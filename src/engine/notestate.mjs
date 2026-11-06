// SPDX-License-Identifier: Apache-2.0
// What the vault remembers about each note between runs, so a start need not read every note: the file's size, modified time and
// changed time, the logged hash they belong to, and the entities each section names (the graph is a pure function of those).
//
//   <state>/notes.state          base: one JSON array per line, sorted by path, rewritten only when folded
//   <state>/notes.journal        the same lines, appended as notes change
//   <state>/notes.journal.old    a journal being folded by a worker; read between the base and the journal
//
// Lines: ["e",n,id,name,kind] names mention n; ["n",path,size,mtimeMs,ctimeMs,hash,sections,op] is a note's whole record, where op names
// the log record it stands at; ["a",path,size,mtimeMs,ctimeMs,hash,sections,op,prev] adds sections to the record standing at prev and moves
// it to op. A record standing anywhere else drops, so lines replayed after a crash in a fold can never double a section: at worst the note is read;
// ["d",path] drops a record.
// sections = [[heading,[mention numbers]]...], sections with no entity left out.
//
// This file is a cache and never the authority. A record counts only while the note's stat and the log's hash for it both match; a
// missing, torn or old record is a read of the note and nothing more. So a line lost to a hard kill costs one read at the next start.
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { replacePrivate, readPrivate, appendPrivate } from './util.mjs';

const VERSION = 1;
export const short = (h) => (h ? String(h).slice(0, 16) : null);
const parseLines = (text) => {
  if (!text) return [];
  const end = text.lastIndexOf('\n'); if (end < 0) return [];
  const body = text.slice(0, end);
  try { return JSON.parse(`[${body.replaceAll('\n', ',')}]`); } catch {}
  const out = []; for (const l of body.split('\n')) { try { out.push(JSON.parse(l)); } catch {} } return out;
};
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** Apply lines to a record map. Records hold mention numbers, so `mentions` must go with them. */
export function applyLines(lines, recs, mentions) {
  for (const l of lines) {
    switch (l[0]) {
      case 'e': mentions[l[1]] = [l[2], l[3], l[4]]; break;
      case 'n': recs.set(l[1], { size: l[2], mtimeMs: l[3], ctimeMs: l[4], ch: l[5], secs: l[6], op: l[7] }); break;
      case 'a': { const r = recs.get(l[1]); if (r?.op === l[7]) break; if (r?.secs && r.op === l[8]) { r.size = l[2]; r.mtimeMs = l[3]; r.ctimeMs = l[4]; r.ch = l[5]; r.op = l[7]; for (const s of l[6]) r.secs.push(s); } else recs.delete(l[1]); break; }
      case 'd': recs.delete(l[1]); break;
      default:
    }
  }
}

/** Read every file into { recs, mentions }. A base of another version counts as no base. */
export function readState(state, withJournal = true) {
  const recs = new Map(); const mentions = [];
  const base = parseLines(read(path.join(state, 'notes.state')));
  if (!base.length || base[0]?.[0] !== 'v' || base[0][1] !== VERSION) return { recs, mentions, base: false };
  applyLines(base, recs, mentions);
  applyLines(parseLines(read(path.join(state, 'notes.journal.old'))), recs, mentions);
  if (withJournal) applyLines(parseLines(read(path.join(state, 'notes.journal'))), recs, mentions);
  return { recs, mentions, base: true };
}

/** The base's text. Numbers stay as they are: a running vault goes on using them after a fold. */
export function baseText(recs, mentions) {
  const parts = [`${JSON.stringify(['v', VERSION])}\n`];
  mentions.forEach((t, n) => { if (t) parts.push(`${JSON.stringify(['e', n, t[0], t[1], t[2]])}\n`); });
  for (const p of [...recs.keys()].sort()) { const r = recs.get(p); if (r.secs) parts.push(`${JSON.stringify(['n', p, r.size, r.mtimeMs, r.ctimeMs, r.ch, r.secs, r.op])}\n`); }
  return parts.join('');
}

const writePrivateFile = replacePrivate;
/**
 * Every note a walk of the vault finds, with its lstat. The walk skips links, so a note in the result has no link on the way to it, and one
 * lstat per note stands in for checking each folder of each path. Vault.allNotes keeps its own walk for callers that want names only.
 */
export function scanNotes(root) {
  const out = new Map();
  const walk = (d, rel) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name; const full = `${d}${path.sep}${e.name}`;
      if (e.isDirectory()) { if (r !== 'work/archive') walk(full, r); }
      else if (e.name.endsWith('.md')) { try { out.set(r, fs.lstatSync(full)); } catch { out.set(r, null); } }
    }
  };
  walk(root, ''); return out;
}

/** Fold the old journal into the base. Runs on a worker. Rename is the commit: a crash before it leaves both inputs, after it the old journal replays harmlessly (see the "a" line). */
export function foldFiles(state) {
  const { recs, mentions } = readState(state, false); // the live journal is read on top at the next start, and only then
  writePrivateFile(path.join(state, 'notes.state'), baseText(recs, mentions));
  fs.rmSync(path.join(state, 'notes.journal.old'), { force: true });
}

export class NoteState {
  constructor(state) { this.state = state; this.recs = new Map(); this.mentions = []; this.byKey = null; this.pending = []; this.lines = 0; this.hadBase = false; this.folding = false; this.foldWorker = null; }
  get journal() { return path.join(this.state, 'notes.journal'); }
  load() {
    const { recs, mentions, base } = readState(this.state);
    this.recs = recs; this.mentions = mentions; this.hadBase = base;
    this.lines = read(this.journal).split('\n').length - 1;
    return this;
  }
  _mention(e) {
    if (!this.byKey) { this.byKey = new Map(); this.mentions.forEach((t, n) => { if (t) this.byKey.set(`${t[0]}\0${t[1]}\0${t[2]}`, n); }); }
    const key = `${e.id}\0${e.name}\0${e.kind}`; let n = this.byKey.get(key);
    if (n === undefined) { n = this.mentions.length; this.byKey.set(key, n); this.mentions[n] = [e.id, e.name, e.kind]; this.pending.push(JSON.stringify(['e', n, e.id, e.name, e.kind])); }
    return n;
  }
  /** `found` from Graph.indexSections: [[heading,[{id,name,kind}...]]...]. */
  _secs(found) { return found.map(([h, ents]) => [h, ents.map((e) => this._mention(e))]); }
  put(p, st, ch, found, op) { const secs = this._secs(found); const o = short(op); if (this.recs) this.recs.set(p, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ch, secs, op: o }); this.pending.push(JSON.stringify(['n', p, st.size, st.mtimeMs, st.ctimeMs, ch, secs, o])); }
  add(p, st, ch, found, rec) { this.pending.push(JSON.stringify(['a', p, st.size, st.mtimeMs, st.ctimeMs, ch, this._secs(found), short(rec.hash), short(rec.prev)])); }
  /** The content is known the same (its hash matched); only the stat moved. */
  restat(p, st) { const r = this.recs?.get(p); if (!r) return; r.size = st.size; r.mtimeMs = st.mtimeMs; r.ctimeMs = st.ctimeMs; this.pending.push(JSON.stringify(['n', p, st.size, st.mtimeMs, st.ctimeMs, r.ch, r.secs, r.op])); }
  drop(p) { this.recs?.delete(p); this.pending.push(JSON.stringify(['d', p])); }
  /** After a start: fold when it is due, then let go of the records. While serving only the journal is written. */
  opened(paths) {
    for (const p of [...this.recs.keys()]) if (!paths.has(p)) this.recs.delete(p);
    if (!this.hadBase || this.lines + this.pending.length > this.foldAt()) {
      writePrivateFile(path.join(this.state, 'notes.state'), baseText(this.recs, this.mentions));
      fs.rmSync(this.journal, { force: true }); fs.rmSync(`${this.journal}.old`, { force: true });
      this.pending = []; this.lines = 0; this.hadBase = true;
    } else this.flush();
    this.noteCount = paths.size; this.recs = null;
  }
  foldAt() { return Math.max(5000, (this.recs?.size ?? this.noteCount ?? 0) / 5); }
  /** Write out what changed. */
  flush() {
    if (!this.pending.length) return;
    fs.appendFileSync(this.journal, `${this.pending.join('\n')}\n`, { mode: 0o600 }); this.lines += this.pending.length; this.pending = [];
    if (!this.folding && this.lines > this.foldAt()) this._foldSoon();
  }
  /** Move the journal aside and let a worker merge it. An old journal still there means a fold is unfinished; it waits for the next start. */
  _foldSoon() {
    const old = `${this.journal}.old`; if (fs.existsSync(old)) return;
    fs.renameSync(this.journal, old); this.lines = 0; this.folding = true;
    const w = new Worker(new URL('./notes-worker.mjs', import.meta.url), { workerData: { job: 'fold', state: this.state } }); w.unref();
    const end = () => { this.folding = false; }; w.once('exit', end); w.once('error', end); this.foldWorker = w;
  }
  close() { try { this.flush(); } catch {} try { this.foldWorker?.terminate(); } catch {} }
}
