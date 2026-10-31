// SPDX-License-Identifier: Apache-2.0
// The recall index: BM25 over note sections (a section = a heading and the text under it).
// It is built from the Markdown files, updated per write, and persisted to .memev/index.jsonl.
// Recall reads only this index, never the operation log. Its size follows the notes, not the history.
import fs from 'node:fs';
import path from 'node:path';
import { truncate } from './util.mjs';
import { readLines } from './oplog.mjs';

const STOP = new Set('a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when where which who will with you your not no do does did can could should would just also than too very about after before over under more most some such only own same each other any all both few'.split(' '));
// Scripts written without spaces between words. A run of these is indexed as single characters and
// overlapping pairs (東京都 -> 東 京 都 東京 京都), the usual way to search CJK text without a dictionary.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const RUN = /[\p{L}\p{N}_][\p{L}\p{N}\p{M}_.-]*/gu;
const word = (t) => { t = t.replace(/^[.-]+|[.-]+$/g, ''); return t.length >= 2 && t.length <= 40 && !STOP.has(t) ? t : null; };
/**
 * Words for the recall index. ASCII text keeps the original rules exactly (a-z, 0-9, _ . -), so an
 * English vault indexes the same as before. Other text keeps every letter and digit in any script:
 * accents on Latin and Greek letters are folded (café -> cafe), Cyrillic, Arabic, Hebrew, Devanagari
 * and the rest stay as written, and CJK runs become characters plus pairs.
 */
export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  if (!/[^\x00-\x7f]/.test(s)) return s.split(/[^a-z0-9_.-]+/).map(word).filter(Boolean);
  const n = s.normalize('NFKD').replace(/([\p{Script=Latin}\p{Script=Greek}])\p{M}+/gu, '$1').normalize('NFC');
  const out = [];
  for (const [run] of n.matchAll(RUN)) {
    let plain = '', cjk = '';
    const flushPlain = () => { if (plain) { const w = word(plain); if (w) out.push(w); plain = ''; } };
    const flushCjk = () => { if (cjk) { const c = [...cjk]; for (let i = 0; i < c.length; i++) { out.push(c[i]); if (i + 1 < c.length) out.push(c[i] + c[i + 1]); } cjk = ''; } };
    for (const ch of run) { if (CJK.test(ch)) { flushPlain(); cjk += ch; } else { flushCjk(); plain += ch; } }
    flushPlain(); flushCjk();
  }
  return out;
}

/** Split a Markdown note into sections: [{ heading, text, line }]. Frontmatter is skipped. */
// A string that does not keep its source alive: V8 can represent a substring as a view of the whole
// note, so a heading or snippet kept in memory would otherwise pin every note it came from.
export const own = (s) => (typeof s === 'string' && s.length > 12 ? Buffer.from(s, 'utf8').toString('utf8') : s);

export function sections(body) {
  let text = String(body || '');
  if (text.startsWith('---\n')) { const e = text.indexOf('\n---', 4); if (e !== -1) text = text.slice(e + 4); }
  const out = []; let cur = { heading: null, lines: [], line: 1 };
  text.split('\n').forEach((l, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) { if (cur.lines.join('').trim() || cur.heading) out.push(cur); cur = { heading: own(m[2].trim()), lines: [], line: i + 1 }; }
    else cur.lines.push(l);
  });
  if (cur.lines.join('').trim() || cur.heading) out.push(cur);
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim(), line: s.line }));
}

// The match count rides on the result list as a property that is not enumerable, so a caller that
// compares, copies or serialises the list sees the same list as before.
const withTotal = (list, total) => Object.defineProperty(list, 'total', { value: total, writable: true, configurable: true });

// Memory layout: one dictionary of terms; per section a sorted Int32Array of term ids and a Uint16Array
// of counts; per term a packed array of section ids. Removing a note marks its sections dead; the
// postings are compacted when a fifth of them are dead. This keeps the index to a few bytes per
// (section, term) pair, so a month of heavy use fits well inside a small heap.
export const INDEX_VERSION = 3; // 3: Unicode words and review dates

export class RecallIndex {
  constructor(file) { this.file = file; this.reset(); }
  reset() { this.terms = new Map(); this.termList = []; this.docs = new Map(); this.postings = []; this.byPath = new Map(); this.totalLen = 0; this.dirty = false; this.nextId = 1; this.dead = 0; this.live = 0; }

  _tid(t) { let id = this.terms.get(t); if (id === undefined) { id = this.termList.length; this.terms.set(t, id); this.termList.push(t); this.postings.push([]); } return id; }

  load() {
    const legacy = this.file.replace(/\.jsonl$/, '.json');
    let any = false, version = null;
    for (const [line] of readLines(this.file)) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (version === null) { version = r.version; if (version !== INDEX_VERSION) return false; continue; }
      const tf = new Map(); r.t.forEach((t, i) => tf.set(t, r.f[i]));
      this._add(r.path, { ...r, tf }); any = true;
    }
    if (version === null && fs.existsSync(legacy)) { try { fs.rmSync(legacy); } catch {} }
    this.dirty = false;
    return version === INDEX_VERSION && (any || this.docs.size === 0);
  }

  /** Streamed to disk one section per line: no whole-index string in memory. */
  save() {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`; const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify({ version: INDEX_VERSION, sections: this.docs.size })}\n`);
      let buf = '';
      for (const d of this.docs.values()) {
        buf += `${JSON.stringify({ path: d.path, heading: d.heading, line: d.line, len: d.len, project: d.project, mtime: d.mtime, snippet: d.snippet, ...(d.rb ? { rb: d.rb } : {}), ...(d.fl ? { fl: d.fl } : {}), t: Array.from(d.tids, (id) => this.termList[id]), f: Array.from(d.tfs) })}\n`;
        if (buf.length > 1 << 20) { fs.writeSync(fd, buf); buf = ''; }
      }
      if (buf) fs.writeSync(fd, buf);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  _add(p, doc) {
    const id = this.nextId++;
    const entries = [...doc.tf.entries()].map(([t, f]) => [this._tid(t), f]).sort((a, b) => a[0] - b[0]);
    const tids = Int32Array.from(entries, (e) => e[0]); const tfs = Uint16Array.from(entries, (e) => Math.min(e[1], 65535));
    const d = { id, path: p, heading: doc.heading ?? null, line: doc.line ?? 1, len: doc.len, project: doc.project ?? null, mtime: doc.mtime ?? null, snippet: doc.snippet, rb: doc.rb ?? null, fl: doc.fl ?? null, tids, tfs };
    this.docs.set(id, d); this.totalLen += d.len; this.live++;
    if (!this.byPath.has(p)) this.byPath.set(p, []);
    this.byPath.get(p).push(id);
    for (const t of tids) this.postings[t].push(id);
  }

  remove(p) {
    for (const id of this.byPath.get(p) || []) { const d = this.docs.get(id); if (!d) continue; this.totalLen -= d.len; this.docs.delete(id); this.dead += d.tids.length; this.live--; }
    this.byPath.delete(p); this.dirty = true;
    if (this.dead > 50000 && this.dead > this.postingsSize() / 5) this.compact();
  }
  postingsSize() { let n = 0; for (const a of this.postings) n += a.length; return n; }
  compact() { for (let t = 0; t < this.postings.length; t++) this.postings[t] = this.postings[t].filter((id) => this.docs.has(id)); this.dead = 0; }
  df(t) { const a = this.postings[t]; if (!this.dead) return a.length; let n = 0; for (const id of a) if (this.docs.has(id)) n++; return n; }

  _sectionDocs(p, secs, { lineOffset = 0, mtime = null, project = null }) {
    const title = path.posix.basename(p, '.md');
    for (const s of secs) {
      const toks = tokenize(`${title} ${s.heading || ''} ${s.heading || ''} ${s.text}`);
      if (!toks.length) continue;
      const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      const sp = /^project:\s*(.+)$/mi.exec(s.text);
      const rb = /^review-by:\s*(\d{4}-\d{2}-\d{2})\s*$/mi.exec(s.text); const fl = /^flags:\s*([a-z, -]+)$/mi.exec(s.text);
      this._add(p, { heading: s.heading, line: s.line + lineOffset, len: toks.length, project: sp ? sp[1].trim().toLowerCase() : project, mtime, rb: rb ? rb[1] : null, fl: fl ? fl[1].trim() : null, snippet: own(truncate(s.text.replace(/\s+/g, ' '), 400)), tf });
    }
    this.dirty = true;
  }

  /** (Re)index one note from its full text. */
  update(p, body, { mtime = null } = {}) {
    this.remove(p);
    let project = null;
    const pm = /^project:\s*(.+)$/mi.exec(body || ''); if (pm) project = pm[1].trim().toLowerCase();
    const wa = /^work\/active\/([^/]+)\.md$/.exec(p); if (wa) project = wa[1].toLowerCase();
    this._sectionDocs(p, sections(body), { mtime, project });
  }

  /** Index only the sections an append added (the text starts with a heading). Lines are offset. */
  appendSections(p, text, { lineOffset = 0, mtime = null, project = null } = {}) {
    if (!project) { const wa = /^work\/active\/([^/]+)\.md$/.exec(p); if (wa) project = wa[1].toLowerCase(); else for (const id of this.byPath.get(p) || []) { project = this.docs.get(id)?.project || null; if (project) break; } }
    this._sectionDocs(p, sections(text), { lineOffset, mtime, project });
  }

  static _tf(d, t) { let lo = 0, hi = d.tids.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; const v = d.tids[m]; if (v === t) return d.tfs[m]; if (v < t) lo = m + 1; else hi = m - 1; } return 0; }

  /** The query's terms as BM25 sees them: known, present, rarest first; on a large index the very common ones are dropped. */
  _terms(q) {
    const words = [...new Set(tokenize(q))];
    let terms = words.map((t) => this.terms.get(t)).filter((t) => t !== undefined);
    const N = this.docs.size; const dfs = new Map(terms.map((t) => [t, this.df(t)]));
    terms = terms.filter((t) => dfs.get(t) > 0);
    // rarest terms first; on a large index, terms in more than a third of all sections carry almost
    // no signal (BM25 idf near zero) and would make every query touch every section, so they are dropped
    terms.sort((x, y) => dfs.get(x) - dfs.get(y));
    const all = terms;
    if (N > 2000) { const rare = terms.filter((t) => dfs.get(t) <= N / 3); terms = (rare.length ? rare : terms.slice(0, 2)).slice(0, 12); }
    const used = new Set(terms);
    return { words, terms, dfs, N, avg: N ? this.totalLen / N : 0, dropped: all.filter((t) => !used.has(t)).map((t) => this.termList[t]), unknown: words.filter((w) => !this.terms.has(w) || !dfs.get(this.terms.get(w))) };
  }
  static _bm(f, df, N, len, avg) { const k1 = 1.2, b = 0.75; const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)); return { idf, part: idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / avg)) }; }
  _factor(d, proj, boosts) { return { project: proj && d.project === proj ? 1.5 : 1, feedback: boosts?.[`${d.path}#${d.heading || ''}`] ?? 1 }; }

  /**
   * BM25. Returns [{ path, heading, line, snippet, score, project, review_by }], with `total` on the
   * array: how many sections matched and passed `prefix` and `filter`, counted without ranking them all.
   * `project` boosts that project's sections; `filter(doc)` drops sections before ranking (scope,
   * permissions, review state), so a hidden section can never push a visible one out of the top.
   */
  query(q, { limit = 8, project = null, prefix = null, boosts = null, filter = null } = {}) {
    if (!this.docs.size) return withTotal([], 0);
    const { terms, dfs, N, avg } = this._terms(q);
    if (!terms.length) return withTotal([], 0);
    const scores = new Map();
    for (const t of terms) {
      const df = dfs.get(t);
      for (const id of this.postings[t]) {
        const d = this.docs.get(id); if (!d) continue;
        scores.set(id, (scores.get(id) || 0) + RecallIndex._bm(RecallIndex._tf(d, t), df, N, d.len, avg).part);
      }
    }
    const proj = project ? String(project).toLowerCase() : null;
    // keep only the best `limit` (a small sorted array), not a sort of every match
    const top = []; let total = 0;
    for (const [id, s] of scores) {
      const d = this.docs.get(id);
      if (prefix && !d.path.startsWith(prefix)) continue;
      if (filter && !filter(d)) continue;
      total++;
      const f = this._factor(d, proj, boosts); const score = s * f.project * f.feedback;
      if (top.length === limit && score <= top[top.length - 1].score) continue;
      let i = top.length; while (i > 0 && top[i - 1].score < score) i--;
      top.splice(i, 0, { d, score }); if (top.length > limit) top.pop();
    }
    return withTotal(top.map(({ d, score }) => ({ path: d.path, heading: d.heading, line: d.line, snippet: d.snippet, score: Number(score.toFixed(3)), project: d.project, ...(d.rb ? { review_by: d.rb } : {}) })), total);
  }

  /** The sections of one note, optionally only the one with this heading. */
  docsOf(p, heading) { return (this.byPath.get(p) || []).map((id) => this.docs.get(id)).filter((d) => d && (heading === undefined || heading === null || (d.heading || '') === heading)); }

  /**
   * Why a section scores what it does for a query: each query word with its count in the section, how
   * many sections hold it, its weight and its share of the score, then the project and feedback
   * multipliers. The parts multiply back to the score query() gives (lexical recall can be explained
   * exactly; there is no hidden similarity number).
   */
  explain(q, d, { project = null, boosts = null } = {}) {
    const { words, terms, dfs, N, avg, dropped } = this._terms(q);
    const used = new Set(terms); const parts = []; let base = 0;
    for (const w of words) {
      const t = this.terms.get(w); const f = t === undefined ? 0 : RecallIndex._tf(d, t);
      if (t === undefined || !f) { parts.push({ word: w, in_section: 0, contribution: 0, note: t === undefined || !dfs.get(t) ? 'not in any note' : 'not in this section' }); continue; }
      if (!used.has(t)) { parts.push({ word: w, in_section: f, sections_with_word: dfs.get(t), contribution: 0, note: 'too common to count (in over a third of all sections)' }); continue; }
      const { idf, part } = RecallIndex._bm(f, dfs.get(t), N, d.len, avg); base += part;
      parts.push({ word: w, in_section: f, sections_with_word: dfs.get(t), weight: Number(idf.toFixed(3)), contribution: Number(part.toFixed(3)) });
    }
    parts.sort((a, b) => b.contribution - a.contribution);
    const f = this._factor(d, project ? String(project).toLowerCase() : null, boosts);
    return { score: Number((base * f.project * f.feedback).toFixed(3)), words: parts, matched: parts.filter((p) => p.contribution > 0).map((p) => p.word), dropped_common: dropped, section_words: d.len, average_section_words: Number(avg.toFixed(1)), project_multiplier: f.project, feedback_multiplier: Number(f.feedback.toFixed(3)) };
  }

  stats() { return { sections: this.docs.size, notes: this.byPath.size, terms: this.terms.size }; }
}
