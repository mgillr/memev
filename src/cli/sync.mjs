// SPDX-License-Identifier: Apache-2.0
// Background jobs the daemon runs, so nothing needs a person to remember it:
//   git sync      every sync.interval_min: commit, pull (merge, never force), import what changed, push
//   re-detection  every clients.recheck_min: connect AI apps installed since (unless you disconnected them)
//   tuning        once a day: recall tuning from which recalled items sessions actually used
import path from 'node:path';
import { git } from '../engine/git.mjs';
import { now, readJson, writeJson } from '../engine/util.mjs';

export function syncOnce(vault, { root }) {
  vault.commits.flush();
  const remote = git(root, ['remote']).out.split('\n').filter(Boolean)[0];
  const res = { at: now(), remote: remote || null, pulled: 0, pushed: false, error: null };
  if (!remote) return res;
  const before = git(root, ['rev-parse', 'HEAD']).out;
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';
  const f = git(root, ['fetch', '-q', remote, branch]);
  if (!f.ok && !/couldn't find remote ref/.test(f.err)) { res.error = `fetch: ${f.err.split('\n').pop()}`; return res; }
  if (f.ok) {
    const m = git(root, ['merge', '--no-edit', '-q', `${remote}/${branch}`]);
    if (!m.ok) { git(root, ['merge', '--abort']); res.error = 'merge conflict: left as is; run memev doctor'; return res; }
    const changed = git(root, ['diff', '--name-only', before, 'HEAD']).out.split('\n').filter((p) => p.endsWith('.md'));
    for (const p of changed) if (vault.syncFromDisk(p, 'git-pull')) res.pulled++;
  }
  const p = git(root, ['push', '-q', remote, `HEAD:${branch}`]);
  res.pushed = p.ok; if (!p.ok) res.error = `push: ${p.err.split('\n').pop()}`;
  return res;
}

export function supervise(vault, { root }) {
  const timers = [];
  const state = path.join(root, '.memev', 'jobs.json');
  const record = (k, v) => { const s = readJson(state, {}); s[k] = v; writeJson(state, s, 0o600); };
  const every = (min, fn, name) => { const run = async () => { try { record(name, { at: now(), ...(await fn()) }); } catch (e) { record(name, { at: now(), error: e.message }); } }; timers.push(setInterval(run, Math.max(1, min) * 60000)); timers.at(-1).unref?.(); return run; };
  every(vault.config.sync?.interval_min ?? 30, () => syncOnce(vault, { root }), 'sync');
  const redetect = every(vault.config.clients?.recheck_min ?? 30, async () => {
    if (vault.config.clients?.auto_connect === false) return { skipped: 'auto_connect is off' };
    const { connectAll, launcherPath } = await import('./clients.mjs');
    const { exists } = await import('../engine/util.mjs');
    if (!exists(launcherPath())) return { skipped: 'no launcher' };
    const r = connectAll({ launcher: launcherPath() });
    return { added: r.filter((x) => x.status === 'added').map((x) => x.id) };
  }, 'redetect');
  const tune = every(24 * 60, async () => { const { tuneRecall } = await import('../engine/tuning.mjs'); return tuneRecall(vault); }, 'tuning');
  if (process.env.MEMEV_NO_BACKGROUND !== '1') { setTimeout(redetect, 5000).unref?.(); setTimeout(tune, 15000).unref?.(); }
  return { stop() { for (const t of timers) clearInterval(t); }, reload() {} };
}
