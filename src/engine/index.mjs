// SPDX-License-Identifier: Apache-2.0
// The recall index: BM25 over note sections (a section = a heading and the text under it).
// It is built from the Markdown files, updated per write, and persisted to .memev/index.json.
// Recall reads only this index, never the operation log. Its size follows the notes, not the history.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, truncate } from './util.mjs';

const STOP = new Set('a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when where which who will with you your not no do does did can could should would just also than too very about after before over under more most some such only own same each other any all both few'.split(' '));
export function tokenize(text) {
  return String(text || '').toLowerCase().normalize('NFKD').split(/[^a-z0-9_.-]+/).map((t) => t.replace(/^[.-]+|[.-]+$/g, '')).filter((t) => t.length >= 2 && t.length <= 40 && !STOP.has(t));
}

/** Split a Markdown note into sections: [{ heading, text, line }]. Frontmatter is skipped. */
export function sections(body) {
  let text = String(body || '');
  if (text.startsWith('---\n')) { const e = text.indexOf('\n---', 4); if (e !== -1) text = text.slice(e + 4); }
  const out = []; let cur = { heading: null, lines: [], line: 1 };
  text.split('\n').forEach((l, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) { if (cur.lines.join('').trim() || cur.heading) out.push(cur); cur = { heading: m[2].trim(), lines: [], line: i + 1 }; }
    else cur.lines.push(l);
  });
  if (cur.lines.join('').trim() || cur.heading) out.push(cur);
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim(), line: s.line }));
}

export class RecallIndex {
  constructor(file) { this.file = file; this.docs = new Map(); this.postings = new Map(); this.byPath = new Map(); this.totalLen = 0; this.dirty = false; this.nextId = 1; }

  load() {
    const d = readJson(this.file, null);
    if (!d || d.version !== 1) return false;
    for (const doc of d.docs) this._add(doc.path, doc);
    return true;
  }
  save() { if (!this.dirty) return; writeJson(this.file, { version: 1, docs: [...this.docs.values()].map(({ tf, ...d }) => ({ ...d, tf: Object.fromEntries(tf) })) }, 0o600); this.dirty = false; }

  _add(p, doc) {
    const id = this.nextId++;
    const tf = doc.tf instanceof Map ? doc.tf : new Map(Object.entries(doc.tf || {}));
    const d = { id, path: p, heading: doc.heading ?? null, line: doc.line ?? 1, len: doc.len, project: doc.project ?? null, mtime: doc.mtime ?? null, snippet: doc.snippet, tf };
    this.docs.set(id, d); this.totalLen += d.len;
    if (!this.byPath.has(p)) this.byPath.set(p, new Set());
    this.byPath.get(p).add(id);
    for (const t of tf.keys()) { if (!this.postings.has(t)) this.postings.set(t, new Set()); this.postings.get(t).add(id); }
  }

  remove(p) {
    for (const id of this.byPath.get(p) || []) {
      const d = this.docs.get(id); if (!d) continue;
      for (const t of d.tf.keys()) { const s = this.postings.get(t); if (s) { s.delete(id); if (!s.size) this.postings.delete(t); } }
      this.totalLen -= d.len; this.docs.delete(id);
    }
    this.byPath.delete(p); this.dirty = true;
  }

  /** (Re)index one note from its full text. */
  update(p, body, { mtime = null } = {}) {
    this.remove(p);
    const title = path.posix.basename(p, '.md');
    let project = null;
    const pm = /^project:\s*(.+)$/mi.exec(body || ''); if (pm) project = pm[1].trim().toLowerCase();
    const wa = /^work\/active\/([^/]+)\.md$/.exec(p); if (wa) project = wa[1].toLowerCase();
    for (const s of sections(body)) {
      const toks = tokenize(`${title} ${s.heading || ''} ${s.heading || ''} ${s.text}`);
      if (!toks.length) continue;
      const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      const sp = /^project:\s*(.+)$/mi.exec(s.text);
      this._add(p, { heading: s.heading, line: s.line, len: toks.length, project: sp ? sp[1].trim().toLowerCase() : project, mtime, snippet: truncate(s.text.replace(/\s+/g, ' '), 400), tf });
    }
    this.dirty = true;
  }

  /** BM25. Returns [{ path, heading, line, snippet, score, project }]. `project` boosts that project's sections. */
  query(q, { limit = 8, project = null, prefix = null, boosts = null } = {}) {
    const terms = [...new Set(tokenize(q))];
    if (!terms.length || !this.docs.size) return [];
    const N = this.docs.size, avg = this.totalLen / N, k1 = 1.2, b = 0.75;
    const scores = new Map();
    for (const t of terms) {
      const ids = this.postings.get(t); if (!ids) continue;
      const idf = Math.log(1 + (N - ids.size + 0.5) / (ids.size + 0.5));
      for (const id of ids) {
        const d = this.docs.get(id); const f = d.tf.get(t);
        scores.set(id, (scores.get(id) || 0) + idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg)));
      }
    }
    const proj = project ? String(project).toLowerCase() : null;
    return [...scores.entries()].map(([id, s]) => {
      const d = this.docs.get(id);
      return { d, score: s * (proj && d.project === proj ? 1.5 : 1) * (boosts?.[`${d.path}#${d.heading || ''}`] ?? 1) };
    }).filter(({ d }) => !prefix || d.path.startsWith(prefix))
      .sort((x, y) => y.score - x.score).slice(0, limit)
      .map(({ d, score }) => ({ path: d.path, heading: d.heading, line: d.line, snippet: d.snippet, score: Number(score.toFixed(3)), project: d.project }));
  }

  stats() { return { sections: this.docs.size, notes: this.byPath.size, terms: this.postings.size }; }
}
