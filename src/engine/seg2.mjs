// Rig prototype, not product code. Immutable on-disk segment + in-memory overlay + fold on a worker thread.
// The overlay is the real RecallIndex, so new text is tokenized and scored by the product's own code.
import fs from 'node:fs'; import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const bmp = (f, df, N, len, avg) => { const k1 = 1.2, b = 0.75; const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)); return idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / avg)); };

export function writeSeg(dir, docs) { // docs: iterable of { path, heading, line, len, project, mtime, snippet, rb, fl, terms: [[w, tf]] }
  fs.mkdirSync(dir, { recursive: true });
  const post = new Map(); const metaFd = fs.openSync(path.join(dir, 'meta.jsonl'), 'w'); const row = []; let off = 0, n = 0, totalLen = 0, buf = '';
  const P = new Map(), J = new Map(); const id = (m, k) => { if (k == null) return 0; let v = m.get(k); if (v === undefined) { v = m.size + 1; m.set(k, v); } return v; };
  for (const d of docs) {
    const line = `${JSON.stringify({ heading: d.heading, line: d.line, mtime: d.mtime, snippet: d.snippet, rb: d.rb || null, fl: d.fl || null })}\n`; const ml = Buffer.byteLength(line);
    buf += line; row.push(d.len, off, ml, id(P, d.path), id(J, d.project), d.rb ? 1 : 0); off += ml; totalLen += d.len; if (buf.length > 1 << 20) { fs.writeSync(metaFd, buf); buf = ''; }
    for (const [w, f] of d.terms) { let p = post.get(w); if (!p) post.set(w, p = []); p.push(n, f); } n++;
  }
  if (buf) fs.writeSync(metaFd, buf); fs.closeSync(metaFd);
  finishSeg(dir, n, totalLen, row, P, J, post);
  return { n };
}
function finishSeg(dir, n, totalLen, row, P, J, post) {
  const c = Buffer.alloc(n * 24); for (let i = 0; i < n; i++) { const o = i * 6, b = i * 24; c.writeUInt32LE(row[o], b); c.writeDoubleLE(row[o + 1], b + 4); c.writeUInt32LE(row[o + 2], b + 12); c.writeUInt32LE(row[o + 3], b + 16); c.writeUInt16LE(row[o + 4], b + 20); c.writeUInt16LE(row[o + 5], b + 22); }
  fs.writeFileSync(path.join(dir, 'cols.bin'), c);
  fs.writeFileSync(path.join(dir, 'names.json'), JSON.stringify({ paths: [...P.keys()], projects: [...J.keys()] }));
  const words = [...post.keys()].sort(); const pfd = fs.openSync(path.join(dir, 'post.bin'), 'w'); const dfd = fs.openSync(path.join(dir, 'dict.txt'), 'w'); const sparse = []; let pos = 0, bytes = 0, i = 0, dbuf = '';
  for (const w of words) { const p = post.get(w); const df = p.length / 2; const b = Buffer.alloc(df * 6); for (let k = 0; k < df; k++) { b.writeUInt32LE(p[k * 2], k * 6); b.writeUInt16LE(Math.min(p[k * 2 + 1], 65535), k * 6 + 4); } fs.writeSync(pfd, b); const l = `${w}\t${df}\t${pos}\n`; if (i++ % 64 === 0) sparse.push([w, bytes]); dbuf += l; bytes += Buffer.byteLength(l); pos += b.length; if (dbuf.length > 1 << 20) { fs.writeSync(dfd, dbuf); dbuf = ''; } }
  if (dbuf) fs.writeSync(dfd, dbuf); fs.closeSync(dfd); fs.closeSync(pfd);
  fs.writeFileSync(path.join(dir, 'head.json'), JSON.stringify({ version: 2, n, totalLen, terms: words.length, sparse, dictBytes: bytes }));
}

export class Seg {
  constructor(dir) { this.dir = dir; this.head = JSON.parse(fs.readFileSync(path.join(dir, 'head.json'), 'utf8')); for (const [k, f] of [['fdD', 'dict.txt'], ['fdP', 'post.bin'], ['fdM', 'meta.jsonl']]) this[k] = fs.openSync(path.join(dir, f), 'r'); }
  close() { fs.closeSync(this.fdD); fs.closeSync(this.fdP); fs.closeSync(this.fdM); }
  cols() { if (!this.c) { this.c = fs.readFileSync(path.join(this.dir, 'cols.bin')); const nm = JSON.parse(fs.readFileSync(path.join(this.dir, 'names.json'), 'utf8')); this.paths = nm.paths; this.projects = nm.projects; this.byPath = null; } return this.c; }
  lookup(w) { const s = this.head.sparse; let lo = 0, hi = s.length - 1, at = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m][0] <= w) { at = m; lo = m + 1; } else hi = m - 1; } if (at < 0) return null; const st = s[at][1], en = at + 1 < s.length ? s[at + 1][1] : this.head.dictBytes; const b = Buffer.alloc(en - st); fs.readSync(this.fdD, b, 0, b.length, st); for (const l of b.toString('utf8').split('\n')) { const i = l.indexOf('\t'); if (l.slice(0, i) === w) { const a = l.split('\t'); return { df: Number(a[1]), pos: Number(a[2]) }; } } return null; }
  postings(e) { const b = Buffer.alloc(e.df * 6); fs.readSync(this.fdP, b, 0, b.length, e.pos); return b; }
  light(i) { const c = this.cols(), o = i * 24; return { i, len: c.readUInt32LE(o), path: this.paths[c.readUInt32LE(o + 16) - 1], project: c.readUInt16LE(o + 20) ? this.projects[c.readUInt16LE(o + 20) - 1] : null, hasRb: !!c.readUInt16LE(o + 22) }; }
  meta(i) { const c = this.cols(), o = i * 24; const b = Buffer.alloc(c.readUInt32LE(o + 12)); fs.readSync(this.fdM, b, 0, b.length, c.readDoubleLE(o + 4)); return JSON.parse(b.toString('utf8')); }
  ordinalsOf(p) { this.cols(); if (!this.byPath) { this.byPath = new Map(); const c = this.c; for (let i = 0; i < this.head.n; i++) { const pid = c.readUInt32LE(i * 24 + 16); let a = this.byPath.get(pid); if (!a) this.byPath.set(pid, a = []); a.push(i); } this.pid = new Map(this.paths.map((x, k) => [x, k + 1])); } return this.byPath.get(this.pid.get(p)) || []; }
}

/** The read view: a segment with some paths retired, and an overlay holding their current text. */
export class View {
  constructor(seg, overlay) { this.seg = seg; this.ov = overlay; this.dead = new Set(); this.deadLen = 0; this.deadPaths = new Set(); }
  retire(p) { if (this.deadPaths.has(p)) return; this.deadPaths.add(p); for (const i of this.seg.ordinalsOf(p)) { this.dead.add(i); this.deadLen += this.seg.light(i).len; } }
  update(p, body, o) { this.retire(p); this.ov.update(p, body, o); }
  remove(p) { this.retire(p); this.ov.remove(p); }
  query(tokenize, q, { limit = 8, project = null, prefix = null, filter = null } = {}) {
    const seg = this.seg, ov = this.ov; const words = [...new Set(tokenize(q))]; const N = seg.head.n - this.dead.size + ov.docs.size; const totalLen = seg.head.totalLen - this.deadLen + ov.totalLen; const avg = N ? totalLen / N : 0;
    const ts = [];
    for (const w of words) {
      const e = seg.lookup(w); let b = null, df = 0;
      if (e) { b = seg.postings(e); df = e.df; if (this.dead.size) for (let k = 0; k < e.df; k++) if (this.dead.has(b.readUInt32LE(k * 6))) df--; }
      const ot = ov.terms.get(w); const odf = ot === undefined ? 0 : ov.df(ot);
      if (df + odf > 0) ts.push({ w, e, b, ot, df: df + odf });
    }
    if (!ts.length) return [];
    ts.sort((x, y) => x.df - y.df); let terms = ts;
    if (N > 2000) { const rare = terms.filter((t) => t.df <= N / 3); terms = (rare.length ? rare : terms.slice(0, 2)).slice(0, 12); }
    const seS = new Map(), ovS = new Map();
    for (const t of terms) {
      if (t.b) { const n = t.b.length / 6; for (let k = 0; k < n; k++) { const i = t.b.readUInt32LE(k * 6); if (this.dead.has(i)) continue; seS.set(i, (seS.get(i) || 0) + bmp(t.b.readUInt16LE(k * 6 + 4), t.df, N, seg.c ? seg.c.readUInt32LE(i * 24) : seg.cols().readUInt32LE(i * 24), avg)); } }
      if (t.ot !== undefined) for (const id of ov.postings[t.ot]) { const d = ov.docs.get(id); if (!d) continue; let f = 0; let lo = 0, hi = d.tids.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.tids[m] === t.ot) { f = d.tfs[m]; break; } if (d.tids[m] < t.ot) lo = m + 1; else hi = m - 1; } ovS.set(id, (ovS.get(id) || 0) + bmp(f, t.df, N, d.len, avg)); }
    }
    const proj = project ? String(project).toLowerCase() : null; const top = []; let total = 0;
    const put = (ref, s, d) => { if (prefix && !d.path.startsWith(prefix)) return; if (filter && !filter(d)) return; total++; const sc = s * (proj && d.project === proj ? 1.5 : 1); if (top.length === limit && sc <= top[top.length - 1].score) return; let i = top.length; while (i > 0 && top[i - 1].score < sc) i--; top.splice(i, 0, { ref, score: sc, d }); if (top.length > limit) top.pop(); };
    for (const [i, s] of seS) put({ seg: i }, s, seg.light(i));
    for (const [id, s] of ovS) { const d = ov.docs.get(id); put({ ov: id }, s, d); }
    return top.map((h) => { if (h.ref.seg !== undefined) { const m = seg.meta(h.ref.seg); return { path: h.d.path, heading: m.heading, line: m.line, score: Number(h.score.toFixed(3)) }; } return { path: h.d.path, heading: h.d.heading, line: h.d.line, score: Number(h.score.toFixed(3)) }; });
  }
}

/** Fold: rewrite segment + overlay as a new segment by streaming the old one. No section is parsed into objects. */
export function foldFiles(oldDir, newDir, deadList, overlayDocs) {
  fs.mkdirSync(newDir, { recursive: true });
  const h = JSON.parse(fs.readFileSync(path.join(oldDir, 'head.json'), 'utf8')); const cols = fs.readFileSync(path.join(oldDir, 'cols.bin')); const nm = JSON.parse(fs.readFileSync(path.join(oldDir, 'names.json'), 'utf8'));
  const dead = new Set(deadList); const remap = new Int32Array(h.n).fill(-1); const P = new Map(nm.paths.map((p, i) => [p, i + 1])), J = new Map(nm.projects.map((p, i) => [p, i + 1])); const id = (m, k) => { if (k == null) return 0; let v = m.get(k); if (v === undefined) { v = m.size + 1; m.set(k, v); } return v; };
  const row = []; let off = 0, n = 0, totalLen = 0;
  const mo = fs.openSync(path.join(oldDir, 'meta.jsonl'), 'r'); const mn = fs.openSync(path.join(newDir, 'meta.jsonl'), 'w');
  // Copy live meta in runs, so a mostly unchanged file costs a few large reads.
  let runStart = -1, runLen = 0; const flush = () => { if (runLen) { const b = Buffer.alloc(runLen); fs.readSync(mo, b, 0, runLen, runStart); fs.writeSync(mn, b); runLen = 0; runStart = -1; } };
  for (let i = 0; i < h.n; i++) { if (dead.has(i)) { flush(); continue; } const o = i * 24; const len = cols.readUInt32LE(o), at = cols.readDoubleLE(o + 4), ml = cols.readUInt32LE(o + 12); if (runStart < 0) runStart = at; runLen += ml; if (runLen > 1 << 24) flush(); remap[i] = n++; row.push(len, off, ml, cols.readUInt32LE(o + 16), cols.readUInt16LE(o + 20), cols.readUInt16LE(o + 22)); off += ml; totalLen += len; }
  flush(); fs.closeSync(mo);
  const add = new Map(); for (const d of overlayDocs) { const line = `${JSON.stringify({ heading: d.heading, line: d.line, mtime: d.mtime, snippet: d.snippet, rb: d.rb || null, fl: d.fl || null })}\n`; const ml = Buffer.byteLength(line); fs.writeSync(mn, line); row.push(d.len, off, ml, id(P, d.path), id(J, d.project), d.rb ? 1 : 0); off += ml; totalLen += d.len; for (const [w, f] of d.terms) { let a = add.get(w); if (!a) add.set(w, a = []); a.push(n, f); } n++; }
  fs.closeSync(mn);
  // Merge the sorted dictionary with the overlay's words, streaming the postings.
  const c = Buffer.alloc(n * 24); for (let i = 0; i < n; i++) { const o = i * 6, b = i * 24; c.writeUInt32LE(row[o], b); c.writeDoubleLE(row[o + 1], b + 4); c.writeUInt32LE(row[o + 2], b + 12); c.writeUInt32LE(row[o + 3], b + 16); c.writeUInt16LE(row[o + 4], b + 20); c.writeUInt16LE(row[o + 5], b + 22); } fs.writeFileSync(path.join(newDir, 'cols.bin'), c);
  fs.writeFileSync(path.join(newDir, 'names.json'), JSON.stringify({ paths: [...P.keys()], projects: [...J.keys()] }));
  const po = fs.openSync(path.join(oldDir, 'post.bin'), 'r'); const pn = fs.openSync(path.join(newDir, 'post.bin'), 'w'); const dn = fs.openSync(path.join(newDir, 'dict.txt'), 'w');
  const addWords = [...add.keys()].sort(); let ai = 0, pos = 0, bytes = 0, cnt = 0, dbuf = ''; const sparse = [];
  const emit = (w, b, used) => { if (!used) return; fs.writeSync(pn, b, 0, used); const l = `${w}\t${used / 6}\t${pos}\n`; if (cnt++ % 64 === 0) sparse.push([w, bytes]); dbuf += l; bytes += Buffer.byteLength(l); pos += used; if (dbuf.length > 1 << 20) { fs.writeSync(dn, dbuf); dbuf = ''; } };
  const fromAdd = (a, w) => { const b = Buffer.alloc(a.length * 3); for (let k = 0; k < a.length / 2; k++) { b.writeUInt32LE(a[k * 2], k * 6); b.writeUInt16LE(Math.min(a[k * 2 + 1], 65535), k * 6 + 4); } emit(w, b, b.length); };
  const dictText = fs.readFileSync(path.join(oldDir, 'dict.txt'), 'utf8');
  for (let at = 0; at < dictText.length;) {
    const e = dictText.indexOf('\n', at); const l = dictText.slice(at, e); at = e + 1; const a = l.split('\t'); const w = a[0], df = Number(a[1]), p = Number(a[2]);
    while (ai < addWords.length && addWords[ai] < w) { fromAdd(add.get(addWords[ai]), addWords[ai]); ai++; }
    const b = Buffer.alloc(df * 6); fs.readSync(po, b, 0, b.length, p); let u = 0; for (let k = 0; k < df; k++) { const m = remap[b.readUInt32LE(k * 6)]; if (m < 0) continue; b.writeUInt32LE(m, u); b.writeUInt16LE(b.readUInt16LE(k * 6 + 4), u + 4); u += 6; }
    if (ai < addWords.length && addWords[ai] === w) { const x = add.get(w); const nb = Buffer.alloc(u + x.length * 3); b.copy(nb, 0, 0, u); for (let k = 0; k < x.length / 2; k++) { nb.writeUInt32LE(x[k * 2], u + k * 6); nb.writeUInt16LE(Math.min(x[k * 2 + 1], 65535), u + k * 6 + 4); } emit(w, nb, nb.length); ai++; } else emit(w, b, u);
  }
  while (ai < addWords.length) { fromAdd(add.get(addWords[ai]), addWords[ai]); ai++; }
  if (dbuf) fs.writeSync(dn, dbuf); fs.closeSync(dn); fs.closeSync(pn); fs.closeSync(po);
  fs.writeFileSync(path.join(newDir, 'head.json'), JSON.stringify({ version: 2, n, totalLen, terms: cnt, sparse, dictBytes: bytes }));
  return { n, terms: cnt };
}

export function foldInWorker(oldDir, newDir, deadList, overlayDocs) { return new Promise((res, rej) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { oldDir, newDir, deadList, overlayDocs } }); w.on('message', res); w.on('error', rej); w.unref(); }); }
if (!isMainThread && workerData?.oldDir) { parentPort.postMessage(foldFiles(workerData.oldDir, workerData.newDir, workerData.deadList, workerData.overlayDocs)); }
export const overlayDocs = (ov) => [...ov.docs.values()].map((d) => { const terms = []; for (let i = 0; i < d.tids.length; i++) terms.push([ov.termList[d.tids[i]], d.tfs[i]]); return { path: d.path, heading: d.heading, line: d.line, len: d.len, project: d.project, mtime: d.mtime, snippet: d.snippet, rb: d.rb, fl: d.fl, terms }; });
