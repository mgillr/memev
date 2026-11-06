// SPDX-License-Identifier: Apache-2.0
// The real daemon over HTTP, on a copy of a vault: recall on the real route once tuning has run, the longest wait on
// /healthz after writes, a fold with an overlay near its threshold, and a kill during that fold.
// Exits non-zero when health times out, a note written before the kill is not found after it, or a section comes back twice.
//   node scripts/bench/speed/daemon.mjs --root <vault copy> --port <port> [--code <checkout>] [--repeats 3] [--fold 16000] [--kill]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; }; const has = (k) => process.argv.includes(`--${k}`);
const CODE = arg('code', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')); const ROOT = arg('root'), PORT = arg('port', '48211'); const REPEATS = Number(arg('repeats', 3)); const FOLD = Number(arg('fold', 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stat = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => Number(s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))].toFixed(1)); return { n: s.length, p50: q(0.5), p95: q(0.95), max: q(1) }; };
const Q = JSON.parse(fs.readFileSync(path.join(CODE, 'bench/queries.json'), 'utf8')); const out = { code: path.basename(CODE), root: path.basename(ROOT) }; let bad = 0;
const url = (r) => `http://127.0.0.1:${PORT}${r}`;
const start = async () => { const t0 = performance.now(); const c = spawn(process.execPath, [`${CODE}/src/server/main.mjs`, '--root', ROOT, '--port', PORT], { stdio: ['ignore', 'ignore', 'pipe'], env: process.env }); let err = ''; c.stderr.on('data', (x) => { err += x; }); let gone = false; c.on('exit', () => { gone = true; }); for (;;) { if (gone) throw new Error(`the daemon exited: ${err.slice(0, 400)}`); try { const r = await fetch(url('/healthz'), { signal: AbortSignal.timeout(800) }); if (r.ok) break; } catch { /* not yet */ } await sleep(50); if (performance.now() - t0 > 400000) throw new Error('no health'); } return { c, up_ms: Math.round(performance.now() - t0) }; };
const stop = async (c, sig = 'SIGTERM') => { const done = new Promise((r) => c.on('exit', r)); c.kill(sig); await done; };
const { clientToken } = await import(`${CODE}/src/cli/common.mjs`); let hdr = null; const auth = () => { hdr = { 'content-type': 'application/json', authorization: `Bearer ${clientToken(ROOT, 'cli')}`, 'x-memev-client': 'cli' }; };
const post = async (r, b) => { const t = performance.now(); const x = await fetch(url(r), { method: 'POST', headers: hdr, body: JSON.stringify(b) }); const j = await x.json(); return { ms: performance.now() - t, status: x.status, j }; };
const recall = (query, project) => post('/v1/recall', { query, project });
const watch = async (ms, during) => { const lat = []; let timeouts = 0; const end = performance.now() + ms; let i = 0; while (performance.now() < end) { const t = performance.now(); try { await fetch(url('/healthz'), { signal: AbortSignal.timeout(800) }); lat.push(performance.now() - t); } catch { timeouts++; lat.push(performance.now() - t); } if (during) await during(i++); await sleep(25); } return { ...stat(lat), timeouts_800ms: timeouts }; };

// A fold needs an overlay near its threshold; writes through the route would take an hour, so they are put in the index first.
if (FOLD) { const { SegIndex } = await import(`${CODE}/src/engine/segindex.mjs`); const ix = new SegIndex(path.join(ROOT, '.memev', 'index.jsonl')); ix.load(); ix.foldSoon = () => null; const target = Math.max(FOLD, Math.ceil(ix.seg.head.n * 0.05) + 50); let i = 0; while (ix.ov.docs.size < target) { ix.update(`notes/bench-seed/s${i++}.md`, `# seeded ${i}\n\n## webhook retries r${i}\nwe looked at the webhook retries and the database migration timeout again word${i} and wrote down what the billing service does when a delivery fails after the third attempt, then moved on\n`, { mtime: 1 }); if (i % 200 === 0) ix.save(); } ix.dirty = true; ix.save(); out.seeded_overlay = ix.ov.docs.size; }

auth(); let d = await start(); auth(); out.up_ms = d.up_ms;
for (let t = 0; t < 200 && !fs.existsSync(path.join(ROOT, '.memev', 'tuning.json')); t++) await sleep(100); await sleep(500); out.tuning = fs.existsSync(path.join(ROOT, '.memev', 'tuning.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, '.memev', 'tuning.json'), 'utf8')).items : null;

if (!FOLD) {
  out.recall_idle = []; for (let r = 0; r < REPEATS; r++) { const a = []; let totals = 0; for (const q of Q.on_topic) { const x = await recall(q.prompt, q.project); a.push(x.ms); totals += x.j.total || 0; } out.recall_idle.push({ ...stat(a), mean_total: Math.round(totals / a.length) }); }
  out.write_cycle = [];
  for (let r = 0; r < REPEATS; r++) { // the rig's own sequence: a write, the debounced save watched, a second write, a recall at the save moment, one after
    const w1 = await post('/v1/journal', { session: `stall${r}`, role: 'user', text: 'a turn to trigger the debounced index save', project: 'billing' }); const health = await watch(9000); const w2 = await post('/v1/journal', { session: `stall${r}`, role: 'assistant', text: 'second write', project: 'billing' }); await sleep(2950); const at = await recall('database migration timeout', 'billing'); await sleep(500); const after = await recall('database migration timeout', 'billing');
    if (health.timeouts_800ms) bad++; out.write_cycle.push({ write1_ms: Math.round(w1.ms), health, write2_ms: Math.round(w2.ms), recall_at_save_ms: Math.round(at.ms), recall_after_ms: Math.round(after.ms) });
  }
  const burst = []; const b = await watch(15000, async (i) => { const t = performance.now(); await post('/v1/remember', { text: `burst fact ${i}: the deploy pipeline step ${i} takes longer on a cold cache`, project: 'billing' }).catch(() => {}); burst.push(performance.now() - t); }); out.burst = { health: b, write_ms: stat(burst) }; if (b.timeouts_800ms) bad++;
} else {
  // The save is debounced by 3 s and every write pushes it back, so the fold starts in the pause after this write; writes during it come slower than the debounce would matter.
  const marker = `foldmarker${Date.now()}`; const before = await post('/v1/journal', { session: 'fold', role: 'user', text: `${marker} written first`, project: 'billing' }); out.write_before_fold_ms = Math.round(before.ms); const gap = await watch(3600);  out.health_until_fold = gap;
  const gen = () => { try { return fs.readFileSync(path.join(ROOT, '.memev', 'index.seg', 'CURRENT'), 'utf8'); } catch { return null; } }; const g0 = gen(); const rec = []; const t0 = performance.now(); let foldEnd = null; let wrote = 0;
  const health = await watch(has('kill') ? Number(arg('killat', 1500)) : 45000, async (i) => { if (i % 4 === 0) { const q = Q.on_topic[(i >> 2) % Q.on_topic.length]; rec.push((await recall(q.prompt, q.project)).ms); } if (i % 8 === 0) { await post('/v1/journal', { session: 'fold', role: 'assistant', text: `${marker} during turn ${wrote++} webhook`, project: 'billing' }); } if (!foldEnd && gen() !== g0) foldEnd = performance.now() - t0; });
  out.fold = { health, recall_ms: stat(rec), generation_changed_after_ms: foldEnd && Math.round(foldEnd), writes_during: wrote, killed_mid_fold: has('kill') && !foldEnd }; if (health.timeouts_800ms) bad++;
  if (has('kill')) { await stop(d.c, 'SIGKILL'); d = await start(); auth(); out.up_after_kill_ms = d.up_ms; await sleep(500); } else if (!foldEnd) { console.log('the fold did not finish in the window'); bad++; }
  const found = await post('/v1/recall', { query: marker, limit: 10, project: 'billing' }); const seen = new Map(); for (const h of found.j.hits || []) { const k = `${h.path}#${h.line}`; seen.set(k, (seen.get(k) || 0) + 1); } out.after = { total: found.j.total, hits: found.j.hits?.length, wrote: wrote + 1, twice: [...seen.values()].filter((v) => v > 1).length };
  if (out.after.twice) { console.log('a section came back twice'); bad++; } if (!found.j.total) { console.log('a note written before the end was not found'); bad++; }
}
await stop(d.c); out.result = bad ? 'FAIL' : 'PASS'; console.log(JSON.stringify(out)); process.exit(bad ? 1 : 0);
