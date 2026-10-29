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
import { sha256, readJson, writeJson, now } from './util.mjs';

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

export class OpLog {
  constructor(dir, { segmentBytes = 16 * 1024 * 1024, snapshotEvery = 1000, fsync = true, deviceId = null } = {}) {
    this.dir = dir; this.segmentBytes = segmentBytes; this.snapshotEvery = snapshotEvery; this.fsync = fsync;
    this.heads = new Map(); this.seq = 0; this.sinceSnapshot = 0; this.fd = null; this.recovered = [];
    // Each record names the device that wrote it and carries a hybrid logical clock, so logs from
    // several devices can later be merged in a deterministic order. Records written before this
    // (no dev, no hlc) stay valid: the hash covers only the fields a record has.
    this.deviceId = deviceId; this.clock = { ms: 0, c: 0 };
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

  open() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
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
      const seg = this.manifest.segments[i], file = path.join(this.dir, seg.name);
      let good = i === fromSeg ? fromOff : 0;
      for (const [line, off] of readLines(file, good)) {
        const end = off + Buffer.byteLength(line) + 1;
        let rec; try { rec = JSON.parse(line); } catch { this.recovered.push(`${seg.name}: unreadable record at byte ${off}, skipped`); continue; }
        if (rec.seq <= this.seq) { good = end; continue; }
        this._apply(rec); good = end; this.sinceSnapshot++;
        if (!seg.first || seg.first > rec.seq) seg.first = rec.seq;
        seg.last = rec.seq;
      }
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (!seg.sealed && size > good) fs.truncateSync(file, good);   // a torn last line from a crash
      if (!seg.sealed) seg.bytes = good;
    }
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
    if (this.fd === null) throw new Error('op log is not open');
    const rec = { seq: this.seq + 1, ts: now(), type: op.type, path: op.path ?? null, agent: op.agent ?? null, client: op.client ?? null, data: op.data ?? null, prev: op.path ? this.heads.get(op.path)?.hash ?? null : null };
    if (this.deviceId) rec.dev = this.deviceId;
    rec.hlc = this.tick();
    rec.hash = recordHash(rec);
    const line = `${JSON.stringify(rec)}\n`;
    const written = fs.writeSync(this.fd, line);
    if (written !== Buffer.byteLength(line)) throw new Error(`op log short write: ${written} of ${Buffer.byteLength(line)} bytes`);
    if (this.fsync) fs.fdatasyncSync(this.fd);
    const a = this.active; a.bytes += Buffer.byteLength(line); a.last = rec.seq; if (!a.first) a.first = rec.seq;
    this._apply(rec);
    if (++this.sinceSnapshot >= this.snapshotEvery) this.snapshot();
    if (a.bytes >= this.segmentBytes) this.roll();
    return rec;
  }

  roll() {
    const a = this.active;
    if (!a.bytes) return;
    fs.fsyncSync(this.fd); fs.closeSync(this.fd);
    a.sealed = true; a.sha256 = hashFile(path.join(this.dir, a.name)); a.sealedAt = now();
    const n = this.manifest.segments.length + 1;
    this.manifest.segments.push({ name: segName(n), first: 0, last: 0, bytes: 0, sealed: false, created: now() });
    this.fd = fs.openSync(path.join(this.dir, this.active.name), 'a', 0o600);
    this._saveManifest(); this.snapshot();
  }

  snapshot() {
    writeJson(this.snapshotPath, { version: 1, seq: this.seq, hlc: formatHlc(this.clock), at: now(), active: { name: this.active.name, offset: this.active.bytes }, heads: Object.fromEntries(this.heads) }, 0o600);
    this._saveManifest();
    this.sinceSnapshot = 0;
  }

  _saveManifest() { writeJson(this.manifestPath, this.manifest, 0o600); }

  /** Stream records in order, optionally from a seq and for one path. Bounded memory. */
  *iterate({ fromSeq = 1, path: only = null, raw = false } = {}) {
    for (const seg of this.manifest.segments) {
      if (seg.last && seg.last < fromSeq) continue;
      for (const [line] of readLines(path.join(this.dir, seg.name))) {
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
      const file = path.join(this.dir, seg.name);
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

  close() { if (this.fd !== null) { try { fs.fsyncSync(this.fd); } catch {} fs.closeSync(this.fd); this.fd = null; this.snapshot(); } }
}
