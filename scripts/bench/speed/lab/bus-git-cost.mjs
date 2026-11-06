// SPDX-License-Identifier: Apache-2.0
// What one bus message costs git, by the size of the file it lands in: git hashes and compresses the whole new version.
//   node scripts/bench/speed/lab/bus-git-cost.mjs <work-dir> [sizes in MB...]
// Prints, per size: git add and commit of one appended line (median of 5, with spread), and the growth of .git per message.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const dir = process.argv[2]; const sizes = process.argv.slice(3).map(Number);
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@example.invalid', '-c', 'gc.auto=0', ...a], { cwd, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout; };
const line = (i) => `${JSON.stringify({ id: `h-${i}`, dseq: i, ts: new Date(1.7e12 + i * 1000).toISOString(), body: Array.from({ length: 50 }, (_, k) => ((i * 2654435761 + k * 40503) >>> 0).toString(36)).join(' ') })}\n`;
const du = (d) => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); n += e.isDirectory() ? du(f) : fs.statSync(f).size; } return n; };
for (const mb of sizes) {
  const root = path.join(dir, `git-${mb}`); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  const f = path.join(root, 'log.jsonl'); let body = ''; let i = 0; while (body.length < mb * 1048576) body += line(++i);
  fs.writeFileSync(f, body); git(root, 'add', 'log.jsonl'); git(root, 'commit', '-q', '-m', 'base');
  const ms = []; const before = du(path.join(root, '.git'));
  for (let k = 0; k < 5; k++) { fs.appendFileSync(f, line(++i)); const t = performance.now(); git(root, 'add', 'log.jsonl'); git(root, 'commit', '-q', '-m', 'm'); ms.push(performance.now() - t); }
  const grew = (du(path.join(root, '.git')) - before) / 5; ms.sort((a, b) => a - b);
  console.log(JSON.stringify({ file_mb: mb, add_commit_ms_p50: Math.round(ms[2]), spread: [Math.round(ms[0]), Math.round(ms[4])], git_bytes_per_message: Math.round(grew) }));
  fs.rmSync(root, { recursive: true, force: true });
}
