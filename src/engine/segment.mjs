// SPDX-License-Identifier: Apache-2.0
// The on-disk segment behind the recall index: immutable files in one folder, read by offset, never parsed whole.
// Fixed-width columns are little-endian typed arrays, so a query reads them without building objects.
// The bytes follow the host, which on every usual Node target (x64 and arm64) is little-endian. head.json names the order, so a folder carried to a host of the other order is rebuilt from the notes.
// Bump SEG_VERSION with any change of these files: an index of another version is rebuilt from the notes.
//   head.json   counts, every 64th dictionary word with its byte offset; written last, so a folder without it is unfinished
//   dict.txt    word, df, row of its first posting; sorted by JavaScript string order
//   ids.bin     u32 section number per posting; tfs.bin u16 count per posting; the same row in both
//   cols.bin    ROW u32 per section: len, meta offset (low, high), meta length, path id, project id, heading offset, review date, key signature
//   heads.bin   headings as UTF-16, the only encoding that returns any JavaScript string unchanged, and fast to decode
//   meta.jsonl  one line per section: line, mtime, snippet, flags. Read only for what is returned
//   names.json  the paths and projects the ids refer to
//   bypath.bin  u32 bucket count, path count, a hash table of path ids, then each path's section numbers
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export const SEG_VERSION = 4;
export const ROW = 9; export const C_LEN = 0, C_MLO = 1, C_MHI = 2, C_MLEN = 3, C_PATH = 4, C_PROJ = 5, C_HEAD = 6, C_RB = 7, C_SIG = 8;
const NO_HEADING = 0x80000000, HAS_FL = 0x80000000; const FLUSH = 1 << 20;
/** A signature of an item key (path#heading). A key absent from a small bitmap of signatures needs no heading. */
export const keySig = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const encodeRb = (rb) => (rb ? Number(rb.replace(/-/g, '')) : 0);
const decodeRb = (v) => { if (!v) return null; const s = String(v).padStart(8, '0'); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`; };
const metaLine = (d) => `${JSON.stringify({ line: d.line, mtime: d.mtime, snippet: d.snippet, fl: d.fl || null })}\n`;
const idOf = (m, k) => { if (k == null) return 0; let v = m.get(k); if (v === undefined) { v = m.size + 1; m.set(Buffer.from(k).toString(), v); } return v; }; // a copy: a view would keep the whole note's text alive

function readAligned(file) { const fd = fs.openSync(file, 'r'); try { const size = fs.fstatSync(fd).size; const b = Buffer.allocUnsafeSlow(size); let at = 0; while (at < size) { const n = fs.readSync(fd, b, at, size - at, at); if (!n) throw new Error(`short read of ${file}`); at += n; } return b; } finally { fs.closeSync(fd); } }
function syncClose(fd) { fs.fsyncSync(fd); fs.closeSync(fd); }
function syncFile(file) { const fd = fs.openSync(file, 'r+'); syncClose(fd); }

// Appends fixed-width values through one buffer, so a whole segment is a few hundred writes rather than one per word.
class Out {
  constructor(file, Type) { this.fd = fs.openSync(file, 'w', 0o600); this.Type = Type; this.a = new Type(FLUSH / Type.BYTES_PER_ELEMENT); this.n = 0; }
  push(v) { this.a[this.n++] = v; if (this.n === this.a.length) this.flush(); }
  flush() { if (this.n) { const b = this.n * this.Type.BYTES_PER_ELEMENT; fs.writeSync(this.fd, new Uint8Array(this.a.buffer, 0, b)); this.n = 0; } }
  all(a) { this.flush(); const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let at = 0; at < b.length;) at += fs.writeSync(this.fd, b, at, Math.min(b.length - at, 1 << 30)); }
  close() { this.flush(); syncClose(this.fd); }
}
class TextOut {
  constructor(file) { this.fd = fs.openSync(file, 'w', 0o600); this.parts = []; this.size = 0; this.bytes = 0; }
  write(b) { this.parts.push(b); this.size += b.length; this.bytes += b.length; if (this.size >= FLUSH) this.flush(); }
  flush() { if (this.size) { fs.writeSync(this.fd, Buffer.concat(this.parts, this.size)); this.parts = []; this.size = 0; } }
  close() { this.flush(); syncClose(this.fd); }
}

// Find a path's sections without a Map of every path on the heap, ready before the first write that needs it.
function pathTable(paths, c, n) {
  const np = paths.length; let nb = 16; while (nb < np * 2) nb *= 2; const t = new Uint32Array(new SharedArrayBuffer((2 + nb + np + 2 + n) * 4)); t[0] = nb; t[1] = np;
  for (let k = 0; k < np; k++) { let h = keySig(paths[k]) & (nb - 1); while (t[2 + h]) h = (h + 1) & (nb - 1); t[2 + h] = k + 1; }
  const O = 2 + nb, R = O + np + 2; for (let i = 0; i < n; i++) t[O + c[i * ROW + C_PATH] + 1]++; for (let k = 1; k < np + 2; k++) t[O + k] += t[O + k - 1]; const at = t.slice(O, O + np + 2); for (let i = 0; i < n; i++) t[R + at[c[i * ROW + C_PATH]]++] = i;
  return t;
}

// The section columns and text files, shared by a first write and a fold.
class SectionWriter {
  constructor(dir, cols) { this.dir = dir; this.cols = cols; this.meta = new TextOut(path.join(dir, 'meta.jsonl')); this.heads = new TextOut(path.join(dir, 'heads.bin')); this.P = new Map(); this.J = new Map(); this.n = 0; this.totalLen = 0; }
  row(len, line, heading, pid, jid, rbv, sig) {
    const o = this.n * ROW; if (o === this.cols.length) { const a = new Uint32Array(Math.max(ROW * 1024, o * 2)); a.set(this.cols); this.cols = a; } // a stream of notes has no known length
    const ml = line.length, at = this.meta.bytes; const c = this.cols; c[o + C_LEN] = len; c[o + C_MLO] = at % 4294967296; c[o + C_MHI] = Math.floor(at / 4294967296); c[o + C_MLEN] = ml; c[o + C_PATH] = pid; c[o + C_PROJ] = jid;
    c[o + C_HEAD] = heading === null ? (this.heads.bytes | NO_HEADING) >>> 0 : this.heads.bytes; c[o + C_RB] = rbv; c[o + C_SIG] = sig; this.meta.write(line); if (heading) this.heads.write(heading); this.totalLen += len; return this.n++;
  }
  doc(d) { const fl = d.fl ? HAS_FL : 0; return this.row(d.len, Buffer.from(metaLine(d)), d.heading === null || d.heading === undefined ? null : Buffer.from(d.heading, 'utf16le'), idOf(this.P, d.path), idOf(this.J, d.project), (encodeRb(d.rb) | fl) >>> 0, keySig(`${d.path}#${d.heading || ''}`)); }
  finish() { this.meta.close(); this.heads.close(); fs.writeFileSync(path.join(this.dir, 'cols.bin'), Buffer.from(this.cols.buffer, 0, this.n * ROW * 4), { mode: 0o600 }); syncFile(path.join(this.dir, 'cols.bin')); fs.writeFileSync(path.join(this.dir, 'names.json'), JSON.stringify({ paths: [...this.P.keys()], projects: [...this.J.keys()] }), { mode: 0o600 }); syncFile(path.join(this.dir, 'names.json')); this.byPath = pathTable([...this.P.keys()], this.cols, this.n); fs.writeFileSync(path.join(this.dir, 'bypath.bin'), Buffer.from(this.byPath.buffer, this.byPath.byteOffset, this.byPath.byteLength), { mode: 0o600 }); syncFile(path.join(this.dir, 'bypath.bin')); }
}
class DictWriter {
  constructor(dir) { this.dir = dir; this.ids = new Out(path.join(dir, 'ids.bin'), Uint32Array); this.tfs = new Out(path.join(dir, 'tfs.bin'), Uint16Array); this.dict = new TextOut(path.join(dir, 'dict.txt')); this.sparse = []; this.row = 0; this.terms = 0; }
  entry(w, df) { const l = Buffer.from(`${w}\t${df}\t${this.row}\n`); if (this.terms++ % 64 === 0) this.sparse.push([w, this.dict.bytes]); this.dict.write(l); this.row += df; }
  close(n, totalLen, headBytes) { this.ids.close(); this.tfs.close(); this.dict.close(); const dir = this.dir; const t = path.join(dir, 'head.json.tmp'); fs.writeFileSync(t, JSON.stringify({ version: SEG_VERSION, endian: os.endianness(), n, totalLen, terms: this.terms, sparse: this.sparse, dictBytes: this.dict.bytes, postings: this.row, headBytes }), { mode: 0o600 }); syncFile(t); fs.renameSync(t, path.join(dir, 'head.json')); }
}

/** Growing typed columns of one posting per row, in section order. No object per posting, so the collector has nothing to walk. */
class PostingRows {
  constructor() { this.n = 0; this.cap = 1 << 20; this.term = new Uint32Array(this.cap); this.doc = new Uint32Array(this.cap); this.tf = new Uint16Array(this.cap); }
  push(t, d, f) {
    if (this.n === this.cap) { this.cap *= 2; const a = new Uint32Array(this.cap), b = new Uint32Array(this.cap), c = new Uint16Array(this.cap); a.set(this.term); b.set(this.doc); c.set(this.tf); this.term = a; this.doc = b; this.tf = c; }
    const i = this.n++; this.term[i] = t; this.doc[i] = d; this.tf[i] = f;
  }
}

/**
 * A first segment, from section objects, which may arrive one at a time: { path, heading, line, len, project, mtime, snippet, rb, fl, terms: [[word, count]] }.
 * Sections go to disk as they pass and only the posting rows stay in memory. Counting per word lays out the sorted words, and one stable pass drops each row in place.
 */
export function writeSeg(dir, docs) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const w = new SectionWriter(dir, new Uint32Array(Array.isArray(docs) ? docs.length * ROW : ROW * 1024)); const rows = new PostingRows(); const termIds = new Map();
  for (const d of docs) { const i = w.doc(d); for (const [t, f] of d.terms) { let id = termIds.get(t); if (id === undefined) { id = termIds.size; termIds.set(Buffer.from(t).toString(), id); } rows.push(id, i, Math.min(f, 65535)); } } // a copy of the word: a view would keep the whole note's text alive
  w.finish(); const dw = new DictWriter(dir);
  const words = [...termIds.keys()].sort(); const df = new Uint32Array(termIds.size), at = new Float64Array(termIds.size); for (let i = 0; i < rows.n; i++) df[rows.term[i]]++;
  let pos = 0; for (const t of words) { const id = termIds.get(t); at[id] = pos; pos += df[id]; dw.entry(t, df[id]); }
  const ids = new Uint32Array(rows.n), tfs = new Uint16Array(rows.n); for (let i = 0; i < rows.n; i++) { const id = rows.term[i], o = at[id]++; ids[o] = rows.doc[i]; tfs[o] = rows.tf[i]; }
  dw.ids.all(ids); dw.tfs.all(tfs); dw.close(w.n, w.totalLen, w.heads.bytes);
  return { n: w.n };
}

/** The sections of an in-memory RecallIndex as writeSeg takes them. */
export function* overlayDocs(ov) { for (const d of ov.docs.values()) { const terms = []; for (let i = 0; i < d.tids.length; i++) terms.push([ov.termList[d.tids[i]], d.tfs[i]]); yield { ...d, terms }; } }

export class Seg {
  constructor(dir, cols = null, byPath = null) {
    this.dir = dir; this.head = JSON.parse(fs.readFileSync(path.join(dir, 'head.json'), 'utf8')); if (this.head.version !== SEG_VERSION || this.head.endian !== os.endianness()) throw new Error(`segment version ${this.head.version}, ${this.head.endian}`);
    this.fdD = fs.openSync(path.join(dir, 'dict.txt'), 'r'); this.fdI = fs.openSync(path.join(dir, 'ids.bin'), 'r'); this.fdT = fs.openSync(path.join(dir, 'tfs.bin'), 'r'); this.fdM = fs.openSync(path.join(dir, 'meta.jsonl'), 'r'); this.c = cols; this.h = null; this.byPath = byPath; this.paths = null;
  }
  close() { for (const f of [this.fdD, this.fdI, this.fdT, this.fdM]) fs.closeSync(f); }
  /** The section columns as one typed array, read once on first use. */
  cols() { if (!this.paths) { if (!this.c) { const b = readAligned(path.join(this.dir, 'cols.bin')); this.c = new Uint32Array(b.buffer, b.byteOffset, b.length / 4); } const nm = JSON.parse(fs.readFileSync(path.join(this.dir, 'names.json'), 'utf8')); this.paths = nm.paths; this.projects = nm.projects; } return this.c; }
  lookup(w) {
    const s = this.head.sparse; let lo = 0, hi = s.length - 1, at = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m][0] <= w) { at = m; lo = m + 1; } else hi = m - 1; }
    if (at < 0) return null; const st = s[at][1], en = at + 1 < s.length ? s[at + 1][1] : this.head.dictBytes; const b = Buffer.allocUnsafe(en - st); fs.readSync(this.fdD, b, 0, b.length, st);
    for (const l of b.toString('utf8').split('\n')) { const i = l.indexOf('\t'); if (l.slice(0, i) === w) { const j = l.indexOf('\t', i + 1); return { df: Number(l.slice(i + 1, j)), row: Number(l.slice(j + 1)) }; } }
    return null;
  }
  ids(e) { const a = new Uint32Array(e.df); fs.readSync(this.fdI, a, 0, e.df * 4, e.row * 4); return a; }
  tfs(e) { const a = new Uint16Array(e.df); fs.readSync(this.fdT, a, 0, e.df * 2, e.row * 2); return a; }
  projectId(p) { this.cols(); if (!this.projIds) this.projIds = new Map(this.projects.map((x, k) => [x, k + 1])); return this.projIds.get(p) || 0; }
  heading(i) { const c = this.cols(), v = c[i * ROW + C_HEAD]; if (v & NO_HEADING) return null; if (!this.h) this.h = readAligned(path.join(this.dir, 'heads.bin')); const e = i + 1 < this.head.n ? (c[(i + 1) * ROW + C_HEAD] & 0x7fffffff) : this.head.headBytes; return this.h.ucs2Slice(v, e); }
  rb(i) { return decodeRb(this.cols()[i * ROW + C_RB] & 0x7fffffff); }
  hasFl(i) { return (this.cols()[i * ROW + C_RB] & HAS_FL) !== 0; }
  meta(i) { const c = this.cols(), o = i * ROW; const b = Buffer.allocUnsafe(c[o + C_MLEN]); fs.readSync(this.fdM, b, 0, b.length, c[o + C_MHI] * 4294967296 + c[o + C_MLO]); return JSON.parse(b.toString('utf8')); }
  /** Section numbers of one note, ascending. */
  ordinalsOf(p) {
    this.cols(); if (!this.byPath) { const b = readAligned(path.join(this.dir, 'bypath.bin')); this.byPath = new Uint32Array(b.buffer, b.byteOffset, b.length / 4); }
    const t = this.byPath, nb = t[0], O = 2 + nb, R = O + t[1] + 2; for (let h = keySig(p) & (nb - 1); ; h = (h + 1) & (nb - 1)) { const k = t[2 + h]; if (!k) return EMPTY; if (this.paths[k - 1] === p) return t.subarray(R + t[O + k], R + t[O + k + 1]); }
  }
}
const EMPTY = new Uint32Array(0);

// One overlay log, as far as a fold needs it: the surviving added sections in order, and the paths retired from the segment.
function readLog(file, end) {
  const live = new Map(); const byPath = new Map(); const retired = new Set(); let id = 0;
  if (end) { const fd = fs.openSync(file, 'r'); const b = Buffer.allocUnsafe(end); let at = 0; while (at < end) { const n = fs.readSync(fd, b, at, end - at, at); if (!n) throw new Error('short overlay log'); at += n; } fs.closeSync(fd);
    let s = 0; while (s < end) { const e = b.indexOf(10, s); const r = JSON.parse(b.toString('utf8', s, e)); s = e + 1; if (r.rm !== undefined) { retired.add(r.rm); for (const k of byPath.get(r.rm) || []) live.delete(k); byPath.delete(r.rm); } else { const k = id++; live.set(k, r); if (!byPath.has(r.path)) byPath.set(r.path, []); byPath.get(r.path).push(k); } } }
  return { docs: [...live.values()], retired };
}

/** Fold: a new segment from the old files and the overlay log up to `logEnd`. Runs on a worker; the old files are not touched. */
export function foldFiles(oldDir, newDir, logFile, logEnd) {
  fs.mkdirSync(newDir, { recursive: true, mode: 0o700 });
  const h = JSON.parse(fs.readFileSync(path.join(oldDir, 'head.json'), 'utf8')); const raw = readAligned(path.join(oldDir, 'cols.bin')); const old = new Uint32Array(raw.buffer, raw.byteOffset, raw.length / 4); const nm = JSON.parse(fs.readFileSync(path.join(oldDir, 'names.json'), 'utf8'));
  const { docs, retired } = readLog(logFile, logEnd);
  const pathId = new Map(nm.paths.map((p, i) => [p, i + 1])); const deadPath = new Uint8Array(nm.paths.length + 1); for (const p of retired) { const k = pathId.get(p); if (k) deadPath[k] = 1; }
  const remap = new Int32Array(h.n).fill(-1); let keep = 0; for (let i = 0; i < h.n; i++) if (!deadPath[old[i * ROW + C_PATH]]) remap[i] = keep++;
  const w = new SectionWriter(newDir, new Uint32Array(new SharedArrayBuffer((keep + docs.length) * ROW * 4))); w.P = pathId; w.J = new Map(nm.projects.map((p, i) => [p, i + 1]));
  // Live sections are copied by offset; a mostly unchanged file costs a few large reads.
  const mo = fs.openSync(path.join(oldDir, 'meta.jsonl'), 'r'); const ho = fs.openSync(path.join(oldDir, 'heads.bin'), 'r'); const mbuf = Buffer.allocUnsafe(FLUSH * 16); const hbuf = Buffer.allocUnsafe(FLUSH * 4);
  const pull = (fd, buf, st, want, pos) => { if (pos >= st.at && pos + want <= st.at + st.len) return pos - st.at; const n = fs.readSync(fd, buf, 0, buf.length, pos); st.at = pos; st.len = n; return 0; }; const ms = { at: 0, len: 0 }, hs = { at: 0, len: 0 };
  for (let i = 0; i < h.n; i++) {
    if (remap[i] < 0) continue; const o = i * ROW; const at = old[o + C_MHI] * 4294967296 + old[o + C_MLO], ml = old[o + C_MLEN]; const big = ml > mbuf.length ? Buffer.allocUnsafe(ml) : mbuf; let line; if (big !== mbuf) { fs.readSync(mo, big, 0, ml, at); line = big; } else { const k = pull(mo, mbuf, ms, ml, at); line = mbuf.subarray(k, k + ml); }
    const hv = old[o + C_HEAD]; let head = null; if (!(hv & NO_HEADING)) { const e = i + 1 < h.n ? (old[o + ROW + C_HEAD] & 0x7fffffff) : h.headBytes; const hl = e - hv; if (hl > hbuf.length) { const x = Buffer.allocUnsafe(hl); fs.readSync(ho, x, 0, hl, hv); head = x; } else { const k = pull(ho, hbuf, hs, hl, hv); head = hbuf.subarray(k, k + hl); } }
    w.row(old[o + C_LEN], Buffer.from(line), head && Buffer.from(head), old[o + C_PATH], old[o + C_PROJ], old[o + C_RB], old[o + C_SIG]);
  }
  fs.closeSync(mo); fs.closeSync(ho);
  const add = new Map(); for (const d of docs) { const i = w.doc(d); for (let k = 0; k < d.t.length; k++) { let a = add.get(d.t[k]); if (!a) add.set(d.t[k], a = []); a.push(i, d.f[k]); } }
  w.finish();
  // Merge the sorted dictionary with the overlay's words; the postings stream in row order, so this is one pass over each file.
  const dw = new DictWriter(newDir); const addWords = [...add.keys()].sort(); let ai = 0;
  const putAdd = (a) => { for (let k = 0; k < a.length; k += 2) { dw.ids.push(a[k]); dw.tfs.push(Math.min(a[k + 1], 65535)); } };
  const fromAdd = (t) => { const a = add.get(t); dw.entry(t, a.length / 2); putAdd(a); };
  const dictText = fs.readFileSync(path.join(oldDir, 'dict.txt'), 'utf8'); const io = fs.openSync(path.join(oldDir, 'ids.bin'), 'r'), to = fs.openSync(path.join(oldDir, 'tfs.bin'), 'r');
  const ibuf = new Uint32Array(FLUSH), tbuf = new Uint16Array(FLUSH); let bufRow = 0, bufLen = 0; const refill = (row) => { const n = fs.readSync(io, ibuf, 0, ibuf.byteLength, row * 4); fs.readSync(to, tbuf, 0, n / 2, row * 2); bufRow = row; bufLen = n / 4; };
  let small = new Uint32Array(1 << 14), smallT = new Uint16Array(1 << 14);
  for (let at = 0; at < dictText.length;) {
    const e = dictText.indexOf('\n', at); const t1 = dictText.indexOf('\t', at), t2 = dictText.indexOf('\t', t1 + 1); const word = dictText.slice(at, t1), df = Number(dictText.slice(t1 + 1, t2)), row = Number(dictText.slice(t2 + 1, e)); at = e + 1;
    while (ai < addWords.length && addWords[ai] < word) fromAdd(addWords[ai++]);
    if (small.length < df) { small = new Uint32Array(df * 2); smallT = new Uint16Array(df * 2); } let u = 0;
    for (let k = 0; k < df; k++) { const r = row + k; if (r < bufRow || r >= bufRow + bufLen) refill(r); const m = remap[ibuf[r - bufRow]]; if (m < 0) continue; small[u] = m; smallT[u++] = tbuf[r - bufRow]; }
    const a = ai < addWords.length && addWords[ai] === word ? add.get(addWords[ai++]) : null; const total = u + (a ? a.length / 2 : 0); if (!total) continue;
    dw.entry(word, total); for (let k = 0; k < u; k++) { dw.ids.push(small[k]); dw.tfs.push(smallT[k]); } if (a) putAdd(a);
  }
  while (ai < addWords.length) fromAdd(addWords[ai++]);
  fs.closeSync(io); fs.closeSync(to); dw.close(w.n, w.totalLen, w.heads.bytes);
  return { n: w.n, terms: dw.terms, cols: w.cols, byPath: w.byPath };
}

export function foldInWorker(oldDir, newDir, logFile, logEnd) {
  return new Promise((res, rej) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { segFold: true, oldDir, newDir, logFile, logEnd } }); w.on('message', res); w.on('error', rej); w.on('exit', (c) => rej(new Error(`fold worker exited ${c}`))); w.unref(); });
}
if (!isMainThread && workerData?.segFold) parentPort.postMessage(foldFiles(workerData.oldDir, workerData.newDir, workerData.logFile, workerData.logEnd));
