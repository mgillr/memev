// SPDX-License-Identifier: Apache-2.0
// A4, the write route on the real daemon: a new note, an append, and the journal call a hook makes (a new session file and an
// existing one). Alternates a control checkout against this one, each daemon started on the same settled vault copy, so the
// control has to show its cost in the same minute. Also samples /healthz while writing, which is what another client feels.
//   node scripts/bench/speed/write.mjs --root COPY [--control OTHER_CHECKOUT] [--reps 3] [--n 15] [--gap 700] [--port 47611] [--json]
// COPY is written to. Pass a throwaway copy, and run `git status` in it once first. Each run's notes go under a fresh folder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const root = arg('root'); if (!root) { console.error('--root COPY is required'); process.exit(2); }
const control = arg('control'); const REPS = Number(arg('reps', 3)); const N = Number(arg('n', 15)); const GAP = Number(arg('gap', 700)); const port = Number(arg('port', 47611));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = JSON.parse(fs.readFileSync(path.join(root, '.memev', 'admin.json'), 'utf8')).token;
const hdr = { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-memev-client': 'bench' };
const base = `http://127.0.0.1:${port}`;
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Number(s[Math.floor((s.length - 1) * p)].toFixed(1)); };

async function call(method, route, body) {
  const t = performance.now();
  const r = await fetch(`${base}${route}`, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  const ms = performance.now() - t;
  if (!r.ok) throw new Error(`${method} ${route}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return { ms, j };
}

async function runOne(src, label, rep) {
  const c = spawn(process.execPath, ['--max-old-space-size=7000', path.join(src, 'src', 'server', 'main.mjs'), '--root', root, '--port', String(port)], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MEMEV_PORT: String(port) } });
  let err = ''; c.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
  const t0 = Date.now(); let up = false;
  // A daemon that has exited will never answer, so say why at once and do not wait out the limit.
  while (Date.now() - t0 < 400000) { if (c.exitCode !== null) throw new Error(`${label}: the daemon exited ${c.exitCode} before it answered: ${err.slice(-1000)}`); try { if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(800) })).ok) { up = true; break; } } catch { /* not up yet */ } await sleep(50); }
  if (!up) { c.kill('SIGKILL'); throw new Error(`${label}: no health`); }
  const upMs = Date.now() - t0;
  await sleep(1500);
  const R = { new_first: null, new: [], append: [], journal_new: [], journal_more: [], health: [] };
  const tag = `${label}${rep}${crypto.randomBytes(3).toString('hex')}`;
  let on = true;
  const prober = (async () => { while (on) { const t = performance.now(); try { await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) }); R.health.push(performance.now() - t); } catch { R.health.push(5000); } await sleep(20); } })();
  try {
    const body = (i) => `# bench ${tag} ${i}\n\nsome note text about webhook retries and the deploy pipeline ${i}\n`;
    R.new_first = (await call('PUT', `/v1/notes/${encodeURIComponent(`notes/bench-${tag}/first.md`)}`, { body: body(0) })).ms;
    await sleep(GAP);
    for (let i = 0; i < N; i++) {
      R.new.push((await call('PUT', `/v1/notes/${encodeURIComponent(`notes/bench-${tag}/n${i}.md`)}`, { body: body(i) })).ms); await sleep(GAP);
      R.append.push((await call('PATCH', `/v1/notes/${encodeURIComponent(`notes/bench-${tag}/first.md`)}`, { text: `\nmore text ${i}\n` })).ms); await sleep(GAP);
      R.journal_new.push((await call('POST', '/v1/journal', { session: `${tag}s${i}`, role: 'user', text: `a prompt about retries ${i}` })).ms); await sleep(GAP);
      R.journal_more.push((await call('POST', '/v1/journal', { session: `${tag}s${i}`, role: 'assistant', text: `an answer about retries ${i}` })).ms); await sleep(GAP);
    }
  } finally { on = false; await prober; }
  const ts = Date.now(); c.kill('SIGTERM'); while (c.exitCode === null && Date.now() - ts < 60000) await sleep(10);
  const stopMs = Date.now() - ts;
  return { label, rep, up_ms: upMs, stop_ms: stopMs, new_first: Number(R.new_first.toFixed(1)), new_p50: pct(R.new, 0.5), new_max: pct(R.new, 1), append_p50: pct(R.append, 0.5), append_max: pct(R.append, 1), journal_new_p50: pct(R.journal_new, 0.5), journal_new_max: pct(R.journal_new, 1), journal_more_p50: pct(R.journal_more, 0.5), journal_more_max: pct(R.journal_more, 1), health_p50: pct(R.health, 0.5), health_p99: pct(R.health, 0.99), health_max: pct(R.health, 1), health_n: R.health.length };
}

// --snapshot: the log's snapshot at this size, the old whole write against the sliced one, on the copy's own log.
if (process.argv.includes('--snapshot')) {
  const { OpLog } = await import('../../../src/engine/oplog.mjs');
  const log = new OpLog(path.join(root, '.memev', 'oplog'), {}).open();
  const gaps = async (fn) => { let on = true; let worst = 0; let last = performance.now(); const t0 = last; const loop = (async () => { while (on) { await new Promise((r) => setImmediate(r)); const t = performance.now(); worst = Math.max(worst, t - last); last = t; } })(); await fn(); const wall = performance.now() - t0; on = false; await loop; return { worst: Number(worst.toFixed(1)), wall: Number(wall.toFixed(1)) }; };
  const R = { whole: [], sliced: [] };
  for (let i = 0; i < REPS * 2; i++) {
    const [name, fn] = i % 2 ? ['sliced', () => log._snapshotInSlices()] : ['whole', async () => { await sleep(0); log.snapshot(); }];
    R[name].push(await gaps(fn)); await sleep(200);
  }
  const heads = log.heads.size; log.close();
  const out = { heads, whole_block_ms: R.whole.map((r) => r.worst), sliced_block_ms: R.sliced.map((r) => r.worst), sliced_wall_ms: R.sliced.map((r) => r.wall) };
  console.log(JSON.stringify(out));
  if (pct(out.whole_block_ms, 0.5) < 20) { console.error('FAIL: the whole snapshot did not block, so this copy measures nothing'); process.exit(1); }
  if (pct(out.sliced_block_ms, 0.5) > pct(out.whole_block_ms, 0.5) / 3) { console.error('FAIL: the sliced snapshot blocks over a third of the whole one'); process.exit(1); }
  console.log('PASS'); process.exit(0);
}
const rows = [];
for (let rep = 0; rep < REPS; rep++) {
  const order = control ? (rep % 2 ? [['now', HERE], ['control', control]] : [['control', control], ['now', HERE]]) : [['now', HERE]];
  for (const [label, src] of order) { const r = await runOne(src, label, rep); rows.push(r); console.log(JSON.stringify(r)); }
}
if (control) {
  const med = (l, k) => pct(rows.filter((r) => r.label === l).map((r) => r[k]), 0.5);
  const cmp = {}; for (const k of ['new_first', 'new_p50', 'append_p50', 'journal_new_p50', 'journal_more_p50', 'health_max', 'stop_ms', 'up_ms']) cmp[k] = [med('control', k), med('now', k)];
  console.log(JSON.stringify({ median_control_vs_now: cmp }));
  if (med('now', 'new_p50') > med('control', 'new_p50')) { console.error('FAIL: a new note is not faster than the control'); process.exit(1); }
}
console.log(`PASS ${rows.length} runs`);
