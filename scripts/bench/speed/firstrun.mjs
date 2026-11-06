#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A7: the first open of a folder of notes, spawn to /healthz on the real daemon, candidates alternating on the same machine.
//   node scripts/bench/speed/firstrun.mjs --root <copy of a vault> --runs 2 --tree <checkout>... [--env K=V]...
// Before each run it removes everything but config and tokens from <copy>/.memev, so only point it at a copy. Exits 1 when a run fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const all = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const root = path.resolve(all('root')[0] || '');
const state = path.join(root, '.memev');
if (!fs.existsSync(path.join(state, 'config.json'))) { console.error('--root must be a copy of a vault'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const trees = all('tree').length ? all('tree') : [path.resolve(here, '..', '..', '..')];
const KEEP = new Set(['config.json', 'tokens.json', 'admin.json', 'device.json', 'devices.json']);
const reset = () => { for (const f of fs.readdirSync(state)) if (!KEEP.has(f)) fs.rmSync(path.join(state, f), { recursive: true, force: true }); };
let bad = 0; const res = new Map(trees.map((t) => [t, []]));
for (let i = 0; i < Number(all('runs')[0] || 2); i++) for (const t of trees) {
  reset();
  const args = [path.join(here, 'start.mjs'), '--root', root, '--runs', '1', '--tree', t, '--timeout', '1800000', ...all('env').flatMap((e) => ['--env', e])];
  const c = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const line = c.stdout.split('\n').find((l) => l.includes('"run":0')); const r = line ? JSON.parse(line) : { ok: false };
  console.log(JSON.stringify({ tree: path.basename(t), run: i, first_open_ms: r.health_ms, stop_ms: r.stop_ms, rss_mb: r.rss_mb, ok: r.ok }));
  if (!r.ok) bad++; else res.get(t).push(r.health_ms);
}
for (const [t, a] of res) { const s = [...a].sort((x, y) => x - y); console.log(JSON.stringify({ summary: path.basename(t), min: s[0], med: s[s.length >> 1], max: s[s.length - 1], n: s.length })); }
if (bad) process.exit(1);
