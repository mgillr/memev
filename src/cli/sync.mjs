// SPDX-License-Identifier: Apache-2.0
// Background jobs the daemon runs, so nothing needs a person to remember it:
//   git sync      every sync.interval_min: commit, pull (merge, never force), import what changed, push
//   re-detection  every clients.recheck_min: connect AI apps installed since (unless you disconnected them)
//   tuning        once a day: recall tuning from which recalled items sessions actually used
// Git is single-writer backup: each computer that pushes records itself in .memev-writers/, and a
// second writer gets a warning (in memev doctor and jobs.json). The warning never blocks anything.
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../engine/git.mjs';
import { gitVia443 } from './github.mjs';
import { signAddressRecord } from '../engine/devices.mjs';
import { now, readJson, writeJson } from '../engine/util.mjs';

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
 */
function mergeJsonl(ours, theirs) {
  const seen = new Set(); const out = [];
  for (const line of [...jsonlLines(ours), ...jsonlLines(theirs)]) if (!seen.has(line)) { seen.add(line); out.push(line); }
  const key = (l) => { const m = JSON.parse(l); return `${m.device}\u0000${String(m.dseq).padStart(12, '0')}`; };
  out.sort((a, b) => key(a).localeCompare(key(b)));
  return out.join('\n') + (out.length ? '\n' : '');
}

/**
 * Resolve the files a merge left conflicted. A bus log keeps both sides' lines; a note keeps both
 * versions (ours, then theirs, under a marker). Returns the resolved paths and the conflict record.
 */
export function resolveConflicts(root, vault) {
  const st = git(root, ['diff', '--name-only', '--diff-filter=U']);
  const files = st.out.split('\n').filter(Boolean);
  const conflicts = files.map((p) => {
    const abs = path.join(root, ...p.split('/'));
    let ours = null, theirs = null;
    try { ours = fs.readFileSync(abs, 'utf8'); } catch {}
    try { theirs = fs.readFileSync(`${abs}.theirs`, 'utf8'); } catch {}
    if (p.startsWith('bus/log/') && p.endsWith('.jsonl')) {
      fs.writeFileSync(abs, mergeJsonl(ours, theirs));
      return { path: p, kind: 'bus log', how: 'kept every message from both computers' };
    }
    const body = `# both versions kept by the sync merge (run memev doctor)\n\n# this computer's version\n${ours ?? ''}\n# the other computer's version\n${theirs ?? ''}\n`;
    fs.writeFileSync(abs, body);
    return { path: p, kind: 'note', how: 'kept both versions' };
  });
  for (const p of files) {
    const abs = path.join(root, ...p.split('/'));
    for (const s of [`${abs}.ours`, `${abs}.theirs`, `${abs}.base`, `${abs}.orig`]) { try { fs.rmSync(s); } catch {} }
    git(root, ['add', '--', p]);
  }
  const m = git(root, ['commit', '-q', '--no-edit', '-m', 'memev: resolve sync conflicts']);
  if (m.ok) {
    if (vault) {
      for (const p of files) if (p.endsWith('.md')) { try { vault.syncFromDisk(p, 'git-pull'); } catch {} }
      try { vault.commits.flush(); } catch {}
    }
  }
  return { files, conflicts, ok: m.ok };
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
  const body = `${JSON.stringify(signAddressRecord(root, url), null, 2)}\n`;
  const file = path.join(root, ADDRESS_FILE);
  let prev = null;
  try { prev = fs.readFileSync(file, 'utf8'); } catch { prev = null; }
  if (prev !== body) fs.writeFileSync(file, body);
  const committed = commitAddressFile(root);
  return { url, committed };
}

export function syncOnce(vault, { root }) {
  vault.commits.flush();
  const remote = git(root, ['remote']).out.split('\n').filter(Boolean)[0];
  const res = { at: now(), remote: remote || null, pulled: 0, pushed: false, error: null };
  if (!remote) return res;
  const before = git(root, ['rev-parse', 'HEAD']).out;
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';
  const url = git(root, ['remote', 'get-url', remote]).out;
  const f = gitVia443(root, ['fetch', '-q', remote, branch], remote, url);
  if (!f.ok && !/couldn't find remote ref/.test(f.err)) { res.error = `fetch: ${f.err.split('\n').pop()}`; return res; }
  if (f.ok) {
    const m = git(root, ['merge', '--no-edit', '-q', `${remote}/${branch}`]);
    if (!m.ok) {
      const r = resolveConflicts(root, vault);
      if (!r.ok) { git(root, ['merge', '--abort']); recordConflicts(root, null); res.error = 'merge conflict: left as is; run memev doctor'; return res; }
      recordConflicts(root, { at: now(), files: r.files, conflicts: r.conflicts });
      res.conflicts = r.conflicts;
      const changed = git(root, ['diff', '--name-only', before, 'HEAD']).out.split('\n').filter((p) => p.endsWith('.md'));
      for (const p of changed) if (vault.syncFromDisk(p, 'git-pull')) res.pulled++;
    } else {
      recordConflicts(root, null);
      const changed = git(root, ['diff', '--name-only', before, 'HEAD']).out.split('\n').filter((p) => p.endsWith('.md'));
      for (const p of changed) if (vault.syncFromDisk(p, 'git-pull')) res.pulled++;
    }
  }
  const w = writerCheck(vault, { root }); if (w.warning) res.warning = w.warning; res.writers = w.writers.length;
  commitAddressFile(root);
  const p = gitVia443(root, ['push', '-q', remote, `HEAD:${branch}`], remote, url);
  res.pushed = p.ok; if (!p.ok) res.error = `push: ${p.err.split('\n').pop()}`;
  return res;
}

export const WRITERS_DIR = '.memev-writers';
/**
 * Record this computer as a writer (one small file per computer, so two computers never conflict
 * on it) and report other computers that wrote in the last 30 days. Report only.
 */
export function writerCheck(vault, { root, at = Date.now() }) {
  const dir = path.join(root, WRITERS_DIR); fs.mkdirSync(dir, { recursive: true });
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
  const every = (min, fn, name) => { const run = async () => { try { record(name, { at: now(), ...(await fn()) }); } catch (e) { record(name, { at: now(), error: e.message }); } }; timers.push(setInterval(run, Math.max(1, min) * 60000)); timers.at(-1).unref?.(); return run; };
  every(vault.config.sync?.interval_min ?? 30, async () => {
    const { selectProvider } = await import('../services/providers.mjs');
    const p = selectProvider('sync', { root, config: vault.config });
    return p ? { provider: p.id, ...(await p.run(vault, { root })) } : { provider: null, skipped: 'no sync provider (memev github setup)' };
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
  if (process.env.MEMEV_NO_BACKGROUND !== '1') { setTimeout(redetect, 5000).unref?.(); setTimeout(tune, 15000).unref?.(); }
  return { stop() { for (const t of timers) clearInterval(t); }, reload() {} };
}
