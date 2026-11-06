// SPDX-License-Identifier: Apache-2.0
// How long the first read of the bus holds the thread: all at once on the first call, or warm in slices, with one flat file or in 4 MiB files.
//   node scripts/bench/speed/lab/bus-warm.mjs --messages 100000 --repeats 3
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Bus } from '../../../../src/engine/bus.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const M = Number(arg('messages', 100000)); const REPEATS = Number(arg('repeats', 3));
const HOST = { id: 'dev_warmhost0000', kind: 'host', label: 'pc', status: 'active' };
const devices = { hostId: HOST.id, get: () => HOST, list: () => [HOST] };
const body = 'lorem ipsum dolor '.repeat(19); const T0 = Date.parse('2026-01-01T00:00:00Z');
const lines = []; for (let i = 1; i <= M; i++) lines.push(JSON.stringify({ id: `warmhost-${i}`, dseq: i, ts: new Date(T0 + i * 1000).toISOString(), device: HOST.id, from: `bot${i % 50}@pc`, operator: false, to: 'all', type: i % 33 === 0 ? 'task' : 'status', body, ref: null, project: null }));
function room(cap) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-warm-')); fs.mkdirSync(path.join(root, 'bus/log'), { recursive: true });
  let n = 1; let buf = []; let size = 0; const flush = () => { fs.writeFileSync(path.join(root, 'bus/log', n === 1 ? `${HOST.id}.jsonl` : `${HOST.id}.${n}.jsonl`), `${buf.join('\n')}\n`); n++; buf = []; size = 0; };
  for (const l of lines) { buf.push(l); size += l.length + 1; if (size >= cap) flush(); } if (buf.length) flush();
  return root;
}
// the longest gap between two turns of the event loop while fn runs, which is what a health check or a save would have to wait for
async function longest(fn) {
  let last = performance.now(); let worst = 0; let on = true;
  const tick = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (on) setImmediate(tick); };
  setImmediate(tick); await new Promise((r) => setImmediate(r));
  const t0 = performance.now(); await fn(); const total = performance.now() - t0;
  await new Promise((r) => setImmediate(r)); on = false;
  return { worst, total };
}
const ROWS = { 'first call, flat': [Infinity, false], 'first call, 4 MiB files': [4 * 1048576, false], 'warm, flat': [Infinity, true], 'warm, 4 MiB files': [4 * 1048576, true] };
const out = {};
for (let r = 0; r < REPEATS; r++) for (const [name, [cap, warm]] of Object.entries(ROWS)) {
  const root = room(cap); const bus = new Bus({ root, devices });
  const res = await longest(async () => { if (warm) await bus.warm(); else bus.roster(); });
  const after = longest(async () => bus.roster());
  (out[name] ||= []).push({ ...res, then: (await after).worst });
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`messages ${M}, load ${os.loadavg()[0].toFixed(1)}`);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [name, rs] of Object.entries(out)) console.log(`${name.padEnd(26)} longest block ${med(rs.map((x) => x.worst)).toFixed(0).padStart(5)} ms (${Math.min(...rs.map((x) => x.worst)).toFixed(0)} to ${Math.max(...rs.map((x) => x.worst)).toFixed(0)})  whole read ${med(rs.map((x) => x.total)).toFixed(0).padStart(5)} ms`);
process.exit(0);
