// SPDX-License-Identifier: Apache-2.0
// The recall index with RecallIndex's interface and answers, over an on-disk segment and a small overlay.
// Nothing is loaded at open. A save appends what changed to the overlay log. A fold runs on a worker and is the log's checkpoint:
// it folds the log up to an offset into a new segment, and only the log's tail moves to the new generation.
// CURRENT names the generation; a generation folder holds its segment and its log, so a kill leaves a matching pair.
import fs from 'node:fs';
import path from 'node:path';
import { RecallIndex, tokenize } from './index.mjs';
import { writeSeg, Seg, foldInWorker, keySig, ROW, C_LEN, C_PATH, C_PROJ, C_RB, C_SIG } from './seg2.mjs';

const round3 = (x) => Number(x.toFixed(3));
const empty = () => Object.defineProperty([], 'total', { value: 0, writable: true, configurable: true });
// The largest boost and a bitmap of the boosted keys, once per tuning. Tuning is replaced whole, never edited (tuning.mjs).
const boostCache = new WeakMap();
const boostInfo = (boosts) => { let k = boostCache.get(boosts); if (!k) { let max = 1, count = 0; for (const key in boosts) { count++; if (boosts[key] > max) max = boosts[key]; } k = { max, sieve: count ? new KeySieve(Object.keys(boosts), count) : null }; boostCache.set(boosts, k); } return k; };
const K1 = 1.2, B = 0.75, K1P = K1 + 1, B0 = 1 - B; // RecallIndex._bm's constants, written out in its order of operations so the doubles are the same
/** A small bitmap of key signatures: a section whose signature is absent cannot be one of these keys. */
class KeySieve {
  constructor(keys, count) { let bits = 1 << 12; while (bits < count * 16) bits <<= 1; this.mask = bits - 1; this.m = new Uint8Array(bits >>> 3); for (const k of keys) { const h = keySig(k) & this.mask; this.m[h >>> 3] |= 1 << (h & 7); } }
  has(sig) { const h = sig & this.mask; return (this.m[h >>> 3] & (1 << (h & 7))) !== 0; }
}
const FOLD_MIN = 2000, FOLD_SHARE = 0.05, RETRY_MS = 60000, LOG_MAX = 1 << 26; // a note rewritten over and over grows the log, not the overlay

/** One section of the segment. Columns cost nothing; text is read only when asked for. `at` moves it, so a query needs only one. */
class SegDoc {
  constructor(seg, i) { this.seg = seg; this.i = i; this.c = seg.cols(); this.m = null; this.sieve = null; this.sieveOf = null; this.read = false; }
  at(i) { this.i = i; this.m = null; return this; }
  get len() { return this.c[this.i * ROW + C_LEN]; }
  get path() { return this.seg.paths[this.c[this.i * ROW + C_PATH] - 1]; }
  get project() { const j = this.c[this.i * ROW + C_PROJ]; return j ? this.seg.projects[j - 1] : null; }
  get heading() { return this.seg.heading(this.i); }
  get rb() { return this.seg.rb(this.i); }
  /** The value for this section's item key in a Map of them. The bitmap answers most sections without building the key. */
  lookup(map) { if (this.sieve === null || this.sieveOf !== map) { this.sieve = new KeySieve(map.keys(), map.size); this.sieveOf = map; } if (!this.sieve.has(this.c[this.i * ROW + C_SIG])) return undefined; this.read = true; return map.get(`${this.path}#${this.heading || ''}`); }
  get fl() { return this.seg.hasFl(this.i) ? this._meta().fl : null; }
  get line() { return this._meta().line; }
  get snippet() { return this._meta().snippet; }
  get mtime() { return this._meta().mtime; }
  _meta() { return this.m || (this.m = this.seg.meta(this.i)); }
}

/**
 * The document a filter sees. A pure filter that read only the project and the review date gives the same verdict for every
 * section with those values, so the verdict is kept per project for sections with no review date and the rest are not asked.
 */
class FilterDoc extends SegDoc {
  get path() { this.read = true; return super.path; }
  get heading() { this.read = true; return super.heading; }
  get line() { this.read = true; return super.line; }
  get snippet() { this.read = true; return super.snippet; }
  get mtime() { this.read = true; return super.mtime; }
  get fl() { this.read = true; return super.fl; }
  get len() { this.read = true; return super.len; }
}

export class SegIndex {
  constructor(file) { this.file = file; this.base = file.replace(/\.jsonl$/, ''); this.root = `${this.base}.seg`; this._clear(); }
  _clear() { this.seg = null; this.ov = new RecallIndex('/nonexistent'); this.dead = null; this.deadCount = 0; this.deadPaths = new Set(); this.deadLen = 0; this.gen = 0; this.logFd = null; this.logEnd = 0; this.pending = []; this.dirty = false; this.foldP = null; this.foldFailed = 0; this.score = null; this.syncing = false; this.syncAgain = false; this.oldLog = null; }
  reset() { this._closeFiles(); this._clear(); fs.rmSync(this.root, { recursive: true, force: true }); }
  _closeFiles() { if (this.logFd !== null) { fs.closeSync(this.logFd); this.logFd = null; } if (this.seg) { this.seg.close(); this.seg = null; } }
  _dir(g) { return path.join(this.root, `gen-${g}`); }
  _log(g) { return path.join(this._dir(g), 'overlay.log'); }
  _publish(g) { const cur = path.join(this.root, 'CURRENT'), t = `${cur}.tmp`; const fd = fs.openSync(t, 'w', 0o600); fs.writeSync(fd, String(g)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(t, cur); try { const d = fs.openSync(this.root, 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* a folder cannot be synced on Windows */ } }
  _sweep(keep) { let list = []; try { list = fs.readdirSync(this.root); } catch { return; } for (const e of list) if (e.startsWith('gen-') && e !== `gen-${keep}`) fs.rm(path.join(this.root, e), { recursive: true, force: true }, () => {}); }

  /** Replay log bytes into a generation's state: the same steps a write took, so ids and their order come out the same. */
  _replay(st, text) { for (let s = 0; s < text.length;) { const e = text.indexOf('\n', s); const r = JSON.parse(text.slice(s, e)); s = e + 1; if (r.rm !== undefined) { this._retireIn(st, r.rm); st.ov.remove(r.rm); } else { st.ov._addLine(r); } } }
  _state(seg) { return { seg, ov: new RecallIndex('/nonexistent'), dead: new Uint8Array(seg.head.n), deadCount: 0, deadPaths: new Set(), deadLen: 0 }; }
  _retireIn(st, p) { if (st.deadPaths.has(p)) return; st.deadPaths.add(p); const c = st.seg.cols(); for (const i of st.seg.ordinalsOf(p)) { if (!st.dead[i]) { st.dead[i] = 1; st.deadCount++; st.deadLen += c[i * ROW + C_LEN]; } } }

  load() {
    let g = null; try { g = Number(fs.readFileSync(path.join(this.root, 'CURRENT'), 'utf8')); } catch { /* no segment yet */ }
    if (g === null) {
      if (!fs.existsSync(this.file)) return false;
      const old = new RecallIndex(this.file); if (!old.load()) return false; // one-time conversion from the old file
      this.ov = old; this._writeFromOverlay(); fs.rmSync(this.file, { force: true }); return true;
    }
    let seg; try { seg = new Seg(this._dir(g)); } catch { fs.rmSync(this.root, { recursive: true, force: true }); return false; } // another version or a lost folder: rebuilt from the notes
    const st = this._state(seg); let text = '';
    try { text = fs.readFileSync(this._log(g), 'utf8'); } catch { /* an empty log */ }
    // A kill can cut the last line. It is dropped here; the vault replays anything past its saved log position.
    let end = Buffer.byteLength(text); const nl = text.lastIndexOf('\n'); if (nl !== text.length - 1) { text = text.slice(0, nl + 1); end = Buffer.byteLength(text); }
    // A complete line that does not parse is not a kill's mark. The notes are the record: the index is rebuilt from them.
    try { this._replay(st, text); } catch { seg.close(); fs.rmSync(this.root, { recursive: true, force: true }); return false; }
    Object.assign(this, st); this.gen = g; this.logFd = fs.openSync(this._log(g), fs.existsSync(this._log(g)) ? 'r+' : 'w+', 0o600); fs.ftruncateSync(this.logFd, end); this.logEnd = end; this.dirty = false; this._sweep(g);
    return true;
  }
  _writeFromOverlay() {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); const g = this.gen + 1; fs.rmSync(this._dir(g), { recursive: true, force: true }); const ov = this.ov;
    writeSeg(this._dir(g), (function* () { for (const d of ov.docs.values()) { const terms = []; for (let i = 0; i < d.tids.length; i++) terms.push([ov.termList[d.tids[i]], d.tfs[i]]); yield { ...d, terms }; } })());
    this._closeFiles(); const log = this._log(g); fs.writeFileSync(log, '', { mode: 0o600 }); const seg = new Seg(this._dir(g)); this._publish(g); Object.assign(this, this._state(seg)); this.gen = g; this.logFd = fs.openSync(log, 'r+'); this.logEnd = 0; this.pending = []; this.dirty = false; this._sweep(g);
  }
  // What changed goes to the log before the save returns, so a killed process keeps it; the wait for the disk is on the thread pool.
  _flush() {
    if (!this.pending.length) return; let out = '';
    for (const o of this.pending) { if (typeof o === 'string') out += `${JSON.stringify({ rm: o })}\n`; else { const d = this.ov.docs.get(o); if (d) out += `${this.ov._docLine(d)}\n`; } }
    const b = Buffer.from(out);
    try { fs.writeSync(this.logFd, b, 0, b.length, this.logEnd); } catch (e) { try { fs.ftruncateSync(this.logFd, this.logEnd); } catch { /* the next load drops a cut line */ } throw e; }
    this.logEnd += b.length; this.pending = []; this._syncLog();
  }
  _syncLog() {
    if (this.syncing) { this.syncAgain = true; return; } this.syncing = true; const fd = this.logFd;
    fs.fdatasync(fd, () => { this.syncing = false; if (this.oldLog === fd) { this.oldLog = null; fs.close(fd, () => {}); } if (this.syncAgain) { this.syncAgain = false; if (this.logFd !== null) this._syncLog(); } });
  }
  save() {
    if (!this.dirty) return;
    if (!this.seg) { this._writeFromOverlay(); return; }
    this._flush(); this.dirty = false;
    if (!this.foldP && Date.now() - this.foldFailed > RETRY_MS && (this.ov.docs.size > Math.max(FOLD_MIN, this.seg.head.n * FOLD_SHARE) || this.deadCount > Math.max(FOLD_MIN, this.seg.head.n / 5) || this.logEnd > (this.logMax ?? LOG_MAX))) this.foldSoon();
  }
  /** Start a fold of the log as it stands. Reads and writes go on against this generation until the new one is ready. */
  foldSoon() {
    if (this.foldP || !this.seg) return this.foldP; this._flush(); const g = this.gen + 1; fs.rmSync(this._dir(g), { recursive: true, force: true }); const sealed = this.logEnd;
    this.foldP = foldInWorker(this._dir(this.gen), this._dir(g), this._log(this.gen), sealed, this.foldTune).then((r) => this._swap(g, sealed, r.cols)).catch(() => { this.foldP = null; this.foldFailed = Date.now(); fs.rm(this._dir(g), { recursive: true, force: true }, () => {}); });
    return this.foldP;
  }
  // What was written after the seal moves to the new generation. Every wait for the disk is on the thread pool, between steps;
  // writes that arrive meanwhile are copied in the last step, which is the only one that changes anything and ends with CURRENT.
  async _swap(g, sealed, cols) {
    const fd = fs.openSync(this._log(g), 'w+', 0o600); const cur = path.join(this.root, 'CURRENT'), tmp = `${cur}.tmp`; let copied = sealed, at = 0; const tail = [];
    const copy = () => { this._flush(); const n = this.logEnd - copied; if (!n) return; const b = Buffer.allocUnsafe(n); fs.readSync(this.logFd, b, 0, n, copied); fs.writeSync(fd, b, 0, n, at); at += n; copied += n; tail.push(b); };
    const done = (f, ...x) => new Promise((res, rej) => f(...x, (e) => (e ? rej(e) : res())));
    try {
      copy(); await done(fs.fdatasync, fd);
      const t = fs.openSync(tmp, 'w', 0o600); fs.writeSync(t, String(g)); await done(fs.fsync, t); fs.closeSync(t);
      const seg = new Seg(this._dir(g), cols); seg.cols(); await new Promise((res) => setImmediate(res));
      copy(); const st = this._state(seg); this._replay(st, Buffer.concat(tail).toString('utf8')); fs.renameSync(tmp, cur);
      const was = this.gen; const oldLog = this.logFd, oldSeg = this.seg; Object.assign(this, st); this.gen = g; this.logFd = fd; this.logEnd = at; this.foldP = null;
      if (this.syncing) this.oldLog = oldLog; else fs.close(oldLog, () => {}); oldSeg.close();
      fs.open(this.root, 'r', (e, dfd) => { const rm = () => fs.rm(this._dir(was), { recursive: true, force: true }, () => {}); if (e) return rm(); return fs.fsync(dfd, () => fs.close(dfd, rm)); }); // a folder cannot be synced on Windows; the error is not checked for that reason
    } catch (e) { try { fs.closeSync(fd); } catch { /* already closed */ } throw e; }
  }
  _retire(p) { if (this.seg) this._retireIn(this, p); }
  _added(from) { for (let id = from; id < this.ov.nextId; id++) this.pending.push(id); this.dirty = true; }
  remove(p) { this._retire(p); this.ov.remove(p); this.pending.push(p); this.dirty = true; }
  update(p, body, o) { this._retire(p); const from = this.ov.nextId; this.ov.update(p, body, o); this.pending.push(p); this._added(from); }
  appendSections(p, text, o = {}) {
    let project = o.project ?? null;
    if (!project && !/^work\/active\/([^/]+)\.md$/.test(p) && this.seg && !this.deadPaths.has(p)) { const doc = new SegDoc(this.seg, 0); for (const i of this.seg.ordinalsOf(p)) { project = doc.at(i).project; if (project) break; } }
    const from = this.ov.nextId; this.ov.appendSections(p, text, { ...o, project }); this._added(from);
  }
  get byPath() { const me = this; return { has(p) { return me.ov.byPath.has(p) || (!!me.seg && !me.deadPaths.has(p) && me.seg.ordinalsOf(p).length > 0); } }; }
  get docs() { const me = this; return { get size() { return me._N(); }, *values() { if (me.seg) for (let i = 0; i < me.seg.head.n; i++) if (!me.dead[i]) yield new SegDoc(me.seg, i); yield* me.ov.docs.values(); } }; }
  _N() { return (this.seg ? this.seg.head.n - this.deadCount : 0) + this.ov.docs.size; }
  _Len() { return (this.seg ? this.seg.head.totalLen - this.deadLen : 0) + this.ov.totalLen; }
  docsOf(p, heading) { const out = []; if (this.seg && !this.deadPaths.has(p)) for (const i of this.seg.ordinalsOf(p)) { const d = new SegDoc(this.seg, i); if (heading === undefined || heading === null || (d.heading || '') === heading) out.push(d); } return out.concat(this.ov.docsOf(p, heading)); }
  stats() { let notes = this.ov.byPath.size, terms = this.ov.terms.size; if (this.seg) { const seg = this.seg; seg.cols(); for (const p of seg.paths) if (!this.deadPaths.has(p) && !this.ov.byPath.has(p) && seg.ordinalsOf(p).length) notes++; terms += seg.head.terms; } return { sections: this._N(), notes, terms }; }

  // The words of a query as BM25 sees them, as RecallIndex._terms has them. After a write a word's live count takes a scan of its postings,
  // but a word that stays over the limit even if every dead section held it is dropped whatever the count, so a query need not scan it.
  // Exact counts are still taken for explain, and when dropping would leave no words.
  _plan(q, exact = false) {
    const seg = this.seg, ov = this.ov; const words = [...new Set(tokenize(q))]; const N = this._N(); const avg = N ? this._Len() / N : 0; const ts = []; const dead = this.dead, deadCount = this.deadCount; let skipped = false;
    for (const w of words) {
      const e = seg ? seg.lookup(w) : null; let ids = null, df = 0; const ot = ov.terms.get(w); const odf = ot === undefined ? 0 : ov.df(ot);
      if (e) {
        df = e.df;
        if (deadCount) { if (!exact && N > 2000 && e.df - deadCount + odf > N / 3) skipped = true; else { ids = seg.ids(e); for (let k = 0; k < e.df; k++) if (dead[ids[k]]) df--; } }
      }
      if (df + odf > 0) ts.push({ w, e, ids, ot, df: df + odf, over: skipped && e && deadCount && !ids });
    }
    ts.sort((x, y) => x.df - y.df); let terms = ts;
    if (N > 2000) { const rare = ts.filter((t) => !t.over && t.df <= N / 3); if (!rare.length && skipped && !exact) return this._plan(q, true); terms = (rare.length ? rare : ts.slice(0, 2)).slice(0, 12); }
    return { words, all: ts, terms, N, avg };
  }
  _scratch(need) { const n = this.seg ? this.seg.head.n : 0; if (!this.score || this.score.length < n) { const room = n + (n >> 3); this.score = new Float64Array(room); this.seen = new Uint32Array(room); this.stamp = 0; } if (!this.order || this.order.length < need) this.order = new Uint32Array(Math.max(need, 1024)); this.stamp++; }
  query(q, { limit = 8, project = null, prefix = null, boosts = null, filter = null } = {}) {
    if (!this._N()) return empty(); const { terms, N, avg } = this._plan(q); if (!terms.length) return empty();
    const seg = this.seg, ov = this.ov, n = seg ? seg.head.n : 0, dead = this.dead; let need = 0; for (const t of terms) need += (t.e ? t.e.df : 0) + (t.ot === undefined ? 0 : ov.postings[t.ot].length);
    this._scratch(need); const score = this.score, seen = this.seen, stamp = this.stamp, order = this.order; const c = seg ? seg.cols() : null; const ovScore = new Map(); let m = 0;
    // Sections are visited in the order RecallIndex first meets them, so equal scores rank the same: term by term, the segment's then the overlay's.
    for (const t of terms) {
      const idf = Math.log(1 + (N - t.df + 0.5) / (t.df + 0.5));
      if (t.e) { const ids = t.ids || seg.ids(t.e), tfs = seg.tfs(t.e), df = t.e.df; for (let k = 0; k < df; k++) { const i = ids[k]; if (dead[i]) continue; const f = tfs[k]; const part = idf * (f * K1P) / (f + K1 * (B0 + B * c[i * ROW + C_LEN] / avg)); if (seen[i] === stamp) score[i] += part; else { seen[i] = stamp; score[i] = part; order[m++] = i; } } }
      if (t.ot !== undefined) for (const id of ov.postings[t.ot]) { const d = ov.docs.get(id); if (!d) continue; const part = RecallIndex._bm(RecallIndex._tf(d, t.ot), t.df, N, d.len, avg).part; const was = ovScore.get(id); if (was === undefined) { ovScore.set(id, part); order[m++] = n + id; } else ovScore.set(id, was + part); }
    }
    const proj = project ? String(project).toLowerCase() : null; const top = []; let total = 0; const fly = seg ? new FilterDoc(seg, 0) : null; const plain = seg ? new SegDoc(seg, 0) : null;
    // Empty tuning is every daemon's first state: nothing can change a score, so no heading is needed.
    let maxB = 1, boostSieve = null; if (boosts) { const k = boostInfo(boosts); maxB = k.max; boostSieve = k.sieve; }
    const hasBoosts = boostSieve !== null; const projId = seg && proj ? seg.projectId(proj) : 0; const verdict = filter && seg ? new Int8Array(seg.projects.length + 1) : null;
    for (let x = 0; x < m; x++) {
      const v = order[x]; let d, s, fp;
      if (v >= n) { d = ov.docs.get(v - n); s = ovScore.get(v - n); if (prefix && !d.path.startsWith(prefix)) continue; if (filter && !filter(d)) continue; fp = proj && d.project === proj ? 1.5 : 1; } else {
        s = score[v]; const o = v * ROW; if (prefix && !plain.at(v).path.startsWith(prefix)) continue;
        if (filter) {
          const j = c[o + C_PROJ]; const memo = verdict && c[o + C_RB] === 0 && (fly.sieve === null || !fly.sieve.has(c[o + C_SIG])) ? verdict[j] : 0;
          if (memo === 2) continue;
          if (memo === 0) { fly.at(v); fly.read = false; const ok = filter(fly); if (verdict && !fly.read && c[o + C_RB] === 0) verdict[j] = ok ? 1 : 2; if (!ok) continue; }
        }
        fp = projId && c[o + C_PROJ] === projId ? 1.5 : 1; d = null;
      }
      total++;
      // A section that could not reach the top even at the largest boost needs no boost lookup; multiplying up never rounds past it.
      if (top.length === limit && s * fp * maxB <= top[top.length - 1].score) continue;
      let fb = 1; if (hasBoosts) { if (d) fb = boosts[`${d.path}#${d.heading || ''}`] ?? 1; else if (boostSieve.has(c[v * ROW + C_SIG])) { plain.at(v); fb = boosts[`${plain.path}#${plain.heading || ''}`] ?? 1; } }
      const score2 = s * fp * fb;
      if (top.length === limit && score2 <= top[top.length - 1].score) continue;
      let i = top.length; while (i > 0 && top[i - 1].score < score2) i--; top.splice(i, 0, { v, score: score2 }); if (top.length > limit) top.pop();
    }
    const list = top.map(({ v, score: sc }) => { const d = v >= n ? ov.docs.get(v - n) : new SegDoc(seg, v); const rb = d.rb; return { path: d.path, heading: d.heading, line: d.line, snippet: d.snippet, score: round3(sc), project: d.project, ...(rb ? { review_by: rb } : {}) }; });
    return Object.defineProperty(list, 'total', { value: total, writable: true, configurable: true });
  }
  _tfOf(d, t) {
    if (d instanceof SegDoc) { if (!t.e) return 0; const ids = t.ids || (t.ids = this.seg.ids(t.e)); let lo = 0, hi = t.e.df - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ids[m] === d.i) return (t.tfs || (t.tfs = this.seg.tfs(t.e)))[m]; if (ids[m] < d.i) lo = m + 1; else hi = m - 1; } return 0; }
    return t.ot === undefined ? 0 : RecallIndex._tf(d, t.ot);
  }
  explain(q, d, { project = null, boosts = null } = {}) {
    const { words, all, terms, N, avg } = this._plan(q, true); const used = new Set(terms.map((t) => t.w)); const byW = new Map(all.map((t) => [t.w, t])); const parts = []; let base = 0;
    for (const w of words) { const t = byW.get(w); const f = t ? this._tfOf(d, t) : 0; if (!t || !f) { parts.push({ word: w, in_section: 0, contribution: 0, note: !t ? 'not in any note' : 'not in this section' }); continue; } if (!used.has(w)) { parts.push({ word: w, in_section: f, sections_with_word: t.df, contribution: 0, note: 'too common to count (in over a third of all sections)' }); continue; } const { idf, part } = RecallIndex._bm(f, t.df, N, d.len, avg); base += part; parts.push({ word: w, in_section: f, sections_with_word: t.df, weight: round3(idf), contribution: round3(part) }); }
    parts.sort((a, b) => b.contribution - a.contribution); const pj = project ? String(project).toLowerCase() : null; const fp = pj && d.project === pj ? 1.5 : 1, fb = boosts?.[`${d.path}#${d.heading || ''}`] ?? 1;
    return { score: round3(base * fp * fb), words: parts, matched: parts.filter((p) => p.contribution > 0).map((p) => p.word), dropped_common: all.filter((t) => !used.has(t.w)).map((t) => t.w), section_words: d.len, average_section_words: Number(avg.toFixed(1)), project_multiplier: fp, feedback_multiplier: round3(fb) };
  }
}
