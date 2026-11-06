#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A1 and A8: wall time from spawning the real daemon to /healthz, to ready, and from SIGTERM to exit, on a vault the caller owns.
// Never point it at a vault you want to keep: it opens the vault. Candidates alternate within one run, so a shared machine hits both.
//   node scripts/bench/speed/start.mjs --root <copy> --runs 3 [--tree <checkout>]... [--env K=V]... [--prof <dir>] [--touch]
// --tree may repeat; each tree is one candidate. --env applies to every candidate. --touch appends to one note through the route before
// each stop, --settle <ms> (300) later, so the stop has something to save and, past the commit delay, a commit in flight. Prints one JSON line per run and a summary with min, median and max, and exits 1
// when any run did not reach health, so a broken daemon cannot read as a fast one.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const all = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const one = (k, d) => all(k)[0] ?? d;
const root = path.resolve(one('root', ''));
if (!fs.existsSync(path.join(root, '.memev', 'config.json'))) { console.error('--root must be a vault copy'); process.exit(2); }
const runs = Number(one('runs', 3));
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const trees = all('tree').length ? all('tree') : [here];
const extra = Object.fromEntries(all('env').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
const prof = one('prof', null);
const port = Number(one('port', 47000 + (process.pid % 900)));
const timeoutMs = Number(one('timeout', 600000));
const heapMb = one('heap', '7000');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const rssMb = (pid) => new Promise((r) => { const c = spawn('ps', ['-o', 'rss=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }); let s = ''; c.stdout.on('data', (d) => { s += d; }); c.on('close', () => r(Math.round(Number(s.trim()) / 1024))); });

async function once(tree) {
  const t0 = performance.now();
  const args = [`--max-old-space-size=${heapMb}`, ...(prof ? ['--cpu-prof', `--cpu-prof-dir=${prof}`] : []), path.join(tree, 'src', 'server', 'main.mjs'), '--root', root, '--port', String(port)];
  const c = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...extra } });
  let err = ''; c.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
  let health = null, ready = null, body = null;
  while (performance.now() - t0 < timeoutMs && c.exitCode === null) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
      body = await r.json();
      if (r.ok && body.ok === true) { health ??= performance.now() - t0; if (body.loading !== true) { ready = performance.now() - t0; break; } }
    } catch {}
    await nap(10);
  }
  if (health === null) { try { c.kill('SIGKILL'); } catch {} return { ok: false, err: err.slice(0, 2000), exit: c.exitCode }; }
  const rss = await rssMb(c.pid);
  if (argv.includes('--touch')) {
    const { clientToken } = await import(path.join(tree, 'src', 'cli', 'common.mjs'));
    const r = await fetch(`http://127.0.0.1:${port}/v1/notes/${encodeURIComponent('notes/bench-touch.md')}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${clientToken(root, 'cli')}`, 'x-memev-client': 'cli' }, body: JSON.stringify({ text: `## ${new Date().toISOString()}\na line for the stop to save\n` }) });
    if (!r.ok) { c.kill('SIGTERM'); await new Promise((res) => c.once('exit', res)); return { ok: false, err: `touch: ${r.status}`, exit: null }; }
  }
  await nap(Number(one('settle', 300)));
  const t1 = performance.now(); c.kill('SIGTERM');
  const code = await new Promise((r) => { if (c.exitCode !== null) r(c.exitCode); else c.once('exit', (x) => r(x)); });
  return { ok: code === 0, health_ms: Math.round(health), ready_ms: Math.round(ready ?? health), stop_ms: Math.round(performance.now() - t1), rss_mb: rss, exit: code };
}

const res = new Map(trees.map((t) => [t, []])); let bad = 0;
for (let i = 0; i < runs; i++) for (const t of trees) { const r = await once(t); console.log(JSON.stringify({ tree: path.basename(t), run: i, ...r })); if (!r.ok) bad++; else res.get(t).push(r); }
const sum = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1], n: s.length } : null; };
for (const [t, a] of res) console.log(JSON.stringify({ summary: path.basename(t), health_ms: sum(a.map((x) => x.health_ms)), ready_ms: sum(a.map((x) => x.ready_ms)), stop_ms: sum(a.map((x) => x.stop_ms)), rss_mb: sum(a.map((x) => x.rss_mb)) }));
if (bad) { console.error(`${bad} run(s) failed`); process.exit(1); }
