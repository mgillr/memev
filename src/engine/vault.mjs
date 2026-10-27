// SPDX-License-Identifier: Apache-2.0
// The vault: Markdown notes you own, in git, with an append-only operation log as the write-ahead log,
// a recall index over sections and a memory graph. One process (the daemon) writes; every client talks
// to it over MCP (stdio is proxied to the daemon) or HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { sha256, readJson, writeJson, writePrivateJson, exists, now, stamp, slug, truncate, randomToken } from './util.mjs';
import { OpLog } from './oplog.mjs';
import { RecallIndex, tokenize, sections } from './index.mjs';
import { TokenStore, allowed } from './tokens.mjs';
import { CommitQueue, git } from './git.mjs';
import { lineSplice, applySplice } from './diff.mjs';
import { findSecrets, redactSecrets } from './secrets.mjs';
import { Graph } from './graph.mjs';
import { Tournament, ROUNDS } from './tournament.mjs';
import { loadTuning } from './tuning.mjs';
import { attach as attachContracts, installVaultHooks } from './contracts.mjs';

export const VERSION = '0.1.0';
export const STATE = '.memev';
const KINDS = { decision: 'decisions', gotcha: 'gotchas', fact: 'facts', pattern: 'patterns', win: 'wins', person: 'people', note: 'notes', preference: 'preferences' };
const PROTECTED = [/^contracts\/signed\//, /^contracts\/keys\//];
const DEFAULT_CONFIG = { version: 1, port: 7787, remote: { enabled: true, provider: 'auto', rate_per_min: 120 }, sync: { interval_min: 30 }, recall: { per_prompt: true, max_chars: 1500, min_score: 1.0 }, journal: { enabled: true, max_chars: 2000 }, contracts: { exec_local_only: true } };

export class VaultError extends Error { constructor(code, message) { super(message); this.code = code; } }

export function checkPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.split('/').some((x) => x === '..' || x === '' || x.startsWith('.'))) throw new VaultError('bad_path', `not a vault path: ${p}`);
  if (!/\.(md|json|pub|txt)$/.test(s)) throw new VaultError('bad_path', `only .md, .json, .pub and .txt notes: ${p}`);
  return s;
}

export function isVault(root) { return exists(path.join(root, STATE, 'config.json')); }

export class Vault extends EventEmitter {
  constructor(root, opts = {}) { super(); this.root = path.resolve(root); this.opts = opts; this.state = path.join(this.root, STATE); }

  open() {
    if (!isVault(this.root)) throw new VaultError('not_a_vault', `${this.root} is not a Memev vault (memev init)`);
    this.config = { ...DEFAULT_CONFIG, ...readJson(path.join(this.state, 'config.json'), {}) };
    this.tokens = new TokenStore(path.join(this.state, 'tokens.json'));
    this.log = new OpLog(path.join(this.state, 'oplog'), { segmentBytes: this.opts.segmentBytes, snapshotEvery: this.opts.snapshotEvery, fsync: this.opts.fsync ?? true }).open();
    this.index = new RecallIndex(path.join(this.state, 'index.jsonl'));
    this.graph = new Graph();
    this.tournament = new Tournament();
    this.feedback = new Map();
    this.contractSessions = new Map();
    this.contractResults = new Map();
    this.commits = new CommitQueue(this.root, { enabled: this.opts.git !== false, delayMs: this.opts.commitDelayMs ?? 400 });
    this.recover();
    const loaded = this.index.load();
    if (!loaded || this.index.stats().notes === 0) this.reindexAll(); else for (const p of this.allNotes()) this.graph.indexNote(p, this._read(p));
    this._replayGraph();
    this.tuning = loadTuning(this);
    this.started = now();
    return this;
  }

  close() { this.commits.flush(); this.index.save(); this._saveGraph(); this.log.close(); }

  // ---- files
  abs(p) { return path.join(this.root, ...p.split('/')); }
  _read(p) { try { return fs.readFileSync(this.abs(p), 'utf8'); } catch { return null; } }
  allNotes(dir = '') {
    const out = []; const base = dir ? this.abs(dir) : this.root;
    const walk = (d, rel) => { let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of ents) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.name.endsWith('.md')) out.push(r); } };
    walk(base, dir.replace(/\/$/, '')); return out.sort();
  }
  reindexAll() { for (const p of this.allNotes()) { const b = this._read(p); this.index.update(p, b); this.graph.indexNote(p, b); } this.index.save(); }

  /**
   * Reconcile the files with the log at startup (and before every write to a note):
   *   file missing             → rebuilt from the log, byte for byte
   *   file is a prefix of it   → a crash cut an append short: completed from the log
   *   file differs otherwise   → edited by hand or by git: recorded as an external 'put' (the old
   *                              version stays in the log), never overwritten
   */
  recover() {
    const fixed = [], imported = [];
    for (const [p, h] of this.log.heads) {
      if (h.deleted || !h.ch) continue;
      const cur = this._read(p);
      if (cur !== null && sha256(cur) === h.ch) continue;
      const content = this.materialize(p);
      if (content === null || sha256(content) !== h.ch) continue;
      if (cur === null || (content.startsWith(cur) && cur.length < content.length)) { fs.mkdirSync(path.dirname(this.abs(p)), { recursive: true }); fs.writeFileSync(this.abs(p), content); fixed.push(p); }
      else { this._importExternal(p, cur, 'startup'); imported.push(p); }
    }
    for (const p of this.allNotes()) if (!this.log.heads.has(p)) { this._importExternal(p, this._read(p), 'startup'); imported.push(p); }
    this.recovered = fixed; this.imported = imported;
    return fixed;
  }
  _importExternal(p, body, source) {
    const rec = this.log.append({ type: 'put', path: p, agent: 'external', client: source, data: { content: body, ch: sha256(body), external: true } });
    return rec;
  }
  // Per-note cache (size, mtime, content hash state, line count) so an append costs what it appends,
  // not the size of the note. A stat that does not match means the file changed outside Memev.
  _ncSet(p, body) {
    const nc = this._nc || (this._nc = new Map());
    let st; try { st = fs.statSync(this.abs(p)); } catch { nc.delete(p); return; }
    const hasher = crypto.createHash('sha256').update(body);
    nc.delete(p); nc.set(p, { size: st.size, mtimeMs: st.mtimeMs, hasher, ch: hasher.copy().digest('hex'), lines: (body.match(/\n/g) || []).length, endsNL: body.endsWith('\n'), empty: body.length === 0 });
    if (nc.size > 256) nc.delete(nc.keys().next().value);
  }
  _ncGet(p) {
    const c = this._nc?.get(p); if (!c) return null;
    let st; try { st = fs.statSync(this.abs(p)); } catch { this._nc.delete(p); return null; }
    return st.size === c.size && st.mtimeMs === c.mtimeMs ? c : null;
  }
  _ncAppend(p, t) {
    const c = this._nc?.get(p); if (!c) return;
    c.hasher.update(t); c.ch = c.hasher.copy().digest('hex'); c.lines += (t.match(/\n/g) || []).length; c.endsNL = t.endsWith('\n'); c.empty = false;
    try { const st = fs.statSync(this.abs(p)); c.size = st.size; c.mtimeMs = st.mtimeMs; } catch { this._nc.delete(p); }
  }

  /** A note changed on disk outside Memev (an editor, git pull): log it before touching it. */
  syncFromDisk(p, source = 'external') {
    const h = this.log.heads.get(p);
    const known = this._ncGet(p);
    if (known && h && !h.deleted && known.ch === h.ch) return null;
    const cur = this._read(p);
    if (cur !== null) this._ncSet(p, cur);
    if (cur === null) { if (h && !h.deleted) { const rec = this.log.append({ type: 'delete', path: p, agent: 'external', client: source, data: { external: true } }); this.index.remove(p); this.graph.removeNote(p); return rec; } return null; }
    if (h && !h.deleted && h.ch === sha256(cur)) return null;
    const rec = this._importExternal(p, cur, source);
    this.index.update(p, cur, { mtime: rec.ts }); this.graph.indexNote(p, cur); this._indexSaveSoon();
    return rec;
  }

  /** Fold the log for one path into its content (streams the log). `uptoSeq` gives any earlier version. */
  materialize(p, { uptoSeq = Infinity } = {}) {
    let c = null;
    for (const rec of this.log.iterate({ path: p })) {
      if (rec.seq > uptoSeq) break;
      if (rec.type === 'put') c = rec.data.content;
      else if (rec.type === 'append') c = (c ?? '') + rec.data.text;
      else if (rec.type === 'splice') c = applySplice(c ?? '', rec.data);
      else if (rec.type === 'delete') c = null;
    }
    return c;
  }

  /** Rebuild every note from the log alone into `dir` (a disaster-recovery copy), in one streaming pass. */
  rebuildInto(dir) {
    const cur = new Map();
    for (const rec of this.log.iterate()) {
      if (!rec.path) continue;
      const c = cur.get(rec.path) ?? null;
      if (rec.type === 'put') cur.set(rec.path, rec.data.content);
      else if (rec.type === 'append') cur.set(rec.path, (c ?? '') + rec.data.text);
      else if (rec.type === 'splice') cur.set(rec.path, applySplice(c ?? '', rec.data));
      else if (rec.type === 'delete') cur.delete(rec.path);
    }
    for (const [p, c] of cur) { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); }
    return [...cur.keys()].sort();
  }

  // ---- auth helpers
  _need(identity, scope, p) {
    if (!allowed(identity, scope, p)) throw new VaultError('forbidden', `this token may not ${scope}${p ? ` ${p}` : ''}`);
  }
  _guard(p, text, allowSecrets, internal) {
    if (!internal && PROTECTED.some((re) => re.test(p))) throw new VaultError('immutable', `${p} is signed and immutable; amend it with a new contract (memev contract amend)`);
    if (!allowSecrets) { const hits = findSecrets(text); if (hits.length) throw new VaultError('secret', `refused: the text looks like a credential (${hits.join(', ')}); never store secrets in memory`); }
  }
  _after(p, rec, client, appended = null) {
    if (appended) {
      // an append that starts new sections: index only those (the cost follows the new text, not the note)
      this.index.appendSections(p, appended.text, { lineOffset: appended.lineOffset, mtime: rec.ts });
      this.graph.indexSections(p, sections(appended.text));
    } else {
      const body = this._read(p);
      this.index.update(p, body ?? '', { mtime: rec.ts }); this.graph.indexNote(p, body ?? '');
    }
    this.commits.add(p, client);
    this._indexSaveSoon();
    this.emit('change', { path: p, type: rec.type, seq: rec.seq, client });
  }
  _indexSaveSoon() { clearTimeout(this._ist); this._ist = setTimeout(() => { this.index.save(); this._saveGraph(); }, 3000); this._ist.unref?.(); }

  // ---- note operations
  get(identity, p) { p = checkPath(p); this._need(identity, 'read', p); const b = this._read(p); if (b === null) throw new VaultError('not_found', `no note ${p}`); return { path: p, body: b }; }
  list(identity, prefix = '') { this._need(identity, 'read', null); return this.allNotes(prefix ? prefix.replace(/\/$/, '') : '').filter((p) => allowed(identity, 'read', p)); }

  write(identity, { path: p, body, client = null, allow_secrets = false, internal = false }) {
    p = checkPath(p); this._need(identity, 'write', p); body = String(body ?? '');
    this._guard(p, body, allow_secrets, internal);
    this.syncFromDisk(p);
    const old = this._read(p);
    let rec;
    if (old === null) rec = this.log.append({ type: 'put', path: p, agent: identity.agent, client, data: { content: body, ch: sha256(body) } });
    else {
      if (old === body) return { path: p, unchanged: true };
      const sp = lineSplice(old, body);
      const spBytes = Buffer.byteLength(JSON.stringify(sp));
      rec = spBytes < Buffer.byteLength(body) / 2
        ? this.log.append({ type: 'splice', path: p, agent: identity.agent, client, data: { ...sp, base: sha256(old), ch: sha256(body) } })
        : this.log.append({ type: 'put', path: p, agent: identity.agent, client, data: { content: body, ch: sha256(body) } });
    }
    fs.mkdirSync(path.dirname(this.abs(p)), { recursive: true });
    const tmp = `${this.abs(p)}.${randomToken(4)}.tmp`; fs.writeFileSync(tmp, body); fs.renameSync(tmp, this.abs(p));
    this._ncSet(p, body);
    this._after(p, rec, client);
    return { path: p, seq: rec.seq, op: rec.type, bytes: Buffer.byteLength(body) };
  }

  append(identity, { path: p, text, client = null, allow_secrets = false, internal = false }) {
    p = checkPath(p); this._need(identity, 'write', p);
    this.syncFromDisk(p);
    let ns = this._ncGet(p);
    if (!ns) { const cur = this._read(p); if (cur !== null) { this._ncSet(p, cur); ns = this._ncGet(p); } }
    let t = String(text ?? ''); if (ns && !ns.empty && !ns.endsNL) t = `\n${t}`; if (!t.endsWith('\n')) t += '\n';
    this._guard(p, t, allow_secrets, internal);
    const h2 = ns ? ns.hasher.copy() : crypto.createHash('sha256'); h2.update(t);
    const rec = this.log.append({ type: 'append', path: p, agent: identity.agent, client, data: { text: t, ch: h2.digest('hex') } });
    fs.mkdirSync(path.dirname(this.abs(p)), { recursive: true });
    fs.appendFileSync(this.abs(p), t);
    const lead = t.replace(/^\n+/, '');
    const incremental = ns && !ns.empty && ns.endsNL && this.index.byPath.has(p) && /^#{1,6}\s/.test(lead) ? { text: t, lineOffset: ns.lines } : null;
    if (ns) this._ncAppend(p, t); else this._ncSet(p, t);
    this._after(p, rec, client, incremental);
    return { path: p, seq: rec.seq, op: 'append', bytes: Buffer.byteLength(t) };
  }

  delete(identity, { path: p, client = null }) {
    p = checkPath(p); this._need(identity, 'write', p); this._guard(p, '', true, false);
    if (this._read(p) === null) throw new VaultError('not_found', `no note ${p}`);
    const rec = this.log.append({ type: 'delete', path: p, agent: identity.agent, client, data: {} });
    fs.rmSync(this.abs(p)); this._nc?.delete(p); this.index.remove(p); this.graph.removeNote(p); this.commits.add(p, client); this._indexSaveSoon();
    return { path: p, seq: rec.seq, op: 'delete', note: 'the content stays in the operation log and in git history' };
  }

  // ---- memory semantics
  /** Save a durable memory. Entries go to month files so no note grows without bound. */
  remember(identity, { text, kind = 'note', project = null, client = null, why = null, allow_secrets = false }) {
    text = String(text || '').trim(); if (!text) throw new VaultError('bad_request', 'nothing to remember');
    const k = KINDS[kind] ? kind : 'note';
    const p = `memory/${KINDS[k]}/${new Date().toISOString().slice(0, 7)}.md`;
    const dup = this.index.query(text, { limit: 3, prefix: `memory/${KINDS[k]}/` }).find((h) => jaccard(String(h.snippet).replace(/\b(Why|Project): .*$/gm, '').replace(/\s(Why|Project): .*$/, ''), text) >= 0.9);
    if (dup) return { duplicate: true, path: dup.path, heading: dup.heading };
    const head = this._read(p) === null ? `# ${KINDS[k][0].toUpperCase()}${KINDS[k].slice(1)} ${p.slice(-10, -3)}\n` : '';
    const entry = `${head}\n### ${stamp()} · ${client || identity.agent}\n${text}\n${why ? `Why: ${why}\n` : ''}${project ? `Project: ${project}\n` : ''}`;
    const r = this.append(identity, { path: p, text: entry, client, allow_secrets });
    return { ...r, kind: k, heading: `${stamp()} · ${client || identity.agent}` };
  }

  /** A progress checkpoint: what the task is, what is done, what is in progress, what is next. Append-only. */
  checkpoint(identity, { project, task = null, done = [], doing = null, next = [], files = [], client = null, session = null, source = 'agent' }) {
    if (!project) throw new VaultError('bad_request', 'a checkpoint needs a project');
    const p = `work/active/${slug(project)}.md`;
    const head = this._read(p) === null ? `# ${project}\n\nProject: ${slug(project)}\nProgress checkpoints, newest last. Memev reads the latest at every session start.\n` : '';
    const L = [`\n### ${stamp()} · checkpoint · ${client || identity.agent}${session ? ` · ${String(session).slice(0, 8)}` : ''}`];
    if (task) L.push(`Task: ${task}`);
    for (const d of done) L.push(`- [x] ${d}`);
    if (doing) L.push(`Doing: ${doing}`);
    for (const n of next) L.push(`- [ ] ${n}`);
    if (files.length) L.push(`Files: ${files.slice(0, 30).join(', ')}`);
    L.push(`Source: ${source}`);
    return { ...this.append(identity, { path: p, text: head + L.join('\n') + '\n', client }), project: slug(project) };
  }

  /** The state of a project from its checkpoints: the latest task, doing and next, and every done item ever. */
  projectState(project) {
    const p = `work/active/${slug(project)}.md`; const body = this._read(p); if (!body) return null;
    const cps = body.split(/\n(?=### )/).filter((s) => s.startsWith('### ') && s.includes('· checkpoint ·'));
    if (!cps.length) return { path: p, checkpoints: 0 };
    const done = new Map(); let last = null;
    for (const c of cps) { for (const m of c.matchAll(/^- \[x\] (.+)$/gm)) done.set(m[1].trim().toLowerCase(), m[1].trim()); last = c; }
    const pick = (re) => (re.exec(last) || [])[1]?.trim() || null;
    const next = [...last.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1].trim()).filter((n) => !done.has(n.toLowerCase()));
    return { path: p, checkpoints: cps.length, at: last.split('\n')[0].replace(/^### /, ''), task: pick(/^Task: (.+)$/m), doing: pick(/^Doing: (.+)$/m), next, done: [...done.values()], files: pick(/^Files: (.+)$/m) };
  }

  /** Record one turn of a session (continuous recording). */
  journal(identity, { session, client = null, role = 'user', text, project = null }) {
    if (!this.config.journal?.enabled) return { skipped: true };
    const sid = slug(session || 'session', 16);
    const p = `work/sessions/${new Date().toISOString().slice(0, 10)}-${slug(client || identity.agent, 20)}-${sid}.md`;
    const head = this._read(p) === null ? `# Session ${sid} (${client || identity.agent})\n${project ? `\nProject: ${slug(project)}\n` : ''}` : '';
    const body = truncate(redactSecrets(String(text || '').trim()), this.config.journal?.max_chars || 2000);
    if (!body) return { skipped: true };
    return this.append(identity, { path: p, text: `${head}\n#### ${stamp()} · ${role}\n${body}\n`, client, allow_secrets: true });
  }

  /** Recall: the index, filtered to what the token may read, annotated with graph context; the use is logged. */
  recall(identity, { query, project = null, limit = 6, client = null, session = null, log = true }) {
    this._need(identity, 'read', null);
    const hits = this.index.query(query, { limit: limit * 3, project, boosts: this.tuning?.boosts }).filter((h) => allowed(identity, 'read', h.path)).slice(0, limit);
    for (const h of hits) {
      const key = `${h.path}#${h.heading || ''}`;
      const ents = this.graph.sectionEnts.get(key) || [];
      h.related = ents.slice(0, 5).map((id) => this.graph.entities.get(id)?.name).filter(Boolean);
      const claims = [...this.graph.claims.values()].filter((c) => c.evidence.some((e) => e.path === h.path));
      if (claims.length) h.claims = claims.slice(0, 3).map((c) => ({ id: c.id, claim: `${c.subject} ${c.predicate}${c.object ? ` ${c.object}` : ''}`, status: Graph.assess(c).status }));
      const u = this.graph.usage.get(key); if (u) h.used = u.count;
    }
    if (log && hits.length) this._logUsage(identity, { client, session, query, items: hits.map((h) => `${h.path}#${h.heading || ''}`) });
    return hits;
  }
  _logUsage(identity, { client, session, query, items }) {
    const rec = this.log.append({ type: 'usage', agent: identity.agent, client, data: { session, query: truncate(query, 200), items } });
    this.graph.applyOp(rec);
  }

  /** Everything a session needs to start (or resume after compaction) already knowing the state. */
  sessionStart(identity, { task = null, project = null, client = null, session = null }) {
    this._need(identity, 'read', null);
    const proj = project ? slug(project) : null;
    const ns = this._read('memory/north-star.md');
    const state = proj ? this.projectState(proj) : null;
    const decisions = this._recentEntries('memory/decisions/', 5);
    const lastSession = this._lastSession(proj, session);
    const relevant = task ? this.recall(identity, { query: `${task} ${proj || ''}`, project: proj, limit: 6, client, session }) : [];
    const contracts = this._openContracts();
    const active = this.allNotes('work/active').map((p) => ({ path: p, state: this.projectState(path.posix.basename(p, '.md')) })).filter((x) => x.state?.checkpoints).sort((a, b) => String(b.state.at).localeCompare(String(a.state.at))).slice(0, 5).map((x) => ({ project: path.posix.basename(x.path, '.md'), at: x.state.at, task: x.state.task, doing: x.state.doing }));
    return { vault: path.basename(this.root), project: proj, north_star: ns && !ns.includes('Write a few lines about yourself') ? truncate(ns.replace(/^---[\s\S]*?\n---\n/, ''), 1500) : null, project_state: state, active_projects: active, recent_decisions: decisions, last_session: lastSession, relevant, open_contracts: contracts };
  }
  _recentEntries(dir, n) {
    const files = this.allNotes(dir.replace(/\/$/, '')).slice(-2); const out = [];
    for (const f of files) { const b = this._read(f) || ''; for (const s of b.split(/\n(?=### )/).filter((x) => x.startsWith('### '))) out.push(truncate(s.replace(/\n+/g, ' — ').replace(/^### /, ''), 300)); }
    return out.slice(-n);
  }
  _lastSession(project, exclude) {
    const files = this.allNotes('work/sessions').reverse();
    for (const f of files) {
      if (exclude && f.includes(slug(exclude, 16))) continue;
      const b = this._read(f) || '';
      if (project && !b.toLowerCase().includes(`project: ${project}`)) continue;
      const turns = b.split(/\n(?=#### )/).filter((x) => x.startsWith('#### ')).slice(-6).map((t) => truncate(t.replace(/^#### /, '').replace(/\n+/g, ': '), 400));
      return { path: f, turns };
    }
    return null;
  }
  _openContracts() { return this.contractStatus({ agent: 'memev', scopes: ['read'], paths: ['**'] }, {}).slice(0, 5).map(({ id, title, project, version, passed, total, remaining, last_verified }) => ({ id, title, project, version, passed, total, last_verified, remaining: remaining.map((t) => `${t.id} ${t.title} (${t.status})`) })); }

  // ---- graph operations (logged)
  link(identity, { from, to, type = 'related', why = null, client = null }) {
    this._need(identity, 'write', null);
    const rec = this.log.append({ type: 'graph.edge', agent: identity.agent, client, data: { from: slug(from), to: slug(to), type, why } });
    this.graph.applyOp(rec);
    for (const n of [from, to]) if (!this.graph.entities.has(slug(n))) this.graph.entities.set(slug(n), { id: slug(n), name: n, kind: 'explicit', sections: new Set() });
    this._indexSaveSoon(); return { seq: rec.seq, from: slug(from), to: slug(to), type };
  }
  assert(identity, { subject, predicate, object = null, stance = 'support', strength = 0.7, path: p = null, text = null, client = null }) {
    this._need(identity, 'write', null);
    if (!subject || !predicate) throw new VaultError('bad_request', 'a claim needs subject and predicate');
    if (!['support', 'oppose', 'speculate'].includes(stance)) throw new VaultError('bad_request', 'stance: support, oppose or speculate');
    const existing = this.graph.findClaim(subject, predicate, object);
    const id = existing?.id || `c_${randomToken(5)}`;
    const rec = this.log.append({ type: 'claim', agent: identity.agent, client, data: { id, subject, predicate, object, stance, strength: Math.max(0, Math.min(1, Number(strength))), path: p, text: text ? truncate(text, 500) : null, source: client || identity.agent } });
    this.graph.applyOp(rec);
    const c = this.graph.claims.get(id); const a = Graph.assess(c);
    if (a.status !== c.status) this.graph.applyOp(this.log.append({ type: 'claim.status', agent: identity.agent, client, data: { id, from: c.status, to: a.status } }));
    this._indexSaveSoon();
    return { id, ...a, previous: c.history.at(-1)?.from ?? null };
  }
  claims(identity, { status = null, subject = null, limit = 50 } = {}) {
    this._need(identity, 'read', null);
    return [...this.graph.claims.values()].map((c) => ({ id: c.id, subject: c.subject, predicate: c.predicate, object: c.object, ...Graph.assess(c), evidence: c.evidence.filter((e) => !e.retracted).length })).filter((c) => (!status || c.status === status) && (!subject || slug(c.subject) === slug(subject))).slice(0, limit);
  }
  /** Where a memory came from (its operations) and every time it was used (recalls), streamed from the log. */
  provenance(identity, { path: p = null, heading = null, claim = null, limit = 20 }) {
    this._need(identity, 'read', null);
    if (claim) { const c = this.graph.claims.get(claim); if (!c) throw new VaultError('not_found', `no claim ${claim}`); return { claim: { id: c.id, subject: c.subject, predicate: c.predicate, object: c.object, ...Graph.assess(c) }, evidence: c.evidence, status_history: c.history }; }
    p = checkPath(p); this._need(identity, 'read', p);
    const origin = []; const key = heading !== null ? `${p}#${heading}` : null; const used = [];
    for (const rec of this.log.iterate()) {
      if (rec.path === p && rec.type !== 'usage') origin.push({ seq: rec.seq, ts: rec.ts, op: rec.type, client: rec.client, agent: rec.agent, bytes: Buffer.byteLength(JSON.stringify(rec.data || {})) });
      else if (rec.type === 'usage' && rec.data.items.some((i) => (key ? i === key : i.startsWith(`${p}#`)))) used.push({ seq: rec.seq, ts: rec.ts, client: rec.client, session: rec.data.session, query: rec.data.query });
    }
    const commits = git(this.root, ['log', '--format=%h %ad %s', '--date=iso-strict', '-n', '10', '--', p]).out.split('\n').filter(Boolean);
    return { path: p, heading, written: origin.slice(-limit), written_total: origin.length, used: used.slice(-limit), used_total: used.length, commits };
  }

  /** Say whether recalled items helped; recall tuning learns from it. */
  feedbackOn(identity, { items, useful, client = null, session = null }) {
    this._need(identity, 'write', null);
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean).map(String).slice(0, 20);
    if (!list.length) throw new VaultError('bad_request', 'feedback needs items (path#heading from recall)');
    const rec = this.log.append({ type: 'feedback', agent: identity.agent, client, data: { items: list, useful: !!useful, session } });
    this._applyMisc(rec); this._indexSaveSoon();
    return { seq: rec.seq, items: list.length };
  }
  match(identity, { topic, a, b, winner = null, round = 'evidence', why = null, client = null }) {
    this._need(identity, 'write', null);
    if (!topic || !a || !b || a === b) throw new VaultError('bad_request', 'a match needs a topic and two different contenders');
    if (winner && winner !== a && winner !== b) throw new VaultError('bad_request', 'winner must be a, b or empty for a draw');
    if (!ROUNDS.includes(round)) throw new VaultError('bad_request', `round: ${ROUNDS.join(', ')}`);
    const rec = this.log.append({ type: 'tournament.match', agent: identity.agent, client, data: { topic, a, b, winner, round, why } });
    this._applyMisc(rec); this._indexSaveSoon();
    return { seq: rec.seq, standings: this.tournament.standings(topic) };
  }
  _applyMisc(rec) {
    if (rec.type === 'tournament.match') this.tournament.applyOp(rec);
    else if (rec.type === 'contract.signed') { if (rec.data.session) this.contractSessions.set(rec.data.id, rec.data.session); }
    else if (rec.type === 'contract.verified') { if (rec.data.tasks) this.contractResults.set(rec.data.id, { at: rec.ts, ok: rec.data.ok, tasks: rec.data.tasks }); }
    else if (rec.type === 'feedback') for (const it of rec.data.items) { const f = this.feedback.get(it) || { up: 0, down: 0 }; rec.data.useful ? f.up++ : f.down++; this.feedback.set(it, f); }
  }

  _replayGraph() {
    const f = path.join(this.state, 'graph.json'); const snap = readJson(f, null); let from = 1;
    if (snap?.version === 2) { for (const e of snap.edges) this.graph.edges.push(e); for (const c of snap.claims) this.graph.claims.set(c.id, c); for (const [k, u] of snap.usage) this.graph.usage.set(k, u); this.tournament.load(snap.tournament); this.feedback = new Map(snap.feedback || []); this.contractSessions = new Map(snap.contract_sessions || []); this.contractResults = new Map(snap.contract_results || []); from = snap.seq + 1; }
    for (const rec of this.log.iterate({ fromSeq: from })) { if (/^(graph\.|claim|usage)/.test(rec.type)) this.graph.applyOp(rec); else if (rec.type === 'tournament.match' || rec.type === 'feedback' || rec.type === 'contract.signed' || rec.type === 'contract.verified') this._applyMisc(rec); }
  }
  _saveGraph() { writePrivateJson(path.join(this.state, 'graph.json'), { version: 2, seq: this.log.seq, edges: this.graph.edges, claims: [...this.graph.claims.values()], usage: [...this.graph.usage.entries()], tournament: this.tournament.toJSON(), feedback: [...this.feedback.entries()], contract_sessions: [...this.contractSessions.entries()], contract_results: [...this.contractResults.entries()] }); }

  status() {
    const mu = process.memoryUsage();
    return { version: VERSION, vault: this.root, started: this.started, oplog: this.log.stats(), index: this.index.stats(), graph: this.graph.stats(), memory: { rss_mb: Math.round(mu.rss / 1048576), heap_mb: Math.round(mu.heapUsed / 1048576) }, recovered: this.recovered?.length || 0, imported: this.imported?.length || 0 };
  }
}

attachContracts(Vault);

function jaccard(a, b) { const A = new Set(tokenize(a)), B = new Set(tokenize(b)); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }

/** Create a new vault in `root` from the template. Idempotent. Returns the admin token when one is minted. */
export function initVault(root, { template, port = null } = {}) {
  root = path.resolve(root);
  fs.mkdirSync(path.join(root, STATE), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(root, 0o700); } catch {}
  const copy = (src, dst) => { for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d); } else if (!exists(d)) fs.copyFileSync(s, d); } };
  if (template && exists(template)) copy(template, root);
  const cfgFile = path.join(root, STATE, 'config.json');
  if (!exists(cfgFile)) writeJson(cfgFile, { ...DEFAULT_CONFIG, port: port || DEFAULT_CONFIG.port, vault_id: randomToken(8), created: now() }, 0o600);
  else if (port) { const c = readJson(cfgFile); c.port = port; writeJson(cfgFile, c, 0o600); }
  const gi = path.join(root, '.gitignore'); if (!exists(gi)) fs.writeFileSync(gi, '.memev/\n*.tmp\n');
  const ga = path.join(root, '.gitattributes'); if (!exists(ga)) fs.writeFileSync(ga, 'memory/**/*.md merge=union\nwork/**/*.md merge=union\n');
  if (!exists(path.join(root, '.git'))) {
    git(root, ['init', '-q', '-b', 'main']);
    if (!git(root, ['config', 'user.email']).out) { git(root, ['config', 'user.name', 'Memev']); git(root, ['config', 'user.email', 'memev@localhost']); }
    git(root, ['add', '-A']); git(root, ['commit', '-q', '-m', 'memev: a new vault']);
  }
  installVaultHooks(root);
  const ts = new TokenStore(path.join(root, STATE, 'tokens.json'));
  let admin = null;
  if (!ts.list().some((t) => t.scopes.includes('admin') && !t.revoked)) { admin = ts.issue({ agent: 'owner', scopes: ['read', 'write', 'admin'], ttlDays: 0, note: 'admin token, minted by init' }); writePrivateJson(path.join(root, STATE, 'admin.json'), { token: admin.token, id: admin.id }); }
  return { root, admin };
}
