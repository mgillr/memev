// SPDX-License-Identifier: Apache-2.0
// The vault: Markdown notes you own, in git, with an append-only operation log as the write-ahead log,
// a recall index over sections and a memory graph. One process (the daemon) writes; every client talks
// to it over MCP (stdio is proxied to the daemon) or HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DeviceRegistry, hostDevice } from './devices.mjs';
import { Bus } from './bus.mjs';
import crypto from 'node:crypto';
import { sha256, readJson, writeJson, writePrivateJson, exists, now, stamp, slug, truncate, randomToken } from './util.mjs';
import { OpLog } from './oplog.mjs';
import { RecallIndex, tokenize, sections } from './index.mjs';
import { SegIndex } from './segindex.mjs';
import { TokenStore, allowed } from './tokens.mjs';
import { CommitQueue, git, gitInitMain } from './git.mjs';
import { lineSplice, applySplice } from './diff.mjs';
import { findSecrets, redactSecrets } from './secrets.mjs';
import { Graph } from './graph.mjs';
import { Tournament, ROUNDS } from './tournament.mjs';
import { loadTuning } from './tuning.mjs';
import { attach as attachContracts, installVaultHooks } from './contracts.mjs';
import { assess, DEFAULT_GATE } from './quality.mjs';
import { STATE, isVault } from './vault-marker.mjs';
import { ProjectStore } from './project-store.mjs';
import { SCHEMA_VERSION } from './project-store.mjs';
import { Coordinator } from './coordinator.mjs';
import { resolveRequest, vaultScope } from './identity.mjs';

export const VERSION = readJson(new URL('../../package.json', import.meta.url), {}).version;
export { STATE, isVault };
const KINDS = { decision: 'decisions', gotcha: 'gotchas', fact: 'facts', pattern: 'patterns', win: 'wins', person: 'people', note: 'notes', preference: 'preferences' };
// written only by the engine itself: signing writes signed/ and keys/, verify writes closed/ and receipts/. Matched in any
// letter case, because a case-insensitive disk writes contracts/Signed/ into contracts/signed/ (issues 242 and 243)
const PROTECTED = [/^contracts\/signed\//i, /^contracts\/keys\//i, /^contracts\/closed\//i, /^contracts\/receipts\//i];
const DEFAULT_CONFIG = { version: 1, port: 7787, remote: { enabled: false, provider: 'auto', rate_per_min: 120 }, sync: { interval_min: 5 }, recall: { per_prompt: true, max_chars: 1500, min_score: 1.0, scope: 'project' }, memory: { ...DEFAULT_GATE }, journal: { enabled: true, max_chars: 2000 }, contracts: { enabled: false, exec_local_only: true } };

export class VaultError extends Error { constructor(code, message) { super(message); this.code = code; } }

export function checkPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.split('/').some((x) => x === '..' || x === '' || x.startsWith('.'))) throw new VaultError('bad_path', `not a vault path: ${p}`);
  // a control character (NUL included) is refused before anything is logged: no file system takes it, and once logged it
  // stopped every open (issue 230)
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new VaultError('bad_path', `a vault path has no control characters: ${JSON.stringify(String(p))}`);
  if (!/\.(md|json|pub|txt)$/.test(s)) throw new VaultError('bad_path', `only .md, .json, .pub and .txt notes: ${p}`);
  return s;
}

/** The largest recall offset served: past it a page is empty and next is null, so one argument cannot ask the index to rank every match. */
export const RECALL_OFFSET_MAX = 1000;

export class Vault extends EventEmitter {
  constructor(root, opts = {}) { super(); this.root = path.resolve(root); this.opts = opts; this.state = path.join(this.root, STATE); }

  open() {
    if (!isVault(this.root)) throw new VaultError('not_a_vault', `${this.root} is not a Memev vault (memev init)`);
    const fileCfg = readJson(path.join(this.state, 'config.json'), {});
    this.config = { ...DEFAULT_CONFIG, ...fileCfg };
    // existing vaults predate the opt-in: contracts stay on for them
    if (!fileCfg.contracts || fileCfg.contracts.enabled === undefined) this.config.contracts = { ...DEFAULT_CONFIG.contracts, ...fileCfg.contracts, enabled: true };
    this.tokens = new TokenStore(path.join(this.state, 'tokens.json'));
    this.host = hostDevice(this.root);
    this.log = new OpLog(path.join(this.state, 'oplog'), { segmentBytes: this.opts.segmentBytes, snapshotEvery: this.opts.snapshotEvery, fsync: this.opts.fsync ?? true, deviceId: this.host.id }).open();
    this.devices = new DeviceRegistry(path.join(this.state, 'devices.json'));
    this.devices.ensureHost(this.host);
    this.devices.migrate(this.tokens); // existing installs: every token becomes its own device entry
    this.bus = new Bus({ root: this.root, devices: this.devices, commit: (p) => this.commits.add(p, 'bus'), config: this.config.bus || {} });
    this.index = process.env.MEMEV_RIG_SEG === '1' ? new SegIndex(path.join(this.state, 'index.jsonl')) : new RecallIndex(path.join(this.state, 'index.jsonl'));
    this.graph = new Graph();
    this.tournament = new Tournament();
    this.feedback = new Map();
    this.reviews = new Map();
    this.contractSessions = new Map();
    this.contractResults = new Map();
    this.commits = new CommitQueue(this.root, { enabled: this.opts.git !== false, delayMs: this.opts.commitDelayMs ?? 400 });
    this._seedBus();
    const RIG = process.env.MEMEV_RIG_SEG === '1';
    if (RIG) this._rigFp = this._rigLoadFp();
    this.recover();
    const loaded = this.index.load();
    if (!loaded || this.index.stats().notes === 0) { this._rigChanged = null; this.reindexAll(); }
    else if (RIG) this._rigOpenNotes();
    else for (const p of this.allNotes()) this.graph.indexNote(p, this._read(p));
    if (process.env.MEMEV_RIG_STOPPED === '1' || RIG) { let saved = null; try { saved = Number(fs.readFileSync(path.join(this.state, 'index.seq'), 'utf8')); } catch {} if (saved !== null) for (const [p, h] of this.log.heads) { try { if (h.seq > saved && !h.deleted) { const b = this._read(p); if (b !== null) { this.index.update(p, b, { mtime: Date.now() }); } } else if (h.seq > saved && h.deleted) this.index.remove(p); } catch {} } }
    // RIG_FIX_STOPPED: a note imported at start reaches recall (main leaves it out until the next rebuild).
    if (process.env.MEMEV_RIG_STOPPED === '1' || RIG) for (const p of this.imported || []) { try { const b = this._read(p); if (b !== null) this.index.update(p, b, { mtime: Date.now() }); } catch {} }
    this._replayGraph();
    this.tuning = loadTuning(this);
    this.started = now();
    return this;
  }

  /** bus/ is part of the vault from the start: seed it and commit it on its own, before any other write. */
  _seedBus() {
    try {
      const { paths, created } = this.bus.ensure(this.host.id);
      if (this.opts.git === false) return;
      const tracked = git(this.root, ['ls-files', '--', ...paths]).out.split('\n').filter(Boolean).length;
      if (!created.length && tracked === paths.length) return;
      for (const p of paths) this.commits.add(p, 'bus');
      this.commits.flush();
    } catch {}
  }

  close() { for (const st of this._projectStores?.values() ?? []) { try { st.close(); } catch {} } this._projectStores?.clear(); this._coordinators?.clear(); this.commits.flush(); this.index.save(); this._rigSeq(); this._saveGraph(); if (process.env.MEMEV_RIG_SEG === '1') { try { this._rigSaveCold(); } catch {} } this.devices?.saveSoon(); this.log.close(); }

  // ---- files
  abs(p) { return path.join(this.root, ...p.split('/')); }
  /**
   * True when a note's path, or any folder on the way to it, is a symbolic link. memev never follows a link in the vault:
   * a link reached files outside it (issue 256), and a dangling link named like a note stopped the vault opening (230).
   */
  _linked(p) {
    let cur = this.root;
    for (const seg of String(p).split('/')) {
      cur = path.join(cur, seg);
      let st; try { st = fs.lstatSync(cur); } catch { return false; }
      if (st.isSymbolicLink()) return true;
    }
    return false;
  }
  _noLink(p) { if (this._linked(p)) throw new VaultError('bad_path', `${p} goes through a symbolic link; memev does not follow links in the vault`); }
  /**
   * A note is refused when its path, or any folder on the way to it, differs from a live note's only in letter case or Unicode
   * form, naming the existing spelling: a case-insensitive disk (macOS, Windows) keeps the two as one file or one folder, so the
   * log would hold two histories over one body, and the vault syncs to such disks (issue 243). The fold (NFC, upper case, then
   * lower case, NFC again) makes final sigma, long s, the sharp s against SS and the Kelvin sign equal to their plain forms, as
   * APFS does; it is close to the disk's own table but not the table itself. Only a path with no live head is checked, so writing
   * an existing note costs nothing extra; the check reads every live head once.
   */
  _noCaseTwin(p) {
    const h = this.log.heads.get(p); if (h && !h.deleted) return;
    const fold = (x) => x.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
    const segs = p.split('/'); const want = []; let acc = '';
    for (const sg of segs) { acc = acc ? `${acc}/${sg}` : sg; want.push([acc, fold(acc)]); }
    for (const [q, hq] of this.log.heads) {
      if (hq.deleted || q === p) continue;
      const qs = q.split('/'); let qa = '';
      for (let i = 0; i < Math.min(qs.length, want.length); i++) {
        qa = qa ? `${qa}/${qs[i]}` : qs[i];
        const [mine, key] = want[i];
        if (qa === mine) continue;
        // a folder of the path, or the note itself, matches the existing spelling only under the fold
        if (fold(qa) === key && (i < segs.length - 1 ? i < qs.length - 1 : i === qs.length - 1)) throw new VaultError('bad_path', `${mine} differs from the existing ${i < qs.length - 1 ? 'folder' : 'note'} ${qa} only in letter case or Unicode form; a case-insensitive disk keeps them as one, so use the spelling ${qa}`);
        break;
      }
    }
  }
  /**
   * A write is refused before the log advances when the file system cannot take it: a note already sits where a folder of the
   * path must be, or a folder with something in it sits at the path. An empty folder there, which a delete leaves behind, is
   * removed. Before, the log took the write, the file system refused it, and every later open threw (issue 230).
   */
  _placeable(p) {
    const segs = String(p).split('/'); let cur = this.root;
    for (let i = 0; i < segs.length; i++) {
      cur = path.join(cur, segs[i]);
      let st; try { st = fs.lstatSync(cur); } catch { return; }
      if (i < segs.length - 1 && !st.isDirectory()) throw new VaultError('bad_path', `${segs.slice(0, i + 1).join('/')} is a note, so nothing can be written under it`);
      if (i === segs.length - 1 && st.isDirectory()) {
        if (fs.readdirSync(cur).length) throw new VaultError('bad_path', `${p} is a folder with notes in it, so no note can be written there`);
        fs.rmdirSync(cur);
      }
    }
  }
  /** Read a note; a journal file that retention moved to work/archive is still readable at its old path. */
  _read(p) {
    if (this._linked(p)) return null; // a link is never followed, for reading either
    try { return fs.readFileSync(this.abs(p), 'utf8'); } catch {}
    if (p.startsWith('work/') && !this._linked(`work/archive/${p.slice(5)}`)) { try { return fs.readFileSync(this.abs(`work/archive/${p.slice(5)}`), 'utf8'); } catch {} }
    return null;
  }
  allNotes(dir = '') {
    const out = []; const base = dir ? this.abs(dir) : this.root;
    const walk = (d, rel) => { let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of ents) { if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) { if (r === 'work/archive') continue; walk(path.join(d, e.name), r); } else if (e.name.endsWith('.md')) out.push(r); } };
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
    const fixed = [], imported = [], skipped = [];
    // one path the file system cannot take (a NUL in it, a note where a folder must be, a folder where the note goes) is
    // skipped with its reason, so the rest of the vault opens; before, it threw and the vault never opened again (issue 230)
    const each = (p, fn) => { try { fn(); } catch (e) { skipped.push({ path: p, reason: e.code || e.message }); } };
    for (const [p, h] of this.log.heads) {
      if (h.deleted || !h.ch) continue;
      each(p, () => {
        if (this._linked(p)) return; // never rebuilt through a link: the write would land wherever the link points
        if (this._rigFp) { const f = this._rigFp.get(p); if (f && f[2] === h.ch) { try { const st = fs.statSync(this.abs(p)); if (st.isFile() && st.size === f[0] && st.mtimeMs === f[1]) return; } catch {} } }
        const cur = this._read(p);
        if (cur !== null && sha256(cur) === h.ch) return;
        const content = this.materialize(p);
        if (content === null || sha256(content) !== h.ch) return;
        if (cur === null || (content.startsWith(cur) && cur.length < content.length)) { fs.mkdirSync(path.dirname(this.abs(p)), { recursive: true }); fs.writeFileSync(this.abs(p), content); fixed.push(p); }
        else { this._importExternal(p, cur, 'startup'); imported.push(p); }
      });
    }
    for (const p of this.allNotes()) if (!this.log.heads.has(p)) each(p, () => { this._importExternal(p, this._read(p), 'startup'); imported.push(p); });
    this.recovered = fixed; this.imported = imported; this.skipped = skipped;
    return fixed;
  }
  _rigLoadFp() { try { return new Map(JSON.parse(fs.readFileSync(path.join(this.state, 'notes.fp.json'), 'utf8'))); } catch { return null; } }
  _rigSaveCold() { // Written at close: stat plus logged hash per note, and the note part of the graph.
    const out = []; for (const [p, h] of this.log.heads) { if (h.deleted || !h.ch) continue; try { const st = fs.statSync(this.abs(p)); if (st.isFile()) out.push([p, [st.size, st.mtimeMs, h.ch]]); } catch {} }
    writePrivateJson(path.join(this.state, 'notes.fp.json'), out);
    const g = this.graph; const rep = (k, v) => (v instanceof Map ? { $m: [...v] } : v instanceof Set ? { $s: [...v] } : v);
    fs.writeFileSync(path.join(this.state, 'graph-notes.json'), JSON.stringify({ entities: g.entities, sectionEnts: g.sectionEnts, notesSections: g.notesSections, noteEnts: g.noteEnts, cooc: g.cooc }, rep), { mode: 0o600 });
  }
  _rigOpenNotes() {
    const rev = (k, v) => (v && v.$m ? new Map(v.$m) : v && v.$s ? new Set(v.$s) : v); let snap = null;
    if (this._rigFp) { try { snap = JSON.parse(fs.readFileSync(path.join(this.state, 'graph-notes.json'), 'utf8'), rev); } catch {} }
    if (snap) Object.assign(this.graph, snap);
    for (const p of this.allNotes()) { const f = snap && this._rigFp.get(p); let same = false; if (f) { try { const st = fs.statSync(this.abs(p)); same = st.isFile() && st.size === f[0] && st.mtimeMs === f[1]; } catch {} } if (!same) { try { const b = this._read(p); this.graph.indexNote(p, b); } catch {} } }
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
    if (this._linked(p)) return null; // a link that replaced a note is neither imported nor taken as a delete
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
    const written = [];
    for (const [p, c] of cur) { try { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); written.push(p); } catch {} }
    return written.sort();
  }

  // ---- auth helpers
  _need(identity, scope, p) {
    if (scope !== 'read' && identity?.read_only) throw new VaultError('forbidden', identity.read_only);
    if (!allowed(identity, scope, p)) throw new VaultError('forbidden', `this token may not ${scope}${p ? ` ${p}` : ''}`);
    // SO-F-01: every store read and write resolves to a subject and a scope, and the scope is held against this vault's own
    const who = resolveRequest(identity, { target: vaultScope(this.config) });
    if (!who.ok) throw new VaultError('forbidden', `${who.code}: ${who.reason}`);
  }
  _guard(p, text, allowSecrets, internal) {
    // the bus writes its own files (messages, seats, the lead record) without the note API, so no token writes under bus/
    // in any letter case: a cloud connector's note writes there made it the lead and gave a local seat its alias (issue 250)
    if (!internal && /^bus\//i.test(p)) throw new VaultError('immutable', `${p} is written only by the bus itself; post with the bus tools`);
    if (!internal && PROTECTED.some((re) => re.test(p))) {
      if (/^contracts\/(closed|receipts)\//i.test(p)) throw new VaultError('immutable', `${p} is written only by memev contract verify; a contract is done when its verify passes`);
      throw new VaultError('immutable', `${p} is signed and immutable; amend it with a new contract (memev contract amend)`);
    }
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
  _rigSeq() { if (process.env.MEMEV_RIG_STOPPED === '1' || process.env.MEMEV_RIG_SEG === '1') { try { fs.writeFileSync(path.join(this.state, 'index.seq'), String(this.log.seq)); } catch {} } }
  _indexSaveSoon() { clearTimeout(this._ist); this._ist = setTimeout(() => { this.index.save(); this._rigSeq(); this._saveGraphBehind(); }, 3000); this._ist.unref?.(); }

  // ---- note operations
  get(identity, p) { p = checkPath(p); this._need(identity, 'read', p); const b = this._read(p); if (b === null) throw new VaultError('not_found', `no note ${p}`); return { path: p, body: b }; }
  list(identity, prefix = '') { this._need(identity, 'read', null); return this.allNotes(prefix ? prefix.replace(/\/$/, '') : '').filter((p) => allowed(identity, 'read', p)); }

  write(identity, { path: p, body, client = null, allow_secrets = false, internal = false }) {
    p = checkPath(p); this._need(identity, 'write', p); this._noLink(p); this._placeable(p); body = String(body ?? '');
    this._guard(p, body, allow_secrets, internal);
    this._noCaseTwin(p); // before syncFromDisk, which on a case-insensitive disk would read the other note's file under this spelling
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
    p = checkPath(p); this._need(identity, 'write', p); this._noLink(p); this._noCaseTwin(p); this._placeable(p);
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
    p = checkPath(p); this._need(identity, 'write', p); this._noLink(p); this._guard(p, '', true, false);
    if (this._read(p) === null) throw new VaultError('not_found', `no note ${p}`);
    const rec = this.log.append({ type: 'delete', path: p, agent: identity.agent, client, data: {} });
    fs.rmSync(this.abs(p)); this._nc?.delete(p); this.index.remove(p); this.graph.removeNote(p); this.commits.add(p, client); this._indexSaveSoon();
    return { path: p, seq: rec.seq, op: 'delete', note: 'the content stays in the operation log and in git history' };
  }

  // ---- memory semantics
  /**
   * Save a durable memory. Entries go to month files so no note grows without bound. The write gate
   * (quality.mjs) refuses acknowledgements, noise and duplicates, and gives short-lived notes a review
   * date; `force` saves a refused memory anyway (it is flagged), `review_by` sets the date (YYYY-MM-DD
   * or a number of days).
   */
  remember(identity, { text, kind = 'note', project = null, client = null, why = null, allow_secrets = false, review_by = null, force = false }) {
    text = String(text || '').trim(); if (!text) throw new VaultError('bad_request', 'nothing to remember');
    const k = KINDS[kind] ? kind : 'note';
    const p = `memory/${KINDS[k]}/${new Date().toISOString().slice(0, 7)}.md`;
    this._need(identity, 'write', p); this._guard(p, text, allow_secrets, false); // permissions and the secrets check come before the quality check
    const gate = { ...DEFAULT_GATE, ...(this.config.memory || {}) };
    const similar = this.index.query(text, { limit: 5, prefix: 'memory/', filter: (d) => (d.lookup ? d.lookup(this.reviews) : this.reviews.get(`${d.path}#${d.heading || ''}`))?.action !== 'drop' });
    const a = assess(text, { similar, gate: gate.enabled === false ? { ...gate, min_words: 0 } : gate, review_by });
    if (a.verdict === 'duplicate') return { duplicate: true, saved: false, path: a.duplicate_of.path, heading: a.duplicate_of.heading, reasons: a.reasons };
    if (gate.enabled === false) { a.flags = []; if (!review_by) a.review_by = null; }
    else if (a.verdict === 'refuse') {
      if (!force) return { saved: false, refused: true, reasons: a.reasons, hint: 'Save decisions, gotchas, facts and preferences that will matter in a later session. Pass force to save it anyway.' };
      a.flags.push('forced');
    }
    const head = this._read(p) === null ? `# ${KINDS[k][0].toUpperCase()}${KINDS[k].slice(1)} ${p.slice(-10, -3)}\n` : '';
    // a heading names one memory (review, feedback and recall items are path#heading), so a second
    // memory in the same minute from the same app gets a number
    let heading = `${stamp()} · ${client || identity.agent}`;
    for (let n = 2; this.index.docsOf(p, heading).length; n++) heading = `${stamp()} · ${client || identity.agent} · ${n}`;
    const entry = `${head}\n### ${heading}\n${text}\n${why ? `Why: ${why}\n` : ''}${project ? `Project: ${project}\n` : ''}${a.review_by ? `Review-By: ${a.review_by}\n` : ''}${a.flags.length ? `Flags: ${a.flags.join(', ')}\n` : ''}`;
    const r = this.append(identity, { path: p, text: entry, client, allow_secrets });
    return { ...r, saved: true, kind: k, heading, ...(a.flags.length ? { flags: a.flags, reasons: a.reasons } : {}), ...(a.review_by ? { review_by: a.review_by } : {}) };
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

  /**
   * The canonical project store for one project, under this vault's .memev directory. One store object per project
   * for the life of the vault (the options apply to the first open), so there is never a second writer in a process;
   * across processes the store's own lock serialises them.
   */
  projectStore(projectId, opts = {}) {
    const id = String(projectId);
    this._projectStores ??= new Map();
    let st = this._projectStores.get(id);
    if (!st) {
      st = new ProjectStore(this.root, { id, deviceId: this.host?.id ?? null, fsync: this.opts.fsync ?? true, ...opts }).open();
      this._projectStores.set(id, st);
    }
    return st;
  }

  /** The one coordinator for a project, over that project's store, moving tasks only through project-state's table. */
  coordinator(projectId) {
    const id = String(projectId);
    this._coordinators ??= new Map();
    let c = this._coordinators.get(id);
    if (!c) { c = new Coordinator(this.projectStore(id), { lifecycle: true }); this._coordinators.set(id, c); }
    return c;
  }

  _projectId(project) {
    if (!project) throw new VaultError('bad_request', 'a project name is needed');
    return slug(project);
  }

  /** Plan tasks for a project: each is accepted, and ready when it has no unmet dependency. Idempotent per task id. */
  tasksPlan(identity, { project, tasks, client = null }) {
    this._need(identity, 'write', null);
    if (!Array.isArray(tasks) || !tasks.length) throw new VaultError('bad_request', 'tasks must be a non-empty list');
    const id = this._projectId(project);
    const specs = tasks.map((t) => ({ id: String(t.id), title: t.title, deps: t.deps || [], resources: t.resources || [], artifacts: t.artifacts || [], criteria: t.criteria || [], artifact_hash: t.artifact_hash ?? null, ...(t.contract ? { contract: { id: String(t.contract.id), task: String(t.contract.task) } } : {}) }));
    if (specs.some((t) => !t.id || t.id === 'undefined')) throw new VaultError('bad_request', 'every task needs an id');
    for (const spec of specs) {
      if (!spec.contract) continue;
      // a task linked to a signed contract task takes its criteria from the contract, and only that contract's verify can verify it
      const sig = this.contractCheckSignature(spec.contract.id);
      if (!sig.ok || !sig.contract) throw new VaultError('bad_request', `task ${spec.id} names contract ${spec.contract.id}, which is not signed or does not verify`);
      if (slug(sig.contract.project || '') !== id) throw new VaultError('bad_request', `contract ${spec.contract.id} belongs to project ${sig.contract.project}, not ${id}`);
      const ct = (sig.contract.tasks || []).find((x) => x.id === spec.contract.task);
      if (!ct) throw new VaultError('bad_request', `contract ${spec.contract.id} has no task ${spec.contract.task}`);
      spec.criteria = (ct.criteria || []).map((c) => ({ id: c.id, mandatory: c.mandatory !== false }));
    }
    return { ...this.coordinator(id).plan(id, specs, { actor: client || identity.agent }), project: id };
  }

  tasksClaim(identity, { project, task, ttl_s = 900, client = null }) {
    this._need(identity, 'write', null);
    this.coordinator(this._projectId(project)).sweep();   // a lease past its expiry blocks its task (owner lost) before anyone claims
    return this.coordinator(this._projectId(project)).claim(String(task), client ? `${identity.agent}/${client}` : identity.agent, (Number(ttl_s) > 0 ? Number(ttl_s) : 900) * 1000);
  }
  tasksHeartbeat(identity, { project, lease, checkpoint = null }) {
    this._need(identity, 'write', null);
    return this.coordinator(this._projectId(project)).heartbeat({ id: String(lease) }, { checkpoint });
  }
  tasksReport(identity, { project, lease, output = null, artifacts = [], artifact_hash = null }) {
    this._need(identity, 'write', null);
    const id = this._projectId(project);
    const co = this.coordinator(id);
    // a contract-linked task's artifact hash is computed here from the files, never taken from the reporter
    const task = this._taskOfLease(id, lease);
    let hash = artifact_hash;
    if (task?.contract_id) hash = this._artifactHash(task.contract_id, [...(task.artifacts || []), ...(Array.isArray(artifacts) ? artifacts : [])]);
    return co.report({ id: String(lease) }, { output, artifacts, ...(hash ? { artifact_hash: hash } : {}) });
  }
  _taskOfLease(project, lease) {
    const st = this.projectStore(project);
    const l = st.snapshot('lease')[String(lease)];
    return l ? st.snapshot('task')[l.task_id] ?? null : null;
  }
  /** The hash the evidence of a contract-linked task binds to: its artifact files in the contract's workdir, or, with none, the contract as signed. */
  _artifactHash(contractId, files) {
    const sig = this.contractCheckSignature(contractId);
    const wd = path.resolve(sig.contract?.workdir || this.root);
    const lines = [...new Set(files.map(String))].sort().map((f) => {
      const abs = path.resolve(wd, f); const rel = path.relative(wd, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return `${f}\0outside`;
      try { return `${rel.split(path.sep).join('/')}\0${sha256(fs.readFileSync(abs))}`; } catch { return `${rel.split(path.sep).join('/')}\0missing`; }
    });
    return sha256(lines.length ? lines.join('\n') : `contract:${sha256(this._read(`contracts/signed/${contractId}.json`) ?? contractId)}`);
  }
  tasksRelease(identity, { project, lease, reason = null }) {
    this._need(identity, 'write', null);
    return this.coordinator(this._projectId(project)).release({ id: String(lease) }, reason);
  }
  /** The operator step that makes a task VERIFIED: evidence bound to its scope version and artifact hash, or a refusal. */
  tasksVerify(identity, { project, task, evidence = [] }) {
    this._need(identity, 'admin', null);
    const id = this._projectId(project);
    const t = this.projectStore(id).snapshot('task')[String(task)];
    // a task tied to a signed contract is verified only by that contract's verify (SR-1.27), never by hand
    if (t?.contract_id) return { ok: false, code: 'CONTRACT_LINKED', reason: `task ${task} is verified by memev_contract_verify of ${t.contract_id}, not by hand` };
    return this.coordinator(id).verify(String(task), { actor: identity.agent, evidence });
  }

  /** Tasks of this contract's project that are VERIFYING now, with the scope version and artifact hash a verify that starts now binds to. */
  tasksBindings(contractId, contract) {
    const id = slug(contract?.project || '');
    if (!id || !fs.existsSync(path.join(this.root, STATE, 'projects', id, 'events.jsonl'))) return [];
    return Object.entries(this.projectStore(id).snapshot('task'))
      .filter(([, t]) => t.project === id && t.contract_id === contractId && t.status === 'VERIFYING')
      .map(([task, t]) => ({ project: id, task, contractTask: t.contract_task, scopeVersion: t.scope_version ?? 1, artifactHash: this._artifactHash(contractId, [...(t.artifacts || [])]) }));
  }

  /** What a finished contract verify does to the tasks it was bound to: a pass verifies them with bound evidence, a failure fails them. */
  tasksFeedVerify(contractId, bindings, tasks, { verified }) {
    const out = [];
    for (const b of bindings) {
      const ct = tasks.find((x) => x.id === b.contractTask);
      if (!ct) continue;
      const co = this.coordinator(b.project);
      if (ct.status === 'PASS') {
        const evidence = ct.criteria.filter((c) => c.mandatory).map((c) => ({ criterion: c.id, scope_version: b.scopeVersion, artifact_hash: b.artifactHash, ref: `contract:${contractId}@${verified}` }));
        const r = co.verify(b.task, { actor: 'contract-verify', evidence, reason: `contract ${contractId} verify passed` });
        out.push({ task: b.task, ok: r.ok === true, ...(r.code ? { code: r.code, reason: r.reason } : {}) });
      } else if (ct.status === 'FAIL') {
        const r = co.fail(b.task, { actor: 'contract-verify', reason: `contract ${contractId} verify failed for ${ct.id}` });
        out.push({ task: b.task, ok: false, failed: r.ok === true, ...(r.code ? { code: r.code } : {}) });
      }
    }
    return out;
  }

  tasksPause(identity, { project, reason = 'paused' }) {
    this._need(identity, 'admin', null);
    return this.coordinator(this._projectId(project)).pause(this._projectId(project), { actor: identity.agent, reason });
  }
  tasksResume(identity, { project, reason = 'resumed' }) {
    this._need(identity, 'admin', null);
    return this.coordinator(this._projectId(project)).resume(this._projectId(project), { actor: identity.agent, reason });
  }
  /** A scope change: operator action. Evidence bound to the old scope version goes stale and the affected tasks are replanned. */
  tasksAmendScope(identity, { project, paths, reason = 'scope amended' }) {
    this._need(identity, 'admin', null);
    if (!Array.isArray(paths) || !paths.length) throw new VaultError('bad_request', 'a scope change names the paths it changes');
    const id = this._projectId(project);
    return this.coordinator(id).amendScope(id, { paths }, { actor: identity.agent, reason });
  }
  /** Cancel a task. Confirming an in-flight cancellation needs the lease holder or an admin; anyone with write may ask for one. */
  tasksCancel(identity, { project, task, reason = 'cancelled', outcome = 'requested' }) {
    this._need(identity, 'write', null);
    const id = this._projectId(project);
    if (!['requested', 'confirmed', 'unsupported'].includes(outcome)) throw new VaultError('bad_request', 'outcome is requested, confirmed or unsupported');
    if (outcome !== 'requested') {
      const st = this.projectStore(id);
      const t = st.snapshot('task')[String(task)];
      const l = t?.lease_id ? st.snapshot('lease')[t.lease_id] : null;
      const holder = l && (l.agent === identity.agent || String(l.agent).startsWith(`${identity.agent}/`));
      if (!holder && !allowed(identity, 'admin', null)) throw new VaultError('forbidden', 'only the session that holds the task, or an admin, can report how its cancellation went');
    }
    return this.coordinator(id).cancel(String(task), { actor: identity.agent, reason, adapter: outcome });
  }
  tasksReassign(identity, { project, task, to, reason = 'reassigned', override = false }) {
    this._need(identity, 'admin', null);
    if (!to) throw new VaultError('bad_request', 'reassignment names the new holder');
    return this.coordinator(this._projectId(project)).reassign(String(task), { to: String(to), actor: identity.agent, reason, override: override === true });
  }
  tasksUpdate(identity, { project, task, patch, base_version, generation, source = null, client = null }) {
    this._need(identity, 'write', null);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new VaultError('bad_request', 'patch is an object of fields');
    return this.coordinator(this._projectId(project)).update(String(task), { patch, base_version, generation, source: source || (client ? `${identity.agent}/${client}` : identity.agent) });
  }
  /** The tasks of a project, the derived project status and what may be claimed now. Read-only; null for a project with no store. */
  tasksStatus(identity, project, { history = false } = {}) {
    this._need(identity, 'read', null);
    const id = this._projectId(project);
    if (!fs.existsSync(path.join(this.root, STATE, 'projects', id, 'events.jsonl'))) return null;
    return this.coordinator(id).status(id, { history });
  }

  /** A read-only reader of one project for `memev work impact`: a frozen object whose one member, snapshot(kind), is frozen too and
   *  returns a copy of the records of that kind. It needs a credential that may read. It is null for a project that has neither
   *  a meta.json nor an event log (none is created), and an empty reader for one that has a meta.json and no log. It refuses a
   *  project whose meta.json carries a schema version above the supported one, as the project store does (future_schema), and one
   *  below it (needs_migration): the store would migrate that one by writing, and an empty view of its records would be wrong.
   *  It reads the event log and applies each record as the store's replay does (project-store.mjs _replay and _applyRecord): a
   *  refused record or one with no entity is not applied, a later record of an id replaces the earlier one, a null record of an
   *  id leaves the null, and a line that is not json is skipped. It never opens the store: opening it rewrites its snapshots and
   *  cuts a torn last line, and another process may be in the middle of writing that line. A last line with no newline is not
   *  applied, even when it is a whole record, because the store cuts it on its next open; the reader leaves it in the file for
   *  the writer to finish. The reader has no write method and does not hand out the store. */
  tasksReader(identity, project) {
    this._need(identity, 'read', null);
    const dir = path.join(this.root, STATE, 'projects', this._projectId(project));
    const file = path.join(dir, 'events.jsonl'), meta = readJson(path.join(dir, 'meta.json'), null);
    if (!meta && !fs.existsSync(file)) return null;
    const version = meta?.schema_version ?? SCHEMA_VERSION;
    if (version > SCHEMA_VERSION) throw new VaultError('future_schema', `refusing to open: schema version ${version} is newer than this Memev knows (${SCHEMA_VERSION})`);
    if (version < SCHEMA_VERSION) throw new VaultError('needs_migration', `schema version ${version} is older than ${SCHEMA_VERSION}: any daemon command that opens the store migrates it, and this reader writes nothing, so it cannot read it until then`);
    const entities = new Map();
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    for (const line of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
      if (!line) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (rec.refused || !rec.entity) continue;
      const { kind, id, data } = rec.entity;
      if (!entities.has(kind)) entities.set(kind, new Map());
      entities.get(kind).set(id, data);
    }
    return Object.freeze({ snapshot: Object.freeze((kind) => structuredClone(Object.fromEntries(entities.get(kind)?.entries() ?? []))) });
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

  /**
   * Which sections a recall may return, decided before ranking: what the token may read, the project
   * (hard scope: that project's sections plus sections with no project; `all_projects` widens it to a
   * boost), and the review state (dropped sections and short-lived ones past their date are left out).
   */
  _recallFilter(identity, { project = null, all_projects = false } = {}) {
    const scope = all_projects ? 'all' : (this.config.recall?.scope ?? 'project');
    const pj = scope === 'project' && project ? slug(project) : null;
    const open = !identity.paths || identity.paths.includes('**');
    const today = new Date().toISOString().slice(0, 10);
    const pc = new Map(), ac = new Map();
    const fn = (d) => {
      const r = this.reviews.size ? (d.lookup ? d.lookup(this.reviews) : this.reviews.get(`${d.path}#${d.heading || ''}`)) : null;
      if (r?.action === 'drop') return false;
      const until = r?.action === 'keep' ? r.until : d.rb;
      if (until && until < today) return false;
      if (pj && d.project) { let x = pc.get(d.project); if (x === undefined) { x = slug(d.project); pc.set(d.project, x); } if (x !== pj) return false; }
      if (!open) { let x = ac.get(d.path); if (x === undefined) { x = allowed(identity, 'read', d.path); ac.set(d.path, x); } if (!x) return false; }
      return true;
    };
    fn.scope = pj ? 'project' : 'all';
    return fn;
  }
  /** Recall: the index, filtered to what the token may read and the project, annotated with graph context; the use is logged. */
  recall(identity, { query, project = null, all_projects = false, limit = 6, offset = 0, client = null, session = null, log = true, rigDrop = null }) {
    this._need(identity, 'read', null);
    const lim = limit == null ? 6 : Math.min(10, Math.max(1, Math.trunc(Number(limit)) || 1));
    const off = Math.max(0, Math.trunc(Number(offset)) || 0);
    // A far offset must not cost a full ranking: the index is asked for one page past the bound at most, and an offset
    // past the bound is an empty page. A client that follows next never gets there; next stops at the bound.
    const top = this.index.query(query, { limit: Math.min(off, RECALL_OFFSET_MAX) + lim, project, boosts: this.tuning?.boosts, filter: rigDrop ? ((f) => (d) => !rigDrop(d.path) && f(d))(this._recallFilter(identity, { project, all_projects })) : this._recallFilter(identity, { project, all_projects }) });
    const total = top.total;
    const hits = off > RECALL_OFFSET_MAX ? [] : top.slice(off, off + lim);
    for (const h of hits) {
      const key = `${h.path}#${h.heading || ''}`;
      const ents = this.graph.sectionEnts.get(key) || [];
      h.related = ents.slice(0, 5).map((id) => this.graph.entities.get(id)?.name).filter(Boolean);
      const claims = [...this.graph.claims.values()].filter((c) => c.evidence.some((e) => e.path === h.path));
      if (claims.length) h.claims = claims.slice(0, 3).map((c) => ({ id: c.id, claim: `${c.subject} ${c.predicate}${c.object ? ` ${c.object}` : ''}`, status: Graph.assess(c).status }));
      const u = this.graph.usage.get(key); if (u) h.used = u.count;
    }
    if (log && hits.length) this._logUsage(identity, { client, session, query, items: hits.map((h) => `${h.path}#${h.heading || ''}`) });
    hits.total = total;
    return hits;
  }

  /**
   * Why recall returned (or did not return) something: the matched words and their share of the
   * score, the project and feedback multipliers, the review state, how often it was used, and for one
   * named item where it came from. Read-only; nothing is logged as a use.
   */
  why(identity, { query, project = null, all_projects = false, path: p = null, heading = null, limit = 5 }) {
    this._need(identity, 'read', null);
    if (!query) throw new VaultError('bad_request', 'why needs the query that was recalled');
    const filter = this._recallFilter(identity, { project, all_projects });
    const opts = { project, boosts: this.tuning?.boosts };
    const ranked = this.index.query(query, { limit: 50, ...opts, filter });
    const rankOf = (d) => { const i = ranked.findIndex((h) => h.path === d.path && h.line === d.line); return i === -1 ? null : i + 1; };
    const today = new Date().toISOString().slice(0, 10);
    const describe = (d) => {
      const key = `${d.path}#${d.heading || ''}`;
      const ex = this.index.explain(query, d, opts);
      const r = this.reviews.get(key); const u = this.graph.usage.get(key); const fb = this.feedback.get(key);
      const rank = rankOf(d); const lines = [];
      if (r?.action === 'drop') lines.push('Left out of recall: dropped in review.');
      else if ((r?.action === 'keep' ? r.until : d.rb) && (r?.action === 'keep' ? r.until : d.rb) < today) lines.push(`Left out of recall: its review date ${r?.until || d.rb} has passed (memev review keep to bring it back).`);
      else if (!filter(d)) lines.push(`Left out of recall: it belongs to project ${d.project}, and recall was limited to project ${project}.`);
      if (!ex.matched.length) lines.push('None of the query words are in this section.');
      else {
        const total = ex.words.reduce((a, w) => a + w.contribution, 0) || 1;
        lines.push(`Matched ${ex.words.filter((w) => w.contribution > 0).map((w) => `"${w.word}" (${w.in_section}x, ${Math.round((100 * w.contribution) / total)}% of the score)`).join(', ')}.`);
      }
      if (ex.dropped_common.length) lines.push(`Ignored as too common in this vault: ${ex.dropped_common.join(', ')}.`);
      if (ex.project_multiplier !== 1) lines.push(`Scored x${ex.project_multiplier} because it belongs to project ${d.project}.`);
      if (ex.feedback_multiplier !== 1) lines.push(`Scored x${ex.feedback_multiplier} from feedback (${fb?.up || 0} helpful, ${fb?.down || 0} not helpful).`);
      if (d.rb && r?.action !== 'keep') lines.push(`Short-lived: review by ${d.rb}.`);
      if (u) lines.push(`Recalled ${u.count} time${u.count === 1 ? '' : 's'} before.`);
      if (rank) lines.push(`Rank ${rank} for this query.`);
      return { item: key, rank, score: ex.score, recalled: !!rank && rank <= limit, why: lines, explanation: ex, used: u?.count || 0, feedback: fb || null, review: r || (d.rb ? { review_by: d.rb } : null) };
    };
    if (p) {
      p = checkPath(p); this._need(identity, 'read', p);
      const docs = this.index.docsOf(p, heading ?? undefined);
      if (!docs.length) return { query, found: false, reason: `nothing indexed at ${p}${heading ? `#${heading}` : ''}` };
      const prov = this.provenance(identity, { path: p, heading, limit: 5 });
      return { query, project, scope: filter.scope, found: true, items: docs.slice(0, 10).map(describe), provenance: { written: prov.written, written_total: prov.written_total, used_total: prov.used_total, commits: prov.commits.slice(0, 5) } };
    }
    // session turns can share a heading, so a hit is matched to its section by line as well
    const top = ranked.slice(0, limit).map((h) => this.index.docsOf(h.path, h.heading || '').find((d) => d.line === h.line)).filter(Boolean);
    return { query, project, scope: filter.scope, found: top.length > 0, items: top.map(describe) };
  }

  /** The review inbox: flagged or short-lived memories nobody has kept or dropped yet, oldest date first. */
  reviewInbox(identity, { limit = 50 } = {}) {
    this._need(identity, 'read', null);
    const today = new Date().toISOString().slice(0, 10); const out = [];
    for (const d of this.index.docs.values()) {
      if (!d.path.startsWith('memory/') || !(d.rb || d.fl) || !allowed(identity, 'read', d.path)) continue;
      const key = `${d.path}#${d.heading || ''}`; const r = this.reviews.get(key);
      if (r && !(r.action === 'keep' && r.until && r.until < today)) continue;
      out.push({ item: key, snippet: truncate(d.snippet, 200), flags: d.fl ? d.fl.split(/,\s*/) : [], review_by: d.rb || null, expired: !!(d.rb && d.rb < today) });
    }
    return out.sort((a, b) => String(a.review_by || '9999').localeCompare(String(b.review_by || '9999'))).slice(0, limit);
  }
  /** Keep (optionally until a date) or drop memories. Logged; the notes themselves are not edited. */
  review(identity, { action, items, days = null, client = null }) {
    this._need(identity, 'write', null);
    if (!['keep', 'drop', 'reset'].includes(action)) throw new VaultError('bad_request', 'action: keep, drop or reset');
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean).map(String).slice(0, 100);
    if (!list.length) throw new VaultError('bad_request', 'review needs items (path#heading)');
    for (const it of list) { const pth = it.split('#')[0]; checkPath(pth); this._need(identity, 'write', pth); }
    const until = action === 'keep' && days ? new Date(Date.now() + Number(days) * 86400000).toISOString().slice(0, 10) : null;
    const rec = this.log.append({ type: 'review', agent: identity.agent, client, data: { items: list, action, until } });
    this._applyMisc(rec); this._indexSaveSoon();
    return { seq: rec.seq, action, items: list.length, ...(until ? { until } : {}) };
  }

  /**
   * A read-only report on memory quality: what the gate would refuse today, duplicates, short-lived
   * notes past their date, hedged notes, memories never recalled after 30 days and memories rated
   * unhelpful more than helpful. Nothing is changed; memev review acts on the findings.
   */
  audit(identity, { limit = 30 } = {}) {
    this._need(identity, 'read', null);
    const docs = [...this.index.docs.values()].filter((d) => d.path.startsWith('memory/') && d.path !== 'memory/north-star.md' && d.heading && /^\d{4}-\d{2}-\d{2} /.test(d.heading) && allowed(identity, 'read', d.path));
    const today = new Date().toISOString().slice(0, 10); const old = Date.now() - 30 * 86400000;
    const R = { refused_now: [], duplicates: [], expired: [], uncertain: [], never_recalled: [], unhelpful: [] };
    const seen = new Set();
    for (const d of docs) {
      const key = `${d.path}#${d.heading || ''}`; const r = this.reviews.get(key);
      if (r?.action === 'drop') continue;
      const body = String(d.snippet).replace(/\s(Why|Project|Review-By|Flags): .*$/, '');
      const a = assess(body, { similar: [] });
      if (a.verdict === 'refuse') R.refused_now.push({ item: key, reason: a.reasons[0] });
      if (a.flags.includes('uncertain')) R.uncertain.push({ item: key });
      const until = r?.action === 'keep' ? r.until : d.rb; if (until && until < today) R.expired.push({ item: key, review_by: until });
      if (!seen.has(key)) {
        const sim = this.index.query(body, { limit: 4, prefix: 'memory/' }).filter((h) => `${h.path}#${h.heading || ''}` !== key);
        for (const h of sim) { const k2 = `${h.path}#${h.heading || ''}`; if (seen.has(k2) || this.reviews.get(k2)?.action === 'drop') continue; const a2 = assess(body, { similar: [h] }); if (a2.verdict === 'duplicate') { R.duplicates.push({ item: key, same_as: k2 }); seen.add(k2); } }
        seen.add(key);
      }
      const u = this.graph.usage.get(key); const t = Date.parse(d.mtime || '') || null;
      if (!u && t && t < old) R.never_recalled.push({ item: key });
      const fb = this.feedback.get(key); if (fb && fb.down > fb.up) R.unhelpful.push({ item: key, helpful: fb.up, unhelpful: fb.down });
    }
    const bad = new Set([...R.refused_now, ...R.duplicates, ...R.expired, ...R.unhelpful].map((x) => x.item));
    const counts = Object.fromEntries(Object.entries(R).map(([k, v]) => [k, v.length]));
    return { memories: docs.length, likely_junk: bad.size, junk_share: docs.length ? Number((bad.size / docs.length).toFixed(3)) : 0, counts, findings: Object.fromEntries(Object.entries(R).map(([k, v]) => [k, v.slice(0, limit)])), next: bad.size ? 'Drop what you do not want with memev review drop <item>; nothing has been changed.' : 'Nothing to clean up.' };
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
    return { vault: path.basename(this.root), project: proj, north_star: ns && !ns.includes('Write a few lines about yourself') ? truncate(ns.replace(/^---[\s\S]*?\n---\n/, ''), 1500) : null, project_state: state, project_tasks: proj ? this.tasksStatus(identity, proj) : null, active_projects: active, recent_decisions: decisions, last_session: lastSession, relevant, open_contracts: contracts };
  }
  _recentEntries(dir, n) {
    const files = this.allNotes(dir.replace(/\/$/, '')).slice(-2); const out = [];
    for (const f of files) { const b = this._read(f) || ''; for (const s of b.split(/\n(?=### )/).filter((x) => x.startsWith('### '))) out.push(truncate(s.replace(/\n+/g, ' · ').replace(/^### /, ''), 300)); }
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

  /** For a token limited to some paths: which entities and sections of the graph it may see. Null when it sees everything. */
  graphView(identity) {
    if (!identity?.paths || identity.paths.includes('**')) return null;
    const ac = new Map(); const ok = (p) => { let x = ac.get(p); if (x === undefined) { x = allowed(identity, 'read', p); ac.set(p, x); } return x; };
    const section = (key) => ok(key.slice(0, key.indexOf('#') === -1 ? key.length : key.indexOf('#')));
    // an entity is visible when a readable section names it; entities that exist only through explicit links are not tied to a note
    const entity = (id) => { const e = this.graph.entities.get(id); if (!e) return this.graph.edges.some((x) => x.from === id || x.to === id); if (!e.sections.size) return true; for (const k of e.sections) if (section(k)) return true; return false; };
    return { entity, section };
  }

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
    else if (rec.type === 'review') for (const it of rec.data.items) { if (rec.data.action === 'reset') this.reviews.delete(it); else this.reviews.set(it, { action: rec.data.action, until: rec.data.until || null, seq: rec.seq, ts: rec.ts }); }
    else if (rec.type === 'feedback') for (const it of rec.data.items) { const f = this.feedback.get(it) || { up: 0, down: 0 }; rec.data.useful ? f.up++ : f.down++; this.feedback.set(it, f); }
  }

  _replayGraph() {
    const f = path.join(this.state, 'graph.json'); const snap = readJson(f, null); let from = 1;
    if (snap?.version === 2) { for (const e of snap.edges) this.graph.edges.push(e); for (const c of snap.claims) this.graph.claims.set(c.id, c); for (const [k, u] of snap.usage) this.graph.usage.set(k, u); this.tournament.load(snap.tournament); this.feedback = new Map(snap.feedback || []); this.reviews = new Map(snap.reviews || []); this.contractSessions = new Map(snap.contract_sessions || []); this.contractResults = new Map(snap.contract_results || []); from = snap.seq + 1; }
    for (const rec of this.log.iterate({ fromSeq: from })) { if (/^(graph\.|claim|usage)/.test(rec.type)) this.graph.applyOp(rec); else if (rec.type === 'tournament.match' || rec.type === 'feedback' || rec.type === 'review' || rec.type === 'contract.signed' || rec.type === 'contract.verified') this._applyMisc(rec); }
  }
  // The debounced save: same file, written on the thread pool. The snapshot carries its log position, so an old or lost one means a longer replay at open, never a wrong graph.
  _saveGraphBehind() {
    if (this._gw) { this._gwAgain = true; return; }
    const file = path.join(this.state, 'graph.json'), tmp = `${file}.${process.pid}.behind.tmp`; this._gw = true;
    const done = () => { this._gw = false; if (this._gwAgain) { this._gwAgain = false; this._saveGraphBehind(); } };
    fs.open(tmp, 'w', 0o600, (e, fd) => { if (e) return done(); return fs.writeFile(fd, `${JSON.stringify(this._graphSnapshot(), null, 2)}\n`, () => fs.fsync(fd, () => fs.close(fd, () => fs.rename(tmp, file, done)))); });
  }
  _saveGraph() { writePrivateJson(path.join(this.state, 'graph.json'), this._graphSnapshot()); }
  _graphSnapshot() { return { version: 2, seq: this.log.seq, edges: this.graph.edges, claims: [...this.graph.claims.values()], usage: [...this.graph.usage.entries()], tournament: this.tournament.toJSON(), feedback: [...this.feedback.entries()], reviews: [...this.reviews.entries()], contract_sessions: [...this.contractSessions.entries()], contract_results: [...this.contractResults.entries()] }; }

  // ---- retention and compaction
  /** Total bytes of every file under a directory (recursive). */
  _dirBytes(d) {
    let s = 0; let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return 0; }
    for (const e of ents) { const f = path.join(d, e.name); if (e.isDirectory()) s += this._dirBytes(f); else { try { s += fs.statSync(f).size; } catch {} } }
    return s;
  }
  /** Number of files under a directory (recursive), only those ending in `ext` when given. */
  _dirFiles(d, ext = null) {
    let n = 0; let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return 0; }
    for (const e of ents) { const f = path.join(d, e.name); if (e.isDirectory()) n += this._dirFiles(f, ext); else if (!ext || e.name.endsWith(ext)) { try { fs.statSync(f); n++; } catch {} } }
    return n;
  }
  /** Bytes of the .jsonl segment files directly in a directory (not its subdirectories). */
  _segBytes(d) {
    let s = 0; let ents = [];
    try { ents = fs.readdirSync(d); } catch { return 0; }
    for (const n of ents) if (n.endsWith('.jsonl')) { try { s += fs.statSync(path.join(d, n)).size; } catch {} }
    return s;
  }

  /** Measured sizes, from the file system, not estimates: op-log, journal, index and git objects. */
  sizeReport() {
    const oplogDir = path.join(this.state, 'oplog');
    const segs = this.log.manifest.segments;
    const indexFile = path.join(this.state, 'index.jsonl');
    return {
      oplog: { bytes: this._dirBytes(oplogDir), segments: segs.length, archived: segs.filter((s) => s.archived).length, activeBytes: this._segBytes(oplogDir), archivedBytes: this._segBytes(path.join(oplogDir, 'archive')) },
      journal: { bytes: this._dirBytes(this.abs('work/sessions')), files: this._dirFiles(this.abs('work/sessions'), '.md') },
      index: { bytes: (fs.existsSync(indexFile) ? fs.statSync(indexFile).size : 0) + this._dirBytes(`${indexFile.replace(/\.jsonl$/, '')}.seg`) + (fs.existsSync(`${indexFile.replace(/\.jsonl$/, '')}.overlay.jsonl`) ? fs.statSync(`${indexFile.replace(/\.jsonl$/, '')}.overlay.jsonl`).size : 0) },
      git: { bytes: this._dirBytes(path.join(this.root, '.git', 'objects')) },
    };
  }

  /**
   * Move journal session files older than `journal.retention_days` out of the index into work/archive.
   * The files are renamed, not deleted, and stay readable at their old path (see _read). When the vault
   * is a git repository the move is a git mv committed on its own, so the archive reaches the backup
   * and the working tree stays clean. Returns the number of files moved.
   */
  _journalRetention() {
    const days = Number(this.config.journal?.retention_days ?? 90);
    const cutoff = Date.now() - days * 86400000;
    const srcDir = this.abs('work/sessions');
    let ents = [];
    try { ents = fs.readdirSync(srcDir, { withFileTypes: true }); } catch { return 0; }
    const hasGit = exists(path.join(this.root, '.git'));
    let moved = 0;
    const paths = [];
    for (const e of ents) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(e.name);
      let age = m ? Date.parse(m[1]) : NaN;
      if (Number.isNaN(age)) { try { age = fs.statSync(path.join(srcDir, e.name)).mtimeMs; } catch { continue; } }
      if (age >= cutoff) continue;
      const from = `work/sessions/${e.name}`, to = `work/archive/sessions/${e.name}`;
      fs.mkdirSync(path.dirname(this.abs(to)), { recursive: true });
      // git mv when the vault is a repository, so the move reaches the backup; a plain rename when it is not
      const tracked = hasGit && git(this.root, ['mv', '--', from, to]).ok;
      if (!tracked) fs.renameSync(this.abs(from), this.abs(to));
      paths.push(tracked ? [from, to] : [to]);
      this.index.remove(from);
      moved++;
    }
    if (moved) {
      this.index.save();
      if (hasGit) {
        const all = paths.flat();
        git(this.root, ['add', '-A', '--', ...all]);
        if (!git(this.root, ['diff', '--cached', '--quiet', '--', ...all]).ok) git(this.root, ['commit', '-q', '-m', `memev: archive ${moved} journal sessions`]);
      }
    }
    return moved;
  }

  /**
   * Compact the vault. A dry run only measures and reports. A real run seals and archives the op-log
   * segments, applies journal retention, and rewrites the index and graph. Nothing is deleted: archived
   * segments are renamed and still verify and materialize, and retained journal files stay readable.
   */
  compact({ dryRun = false } = {}) {
    const before = this.sizeReport();
    if (dryRun) return { dryRun: true, before };
    this.log.roll();
    const archived = this.log.archiveSealed();
    const retained = this._journalRetention();
    this.index.save();
    this.index.compact?.();
    this._saveGraph();
    const after = this.sizeReport();
    return { dryRun: false, before, after, archived, retained };
  }

  status() {
    const mu = process.memoryUsage();
    return { version: VERSION, vault: this.root, started: this.started, oplog: this.log.stats(), index: this.index.stats(), graph: this.graph.stats(), memory: { rss_mb: Math.round(mu.rss / 1048576), heap_mb: Math.round(mu.heapUsed / 1048576) }, recovered: this.recovered?.length || 0, imported: this.imported?.length || 0 };
  }
}

attachContracts(Vault);


/** Create a new vault in `root` from the template. Idempotent. Returns the admin token when one is minted. */
export function initVault(root, { template, port = null } = {}) {
  root = path.resolve(root);
  const madeRoot = !exists(root);
  const madeGit = !exists(path.join(root, '.git'));
  if (madeGit) {
    // git init runs first, before anything is written, so a failure never leaves a half built vault.
    if (madeRoot) fs.mkdirSync(root, { recursive: true });
    const init = gitInitMain(root);
    if (!init.ok) {
      if (madeRoot) { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
      else { try { fs.rmSync(path.join(root, '.git'), { recursive: true, force: true }); } catch {} }
      throw new VaultError('git_failed', `git init failed for the vault at ${root}: ${init.err || `exit ${init.status}`}`);
    }
  }
  fs.mkdirSync(path.join(root, STATE), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(root, 0o700); } catch {}
  const copy = (src, dst) => { for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d); } else if (!exists(d)) fs.copyFileSync(s, d); } };
  if (template && exists(template)) copy(template, root);
  const cfgFile = path.join(root, STATE, 'config.json');
  if (!exists(cfgFile)) writeJson(cfgFile, { ...DEFAULT_CONFIG, port: port || DEFAULT_CONFIG.port, vault_id: randomToken(8), created: now() }, 0o600);
  else if (port) { const c = readJson(cfgFile); c.port = port; writeJson(cfgFile, c, 0o600); }
  const gi = path.join(root, '.gitignore'); if (!exists(gi)) fs.writeFileSync(gi, '.memev/\n*.tmp\n');
  const ga = path.join(root, '.gitattributes'); if (!exists(ga)) fs.writeFileSync(ga, 'memory/**/*.md merge=union\nwork/**/*.md merge=union\n');
  if (madeGit) {
    if (!git(root, ['config', 'user.email']).out) { git(root, ['config', 'user.name', 'Memev']); git(root, ['config', 'user.email', 'memev@localhost']); }
    git(root, ['add', '-A']); git(root, ['commit', '-q', '-m', 'memev: a new vault']);
  }
  installVaultHooks(root);
  const ts = new TokenStore(path.join(root, STATE, 'tokens.json'));
  let admin = null;
  if (!ts.list().some((t) => t.scopes.includes('admin') && !t.revoked)) { admin = ts.issue({ agent: 'owner', scopes: ['read', 'write', 'admin'], ttlDays: 0, note: 'admin token, minted by init' }); writePrivateJson(path.join(root, STATE, 'admin.json'), { token: admin.token, id: admin.id }); }
  return { root, admin };
}
