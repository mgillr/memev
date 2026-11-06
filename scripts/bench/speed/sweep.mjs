#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// O1: time for the background sweep to find an edit no stat can show, and what it costs the thread. Opens the vault with changed time
// ignored, which is how a file system without a usable one behaves. It edits a note in the vault, so only point it at a copy.
//   node scripts/bench/speed/sweep.mjs --root <copy> [--runs 3] [--tree <checkout>]
// Exits 1 when the edit is seen too early (the plant failed), or not found by the sweep, or the thread stalled past --stall ms.
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const one = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const root = path.resolve(one('root', '')); const here = path.dirname(fileURLToPath(import.meta.url));
const tree = path.resolve(one('tree', path.resolve(here, '..', '..', '..')));
const { Vault } = await import(path.join(tree, 'src', 'engine', 'vault.mjs'));
const OPT = { git: false, fsync: false, ignoreCtime: true }; const SECOND = 1700000000;
const stallMs = Number(one('stall', 1000)); let bad = 0;
for (let run = 0; run < Number(one('runs', 3)); run++) {
  let v = new Vault(root, OPT).open();
  const notes = [...v.log.heads.entries()].filter(([p, h]) => !h.deleted && h.ch && p.startsWith('notes/') && p.endsWith('.md')).map(([p]) => p).sort();
  const p = notes[Math.floor(notes.length * (run + 0.5) / Number(one('runs', 3)))]; const file = path.join(root, ...p.split('/'));
  const flipped = (t) => { const i = t.search(/[a-z]/); return `${t.slice(0, i)}${t[i] === 'q' ? 'x' : 'q'}${t.slice(i + 1)}`; };
  v.close(); fs.utimesSync(file, SECOND, SECOND); v = new Vault(root, OPT).open(); v.close();
  const before = fs.statSync(file, { bigint: true }); fs.writeFileSync(file, flipped(fs.readFileSync(file, 'utf8'))); fs.utimesSync(file, SECOND, SECOND); const after = fs.statSync(file, { bigint: true });
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) { console.log('the plant did not keep size and time'); bad++; continue; }
  const t0 = performance.now(); v = new Vault(root, OPT).open(); const open_ms = Math.round(performance.now() - t0);
  if (v.imported.includes(p)) { console.log('the start saw the edit, so the sweep was not tested'); bad++; v.close(); continue; }
  const h = monitorEventLoopDelay({ resolution: 5 }); h.enable(); let last = performance.now(), worst = 0; const tick = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 5); last = n; }, 5);
  const s = v.startSweep(); while (s.state === 'running') await new Promise((r) => setTimeout(r, 20));
  clearInterval(tick); h.disable();
  const found = s.found.find((f) => f.path === p);
  console.log(JSON.stringify({ run, notes: s.total, open_ms, state: s.state, detect_ms: found?.ms ?? null, cycle_ms: s.cycle_ms, mb: Math.round(s.bytes / 1048576), changed: s.changed, thread_worst_ms: Math.round(worst), loop_p99_ms: Math.round(h.percentile(99) / 1e6) }));
  if (!found || s.state !== 'done' || worst > stallMs) bad++;
  v.close();
}
console.log(JSON.stringify({ bad }));
process.exit(bad ? 1 : 0);
