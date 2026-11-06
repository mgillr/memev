// SPDX-License-Identifier: Apache-2.0
// The on-disk segment behind the recall index: immutable files in one folder, read by offset, never parsed whole.
// Fixed-width columns are typed arrays, so a query reads them without building objects.
// The bytes follow the host, which on every usual Node target (x64 and arm64) is little-endian. head.json names the order, so a folder carried to a host of the other order is rebuilt from the notes.
// Bump SEG_VERSION with any change of these files: an index of another version is rebuilt from the notes.
//   head.json   counts, every 64th dictionary word with its byte offset, each file's size and sha-256, and a sum of itself; written last, so a folder without it is unfinished
//   dict.txt    word, df, row of its first posting, a check of that word's postings, a check of the line; sorted by JavaScript string order
//   ids.bin     u32 section number per posting; tfs.bin u16 count per posting; the same row in both
//   cols.bin    ROW u32 per section: len, meta offset (low, high), meta length, path id, project id, heading offset, review date, key signature
//   heads.bin   headings as UTF-16, the only encoding that returns any JavaScript string unchanged, and fast to decode
//   meta.jsonl  one line per section: line, mtime, snippet, flags, and a check of the line and its note's path. Read only for what is returned
//   names.json  the paths and projects the ids refer to
//   bypath.bin  u32 bucket count, path count, a hash table of path ids, then each path's section numbers
//
// What is checked, and when. Opening reads head.json and looks at the other files' sizes and types, so a start costs the same whatever
// the size of the index. A file read whole (cols, names, heads, bypath) is checked against its sum as it is read. The big files are read
// by offset, so what a query reads carries a check of its own: every line of a dictionary block, each word's postings and counts, each meta
// line. So damage is found by the read that meets it, however few bytes it touched, and an answer is never built on it. The whole-file sums
// of the big files find what no query has read yet, behind the start (the sweep), in memev doctor and before a fold, so damage is never
// carried into a new generation. Any failure throws SegDamage, and the index is rebuilt from the notes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export const SEG_VERSION = 5;
export const ROW = 9; export const C_LEN = 0, C_MLO = 1, C_MHI = 2, C_MLEN = 3, C_PATH = 4, C_PROJ = 5, C_HEAD = 6, C_RB = 7, C_SIG = 8;
const NO_HEADING = 0x80000000, HAS_FL = 0x80000000; const FLUSH = 1 << 20;
export const SEG_FILES = ['dict.txt', 'ids.bin', 'tfs.bin', 'cols.bin', 'heads.bin', 'meta.jsonl', 'names.json', 'bypath.bin'];
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
/** A generation's files are not what was written. The notes are the record, so the index is rebuilt from them. A query that meets this gets it as its error. */
export class SegDamage extends Error { constructor(why) { super(`the recall index is damaged and is being rebuilt from the notes: ${why}`); this.name = 'SegDamage'; this.code = 'index_rebuilding'; this.why = why; } }
/** A path the index may hand out: relative, with no step up and nothing a vault path never holds. A forged or damaged line cannot name a file outside the vault. */
export const indexablePath = (p) => typeof p === 'string' && p.length > 0 && !/[\u0000-\u001f\u007f]/.test(p) && !p.split('/').some((x) => x === '..' || x === '.' || x === '') && !p.startsWith('/');
/** A signature of an item key (path#heading). A key absent from a small bitmap of signatures needs no heading. */
export const keySig = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const encodeRb = (rb) => (rb ? Number(rb.replace(/-/g, '')) : 0);
const decodeRb = (v) => { if (!v) return null; const s = String(v).padStart(8, '0'); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`; };
/** A JSON object with a check of its own text added as its last field. `salt` binds it to what is not in it. Damage and a line moved from elsewhere both fail it. */
export const sealLine = (json, salt = '') => `${json.slice(0, -1)},"k":${keySig(`${salt}${json}`)}}`;
export function openLine(text, salt = '') {
  const at = text.lastIndexOf(',"k":'); if (at < 0 || !text.endsWith('}')) return null;
  const json = `${text.slice(0, at)}}`; if (keySig(`${salt}${json}`) !== Number(text.slice(at + 5, -1))) return null;
  try { return JSON.parse(json); } catch { return null; }
}
/** A check of one word's postings: each step is one-to-one, so one changed value always changes the result. */
export const listSig = (word, ids, tfs, n = ids.length) => { let h = keySig(word); for (let k = 0; k < n; k++) { h = Math.imul(h ^ ids[k], 16777619); h = Math.imul(h ^ tfs[k], 16777619); } return h >>> 0; };
const metaLine = (d) => `${sealLine(JSON.stringify({ line: d.line, mtime: d.mtime, snippet: d.snippet, fl: d.fl || null }), d.path)}\n`;
const idOf = (m, k) => { if (k == null) return 0; let v = m.get(k); if (v === undefined) { v = m.size + 1; m.set(Buffer.from(k).toString(), v); } return v; }; // a copy: a view would keep the whole note's text alive

function readAligned(file) { const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); try { if (!fs.fstatSync(fd).isFile()) throw new Error(`${file} is not a file`); const size = fs.fstatSync(fd).size; const b = Buffer.allocUnsafeSlow(size); let at = 0; while (at < size) { const n = fs.readSync(fd, b, at, size - at, at); if (!n) throw new Error(`short read of ${file}`); at += n; } return b; } finally { fs.closeSync(fd); } }
const sumOf = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** The sum of a file by reading it, without holding it in memory. A link is not followed. */
export function fileSum(file, buf = Buffer.allocUnsafe(FLUSH)) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
  try { const h = crypto.createHash('sha256'); let pos = 0, n; while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) { h.update(buf.subarray(0, n)); pos += n; } return h.digest('hex'); } finally { fs.closeSync(fd); }
}
/** Every file of a generation against the sums in its head: what is wrong, or null. The whole-file check, so it costs a read of the whole index: a worker's job, or a command's. */
export function verifySegFiles(dir, head) {
  const buf = Buffer.allocUnsafe(FLUSH);
  for (const f of SEG_FILES) { let sum; try { sum = fileSum(path.join(dir, f), buf); } catch (e) { return `${f}: ${e.code || e.message}`; } if (sum !== head.sums?.[f]) return `${f} differs from its checksum`; }
  return null;
}
const selfSum = (h) => { const { self, ...rest } = h; void self; return sumOf(JSON.stringify(rest)); };
const uint = (x) => Number.isSafeInteger(x) && x >= 0;
/** A head with its sums and sizes: what is wrong with it, or null. Nothing here reads another file. */
function headProblem(h) {
  if (selfSum(h) !== h.self) return 'head.json differs from its checksum';
  for (const k of ['n', 'totalLen', 'terms', 'dictBytes', 'postings', 'headBytes']) if (!uint(h[k])) return `head.json: ${k} is not a count`;
  if (h.n > 2 ** 32 || h.postings > 2 ** 40) return 'head.json: a count past what the columns can hold';
  if (!Array.isArray(h.sparse) || h.sparse.length !== Math.ceil(h.terms / 64)) return 'head.json: the word samples do not match the word count';
  for (let i = 0; i < h.sparse.length; i++) { const e = h.sparse[i]; if (!Array.isArray(e) || typeof e[0] !== 'string' || !uint(e[1]) || e[1] >= h.dictBytes || (i === 0 ? e[1] !== 0 : !(h.sparse[i - 1][0] < e[0] && h.sparse[i - 1][1] < e[1]))) return `head.json: word sample ${i} is out of order or out of range`; }
  if (!h.sizes || !h.sums) return 'head.json has no sizes or sums';
  for (const f of SEG_FILES) if (!uint(h.sizes[f]) || typeof h.sums[f] !== 'string') return `head.json: nothing recorded for ${f}`;
  const want = { 'dict.txt': h.dictBytes, 'ids.bin': h.postings * 4, 'tfs.bin': h.postings * 2, 'cols.bin': h.n * ROW * 4, 'heads.bin': h.headBytes };
  for (const f in want) if (h.sizes[f] !== want[f]) return `head.json: the size of ${f} does not follow from its counts`;
  return null;
}
/** Read and check a generation's head: a SegDamage when it is damaged, a plain Error when it is simply another version. */
export function readHead(dir) {
  let head, text;
  try { const fd = fs.openSync(path.join(dir, 'head.json'), fs.constants.O_RDONLY | NOFOLLOW); try { text = fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); } } catch (e) { throw new SegDamage(`head.json: ${e.code || e.message}`); }
  try { head = JSON.parse(text); } catch { throw new SegDamage('head.json does not parse'); }
  if (head === null || typeof head !== 'object' || Array.isArray(head)) throw new SegDamage('head.json is not an object');
  if (head.version !== SEG_VERSION || head.endian !== os.endianness()) { if (head.version === undefined || head.endian === undefined) throw new SegDamage('head.json has no version'); throw new Error(`segment version ${head.version}, ${head.endian}`); }
  const why = headProblem(head); if (why) throw new SegDamage(why);
  return head;
}
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
  entry(w, df, sig) { const text = `${w}\t${df}\t${this.row}\t${sig}`; const l = Buffer.from(`${text}\t${keySig(text)}\n`); if (this.terms++ % 64 === 0) this.sparse.push([w, this.dict.bytes]); this.dict.write(l); this.row += df; }
  close(n, totalLen, headBytes) {
    this.ids.close(); this.tfs.close(); this.dict.close(); const dir = this.dir; const t = path.join(dir, 'head.json.tmp'); const sizes = {}, sums = {}; const buf = Buffer.allocUnsafe(FLUSH);
    for (const f of SEG_FILES) { sizes[f] = fs.statSync(path.join(dir, f)).size; sums[f] = fileSum(path.join(dir, f), buf); }
    const head = { version: SEG_VERSION, endian: os.endianness(), n, totalLen, terms: this.terms, sparse: this.sparse, dictBytes: this.dict.bytes, postings: this.row, headBytes, sizes, sums }; head.self = selfSum(head);
    fs.writeFileSync(t, JSON.stringify(head), { mode: 0o600 }); syncFile(t); fs.renameSync(t, path.join(dir, 'head.json'));
  }
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
  let pos = 0; for (const t of words) { const id = termIds.get(t); at[id] = pos; pos += df[id]; }
  const ids = new Uint32Array(rows.n), tfs = new Uint16Array(rows.n); for (let i = 0; i < rows.n; i++) { const id = rows.term[i], o = at[id]++; ids[o] = rows.doc[i]; tfs[o] = rows.tf[i]; }
  pos = 0; for (const t of words) { const d = df[termIds.get(t)]; dw.entry(t, d, listSig(t, ids.subarray(pos, pos + d), tfs.subarray(pos, pos + d))); pos += d; }
  dw.ids.all(ids); dw.tfs.all(tfs); dw.close(w.n, w.totalLen, w.heads.bytes);
  return { n: w.n };
}

/** The sections of an in-memory RecallIndex as writeSeg takes them. */
export function* overlayDocs(ov) { for (const d of ov.docs.values()) { const terms = []; for (let i = 0; i < d.tids.length; i++) terms.push([ov.termList[d.tids[i]], d.tfs[i]]); yield { ...d, terms }; } }

export class Seg {
  constructor(dir, cols = null, byPath = null) {
    this.dir = dir; this.head = readHead(dir); this.onDamage = null; const h = this.head; this.fds = []; const big = {};
    try {
      for (const f of ['dict.txt', 'ids.bin', 'tfs.bin', 'meta.jsonl']) { const fd = fs.openSync(path.join(dir, f), fs.constants.O_RDONLY | NOFOLLOW); this.fds.push(fd); const st = fs.fstatSync(fd); if (!st.isFile()) throw new SegDamage(`${f} is not a file`); if (st.size !== h.sizes[f]) throw new SegDamage(`${f} is ${st.size} bytes, not the ${h.sizes[f]} recorded`); big[f] = fd; }
      for (const f of ['cols.bin', 'heads.bin', 'names.json', 'bypath.bin']) { const st = fs.lstatSync(path.join(dir, f)); if (!st.isFile()) throw new SegDamage(`${f} is not a file`); if (st.size !== h.sizes[f]) throw new SegDamage(`${f} is ${st.size} bytes, not the ${h.sizes[f]} recorded`); }
    } catch (e) { this.close(); if (e instanceof SegDamage) throw e; throw new SegDamage(e.code ? `${path.basename(e.path || '')} ${e.code}` : e.message); }
    this.fdD = big['dict.txt']; this.fdI = big['ids.bin']; this.fdT = big['tfs.bin']; this.fdM = big['meta.jsonl']; this.c = cols; this.h = null; this.byPath = byPath; this.paths = null; this.prebuilt = cols !== null;
  }
  close() { for (const f of this.fds) fs.closeSync(f); this.fds = []; }
  /** Say so once, and stop: nothing read from here on may be believed. */
  _bad(why) { const e = new SegDamage(why); this.onDamage?.(e); throw e; }
  _whole(f) { let b; try { b = readAligned(path.join(this.dir, f)); } catch (e) { return this._bad(`${f}: ${e.code || e.message}`); } if (b.length !== this.head.sizes[f] || sumOf(b) !== this.head.sums[f]) return this._bad(`${f} differs from its checksum`); return b; }
  /** The section columns as one typed array, read once on first use, with the names they point at. Either may be damaged in a way that keeps its size, so both are held to their sums here: every path a hit or a scope check sees comes through this. */
  cols() {
    if (!this.paths) {
      const n = this.head.n; if (!this.c) { const b = this._whole('cols.bin'); this.c = new Uint32Array(b.buffer, b.byteOffset, b.length / 4); }
      let nm; try { nm = JSON.parse(this._whole('names.json').toString('utf8')); } catch (e) { if (e instanceof SegDamage) throw e; this._bad('names.json does not parse'); }
      if (!Array.isArray(nm?.paths) || !Array.isArray(nm.projects) || !nm.paths.every(indexablePath) || !nm.projects.every((p) => typeof p === 'string')) this._bad('names.json is not a list of note paths');
      if (!this.prebuilt) {
        const c = this.c, np = nm.paths.length, nj = nm.projects.length, metaEnd = this.head.sizes['meta.jsonl'], headEnd = this.head.headBytes; let ha = 0;
        for (let i = 0, o = 0; i < n; i++, o += ROW) { const hv = c[o + C_HEAD] & 0x7fffffff; if (c[o + C_PATH] < 1 || c[o + C_PATH] > np || c[o + C_PROJ] > nj || c[o + C_MHI] * 4294967296 + c[o + C_MLO] + c[o + C_MLEN] > metaEnd || hv < ha || hv > headEnd) this._bad(`cols.bin: section ${i} is out of range`); ha = hv; }
      }
      this.paths = nm.paths; this.projects = nm.projects;
    }
    return this.c;
  }
  lookup(w) {
    const s = this.head.sparse; let lo = 0, hi = s.length - 1, at = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m][0] <= w) { at = m; lo = m + 1; } else hi = m - 1; }
    if (at < 0) return null; const st = s[at][1], en = at + 1 < s.length ? s[at + 1][1] : this.head.dictBytes; const b = Buffer.allocUnsafe(en - st); if (fs.readSync(this.fdD, b, 0, b.length, st) !== b.length) this._bad('dict.txt is shorter than recorded');
    // A block starts at the word the head says, its words ascend and each row follows the last. Damage that keeps the size shows here, on the query that meets it.
    const lines = b.toString('utf8').split('\n'); if (lines.pop() !== '') this._bad('dict.txt: a block does not end a line'); if (lines[0]?.slice(0, lines[0].indexOf('\t')) !== s[at][0]) this._bad('dict.txt: a block does not start at its word');
    let found = null, prev = null, next = null;
    for (const l of lines) {
      const end = l.lastIndexOf('\t'), i = l.indexOf('\t'), j = l.indexOf('\t', i + 1), m = l.indexOf('\t', j + 1); if (i <= 0 || j < 0 || m < 0 || end <= m - 1 || keySig(l.slice(0, end)) !== Number(l.slice(end + 1))) this._bad('dict.txt: a line fails its check');
      const word = l.slice(0, i), df = Number(l.slice(i + 1, j)), row = Number(l.slice(j + 1, m));
      if (!uint(df) || df === 0 || !uint(row) || row + df > this.head.postings || (next !== null && row !== next) || (prev !== null && !(prev < word))) this._bad('dict.txt: a line is out of order or out of range');
      prev = word; next = row + df; if (word === w) found = { word, df, row, sig: Number(l.slice(m + 1, end)) };
    }
    return found;
  }
  ids(e) { const a = new Uint32Array(e.df); if (fs.readSync(this.fdI, a, 0, e.df * 4, e.row * 4) !== e.df * 4) this._bad('ids.bin is shorter than recorded'); const n = this.head.n; let was = -1; for (let k = 0; k < a.length; k++) { const i = a[k]; if (i <= was || i >= n) this._bad('ids.bin: a posting list is out of order or out of range'); was = i; } return a; }
  tfs(e) { const a = new Uint16Array(e.df); if (fs.readSync(this.fdT, a, 0, e.df * 2, e.row * 2) !== e.df * 2) this._bad('tfs.bin is shorter than recorded'); for (let k = 0; k < a.length; k++) if (!a[k]) this._bad('tfs.bin: a count of nothing'); return a; }
  /** A word's postings and counts are what its dictionary line says they were. */
  checkList(e, ids, tfs) { if (listSig(e.word, ids, tfs, e.df) !== e.sig) this._bad(`ids.bin or tfs.bin: the postings of a word fail their check`); }
  /** What a pure test of a path said, by path id: 0 not asked yet, 1 kept, 2 dropped. A segment's paths never change, so it is kept per test. */
  pathVerdicts(fn) { this.cols(); if (!this.verdicts) this.verdicts = new WeakMap(); let v = this.verdicts.get(fn); if (!v) { v = new Uint8Array(this.paths.length + 1); this.verdicts.set(fn, v); } return v; }
  projectId(p) { this.cols(); if (!this.projIds) this.projIds = new Map(this.projects.map((x, k) => [x, k + 1])); return this.projIds.get(p) || 0; }
  heading(i) { const c = this.cols(), v = c[i * ROW + C_HEAD]; if (v & NO_HEADING) return null; if (!this.h) this.h = this._whole('heads.bin'); const e = i + 1 < this.head.n ? (c[(i + 1) * ROW + C_HEAD] & 0x7fffffff) : this.head.headBytes; return this.h.ucs2Slice(v, e); }
  rb(i) { return decodeRb(this.cols()[i * ROW + C_RB] & 0x7fffffff); }
  hasFl(i) { return (this.cols()[i * ROW + C_RB] & HAS_FL) !== 0; }
  meta(i) { const c = this.cols(), o = i * ROW; const b = Buffer.allocUnsafe(c[o + C_MLEN]); if (fs.readSync(this.fdM, b, 0, b.length, c[o + C_MHI] * 4294967296 + c[o + C_MLO]) !== b.length) this._bad('meta.jsonl is shorter than recorded'); const m = openLine(b.toString('utf8').trimEnd(), this.paths[c[o + C_PATH] - 1]); if (!m) this._bad(`meta.jsonl: section ${i} fails its check`); return m; }
  _table() {
    if (this.byPath) return this.byPath;
    const b = this._whole('bypath.bin'); if (b.length % 4 || b.length < 8) this._bad('bypath.bin: its size does not fit'); const t = new Uint32Array(b.buffer, b.byteOffset, b.length / 4); const nb = t[0], np = t[1], n = this.head.n;
    if (nb < 16 || (nb & (nb - 1)) || np !== this.paths.length || nb < np * 2 || t.length !== 2 + nb + np + 2 + n || t[2 + nb] !== 0 || t[2 + nb + np + 1] !== n) this._bad('bypath.bin: its counts do not fit');
    for (let k = 0, O = 2 + nb; k < np + 1; k++) if (t[O + k] > t[O + k + 1]) this._bad('bypath.bin: its offsets do not ascend');
    return this.byPath = t;
  }
  /** Section numbers of one note, ascending. The probe stops at the size of the table, whatever the file holds: a healthy table is at most half full. */
  ordinalsOf(p) {
    this.cols(); const t = this._table(), nb = t[0], np = t[1], O = 2 + nb, R = O + np + 2;
    for (let h = keySig(p) & (nb - 1), left = nb; left > 0; h = (h + 1) & (nb - 1), left--) {
      const k = t[2 + h]; if (!k) return EMPTY; if (k > np) this._bad('bypath.bin: a bucket names no path');
      if (this.paths[k - 1] === p) { const a = t.subarray(R + t[O + k], R + t[O + k + 1]); const c = this.c, n = this.head.n; let was = -1; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x <= was || x >= n || c[x * ROW + C_PATH] !== k) this._bad('bypath.bin: a section of another note'); was = x; } return a; }
    }
    return this._bad('bypath.bin: a table with no empty bucket');
  }
}
const EMPTY = new Uint32Array(0); const NONE = [];

/** One line of an overlay log: { rm: path } or a section. Anything else is damage, whether or not it parses. */
export function readOverlayLine(text) {
  const r = openLine(text); if (r === null || typeof r !== 'object') throw new SegDamage('overlay.log: a line fails its check');
  if (r.rm !== undefined) { if (!indexablePath(r.rm)) throw new SegDamage('overlay.log: a removal of no note'); return r; }
  if (!indexablePath(r.path) || !Array.isArray(r.t) || !Array.isArray(r.f) || r.t.length !== r.f.length || !uint(r.len) || !r.t.every((w) => typeof w === 'string') || !r.f.every(uint)) throw new SegDamage('overlay.log: a section of the wrong shape');
  return r;
}

// One overlay log, as far as a fold needs it: the surviving added sections in order, and the paths retired from the segment.
function readLog(file, end) {
  const live = new Map(); const byPath = new Map(); const retired = new Set(); let id = 0;
  if (end) { const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); const b = Buffer.allocUnsafe(end); let at = 0; while (at < end) { const n = fs.readSync(fd, b, at, end - at, at); if (!n) throw new SegDamage('overlay.log is shorter than saved'); at += n; } fs.closeSync(fd);
    let s = 0; while (s < end) { const e = b.indexOf(10, s); if (e < 0) throw new SegDamage('overlay.log: a line with no end'); const r = readOverlayLine(b.toString('utf8', s, e)); s = e + 1; if (r.rm !== undefined) { retired.add(r.rm); for (const k of byPath.get(r.rm) || []) live.delete(k); byPath.delete(r.rm); } else { const k = id++; live.set(k, r); if (!byPath.has(r.path)) byPath.set(r.path, []); byPath.get(r.path).push(k); } } }
  return { docs: [...live.values()], retired };
}

/** Fold: a new segment from the old files and the overlay log up to `logEnd`. Runs on a worker; the old files are not touched. */
export function foldFiles(oldDir, newDir, logFile, logEnd) {
  fs.mkdirSync(newDir, { recursive: true, mode: 0o700 });
  // Sums first: a fold writes new sums over what it reads, so damage it carried across would then look sound.
  const h = readHead(oldDir); const why = verifySegFiles(oldDir, h); if (why) throw new SegDamage(why);
  const raw = readAligned(path.join(oldDir, 'cols.bin')); const old = new Uint32Array(raw.buffer, raw.byteOffset, raw.length / 4); const nm = JSON.parse(fs.readFileSync(path.join(oldDir, 'names.json'), 'utf8'));
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
  const addSig = (h, a) => { for (let k = 0; k < a.length; k += 2) { h = Math.imul(h ^ a[k], 16777619); h = Math.imul(h ^ Math.min(a[k + 1], 65535), 16777619); } return h >>> 0; };
  const fromAdd = (t) => { const a = add.get(t); dw.entry(t, a.length / 2, addSig(keySig(t), a)); putAdd(a); };
  const dictText = fs.readFileSync(path.join(oldDir, 'dict.txt'), 'utf8'); const io = fs.openSync(path.join(oldDir, 'ids.bin'), 'r'), to = fs.openSync(path.join(oldDir, 'tfs.bin'), 'r');
  const ibuf = new Uint32Array(FLUSH), tbuf = new Uint16Array(FLUSH); let bufRow = 0, bufLen = 0; const refill = (row) => { const n = fs.readSync(io, ibuf, 0, ibuf.byteLength, row * 4); fs.readSync(to, tbuf, 0, n / 2, row * 2); bufRow = row; bufLen = n / 4; };
  let small = new Uint32Array(1 << 14), smallT = new Uint16Array(1 << 14);
  for (let at = 0; at < dictText.length;) {
    const e = dictText.indexOf('\n', at); const t1 = dictText.indexOf('\t', at), t2 = dictText.indexOf('\t', t1 + 1), t3 = dictText.indexOf('\t', t2 + 1); if (e < 0 || t1 < 0 || t2 < 0 || t3 < 0) throw new SegDamage('dict.txt: a line is not a word and its numbers'); const word = dictText.slice(at, t1), df = Number(dictText.slice(t1 + 1, t2)), row = Number(dictText.slice(t2 + 1, t3)); at = e + 1;
    while (ai < addWords.length && addWords[ai] < word) fromAdd(addWords[ai++]);
    if (small.length < df) { small = new Uint32Array(df * 2); smallT = new Uint16Array(df * 2); } let u = 0;
    for (let k = 0; k < df; k++) { const r = row + k; if (r < bufRow || r >= bufRow + bufLen) refill(r); const m = remap[ibuf[r - bufRow]]; if (m < 0) continue; small[u] = m; smallT[u++] = tbuf[r - bufRow]; }
    const a = ai < addWords.length && addWords[ai] === word ? add.get(addWords[ai++]) : null; const total = u + (a ? a.length / 2 : 0); if (!total) continue;
    dw.entry(word, total, addSig(Number(listSig(word, small, smallT, u)) | 0, a || NONE)); for (let k = 0; k < u; k++) { dw.ids.push(small[k]); dw.tfs.push(smallT[k]); } if (a) putAdd(a);
  }
  while (ai < addWords.length) fromAdd(addWords[ai++]);
  fs.closeSync(io); fs.closeSync(to); dw.close(w.n, w.totalLen, w.heads.bytes);
  return { n: w.n, terms: dw.terms, cols: w.cols, byPath: w.byPath };
}

export function foldInWorker(oldDir, newDir, logFile, logEnd) {
  return new Promise((res, rej) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { segFold: true, oldDir, newDir, logFile, logEnd } }); w.on('message', res); w.on('error', rej); w.on('exit', (c) => rej(new Error(`fold worker exited ${c}`))); w.unref(); });
}
if (!isMainThread && workerData?.segFold) { try { parentPort.postMessage(foldFiles(workerData.oldDir, workerData.newDir, workerData.logFile, workerData.logEnd)); } catch (e) { if (!(e instanceof SegDamage)) throw e; parentPort.postMessage({ damage: e.why }); } }
