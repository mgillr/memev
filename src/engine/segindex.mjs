// Rig prototype, not landed code. The RecallIndex's interface over an on-disk segment and a small overlay.
// Nothing is loaded at open; a save writes only the overlay; a fold runs on a worker thread.
import fs from 'node:fs'; import path from 'node:path';
import { RecallIndex, tokenize } from './index.mjs';
import { writeSeg, Seg, foldInWorker, overlayDocs } from './seg2.mjs';

const round3 = (x) => Number(x.toFixed(3));
class LazyDoc {
  constructor(seg, i) { this.seg = seg; this.i = i; const c = seg.cols(), o = i * 24; this.len = c.readUInt32LE(o); this.path = seg.paths[c.readUInt32LE(o + 16) - 1]; const j = c.readUInt16LE(o + 20); this.project = j ? seg.projects[j - 1] : null; this._hasRb = !!c.readUInt16LE(o + 22); }
  get _m() { return this.__m || (this.__m = this.seg.meta(this.i)); }
  get heading() { return this._m.heading; } get line() { return this._m.line; } get snippet() { return this._m.snippet; } get mtime() { return this._m.mtime; }
  get rb() { return this._hasRb ? this._m.rb : null; } get fl() { return this._m.fl; }
}

export class SegIndex {
  constructor(file) { this.file = file; this.base = file.replace(/\.jsonl$/, ''); this.root = `${this.base}.seg`; this.ovFile = `${this.base}.overlay.jsonl`; this.reset(true); }
  reset(first = false) { this.seg = null; this.ov = new RecallIndex(this.ovFile); this.dead = new Set(); this.deadPaths = new Set(); this.deadLen = 0; this.dirty = false; this.gen = 0; this.since = null; this.foldP = null; if (!first) { fs.rmSync(this.root, { recursive: true, force: true }); fs.rmSync(this.ovFile, { force: true }); fs.rmSync(`${this.base}.retired.json`, { force: true }); } }
  _dir(g) { return path.join(this.root, `gen-${g}`); }
  _cur() { return path.join(this.root, 'CURRENT'); }
  _publish(g) { const t = `${this._cur()}.tmp`; fs.writeFileSync(t, String(g)); fs.renameSync(t, this._cur()); this.gen = g; for (const e of fs.readdirSync(this.root)) if (e.startsWith('gen-') && e !== `gen-${g}`) fs.rmSync(path.join(this.root, e), { recursive: true, force: true }); }
  load() {
    let g = null; try { g = Number(fs.readFileSync(this._cur(), 'utf8')); } catch {}
    if (g === null) {
      if (!fs.existsSync(this.file)) return false;
      const old = new RecallIndex(this.file); if (!old.load()) return false; // one-time conversion from the old file
      this.ov = old; this._writeFromOverlay(); fs.rmSync(this.file, { force: true }); return true;
    }
    this.seg = new Seg(this._dir(g)); this.gen = g;
    if (fs.existsSync(this.ovFile) && !this.ov.load()) return false;
    try { for (const p of JSON.parse(fs.readFileSync(`${this.base}.retired.json`, 'utf8'))) this._retire(p); } catch {}
    this.ov.dirty = false; this.dirty = false; return true;
  }
  _writeFromOverlay() {
    fs.mkdirSync(this.root, { recursive: true }); const g = this.gen + 1; fs.rmSync(this._dir(g), { recursive: true, force: true });
    writeSeg(this._dir(g), overlayDocs(this.ov)); this.seg = new Seg(this._dir(g)); this._publish(g);
    this.ov = new RecallIndex(this.ovFile); this.dead = new Set(); this.deadPaths = new Set(); this.deadLen = 0; fs.rmSync(this.ovFile, { force: true }); fs.rmSync(`${this.base}.retired.json`, { force: true }); this.dirty = false;
  }
  save() {
    if (!this.dirty) return;
    if (!this.seg) { this._writeFromOverlay(); return; }
    this.ov.dirty = true; this.ov.save(); fs.writeFileSync(`${this.base}.retired.json`, JSON.stringify([...this.deadPaths])); this.dirty = false;
    if (!this.foldP && this.ov.docs.size > Math.max(2000, this.seg.head.n * 0.05)) this.foldSoon();
  }
  foldSoon() {
    const g = this.gen + 1; fs.rmSync(this._dir(g), { recursive: true, force: true }); this.since = new Set(); const dead = [...this.dead]; const docs = overlayDocs(this.ov); const started = this.ov;
    this.foldP = foldInWorker(this._dir(this.gen), this._dir(g), dead, docs, true).then(() => this._swap(g, started)).catch(() => { this.foldP = null; this.since = null; });
    return this.foldP;
  }
  _swap(g, oldOv) {
    const changed = this.since; const seg = new Seg(this._dir(g)); const ov = new RecallIndex(this.ovFile); const keep = [];
    for (const p of changed) for (const id of oldOv.byPath.get(p) || []) { const d = oldOv.docs.get(id); if (d) keep.push(d); }
    this.seg = seg; this.ov = ov; this.dead = new Set(); this.deadPaths = new Set(); this.deadLen = 0;
    const retired = changed; for (const p of retired) if (this.lastChange?.get(p) !== 'append') this._retire(p);
    for (const d of keep) { const tf = new Map(); for (let i = 0; i < d.tids.length; i++) tf.set(oldOv.termList[d.tids[i]], d.tfs[i]); ov._add(d.path, { ...d, tf }); }
    this._publish(g); ov.dirty = true; ov.save(); fs.writeFileSync(`${this.base}.retired.json`, JSON.stringify([...this.deadPaths])); this.foldP = null; this.since = null; this.lastChange = null;
  }
  _retire(p) { if (!this.seg || this.deadPaths.has(p)) return; this.deadPaths.add(p); for (const i of this.seg.ordinalsOf(p)) { this.dead.add(i); this.deadLen += this.seg.cols().readUInt32LE(i * 24); } }
  _touch(p, kind) { if (!this.since) return; this.since.add(p); if (!this.lastChange) this.lastChange = new Map(); if (kind !== 'append' || !this.lastChange.has(p)) this.lastChange.set(p, kind); }
  remove(p) { this._touch(p, 'replace'); this._retire(p); this.ov.remove(p); this.dirty = true; }
  update(p, body, o) { this._touch(p, 'replace'); this._retire(p); this.ov.update(p, body, o); this.dirty = true; }
  appendSections(p, text, o = {}) {
    this._touch(p, 'append');
    let project = o.project ?? null;
    if (!project && !/^work\/active\//.test(p) && this.seg && !this.deadPaths.has(p)) { const a = this.seg.ordinalsOf(p); if (a.length) project = new LazyDoc(this.seg, a[0]).project; }
    this.ov.appendSections(p, text, { ...o, project }); this.dirty = true;
  }
  get byPath() { const me = this; return { has(p) { return me.ov.byPath.has(p) || (!!me.seg && !me.deadPaths.has(p) && me.seg.ordinalsOf(p).length > 0); } }; }
  get docs() { const me = this; return { get size() { return me._N(); }, *values() { if (me.seg) for (let i = 0; i < me.seg.head.n; i++) if (!me.dead.has(i)) yield new LazyDoc(me.seg, i); yield* me.ov.docs.values(); } }; }
  _N() { return (this.seg ? this.seg.head.n - this.dead.size : 0) + this.ov.docs.size; }
  _Len() { return (this.seg ? this.seg.head.totalLen - this.deadLen : 0) + this.ov.totalLen; }
  docsOf(p, heading) { const out = []; if (this.seg && !this.deadPaths.has(p)) for (const i of this.seg.ordinalsOf(p)) { const d = new LazyDoc(this.seg, i); if (heading === undefined || heading === null || (d.heading || '') === heading) out.push(d); } return out.concat(this.ov.docsOf(p, heading)); }
  stats() { let notes = this.ov.byPath.size, terms = this.ov.terms.size; if (this.seg) { this.seg.ordinalsOf('\0'); for (const [, a] of this.seg.byPath) if (!this.deadPaths.has(this.seg.paths[this.seg.c.readUInt32LE(a[0] * 24 + 16) - 1]) && !this.ov.byPath.has(this.seg.paths[this.seg.c.readUInt32LE(a[0] * 24 + 16) - 1])) notes++; terms += this.seg.head.terms; } return { sections: this._N(), notes, terms }; }
  _plan(q) {
    const seg = this.seg, ov = this.ov; const words = [...new Set(tokenize(q))]; const N = this._N(); const avg = N ? this._Len() / N : 0; const ts = [];
    for (const w of words) { const e = seg ? seg.lookup(w) : null; let b = null, df = 0; if (e) { b = seg.postings(e); df = e.df; if (this.dead.size) for (let k = 0; k < e.df; k++) if (this.dead.has(b.readUInt32LE(k * 6))) df--; } const ot = ov.terms.get(w); const odf = ot === undefined ? 0 : ov.df(ot); if (df + odf > 0) ts.push({ w, b, ot, df: df + odf }); }
    ts.sort((x, y) => x.df - y.df); let terms = ts; if (N > 2000) { const rare = ts.filter((t) => t.df <= N / 3); terms = (rare.length ? rare : ts.slice(0, 2)).slice(0, 12); }
    return { words, all: ts, terms, N, avg };
  }
  query(q, { limit = 8, project = null, prefix = null, boosts = null, filter = null } = {}) {
    const empty = () => Object.defineProperty([], 'total', { value: 0, writable: true, configurable: true });
    if (!this._N()) return empty(); const { terms, N, avg } = this._plan(q); if (!terms.length) return empty();
    const seg = this.seg, ov = this.ov; const seS = new Map(), ovS = new Map();
    for (const t of terms) {
      if (t.b) { const c = seg.cols(); const n = t.b.length / 6; for (let k = 0; k < n; k++) { const i = t.b.readUInt32LE(k * 6); if (this.dead.has(i)) continue; seS.set(i, (seS.get(i) || 0) + RecallIndex._bm(t.b.readUInt16LE(k * 6 + 4), t.df, N, c.readUInt32LE(i * 24), avg).part); } }
      if (t.ot !== undefined) for (const id of ov.postings[t.ot]) { const d = ov.docs.get(id); if (!d) continue; ovS.set(id, (ovS.get(id) || 0) + RecallIndex._bm(RecallIndex._tf(d, t.ot), t.df, N, d.len, avg).part); }
    }
    const proj = project ? String(project).toLowerCase() : null; const top = []; let total = 0;
    const put = (d, s) => { if (prefix && !d.path.startsWith(prefix)) return; if (filter && !filter(d)) return; total++; const f = (proj && d.project === proj ? 1.5 : 1) * (boosts ? (boosts[`${d.path}#${d.heading || ''}`] ?? 1) : 1); const score = s * f; if (top.length === limit && score <= top[top.length - 1].score) return; let i = top.length; while (i > 0 && top[i - 1].score < score) i--; top.splice(i, 0, { d, score }); if (top.length > limit) top.pop(); };
    for (const [i, s] of seS) put(new LazyDoc(seg, i), s); for (const [id, s] of ovS) put(ov.docs.get(id), s);
    return Object.defineProperty(top.map(({ d, score }) => ({ path: d.path, heading: d.heading, line: d.line, snippet: d.snippet, score: round3(score), project: d.project, ...(d.rb ? { review_by: d.rb } : {}) })), 'total', { value: total, writable: true, configurable: true });
  }
  _tfOf(d, t) { if (d instanceof LazyDoc) { if (!t.b) return 0; const n = t.b.length / 6; for (let k = 0; k < n; k++) if (t.b.readUInt32LE(k * 6) === d.i) return t.b.readUInt16LE(k * 6 + 4); return 0; } return t.ot === undefined ? 0 : RecallIndex._tf(d, t.ot); }
  explain(q, d, { project = null, boosts = null } = {}) {
    const { words, all, terms, N, avg } = this._plan(q); const used = new Set(terms.map((t) => t.w)); const byW = new Map(all.map((t) => [t.w, t])); const parts = []; let base = 0;
    for (const w of words) { const t = byW.get(w); const f = t ? this._tfOf(d, t) : 0; if (!t || !f) { parts.push({ word: w, in_section: 0, contribution: 0, note: !t ? 'not in any note' : 'not in this section' }); continue; } if (!used.has(w)) { parts.push({ word: w, in_section: f, sections_with_word: t.df, contribution: 0, note: 'too common to count (in over a third of all sections)' }); continue; } const { idf, part } = RecallIndex._bm(f, t.df, N, d.len, avg); base += part; parts.push({ word: w, in_section: f, sections_with_word: t.df, weight: round3(idf), contribution: round3(part) }); }
    parts.sort((a, b) => b.contribution - a.contribution); const pj = project ? String(project).toLowerCase() : null; const fp = pj && d.project === pj ? 1.5 : 1, fb = boosts ? (boosts[`${d.path}#${d.heading || ''}`] ?? 1) : 1;
    return { score: round3(base * fp * fb), words: parts, matched: parts.filter((p) => p.contribution > 0).map((p) => p.word), dropped_common: all.filter((t) => !used.has(t.w)).map((t) => t.w), section_words: d.len, average_section_words: Number(avg.toFixed(1)), project_multiplier: fp, feedback_multiplier: round3(fb) };
  }
}
