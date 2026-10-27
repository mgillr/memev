// SPDX-License-Identifier: Apache-2.0
// The recall index: BM25 over note sections (a section = a heading and the text under it).
// It is built from the Markdown files, updated per write, and persisted to .memev/index.jsonl.
// Recall reads only this index, never the operation log. Its size follows the notes, not the history.
import fs from 'node:fs';
import path from 'node:path';
import { truncate } from './util.mjs';
import { readLines } from './oplog.mjs';

const STOP = new Set('a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when where which who will with you your not no do does did can could should would just also than too very about after before over under more most some such only own same each other any all both few'.split(' '));
export function tokenize(text) {
  return String(text || '').toLowerCase().normalize('NFKD').split(/[^a-z0-9_.-]+/).map((t) => t.replace(/^[.-]+|[.-]+$/g, '')).filter((t) => t.length >= 2 && t.length <= 40 && !STOP.has(t));
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

// Memory layout: one dictionary of terms; per section a sorted Int32Array of term ids and a Uint16Array
// of counts; per term a packed array of section ids. Removing a note marks its sections dead; the
// postings are compacted when a fifth of them are dead. This keeps the index to a few bytes per
// (section, term) pair, so a month of heavy use fits well inside a small heap.
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
      if (version === null) { version = r.version; if (version !== 2) return false; continue; }
      const tf = new Map(); r.t.forEach((t, i) => tf.set(t, r.f[i]));
      this._add(r.path, { ...r, tf }); any = true;
    }
    if (version === null && fs.existsSync(legacy)) { try { fs.rmSync(legacy); } catch {} }
    this.dirty = false;
    return version === 2 && (any || this.docs.size === 0);
  }

  /** Streamed to disk one section per line: no whole-index string in memory. */
  save() {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`; const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify({ version: 2, sections: this.docs.size })}\n`);
      let buf = '';
      for (const d of this.docs.values()) {
        buf += `${JSON.stringify({ path: d.path, heading: d.heading, line: d.line, len: d.len, project: d.project, mtime: d.mtime, snippet: d.snippet, t: Array.from(d.tids, (id) => this.termList[id]), f: Array.from(d.tfs) })}\n`;
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
    const d = { id, path: p, heading: doc.heading ?? null, line: doc.line ?? 1, len: doc.len, project: doc.project ?? null, mtime: doc.mtime ?? null, snippet: doc.snippet, tids, tfs };
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
      this._add(p, { heading: s.heading, line: s.line + lineOffset, len: toks.length, project: sp ? sp[1].trim().toLowerCase() : project, mtime, snippet: own(truncate(s.text.replace(/\s+/g, ' '), 400)), tf });
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

  /** BM25. Returns [{ path, heading, line, snippet, score, project }]. `project` boosts that project's sections. */
  query(q, { limit = 8, project = null, prefix = null, boosts = null } = {}) {
    let terms = [...new Set(tokenize(q))].map((t) => this.terms.get(t)).filter((t) => t !== undefined);
    if (!terms.length || !this.docs.size) return [];
    const N = this.docs.size, avg = this.totalLen / N, k1 = 1.2, b = 0.75;
    const dfs = new Map(terms.map((t) => [t, this.df(t)]));
    terms = terms.filter((t) => dfs.get(t) > 0);
    // rarest terms first; on a large index, terms in more than a third of all sections carry almost
    // no signal (BM25 idf near zero) and would make every query touch every section, so they are dropped
    terms.sort((x, y) => dfs.get(x) - dfs.get(y));
    if (N > 2000) { const rare = terms.filter((t) => dfs.get(t) <= N / 3); terms = (rare.length ? rare : terms.slice(0, 2)).slice(0, 12); }
    const scores = new Map();
    for (const t of terms) {
      const df = dfs.get(t); const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const id of this.postings[t]) {
        const d = this.docs.get(id); if (!d) continue;
        const f = RecallIndex._tf(d, t);
        scores.set(id, (scores.get(id) || 0) + idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg)));
      }
    }
    const proj = project ? String(project).toLowerCase() : null;
    // keep only the best `limit` (a small sorted array), not a sort of every match
    const top = [];
    for (const [id, s] of scores) {
      const d = this.docs.get(id);
      if (prefix && !d.path.startsWith(prefix)) continue;
      const score = s * (proj && d.project === proj ? 1.5 : 1) * (boosts?.[`${d.path}#${d.heading || ''}`] ?? 1);
      if (top.length === limit && score <= top[top.length - 1].score) continue;
      let i = top.length; while (i > 0 && top[i - 1].score < score) i--;
      top.splice(i, 0, { d, score }); if (top.length > limit) top.pop();
    }
    return top.map(({ d, score }) => ({ path: d.path, heading: d.heading, line: d.line, snippet: d.snippet, score: Number(score.toFixed(3)), project: d.project }));
  }

  stats() { return { sections: this.docs.size, notes: this.byPath.size, terms: this.terms.size }; }
}
