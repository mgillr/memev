// SPDX-License-Identifier: Apache-2.0
// Background jobs the daemon runs, so nothing needs a person to remember it:
//   git sync      every sync.interval_min: commit, pull (merge, never force), import what changed, push
//   re-detection  every clients.recheck_min: connect AI apps installed since (unless you disconnected them)
//   tuning        once a day: recall tuning from which recalled items sessions actually used
// Git is single-writer backup: each computer that pushes records itself in .memev-writers/, and a
// second writer gets a warning (in memev doctor and jobs.json). The warning never blocks anything.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { git } from '../engine/git.mjs';
import { gitVia443, alt443, cloneOffer } from './github.mjs';
import { signAddressRecord } from '../engine/devices.mjs';
import { now, readJson, writeJson, linkedUnder } from '../engine/util.mjs';
import { resolveMerge, ENGINE_MAX_BUFFER } from '../engine/merge.mjs';
import { licenseFile } from '../engine/license.mjs';

export const ADDRESS_FILE = 'address.json';

const JOBS_FILE = path.join('.memev', 'jobs.json');

export function readConflicts(root) {
  return readJson(path.join(root, JOBS_FILE), {})?.sync?.conflicts || null;
}
export function recordConflicts(root, conflicts) {
  const s = readJson(path.join(root, JOBS_FILE), {});
  s.sync = { ...(s.sync || {}), ...(conflicts ? { conflicts } : { conflicts: null }) };
  writeJson(path.join(root, JOBS_FILE), s, 0o600);
}

/** The installed licence as the signed object, or null when there is none (the free tier). */
function rawLicense(env = process.env) {
  try { return JSON.parse(fs.readFileSync(licenseFile(env), 'utf8')); } catch { return null; }
}

/** The lines of a jsonl file that are valid JSON objects with a device and a dseq. */
function jsonlLines(body) {
  const out = [];
  for (const line of String(body ?? '').split('\n')) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m && typeof m === 'object' && m.device && Number.isInteger(m.dseq)) out.push(line); } catch {}
  }
  return out;
}
/**
 * A bus log is append-only, one file per computer: a conflict means both sides appended. Keep every
 * line from both sides (deduplicated) and sort by device then dseq, the order the bus agrees on.
 * When two different lines share a device and a dseq (one device id on two computers, as with a
 * copied config), this computer's line keeps its number and the other is renumbered after the
 * device's highest dseq with a new id, so every id stays unique and dseq strictly increases.
 */
function mergeJsonl(ours, theirs) {
  const seen = new Set(); const entries = [];
  for (const [side, body] of [['ours', ours], ['theirs', theirs]]) for (const line of jsonlLines(body)) if (!seen.has(line)) { seen.add(line); entries.push({ line, side }); }
  const byDevice = new Map();
  for (const e of entries) { const d = JSON.parse(e.line).device; if (!byDevice.has(d)) byDevice.set(d, []); byDevice.get(d).push(e); }
  const out = []; const renumbered = [];
  for (const list of byDevice.values()) {
    list.sort((a, b) => JSON.parse(a.line).dseq - JSON.parse(b.line).dseq || (a.side === 'ours' ? 0 : 1) - (b.side === 'ours' ? 0 : 1));
    let next = Math.max(...list.map((e) => JSON.parse(e.line).dseq));
    const taken = new Set();
    for (const e of list) {
      const m = JSON.parse(e.line);
      if (!taken.has(m.dseq)) { taken.add(m.dseq); out.push(e.line); continue; }
      const dseq = ++next;
      const n = { ...m, dseq };
      if (typeof m.id === 'string') { const suffix = `-${m.dseq}`; n.id = m.id.endsWith(suffix) ? `${m.id.slice(0, -suffix.length)}-${dseq}` : `${m.id}-${dseq}`; }
      renumbered.push({ device: m.device, dseq, id: n.id ?? null });
      taken.add(dseq); out.push(JSON.stringify(n));
    }
  }
  const key = (l) => { const m = JSON.parse(l); return `${m.device}\u0000${String(m.dseq).padStart(12, '0')}`; };
  out.sort((a, b) => key(a).localeCompare(key(b)));
  return { text: out.join('\n') + (out.length ? '\n' : ''), renumbered };
}

/** The exact content of one side of a conflicted file, from the merge index (stage 2 is ours, 3 theirs). */
function stageContent(root, stage, p) {
  const r = spawnSync('git', ['show', `:${stage}:${p}`], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: ENGINE_MAX_BUFFER });
  // null means "this side has no such file" below; a read that failed (a note over the buffer) must not look like that
  if (r.error) throw new Error(`could not read ${p} from the merge: ${r.error.code || r.error.message}`);
  return r.status === 0 ? r.stdout : null;
}

/** The sibling file that keeps the other computer's version of a conflicted note, whole. */
function conflictCopyPath(root, p) {
  const parts = p.split('/');
  const name = parts.at(-1);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const day = new Date().toISOString().slice(0, 10);
  let copy = `${base}.conflict-${day}${ext}`;
  for (let i = 2; fs.existsSync(path.join(root, ...parts.slice(0, -1), copy)); i++) copy = `${base}.conflict-${day}-${i}${ext}`;
  return parts.slice(0, -1).concat(copy).join('/');
}

/**
 * Resolve the files a merge left conflicted. A bus log keeps both sides' lines (renumbering a
 * duplicate device+dseq so every id stays unique). A note keeps this computer's version at the
 * path and the other computer's version whole in a conflict copy next to it, so the two versions
 * are never combined. Returns the resolved paths and the conflict record.
 */
export function resolveConflicts(root, vault, opts = {}) {
  // core.quotePath=false so non-ASCII paths come back as the real path, not a quoted octal string
  const st = git(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U']);
  const files = st.out.split('\n').filter(Boolean);
  // every side is read before anything is written, so a side that cannot be read leaves the merge to be aborted
  try { for (const p of files) for (const stage of [1, 2, 3]) stageContent(root, stage, p); } catch (e) { return { files, conflicts: [], ok: false, error: e.message }; }
  // a conflicted path that goes through a symbolic link (a pulled commit can carry one) is never written, so the merge is aborted
  // before anything is: the write would land wherever the link points (issue 256)
  for (const p of files) if (linkedUnder(root, path.join(root, ...p.split('/')))) return { files, conflicts: [], ok: false, error: `${p} goes through a symbolic link` };
  const adds = [];
  const conflicts = files.map((p) => {
    const abs = path.join(root, ...p.split('/'));
    const ours = stageContent(root, 2, p);
    const theirs = stageContent(root, 3, p);
    if (p.startsWith('bus/log/') && p.endsWith('.jsonl')) {
      const merged = mergeJsonl(ours, theirs);
      fs.writeFileSync(abs, merged.text);
      adds.push(p);
      const how = merged.renumbered.length
        ? `kept every message from both computers; renumbered ${merged.renumbered.length} duplicate message(s) so every id stays unique`
        : 'kept every message from both computers';
      return { path: p, kind: 'bus log', how, ...(merged.renumbered.length ? { renumbered: merged.renumbered } : {}) };
    }
    if (ours === null) {
      // this computer deleted the note; keep it removed and hold the other version whole in a conflict copy
      git(root, ['rm', '-q', '--', p]);
      let copy = null;
      if (theirs !== null) {
        copy = conflictCopyPath(root, p);
        // git rm can take the note's folder with it; put it back before writing the copy
        fs.mkdirSync(path.join(root, ...copy.split('/').slice(0, -1)), { recursive: true });
        fs.writeFileSync(path.join(root, ...copy.split('/')), theirs);
        adds.push(copy);
      }
      return { path: p, kind: 'note', how: theirs !== null
        ? 'this computer deleted the note and the other computer edited it, so the note stays removed and the other version is kept in a conflict copy'
        : 'both computers deleted the note', ...(copy ? { copy } : {}) };
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let logLine = null;
    const res = resolveMerge({ a: ours, b: theirs, base: stageContent(root, 1, p), license: opts.license, config: vault?.config, keys: opts.keys, now: opts.now, log: (l) => { logLine = l; } });
    if (res.resolved) {
      fs.writeFileSync(abs, res.text);
      adds.push(p);
      return { path: p, kind: 'note', how: 'merged by the merge engine' };
    }
    fs.writeFileSync(abs, ours);
    adds.push(p);
    let copy = null;
    if (theirs !== null) {
      copy = conflictCopyPath(root, p);
      fs.writeFileSync(path.join(root, ...copy.split('/')), theirs);
      adds.push(copy);
    }
    return { path: p, kind: 'note', how: theirs !== null ? 'kept both versions as separate files' : "kept this computer's version; the other computer deleted the note", ...(copy ? { copy } : {}), ...(logLine ? { reason: logLine } : {}) };
  });
  for (const p of adds) git(root, ['add', '--', p]);
  const m = git(root, ['commit', '-q', '--no-edit', '-m', 'memev: resolve sync conflicts']);
  if (m.ok) {
    if (vault) {
      for (const p of files) if (p.endsWith('.md')) { try { vault.syncFromDisk(p, 'git-pull'); } catch {} }
      try { vault.commits.flush(); } catch {}
    }
  }
  return { files, conflicts, ok: m.ok };
}

/**
 * A conflict stays on the record until it is resolved: a note conflict until its conflict copy is
 * removed, and a bus log conflict is resolved by the merge that recorded it, so it drops on the
 * next sync. A clean merge never clears the record; it only drops what is resolved.
 */
function pruneConflicts(root) {
  const rec = readConflicts(root);
  if (!rec?.conflicts?.length) return rec || null;
  const kept = rec.conflicts.filter((f) => {
    if (f.kind === 'bus log') return false;
    if (f.kind === 'note' && f.copy) return fs.existsSync(path.join(root, ...f.copy.split('/')));
    return true;
  });
  if (kept.length === rec.conflicts.length) return rec;
  const next = kept.length ? { ...rec, files: kept.map((f) => f.path), conflicts: kept } : null;
  recordConflicts(root, next);
  return next;
}

/** Commit address.json when it is new or changed, so the git backup carries the signed record. */
export function commitAddressFile(root) {
  const st = git(root, ['status', '--porcelain', '--', ADDRESS_FILE]);
  if (!st.out) return false;
  git(root, ['add', '--', ADDRESS_FILE]);
  return git(root, ['commit', '-q', '-m', 'memev: record the vault address', '--', ADDRESS_FILE]).ok;
}

/** Write the signed address into the vault and commit it on the git backup. */
export function publishAddressRecord(root, url) {
  const file = path.join(root, ADDRESS_FILE);
  if (linkedUnder(root, file)) return { url, committed: false, skipped: `${ADDRESS_FILE} is a symbolic link; memev does not write through links in the vault` };
  const body = `${JSON.stringify(signAddressRecord(root, url), null, 2)}\n`;
  let prev = null;
  try { prev = fs.readFileSync(file, 'utf8'); } catch { prev = null; }
  if (prev !== body) fs.writeFileSync(file, body);
  const committed = commitAddressFile(root);
  return { url, committed };
}

// The sync, step by step: local git work runs here, and each network step (fetch, push) is yielded to
// the caller, which runs it blocking (syncOnce), blocking with a deadline (syncOnceWithin, at daemon
// stop) or off the event loop with a timeout (syncOnceAsync, the daemon's start and interval syncs).
function* syncSteps(vault, { root, license, keys, at } = {}) {
  const fc = vault.commits.flush();
  const remote = git(root, ['remote']).out.split('\n').filter(Boolean)[0];
  const res = { at: now(), remote: remote || null, pulled: 0, pushed: false, error: null };
  // a failed commit means the note is not in the backup; say so instead of claiming pushed
  if (fc && !fc.ok) { res.error = `commit: ${fc.err.split('\n').pop()}`; return res; }
  if (!remote) return res;
  const before = git(root, ['rev-parse', 'HEAD']).out;
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';
  const url = git(root, ['remote', 'get-url', remote]).out;
  const f = yield { args: ['fetch', '-q', remote, branch], remote, url };
  if (!f.ok && !/couldn't find remote ref/.test(f.err)) { res.error = `fetch: ${f.err.split('\n').pop()}`; return res; }
  if (f.ok) {
    // a backup holding a different vault (no common history) is never merged into this one: name the cause and the clone
    if (!git(root, ['merge-base', 'HEAD', `${remote}/${branch}`]).ok) { res.error = `unrelated history: ${cloneOffer(url)}`; return res; }
    const m = git(root, ['merge', '--no-edit', '-q', `${remote}/${branch}`]);
    if (!m.ok) {
      const r = resolveConflicts(root, vault, { license: license === undefined ? rawLicense() : license, keys, now: at });
      if (!r.ok) { git(root, ['merge', '--abort']); res.error = 'merge conflict: left as is; run memev doctor'; return res; }
      const prev = pruneConflicts(root);
      recordConflicts(root, { at: now(), files: [...new Set([...(prev?.files || []), ...r.files])], conflicts: [...(prev?.conflicts || []), ...r.conflicts] });
      res.conflicts = r.conflicts;
      const changed = git(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', before, 'HEAD']).out.split('\n').filter((p) => p.endsWith('.md'));
      for (const p of changed) if (vault.syncFromDisk(p, 'git-pull')) res.pulled++;
    } else {
      pruneConflicts(root);
      const changed = git(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', before, 'HEAD']).out.split('\n').filter((p) => p.endsWith('.md'));
      for (const p of changed) if (vault.syncFromDisk(p, 'git-pull')) res.pulled++;
    }
  }
  const w = writerCheck(vault, { root }); if (w.warning) res.warning = w.warning; res.writers = w.writers.length;
  commitAddressFile(root);
  const p = yield { args: ['push', '-q', remote, `HEAD:${branch}`], remote, url };
  res.pushed = p.ok; if (!p.ok) res.error = `push: ${p.err.split('\n').pop()}`;
  return res;
}

const NET_TIMEOUT_MS = 60000;   // one fetch or push in the background; a dropped port 22 hangs about 75 s
export const STOP_SYNC_MS = 3000; // the last sync at stop, inside the 5 s memev stop waits before SIGKILL

/** The sync, run blocking: memev sync and the sync provider. */
export function syncOnce(vault, opts = {}) {
  const g = syncSteps(vault, opts);
  let r = g.next();
  while (!r.done) r = g.next(gitVia443(opts.root, r.value.args, r.value.remote, r.value.url));
  return r.value;
}

/** A git network command, blocking but bounded: the remote URL, then the 443 form when the first fails fast. */
function gitWithin(root, { args, remote, url }, deadline) {
  const run = (dest) => {
    const ms = deadline - Date.now();
    if (ms <= 0) return { ok: false, err: 'no time left', timedOut: true };
    const r = spawnSync('git', args.map((a) => (a === remote ? dest : a)), { cwd: root, encoding: 'utf8', timeout: ms, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const timedOut = r.error?.code === 'ETIMEDOUT';
    return { ok: r.status === 0 && !timedOut, err: timedOut ? 'timed out' : String(r.stderr || r.error?.message || '').trim(), timedOut };
  };
  const p = run(remote);
  const alt = alt443(url);
  return p.ok || p.timedOut || !alt ? p : run(alt);
}

/** The sync with a deadline, for the daemon's stop: what does not finish in time is left to the next start. */
export function syncOnceWithin(vault, { ms = STOP_SYNC_MS, ...opts } = {}) {
  const deadline = Date.now() + ms;
  const g = syncSteps(vault, opts);
  let r = g.next();
  while (!r.done) {
    const out = gitWithin(opts.root, r.value, deadline);
    if (out.timedOut) { g.return(); return { at: now(), pushed: false, error: `the sync did not finish in ${ms / 1000} s; the next start syncs it` }; }
    r = g.next(out);
  }
  return r.value;
}

/** A git network command off the event loop, in its own process group so a timeout or a stop ends ssh too. */
function gitAsync(root, args, { timeoutMs = NET_TIMEOUT_MS, live = null } = {}) {
  return new Promise((resolve) => {
    const group = process.platform !== 'win32';
    const child = spawn('git', args, { cwd: root, detached: group, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (live) live.child = child;
    let out = '', err = '', timedOut = false;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { timedOut = true; endGit(child); }, timeoutMs);
    const done = (code, e = null) => { clearTimeout(t); if (live?.child === child) live.child = null; resolve({ ok: code === 0 && !timedOut, status: code, out: out.trim(), err: timedOut ? `timed out after ${timeoutMs / 1000} s` : (e?.message || err.trim()) }); };
    child.on('error', (e) => done(null, e));
    child.on('close', (code) => done(code));
  });
}

/** End a git process and its ssh: SIGTERM, so git removes its lock files on the way out. */
function endGit(child) {
  if (!child || child.exitCode !== null) return;
  try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
}

/** The sync off the event loop: the daemon keeps answering while fetch and push wait on the network. */
export async function syncOnceAsync(vault, { timeoutMs = NET_TIMEOUT_MS, live = null, ...opts } = {}) {
  const g = syncSteps(vault, opts);
  let r = g.next();
  while (!r.done) {
    const { args, remote, url } = r.value;
    let out = await gitAsync(opts.root, args, { timeoutMs, live });
    const alt = alt443(url);
    // a github.com remote that fails or hangs (port 22 dropped) is tried again through ssh.github.com:443
    if (!out.ok && !live?.stopped && alt) out = await gitAsync(opts.root, args.map((a) => (a === remote ? alt : a)), { timeoutMs, live });
    // the daemon stopped while this waited: the stop runs its own last sync, so this one ends here
    if (live?.stopped) { g.return(); return { stopped: true }; }
    r = g.next(out);
  }
  return r.value;
}

export const WRITERS_DIR = '.memev-writers';
/**
 * Record this computer as a writer (one small file per computer, so two computers never conflict
 * on it) and report other computers that wrote in the last 30 days. Report only.
 */
export function writerCheck(vault, { root, at = Date.now() }) {
  const dir = path.join(root, WRITERS_DIR);
  if (linkedUnder(root, path.join(dir, `${vault.host?.id}.json`))) return { writers: [], warning: null, skipped: `${WRITERS_DIR} goes through a symbolic link; memev does not write through links in the vault` };
  fs.mkdirSync(dir, { recursive: true });
  const id = vault.host?.id; const mine = path.join(dir, `${id}.json`);
  const day = new Date(at).toISOString().slice(0, 10);
  let rec = readJson(mine, null);
  if (id && rec?.last !== day) {
    rec = { device: id, platform: vault.host.platform, first: rec?.first || day, last: day };
    fs.writeFileSync(mine, `${JSON.stringify(rec, null, 2)}\n`);
    git(root, ['add', '--', path.posix.join(WRITERS_DIR, `${id}.json`)]);
    git(root, ['commit', '-q', '-m', 'memev: record this computer as a vault writer', '--', path.posix.join(WRITERS_DIR, `${id}.json`)]);
  }
  const writers = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f), null)).filter((w) => w?.device && at - Date.parse(w.last) <= 30 * 86400e3);
  const others = writers.filter((w) => w.device !== id);
  return { writers, warning: others.length ? `${others.length} other computer(s) also push this vault through git (${others.map((w) => w.device).join(', ')}). Git backup is meant for one writer: concurrent edits can conflict, and using one vault on several computers is what the paid Sync service is for (see docs/PRICING.md). Nothing is blocked.` : null };
}

export function supervise(vault, { root }) {
  const timers = [];
  const state = path.join(root, '.memev', 'jobs.json');
  const record = (k, v) => { const s = readJson(state, {}); s[k] = v; writeJson(state, s, 0o600); };
  // what the daemon's stop records is the last word: a background run that ends after it records nothing
  const live = { child: null, stopped: false };
  const every = (min, fn, name) => { const run = async () => { const at = now(); try { const v = await fn(); if (!live.stopped) record(name, { at, ...v }); } catch (e) { if (!live.stopped) record(name, { at, error: e.message }); } }; timers.push(setInterval(run, Math.max(1, min) * 60000)); timers.at(-1).unref?.(); return run; };
  let running = false;
  const syncRun = every(vault.config.sync?.interval_min ?? 5, async () => {
    if (running) return { skipped: 'the previous sync is still running' };
    const { selectProvider } = await import('../services/providers.mjs');
    const p = selectProvider('sync', { root, config: vault.config });
    if (!p) return { provider: null, skipped: 'no sync provider (memev github setup)' };
    running = true;
    // git's network steps run off the event loop, so a slow remote never stalls the daemon's answers
    try { return { provider: p.id, ...(await (p.id === 'git' ? syncOnceAsync(vault, { root, live }) : p.run(vault, { root }))) }; } finally { running = false; }
  }, 'sync');
  const redetect = every(vault.config.clients?.recheck_min ?? 30, async () => {
    if (vault.config.clients?.auto_connect === false) return { skipped: 'auto_connect is off' };
    const { connectAll, launcherPath } = await import('./clients.mjs');
    const { exists } = await import('../engine/util.mjs');
    if (!exists(launcherPath())) return { skipped: 'no launcher' };
    const r = connectAll({ launcher: launcherPath() });
    const added = r.filter((x) => x.status === 'added').map((x) => x.id);
    for (const id of added) try { vault.bus.register({ client: id, device: vault.devices.get(vault.host.id) }); } catch {}
    return { added };
  }, 'redetect');
  const tune = every(24 * 60, async () => { const { tuneRecall } = await import('../engine/tuning.mjs'); return tuneRecall(vault); }, 'tuning');
  let startSync = null;
  if (process.env.MEMEV_NO_BACKGROUND !== '1') {
    // one sync when the daemon starts, before the first interval, so a fresh machine backs up at once
    startSync = setTimeout(syncRun, 0); startSync.unref?.();
    setTimeout(redetect, 5000).unref?.();
    setTimeout(tune, 15000).unref?.();
  }
  return {
    stop() {
      live.stopped = true;
      for (const t of timers) clearInterval(t);
      if (startSync) clearTimeout(startSync);
      endGit(live.child);
      // one last commit and push before the vault closes, so a note written moments before stop is in the backup;
      // bounded, so memev stop never has to kill the daemon, and what does not fit is left to the next start
      try { record('sync', { at: now(), shutdown: true, ...syncOnceWithin(vault, { root }) }); } catch (e) { record('sync', { at: now(), shutdown: true, error: e.message }); }
    },
    reload() {}
  };
}
