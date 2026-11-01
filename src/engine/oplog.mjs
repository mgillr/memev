// SPDX-License-Identifier: Apache-2.0
// The operation log: append-only, segmented, snapshotted, streamed.
//
//   <dir>/seg-000001.jsonl ...   one JSON record per line, appended, never rewritten
//   <dir>/manifest.json          every segment: first/last seq, bytes, and once sealed its SHA-256
//   <dir>/snapshot.json          the small state needed to resume: last seq, per-path heads, the active
//                                segment and the byte offset the snapshot covers
//
// Memory holds only the per-path heads (one entry per note, never per operation) and the manifest.
// Payloads stay on disk; iterate() streams them back in fixed-size chunks, so a replay of any size
// runs in bounded memory. A segment rolls at `segmentBytes`; a sealed segment's hash is pinned in
// the manifest, and verify() re-checks every seal and every per-path hash chain. Nothing is ever
// summarised, truncated or compacted: every record is recoverable byte for byte.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { sha256, readJson, writeJson, now, machineBootId, pidNamespace, processStart } from './util.mjs';
import { mergeContractHash } from './envelope.mjs';
import { oplogRecordToEnvelope, LOCAL_MERGE_CONTRACT } from './envelope-adapters.mjs';

const CHUNK = 1 << 20;
const segName = (n) => `seg-${String(n).padStart(6, '0')}.jsonl`;

/** Stream the lines of a file from `offset`, synchronously, CHUNK bytes at a time. Yields [line, byteOffset]. */
export function* readLines(file, offset = 0) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return; }
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = offset, rest = Buffer.alloc(0), restStart = offset;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      let data = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0, i;
      while ((i = data.indexOf(10, start)) !== -1) {
        yield [data.subarray(start, i).toString('utf8'), restStart + start];
        start = i + 1;
      }
      rest = Buffer.from(data.subarray(start));
      restStart += start;
    }
    // a trailing partial line (a crash mid-append) is not a record: it is ignored and truncated on open
  } finally { fs.closeSync(fd); }
}

function hashFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = crypto.createHash('sha256');
    const buf = Buffer.alloc(CHUNK); let pos = 0, n;
    while ((n = fs.readSync(fd, buf, 0, CHUNK, pos)) > 0) { h.update(buf.subarray(0, n)); pos += n; }
    return h.digest('hex');
  } finally { fs.closeSync(fd); }
}

export const formatHlc = ({ ms, c }) => `${String(ms).padStart(13, '0')}.${String(c).padStart(4, '0')}`;
export function parseHlc(s) { const m = /^(\d{13})\.(\d{4,})$/.exec(String(s || '')); return m ? { ms: Number(m[1]), c: Number(m[2]) } : null; }
/** Total order for records from several devices: clock, then device id, then seq. Records without a clock sort by ts. */
export function compareRecords(a, b) {
  const ha = a.hlc || `${String(Date.parse(a.ts) || 0).padStart(13, '0')}.0000`, hb = b.hlc || `${String(Date.parse(b.ts) || 0).padStart(13, '0')}.0000`;
  return ha < hb ? -1 : ha > hb ? 1 : String(a.dev || '') < String(b.dev || '') ? -1 : String(a.dev || '') > String(b.dev || '') ? 1 : a.seq - b.seq;
}

export function recordHash(rec) {
  const { hash, ...rest } = rec; void hash;
  return sha256(JSON.stringify(rest));
}

/**
 * The error a second writer gets: the vault's op log is held by another opener, or this process has lost its own lock.
 * `pid` is the holder's pid when its lock file can be read.
 */
export class VaultLocked extends Error {
  constructor(message, holder = {}) { super(message); this.name = 'VaultLocked'; this.code = 'VaultLocked'; this.pid = holder.pid ?? null; this.holder = holder; }
}

const LOCK = 'LOCK';
// The locks this process holds, by the real path of the op log folder: a symlink, a trailing slash or a '..' spelling of one vault is
// one entry, and a second writable open in this process is refused whatever the file says.
const held = new Map();

/** The holder a lock file's bytes name: { pid, host } or {} when they are not a lock. */
function holderOf(bytes) {
  try { const o = JSON.parse(bytes); return o && validPid(o.pid) ? { pid: o.pid, host: o.host ?? null } : {}; } catch { return {}; }
}
const lockedBy = (dir, bytes) => {
  const h = holderOf(bytes);
  return new VaultLocked(h.pid === undefined ? `the vault's op log at ${dir} has a lock file (LOCK) that names no holder` : `the vault's op log at ${dir} is locked by pid ${h.pid}${h.host ? ` on ${h.host}` : ''}`, h);
};

const validPid = (pid) => Number.isInteger(pid) && pid > 0;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const bootTime = () => Date.now() - os.uptime() * 1000;

/** The fields a lock (and the recovery mutex) records about its writer. */
const writerRecord = (token) => ({ pid: process.pid, host: os.hostname(), boot: String(Math.round(bootTime())), start: processStart(process.pid), machine: machineBootId(), ns: pidNamespace(), token });

/** Same host, same boot (os.uptime() times within 120 s), same per-boot machine identifier and same pid namespace: pids are comparable. */
function sameEnvironment(o) {
  return o.host === os.hostname() && Math.abs(Number(o.boot) - bootTime()) <= 120000 && (o.machine ?? null) === machineBootId() && (o.ns ?? null) === pidNamespace();
}

/**
 * Is this lock stale? `bytes` and `ageMs` (the mtime's age) are what the file held when it was read. An empty, unparsable or
 * pid-less lock is held for 60 s. A lock from another host or boot is stale after 90 s. On this host, boot, machine and pid
 * namespace, together and before any pid rule: stale when the pid is not alive, when it is alive with a start time more than 2 s
 * from the recorded one (the pid was reused), or when it is this process's own pid and this process holds no token for it (an
 * earlier run, as in a restarted container). A start time that cannot be read counts as alive.
 */
function isStale(bytes, ageMs) {
  let o = null;
  try { o = JSON.parse(bytes); } catch { /* not a lock */ }
  if (!o || !validPid(o.pid)) return ageMs > 60000;
  if (!sameEnvironment(o)) return ageMs > 90000;
  if (o.pid === process.pid) return ![...held.values()].includes(o.token);
  if (!alive(o.pid)) return true;
  const start = processStart(o.pid);
  return start !== null && typeof o.start === 'number' && Math.abs(start - o.start) > 2000;
}

/** Test seam: MEMEV_LOCK_TEST_PAUSE=after-judge:<ms>,after-rename:<ms> pauses a recoverer at that point. */
function pause(point) {
  for (const spec of String(process.env.MEMEV_LOCK_TEST_PAUSE || '').split(',')) {
    const [name, ms] = spec.split(':');
    if (name === point && Number(ms) > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms));
  }
}

/** A file's bytes and the age of its mtime, or null when it is not there. */
function readAged(file) {
  try { const bytes = fs.readFileSync(file, 'utf8'); return { bytes, age: Date.now() - fs.statSync(file).mtimeMs }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

/**
 * Rename `file` away, and if what was moved is not `bytes` (it changed meanwhile, or another opener's lock stood there) put it
 * back with a link that never replaces a file: it is never moved over a file that exists. Returns true when `bytes` were removed.
 */
function removeIf(file, bytes, tag, afterRename = () => {}) {
  const away = `${file}.stale-${tag}`;
  try { fs.renameSync(file, away); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  afterRename();
  let same = false;
  try { same = fs.readFileSync(away, 'utf8') === bytes; } catch { /* unreadable: not the lock we judged */ }
  if (same) { fs.rmSync(away, { force: true }); return true; }
  try { fs.linkSync(away, file); fs.rmSync(away, { force: true }); } catch { /* a lock stands there: the moved file stays where it is */ }
  return false;
}

/**
 * The lease. It runs in a worker_threads worker, so a main thread blocked in a long synchronous call keeps the lock: every `ms` it
 * sets the lock's mtime to now, after checking that the file still carries `token`. The lock's bytes are never written. When the
 * file is gone, unreadable or another opener's, the worker stops and never renews again.
 */
function renewLoop() {
  const { workerData: { file, token, ms } } = require('node:worker_threads');
  const fs = require('node:fs');
  const timer = setInterval(() => {
    try {
      if (JSON.parse(fs.readFileSync(file, 'utf8')).token !== token) throw new Error('not ours');
      const t = new Date();
      fs.utimesSync(file, t, t);
    } catch { clearInterval(timer); }
  }, ms);
}

export class OpLog {
  constructor(dir, { segmentBytes = 16 * 1024 * 1024, snapshotEvery = 1000, fsync = true, deviceId = null, mergeContract = LOCAL_MERGE_CONTRACT, envelopes = true, readOnly = false } = {}) {
    this.dir = dir; this.readOnly = readOnly; this.token = null; this.segmentBytes = segmentBytes; this.snapshotEvery = snapshotEvery; this.fsync = fsync;
    this.heads = new Map(); this.seq = 0; this.sinceSnapshot = 0; this.fd = null; this.recovered = [];
    // Each record names the device that wrote it and carries a hybrid logical clock, so logs from
    // several devices can later be merged in a deterministic order. Records written before this
    // (no dev, no hlc) stay valid: the hash covers only the fields a record has.
    this.deviceId = deviceId; this.clock = { ms: 0, c: 0 };
    // Every append also builds the operation envelope of the record it wrote (docs/OPERATION-ENVELOPE.md), under the merge
    // contract given here. The envelope is held in memory only: `lastEnvelope` is the one of the latest append, and nothing of it
    // is written to the log. A record that cannot be an envelope is still written (the log is the authority); it is counted.
    this.mergeContractHash = mergeContractHash(mergeContract); this.envelopes = envelopes !== false;
    this.lastEnvelope = null; this.envelopeFailures = 0; this.lastEnvelopeError = null;
  }

  /** The next hybrid logical clock value: wall-clock milliseconds, plus a counter when time stalls or goes back. */
  tick(nowMs = Date.now()) {
    if (nowMs > this.clock.ms) this.clock = { ms: nowMs, c: 0 }; else this.clock = { ms: this.clock.ms, c: this.clock.c + 1 };
    return formatHlc(this.clock);
  }
  /** Merge a clock seen from another device (for sync): later ticks sort after it. */
  observeClock(hlc) { const o = parseHlc(hlc); if (!o) return; if (o.ms > this.clock.ms || (o.ms === this.clock.ms && o.c > this.clock.c)) this.clock = o; }

  get manifestPath() { return path.join(this.dir, 'manifest.json'); }
  get snapshotPath() { return path.join(this.dir, 'snapshot.json'); }
  /** Where a segment's file lives: the log directory, or the archive folder once it has been archived. */
  _segFile(seg) { return path.join(this.dir, seg.archived ? path.join('archive', seg.name) : seg.name); }

  /**
   * Take the lock: .memev/oplog/LOCK, an exclusive create (wx), written whole with the holder's pid, host, boot, start time, machine
   * identifier, pid namespace and a random token, and fsynced. Its bytes never change while it is held.
   */
  _acquire() {
    const key = fs.realpathSync(this.dir), file = path.join(key, LOCK);
    if (held.has(key)) throw new VaultLocked(`the vault's op log at ${key} is already open in this process (pid ${process.pid}); the lock is not re-entrant`, { pid: process.pid, host: os.hostname() });
    const token = crypto.randomBytes(16).toString('hex');
    // an exclusive create of `target` with this process's record in it; false when it already exists, any other error is thrown
    const create = (target, tok) => {
      let fd;
      try { fd = fs.openSync(target, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
      try { fs.writeSync(fd, `${JSON.stringify(writerRecord(tok))}\n`); fs.fsyncSync(fd); } catch (e) { fs.closeSync(fd); fs.rmSync(target, { force: true }); throw e; }
      fs.closeSync(fd);
      return true;
    };
    if (!create(file, token)) this._recover(key, token, create);
    held.set(key, token); this.token = token; this.lockKey = key; this.lockFile = file;
    this.renewer = new Worker(`(${renewLoop})()`, { eval: true, workerData: { file, token, ms: Number(process.env.MEMEV_LOCK_RENEW_MS) || 15000 } });
    this.renewer.on('error', () => {}); this.renewer.unref();
  }

  /**
   * LOCK exists: judge it. A live lock is never moved. A stale one is replaced under the recovery mutex (LOCK.recover, an exclusive
   * create): LOCK is read again inside the mutex and recovery goes on only if its bytes still are the stale lock judged, which is
   * then renamed away, checked once more, and replaced by this opener's own LOCK (an exclusive create); the mutex is released last.
   */
  _recover(key, token, create) {
    const file = path.join(key, LOCK), mutexFile = path.join(key, `${LOCK}.recover`);
    for (let tries = 0; tries < 5; tries++) {
      const seen = readAged(file);
      if (seen === null) { if (create(file, token)) return; continue; }
      if (!isStale(seen.bytes, seen.age)) throw lockedBy(key, seen.bytes);
      pause('after-judge');
      const mtoken = crypto.randomBytes(16).toString('hex');
      if (!create(mutexFile, mtoken)) {
        const m = readAged(mutexFile);
        if (m !== null && m.age > 10000 && isStale(m.bytes, m.age)) removeIf(mutexFile, m.bytes, token);   // a mutex whose writer is gone
        else if (m !== null) throw lockedBy(key, m.bytes);
        continue;
      }
      try {
        const again = readAged(file);
        if (again === null) continue;
        if (again.bytes !== seen.bytes || !isStale(again.bytes, again.age)) throw lockedBy(key, again.bytes);
        if (!removeIf(file, seen.bytes, token, () => pause('after-rename'))) throw lockedBy(key, readAged(file)?.bytes ?? '');
        if (!create(file, token)) throw lockedBy(key, readAged(file)?.bytes ?? '');
        return;
      } finally {
        if (readAged(mutexFile)?.bytes.includes(mtoken)) fs.rmSync(mutexFile, { force: true });
      }
    }
    throw new VaultLocked(`the vault's op log at ${key} is being recovered by another opener`);
  }

  /** Does the lock file still carry this log's token? */
  holds() {
    try { return JSON.parse(fs.readFileSync(this.lockFile, 'utf8')).token === this.token; } catch { return false; }
  }

  /** Before every write to the op log folder: a log that lost its lock writes nothing and fails closed. */
  _assertHeld() {
    this._writable();
    if (this.holds()) return;
    let bytes = '';
    try { bytes = fs.readFileSync(this.lockFile, 'utf8'); } catch { /* the lock is gone */ }
    const h = holderOf(bytes);
    throw new VaultLocked(`this process no longer holds the vault lock on ${this.lockKey}${h.pid === undefined ? '' : `; pid ${h.pid} does`}; nothing more is written`, h);
  }

  /** Give the lock up, if it is still ours: a lock file with another token is never deleted. */
  _release() {
    if (this.token === null) return;
    void this.renewer.terminate();
    try { if (JSON.parse(fs.readFileSync(this.lockFile, 'utf8')).token === this.token) fs.rmSync(this.lockFile, { force: true }); } catch { /* gone or not ours */ }
    held.delete(this.lockKey); this.token = null;
  }

  /** A read-only log never writes: its writers refuse here. */
  _writable() { if (this.readOnly) throw new Error('op log is open read-only'); }

  open() {
    if (!this.readOnly) { fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 }); this._acquire(); }
    try { return this._open(); } catch (e) { this._release(); throw e; }
  }

  _open() {
    this.manifest = readJson(this.manifestPath, null) || { version: 1, segments: [] };
    if (!this.manifest.segments.length) this.manifest.segments.push({ name: segName(1), first: 1, last: 0, bytes: 0, sealed: false, created: now() });
    const snap = readJson(this.snapshotPath, null);
    let fromSeg = 0, fromOff = 0;
    if (snap && snap.version === 1) {
      this.seq = snap.seq; this.heads = new Map(Object.entries(snap.heads || {}));
      if (snap.hlc) this.observeClock(snap.hlc);
      fromSeg = Math.max(0, this.manifest.segments.findIndex((s) => s.name === snap.active?.name));
      fromOff = snap.active?.offset || 0;
    }
    // replay only what the snapshot does not cover: the tail of its segment and any later segment.
    // A line that does not parse in the middle of a segment is torn or edited: it is skipped and
    // reported, and every valid record after it is kept. Only a partial last line (no newline) is
    // a torn tail, and it is truncated only after the good prefix has been read and verified.
    for (let i = fromSeg; i < this.manifest.segments.length; i++) {
      const seg = this.manifest.segments[i], file = this._segFile(seg);
      let good = i === fromSeg ? fromOff : 0;
      let complete = good;   // the end of the last whole line, readable or not: only bytes past it are a torn tail
      for (const [line, off] of readLines(file, good)) {
        const end = off + Buffer.byteLength(line) + 1;
        complete = end;
        let rec; try { rec = JSON.parse(line); } catch { this.recovered.push(`${seg.name}: unreadable record at byte ${off}, skipped`); continue; }
        if (rec.seq <= this.seq) { good = end; continue; }
        this._apply(rec); good = end; this.sinceSnapshot++;
        if (!seg.first || seg.first > rec.seq) seg.first = rec.seq;
        seg.last = rec.seq;
      }
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (!seg.sealed && size > complete && !this.readOnly) fs.truncateSync(file, complete);   // a torn last line from a crash
      if (!seg.sealed) seg.bytes = complete;
    }
    if (this.readOnly) return this;
    const active = this.active;
    this.fd = fs.openSync(path.join(this.dir, active.name), 'a', 0o600);
    this._saveManifest();
    return this;
  }

  get active() { return this.manifest.segments[this.manifest.segments.length - 1]; }

  _apply(rec) {
    this.seq = Math.max(this.seq, rec.seq);
    if (rec.hlc) this.observeClock(rec.hlc);
    if (rec.path) {
      if (rec.type === 'delete') this.heads.set(rec.path, { seq: rec.seq, hash: rec.hash, deleted: true });
      else this.heads.set(rec.path, { seq: rec.seq, hash: rec.hash, ch: rec.data?.ch ?? null });
    }
  }

  /** Append one operation. `op` = { type, path?, agent?, client?, data? }. Returns the stored record. */
  append(op) {
    this._writable();
    if (this.fd === null) throw new Error('op log is not open');
    this._assertHeld();
    const rec = { seq: this.seq + 1, ts: now(), type: op.type, path: op.path ?? null, agent: op.agent ?? null, client: op.client ?? null, data: op.data ?? null, prev: op.path ? this.heads.get(op.path)?.hash ?? null : null };
    if (this.deviceId) rec.dev = this.deviceId;
    rec.hlc = this.tick();
    rec.hash = recordHash(rec);
    const line = `${JSON.stringify(rec)}\n`;
    // finish a short write; if it cannot finish, cut the partial record off again so the next append starts on a line of its own
    const buf = Buffer.from(line); let done = 0;
    try { while (done < buf.length) { const n = fs.writeSync(this.fd, buf, done, buf.length - done); if (!(n > 0)) throw new Error('no progress'); done += n; } }
    catch (e) { try { fs.ftruncateSync(this.fd, this.active.bytes); } catch {} throw new Error(`op log short write: ${done} of ${buf.length} bytes (${e.message}); the partial record was removed`); }
    if (this.fsync) fs.fdatasyncSync(this.fd);
    const a = this.active; a.bytes += Buffer.byteLength(line); a.last = rec.seq; if (!a.first) a.first = rec.seq;
    this._apply(rec);
    if (this.envelopes) this._buildEnvelope(rec);
    if (++this.sinceSnapshot >= this.snapshotEvery) this.snapshot();
    if (a.bytes >= this.segmentBytes) this.roll();
    return rec;
  }

  _buildEnvelope(rec) {
    try { this.lastEnvelope = oplogRecordToEnvelope(rec, { mergeContractHash: this.mergeContractHash }); this.lastEnvelopeError = null; }
    catch (e) { this.lastEnvelope = null; this.envelopeFailures++; this.lastEnvelopeError = e.message; }
  }

  roll() {
    this._assertHeld();
    const a = this.active;
    if (!a.bytes) return;
    fs.fsyncSync(this.fd); fs.closeSync(this.fd);
    a.sealed = true; a.sha256 = hashFile(path.join(this.dir, a.name)); a.sealedAt = now();
    const n = this.manifest.segments.length + 1;
    this.manifest.segments.push({ name: segName(n), first: 0, last: 0, bytes: 0, sealed: false, created: now() });
    this.fd = fs.openSync(path.join(this.dir, this.active.name), 'a', 0o600);
    this._saveManifest(); this.snapshot();
  }

  /**
   * Move every sealed segment into the archive folder. Nothing is deleted: the file is renamed, its
   * hash stays pinned in the manifest, and iterate() and verify() read it back from the archive.
   * Returns the number of segments moved.
   */
  archiveSealed() {
    this._assertHeld();
    const arch = path.join(this.dir, 'archive');
    let moved = 0;
    for (const seg of this.manifest.segments) {
      if (!seg.sealed || seg.archived) continue;
      const from = path.join(this.dir, seg.name);
      if (!fs.existsSync(from)) continue;
      fs.mkdirSync(arch, { recursive: true });
      fs.renameSync(from, path.join(arch, seg.name));
      seg.archived = true;
      moved++;
    }
    if (moved) { this._saveManifest(); this.snapshot(); }
    return moved;
  }

  snapshot() {
    this._assertHeld();
    writeJson(this.snapshotPath, { version: 1, seq: this.seq, hlc: formatHlc(this.clock), at: now(), active: { name: this.active.name, offset: this.active.bytes }, heads: Object.fromEntries(this.heads) }, 0o600);
    this._saveManifest();
    this.sinceSnapshot = 0;
  }

  _saveManifest() { this._assertHeld(); writeJson(this.manifestPath, this.manifest, 0o600); }

  /** Stream records in order, optionally from a seq and for one path. Bounded memory. */
  *iterate({ fromSeq = 1, path: only = null, raw = false } = {}) {
    for (const seg of this.manifest.segments) {
      if (seg.last && seg.last < fromSeq) continue;
      for (const [line] of readLines(this._segFile(seg))) {
        if (!line) continue;
        if (raw) { yield line; continue; }
        let rec; try { rec = JSON.parse(line); } catch { continue; }   // an unreadable line is not a record: skip it, as verify() does
        if (rec.seq < fromSeq) continue;
        if (only && rec.path !== only) continue;
        yield rec;
      }
    }
  }

  /** Re-check every sealed segment's hash, every record hash and every per-path chain. Streams. */
  verify() {
    const errors = []; const last = new Map(); let ops = 0, prevSeq = 0;
    for (const seg of this.manifest.segments) {
      const file = this._segFile(seg);
      if (seg.sealed && seg.sha256 && hashFile(file) !== seg.sha256) errors.push(`${seg.name}: sealed hash does not match`);
      for (const [line] of readLines(file)) {
        if (!line) continue;
        let rec; try { rec = JSON.parse(line); } catch { errors.push(`${seg.name}: unreadable record`); continue; }
        ops++;
        if (rec.seq !== prevSeq + 1) errors.push(`seq gap before ${rec.seq}`);
        prevSeq = rec.seq;
        if (recordHash(rec) !== rec.hash) errors.push(`record ${rec.seq}: hash does not match its content`);
        if (rec.path) { if ((last.get(rec.path) ?? null) !== rec.prev) errors.push(`record ${rec.seq}: chain break on ${rec.path}`); last.set(rec.path, rec.hash); }
      }
    }
    return { ok: errors.length === 0, ops, segments: this.manifest.segments.length, errors: errors.slice(0, 20) };
  }

  stats() {
    const bytes = this.manifest.segments.reduce((s, x) => s + (x.bytes || 0), 0);
    return { seq: this.seq, segments: this.manifest.segments.length, sealed: this.manifest.segments.filter((s) => s.sealed).length, bytes, paths: this.heads.size };
  }

  close() {
    if (this.fd === null) return;
    try { fs.fsyncSync(this.fd); } catch {}
    fs.closeSync(this.fd); this.fd = null;
    try { this.snapshot(); } finally { this._release(); }
  }
}
