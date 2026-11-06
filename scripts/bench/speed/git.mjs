// SPDX-License-Identifier: Apache-2.0
// A5, the commit queue. How long one commit stops this thread, the old way (the commit on this thread, the control) against the
// real queue, alternating in one process on one settled vault copy. The longest gap between event-loop turns over the commit is
// the number; the control has to show the block, or the comparison means nothing, so a control that does not block fails the run.
//   node scripts/bench/speed/git.mjs --root COPY [--rounds 15] [--delay 50] [--json]
// COPY is written to: pass a throwaway copy of a vault, and run `git status` in it once first.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { CommitQueue } from '../../../src/engine/git.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const root = arg('root'); if (!root) { console.error('--root COPY is required'); process.exit(2); }
const ROUNDS = Number(arg('rounds', 15)); const DELAY = Number(arg('delay', 50));
const rel = 'work/sessions/bench-speed-git.md'; const abs = path.join(root, ...rel.split('/'));
fs.mkdirSync(path.dirname(abs), { recursive: true });
if (!fs.existsSync(abs)) fs.writeFileSync(abs, '# bench\n');
const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const tick = () => new Promise((r) => setImmediate(r));

/** One commit through the queue. Returns the longest event-loop gap from the end of the quiet period to the commit, and the time to it. */
async function one(q, tag) {
  const commits = q.commits;
  fs.appendFileSync(abs, `\n#### ${tag} ${Date.now()}\nsome text about webhook retries\n`);
  q.add(rel, 'bench');
  const t0 = performance.now(); let last = t0; let worst = 0;
  while (q.commits === commits) {
    await tick();
    const t = performance.now(); worst = Math.max(worst, t - last); last = t;
    if (t - t0 > 60000) throw new Error('no commit in 60 s');
  }
  return { block: worst, wall: performance.now() - t0 };
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Number(s[Math.floor((s.length - 1) * p)].toFixed(1)); };
const brief = (a) => ({ p50: q(a, 0.5), p25: q(a, 0.25), p75: q(a, 0.75), max: q(a, 1) });
const control = new CommitQueue(root, { delayMs: DELAY, background: false });
const queue = new CommitQueue(root, { delayMs: DELAY });
const timer = setInterval(() => {}, 1000);
const R = { control: { block: [], wall: [] }, queue: { block: [], wall: [] } };
const head0 = head();
await one(queue, 'warm'); // the thread starts on the first commit; report its start apart
const start = (await one(queue, 'warm2'));
for (let i = 0; i < ROUNDS; i++) {
  for (const [name, c] of i % 2 ? [['queue', queue], ['control', control]] : [['control', control], ['queue', queue]]) {
    const r = await one(c, `${name} ${i}`);
    R[name].block.push(r.block); R[name].wall.push(r.wall);
  }
}
clearInterval(timer);
const made = Number(spawnSync('git', ['rev-list', '--count', `${head0}..HEAD`], { cwd: root, encoding: 'utf8' }).stdout.trim());
const out = { rounds: ROUNDS, delay_ms: DELAY, commits_made: made, expected: 2 * ROUNDS + 2, warm_block_ms: Number(start.block.toFixed(1)), control_block: brief(R.control.block), queue_block: brief(R.queue.block), control_wall: brief(R.control.wall), queue_wall: brief(R.queue.wall) };
console.log(JSON.stringify(out));
const failures = [];
if (made !== out.expected) failures.push(`${made} commits, expected ${out.expected}`);
if (q(R.control.block, 0.5) < 20) failures.push('the control did not block: this copy measures nothing');
if (q(R.queue.block, 0.5) > q(R.control.block, 0.5) / 3) failures.push('the queue blocks over a third of the control');
if (failures.length) { console.error(`FAIL: ${failures.join('; ')}`); process.exit(1); }
console.log('PASS');
