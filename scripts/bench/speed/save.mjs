// SPDX-License-Identifier: Apache-2.0
// What a write costs the thread that answers requests, on the segment index: each blocking step timed directly,
// the event loop's longest stall measured from inside, and recall during a fold. Fails when a fold does not finish
// or leaves the index with a section count the writes do not explain.
//   node scripts/bench/speed/save.mjs --index <a copy of .memev/index.jsonl> --work <scratch folder> [--code <checkout>] [--repeats 3] [--sizes 500,5000,16000] [--quiet: no reads during the fold, so the longest stall is the fold's own]
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const has = (k) => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CODE = arg('code', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')); const INDEX = arg('index'), WORK = arg('work'); const REPEATS = Number(arg('repeats', 3)); const SIZES = arg('sizes', '500,5000,16000').split(',').map(Number);
const { SegIndex } = await import(`${CODE}/src/engine/segindex.mjs`);
const stat = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => Number(s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))].toFixed(1)); return { n: s.length, p50: q(0.5), p95: q(0.95), max: q(1) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timed = (fn) => { const t = performance.now(); fn(); return Number((performance.now() - t).toFixed(1)); };
setInterval(() => {}, 1000); // a fold's worker does not hold the process open
fs.mkdirSync(WORK, { recursive: true }); const file = path.join(WORK, 'index.jsonl');
if (!fs.existsSync(path.join(WORK, 'index.seg', 'CURRENT'))) { fs.copyFileSync(INDEX, file); const t = performance.now(); const c = new SegIndex(file); if (!c.load()) throw new Error('conversion failed'); console.log(JSON.stringify({ convert_ms: Math.round(performance.now() - t) })); }
const pristine = `${WORK}.pristine`; if (!fs.existsSync(pristine)) fs.cpSync(`${WORK}/index.seg`, pristine, { recursive: true });
const restore = () => { fs.rmSync(`${WORK}/index.seg`, { recursive: true, force: true }); fs.cpSync(pristine, `${WORK}/index.seg`, { recursive: true }); for (const f of ['index.overlay.jsonl', 'index.retired.json']) fs.rmSync(path.join(WORK, f), { force: true }); };
// Text like a journal turn: the same size and vocabulary mix as real sections, new words included.
let wi = 0; const body = (extra = '') => { const i = wi++; return `# turn ${i}\n\nProject: billing\n\n## webhook retries r${i}\nwe looked at the webhook retries and the database migration timeout again ${extra} word${i} word${i % 97} and wrote down what the billing service does when a delivery fails after the third attempt, then moved on to the next item on the list\n`; };
const PROMPTS = ['database migration timeout', 'how do we handle retries for webhook delivery in billing', 'write a unit test for parse_date', 'what did we decide about the deploy pipeline and the staging rollback when the health check fails twice', 'token rotation schedule for the api gateway'];
let bad = 0; const rows = [];
for (let rep = 0; rep < REPEATS; rep++) for (const size of SIZES) {
  restore(); const ix = new SegIndex(file); if (!ix.load()) throw new Error('segment did not load'); const out = { rep, overlay: size };
  const n0 = ix.docs.size; const seg = ix.seg; out.sections = n0; out.open_columns_ms = timed(() => { ix.query('database migration timeout', { limit: 4, boosts: {} }); });
  out.first_write_ms = timed(() => ix.update('notes/bench/first.md', body())); let added = ix.docs.size - n0; let i = 0;
  // Grow the overlay the way writes do, in saves of 20, keeping it under the fold threshold where the size asks for that.
  const grow = []; ix.foldSoon0 = ix.foldSoon; ix.foldSoon = () => null; while (ix.ov.docs.size < size) { const t = performance.now(); for (let k = 0; k < 20; k++) ix.update(`notes/bench/n${i++}.md`, body()); grow.push((performance.now() - t) / 20); ix.save(); }
  out.write_each_ms = stat(grow); ix.foldSoon = ix.foldSoon0; delete ix.foldSoon0;
  out.save_one_note_ms = []; for (let k = 0; k < 5; k++) { ix.update(`notes/bench/s${k}.md`, body()); const f0 = ix.foldSoon; ix.foldSoon = () => null; out.save_one_note_ms.push(timed(() => ix.save())); ix.foldSoon = f0; }
  added = ix.docs.size - n0;
  // The fold, with recalls and the loop's stall measured from this thread, and writes arriving during it.
  let stall = 0, last = performance.now(), run = true; const tick = () => { const t = performance.now(); stall = Math.max(stall, t - last - 2); last = t; if (run) setTimeout(tick, 2); }; tick();
  const sw = ix._swap; let swapMs = null; ix._swap = function (...a) { const t = performance.now(); const r = sw.apply(this, a); swapMs = Number((performance.now() - t).toFixed(1)); return r; };
  const t0 = performance.now(); let startMs; const before = stall; startMs = timed(() => ix.foldSoon()); const during = []; const wr = []; let q = 0; let duringWrites = 0; const f = ix.foldP;
  let done = false; f.then(() => { done = true; });
  if (has('quiet')) { await f; }
  while (!done) { const t = performance.now(); ix.query(PROMPTS[q++ % PROMPTS.length], { limit: 4, boosts: {} }); during.push(performance.now() - t); if (q % 5 === 0) { const t2 = performance.now(); ix.update(`notes/bench/d${q}.md`, body()); duringWrites++; const f2 = ix.foldSoon; ix.foldSoon = () => ix.foldP; ix.save(); ix.foldSoon = f2; wr.push(performance.now() - t2); } await sleep(20); if (performance.now() - t0 > 600000) { console.log('fold did not finish'); bad++; break; } }
  await f; out.fold_wall_ms = Math.round(performance.now() - t0); out.fold_start_blocks_ms = startMs; out.swap_blocks_ms = swapMs; out.recall_during_fold_ms = stat(during); out.save_during_fold_ms = stat(wr); out.writes_during_fold = duringWrites; out.longest_stall_ms = Number(Math.max(stall, before).toFixed(1));
  run = false; await sleep(5); const after = []; for (let k = 0; k < 20; k++) { const t = performance.now(); ix.query(PROMPTS[k % PROMPTS.length], { limit: 4, boosts: {} }); after.push(performance.now() - t); } out.recall_after_ms = stat(after);
  if (ix.seg === seg) { console.log('the fold did not swap'); bad++; } const expect = n0 + added + duringWrites * 2; out.sections_after = ix.docs.size; out.expect_about = expect; if (ix.docs.size < n0) { console.log('the fold lost sections'); bad++; }
  out.rss_mb = Math.round(process.memoryUsage().rss / 1048576); out.heap_mb = Math.round(process.memoryUsage().heapUsed / 1048576); rows.push(out); console.log(JSON.stringify(out));
}
console.log(JSON.stringify({ result: bad ? 'FAIL' : 'PASS', runs: rows.length, bad })); process.exit(bad ? 1 : 0);
