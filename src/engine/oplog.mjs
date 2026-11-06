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
import path from 'node:path';
import { sha256, readJson, writeJson, writeAtomic, now } from './util.mjs';
import { mergeContractHash } from './envelope.mjs';
import { oplogRecordToEnvelope, LOCAL_MERGE_CONTRACT } from './envelope-adapters.mjs';

const CHUNK = 1 << 20;
const CLOSE_SNAPSHOT_AT = 200;
const BATCH_BYTES = 1 << 20;
const SLICE_HEADS = 2000;
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

// The heads in a snapshot, flat: path, seq, hash, content hash, deleted, five values per note. Parsing it costs a fifth of one object per note.
const flatHead = (p, h) => [p, h.seq, h.hash, h.ch ?? null, h.deleted ? 1 : 0];
const headsToFlat = (heads) => { const a = []; for (const [p, h] of heads) a.push(...flatHead(p, h)); return a; };
const headsFromFlat = (a) => { const m = new Map(); for (let i = 0; i < a.length; i += 5) m.set(a[i], a[i + 4] ? { seq: a[i + 1], hash: a[i + 2], deleted: true } : { seq: a[i + 1], hash: a[i + 2], ch: a[i + 3] }); return m; };

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

export class OpLog {
  constructor(dir, { segmentBytes = 16 * 1024 * 1024, snapshotEvery = 1000, snapshotSliceAt = 5000, fsync = true, deviceId = null, mergeContract = LOCAL_MERGE_CONTRACT, envelopes = true } = {}) {
    this.dir = dir; this.segmentBytes = segmentBytes; this.snapshotEvery = snapshotEvery; this.snapshotSliceAt = snapshotSliceAt; this.snapshotting = null; this.fsync = fsync;
    this.heads = new Map(); this.headWatch = null; this.seq = 0; this.sinceSnapshot = 0; this.fd = null; this.recovered = [];
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

  open() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.manifest = readJson(this.manifestPath, null) || { version: 1, segments: [] };
    const manifestBefore = JSON.stringify(this.manifest);
    if (!this.manifest.segments.length) this.manifest.segments.push({ name: segName(1), first: 1, last: 0, bytes: 0, sealed: false, created: now() });
    const snap = readJson(this.snapshotPath, null);
    let fromSeg = 0, fromOff = 0;
    if (snap && (snap.version === 1 || snap.version === 2)) {
      this.seq = snap.seq; this.heads = snap.version === 2 ? headsFromFlat(snap.heads) : new Map(Object.entries(snap.heads || {}));
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
      if (!seg.sealed && size > complete) fs.truncateSync(file, complete);   // a torn last line from a crash
      if (!seg.sealed) seg.bytes = complete;
    }
    const active = this.active;
    this.fd = fs.openSync(path.join(this.dir, active.name), 'a', 0o600);
    // nothing replayed and nothing to repair: the file on disk already says this, and a start need not fsync it again
    if (JSON.stringify(this.manifest) !== manifestBefore) this._saveManifest();
    return this;
  }

  get active() { return this.manifest.segments[this.manifest.segments.length - 1]; }

  _apply(rec) {
    this.seq = Math.max(this.seq, rec.seq);
    if (rec.hlc) this.observeClock(rec.hlc);
    if (rec.path) {
      if (this.headWatch) { const h = this.heads.get(rec.path); this.headWatch(rec.path, !!h && !h.deleted, rec.type !== 'delete'); }
      if (rec.type === 'delete') this.heads.set(rec.path, { seq: rec.seq, hash: rec.hash, deleted: true });
      else this.heads.set(rec.path, { seq: rec.seq, hash: rec.hash, ch: rec.data?.ch ?? null });
    }
  }

  /** Append one operation. `op` = { type, path?, agent?, client?, data? }. Returns the stored record. */
  append(op) {
    if (this.fd === null) throw new Error('op log is not open');
    const rec = { seq: this.seq + 1, ts: now(), type: op.type, path: op.path ?? null, agent: op.agent ?? null, client: op.client ?? null, data: op.data ?? null, prev: op.path ? this.heads.get(op.path)?.hash ?? null : null };
    if (this.deviceId) rec.dev = this.deviceId;
    rec.hlc = this.tick();
    rec.hash = recordHash(rec);
    const line = `${JSON.stringify(rec)}\n`;
    // finish a short write; if it cannot finish, cut the partial record off again so the next append starts on a line of its own
    const buf = Buffer.from(line); let done = 0;
    if (this.batching) { this.batchBuf.push(buf); this.batchBytes += buf.length; if (this.batchBytes >= BATCH_BYTES) this._writeBatch(); done = buf.length; }
    else try { while (done < buf.length) { const n = fs.writeSync(this.fd, buf, done, buf.length - done); if (!(n > 0)) throw new Error('no progress'); done += n; } }
    catch (e) { try { fs.ftruncateSync(this.fd, this.active.bytes); } catch {} throw new Error(`op log short write: ${done} of ${buf.length} bytes (${e.message}); the partial record was removed`); }
    if (this.fsync && !this.batching) fs.fdatasyncSync(this.fd);
    const a = this.active; a.bytes += Buffer.byteLength(line); a.last = rec.seq; if (!a.first) a.first = rec.seq;
    this._apply(rec);
    if (this.envelopes) this._buildEnvelope(rec);
    // never inside a group: the active size then counts bytes that are not yet on disk, and a snapshot's offset must not pass them
    if (++this.sinceSnapshot >= this.snapshotEvery && !this.batching) { if (this.heads.size >= this.snapshotSliceAt) this._snapshotInSlices(); else this.snapshot(); }
    if (a.bytes >= this.segmentBytes) this.roll();
    return rec;
  }

  _writeBatch() {
    if (!this.batchBytes) return;
    const b = Buffer.concat(this.batchBuf); this.batchBuf = []; this.batchBytes = 0;
    for (let o = 0; o < b.length;) o += fs.writeSync(this.fd, b, o, b.length - o);
  }
  /**
   * Run appends as one group: one sync at the end and no snapshot in between (a snapshot must never promise bytes that are not yet on
   * disk). Only for records that can be made again from what is still on disk, so a crash inside the group loses nothing: the start's
   * import of notes the log has not seen. A record that was torn is cut on open, and its note is simply not in the log yet.
   */
  group(fn) {
    if (this.batching) return fn();
    this.batching = true; this.batchBuf = []; this.batchBytes = 0;
    try { return fn(); } finally {
      this._writeBatch(); this.batching = false;
      if (this.fd !== null) { if (this.fsync) fs.fdatasyncSync(this.fd); if (this.sinceSnapshot >= this.snapshotEvery) this.snapshot(); }
    }
  }

  _buildEnvelope(rec) {
    try { this.lastEnvelope = oplogRecordToEnvelope(rec, { mergeContractHash: this.mergeContractHash }); this.lastEnvelopeError = null; }
    catch (e) { this.lastEnvelope = null; this.envelopeFailures++; this.lastEnvelopeError = e.message; }
  }

  roll() {
    const a = this.active;
    if (!a.bytes) return;
    if (this.batching) this._writeBatch();
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
    writeAtomic(this.snapshotPath, JSON.stringify({ version: 2, seq: this.seq, hlc: formatHlc(this.clock), at: now(), active: { name: this.active.name, offset: this.active.bytes }, heads: headsToFlat(this.heads) }), 0o600);
    this._saveManifest();
    this.sinceSnapshot = 0;
  }

  /**
   * The same snapshot for a vault too big to serialize in one go: at 50,000 notes that stopped the daemon's thread for 600 ms every
   * 1,000 writes. A few thousand heads per turn of the event loop, written and synced off the thread. It is a fuzzy checkpoint: seq and
   * offset are taken first, and a head that changes meanwhile may be newer than them, which is safe because a snapshot only starts a
   * replay, and replaying from that offset sets every such path to its last record. An old or missing snapshot only means a longer
   * replay, so a kill at any step here loses nothing.
   */
  _snapshotInSlices() {
    if (this.snapshotting) return this.snapshotting;
    this.sinceSnapshot = 0;
    return this.snapshotting = this._writeSlices().catch(() => { /* the next one tries again; the log is untouched */ }).finally(() => { this.snapshotting = null; });
  }
  async _writeSlices() {
    const head = { version: 2, seq: this.seq, hlc: formatHlc(this.clock), at: now(), active: { name: this.active.name, offset: this.active.bytes } };
    const tmp = `${this.snapshotPath}.slices.tmp`;
    const fh = await fs.promises.open(tmp, 'w', 0o600);
    try {
      let out = `${JSON.stringify(head).slice(0, -1)},"heads":[`; let n = 0;
      for (const [p, h] of this.heads) {
        out += `${n++ ? ',' : ''}${JSON.stringify(flatHead(p, h)).slice(1, -1)}`;
        if (n % SLICE_HEADS === 0) { await fh.write(out); out = ''; }
      }
      await fh.write(`${out}]}\n`);
      await fh.sync();
    } finally { await fh.close(); }
    await fs.promises.rename(tmp, this.snapshotPath);
    if (this.fd !== null) this._saveManifest();
  }

  _saveManifest() { writeJson(this.manifestPath, this.manifest, 0o600); }

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

  // A snapshot only shortens the next replay. With little to replay, a close writes none: the next start reads those few records, the same as after a crash.
  close() { if (this.fd !== null) { try { fs.fsyncSync(this.fd); } catch {} fs.closeSync(this.fd); this.fd = null; if (this.sinceSnapshot >= CLOSE_SNAPSHOT_AT || !fs.existsSync(this.snapshotPath)) this.snapshot(); else if (this.sinceSnapshot) this._saveManifest(); } }
}
