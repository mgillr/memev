#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Axis A6, the bus: roster, tasks, unread, send and the first read, on a generated bus file.
//   node scripts/bench/speed/bus.mjs --seats 50 --messages 100000 --json
//   --impl <file>     a bus module to measure instead of src/engine/bus.mjs (may be repeated; the runs alternate)
//   --repeats <n>     rounds per module (default 3); every number printed is the median round, with its spread
// The bench exits non-zero when --max-roster is set and the roster p95 is over it, so it can fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const args = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const SEATS = Number(arg('seats', 50)); const M = Number(arg('messages', 100000)); const REPEATS = Number(arg('repeats', 3));
const JSON_OUT = argv.includes('--json'); const MAX_ROSTER = arg('max-roster', null);
const IMPLS = args('impl').length ? args('impl') : [path.join(REPO, 'src/engine/bus.mjs')];

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MIX = [['status', 60], ['ack', 20], ['question', 5], ['answer', 5], ['task', 3], ['claim', 3], ['verdict', 2.5], ['restate', 1.5]];
const WORDS = Array.from({ length: 4000 }, (_, i) => `w${(i * 2654435761 >>> 0).toString(36)}`);
const DEVICE = 'dev_benchhost00000';

/** The same message mix as the growth report's bus step, about 540 bytes a message. */
function genLog(messages, seats, device = DEVICE) {
  const r = prng(17); const tasks = []; const start = Date.parse('2026-01-01T00:00:00Z'); const lines = [];
  for (let i = 1; i <= messages; i++) {
    let x = r() * 100; let type = 'status';
    for (const [t, w] of MIX) { if (x < w) { type = t; break; } x -= w; }
    let ref = null;
    if (['claim', 'verdict', 'restate'].includes(type)) { if (tasks.length) ref = tasks[Math.floor(r() * tasks.length)]; else type = 'status'; }
    const id = `${device.slice(4, 12)}-${i}`;
    if (type === 'task') tasks.push(id);
    let body = ''; while (body.length < 330) body += `${WORDS[Math.floor(r() * r() * WORDS.length)]} `;
    lines.push(JSON.stringify({ id, dseq: i, ts: new Date(start + i * 1000).toISOString(), device, from: `bot${i % seats}@fleet`, operator: false, to: type === 'task' ? `bot${(i + 1) % seats}@fleet` : 'all', type, body, ref, project: null }));
  }
  return `${lines.join('\n')}\n`;
}

// bot1 has read nothing (the worst case for unread); the other seats have read everything.
function makeRoot(base, log) {
  const root = fs.mkdtempSync(path.join(base, 'v-'));
  for (const d of ['seats', 'pulse', 'log']) fs.mkdirSync(path.join(root, 'bus', d), { recursive: true });
  fs.writeFileSync(path.join(root, 'bus/operator.json'), JSON.stringify({ seat: null, set: null }));
  fs.writeFileSync(path.join(root, 'bus/log', `${DEVICE}.jsonl`), log);
  const at = new Date().toISOString();
  for (let i = 0; i < SEATS; i++) {
    const seat = `bot${i}@fleet`; const f = `${seat.replace('@', '~')}.json`;
    fs.writeFileSync(path.join(root, 'bus/seats', f), JSON.stringify({ seat, client: `bot${i}`, device: DEVICE, device_kind: 'host', device_label: 'fleet', project: null, created: at, joined: at, removed: null }));
    if (i !== 1) fs.writeFileSync(path.join(root, 'bus/pulse', f), JSON.stringify({ seat, device: DEVICE, last_seen: at, session: null, beats: 1, read: { [DEVICE]: M }, read_extra: {}, seen_seq: M, seen_dseq: { [DEVICE]: M } }));
  }
  return root;
}
const device = { id: DEVICE, kind: 'host', label: 'fleet', status: 'active' };
const devices = { hostId: DEVICE, get: (id) => (id === DEVICE ? device : null), list: () => [device] };
const ID = { id: 'bench', agent: 'bench', scopes: ['read', 'write'], paths: ['**'] };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
const round = (x) => Math.round(x * 100) / 100;
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
const series = (fn, n) => { const out = []; for (let i = 0; i < n; i++) out.push(time(fn)); return out; };
// thread CPU per call as well, because on a shared machine wall time mostly measures the neighbours
const both = (r, key, fn, n) => { const c = process.cpuUsage(); const s = series(fn, n); const u = process.cpuUsage(c); r[`${key}_ms`] = q(s, 0.5); r[`${key}_cpu_ms`] = (u.user + u.system) / 1000 / n; return s; };

async function measure(file, base, log) {
  const { Bus } = await import(pathToFileURL(path.resolve(file)).href);
  const root = makeRoot(base, log);
  const bus = new Bus({ root, devices });
  const unreadSeat = { identity: ID, client: 'bot1', device }; const caughtUp = { identity: ID, client: 'bot2', device };
  const r = {};
  both(r, 'first', () => bus.all(), 1);
  both(r, 'all', () => bus.all(), 5);
  both(r, 'unread_all_unread_capped', () => bus.unread(unreadSeat, { seat: 'bot1@fleet', peek: true, capped: true }), 5);
  both(r, 'unread_caught_up', () => bus.unread(caughtUp, { seat: 'bot2@fleet', peek: true }), 5);
  both(r, 'send', () => bus.send(caughtUp, { seat: 'bot2@fleet', to: 'all', type: 'status', body: 'bench message' }), 5);
  // the first roster tells how many more this module can afford; p95 needs twenty
  const one = time(() => bus.roster());
  const roster = [one, ...both(r, 'roster', () => bus.roster(), one > 2000 ? 2 : 19)];
  r.roster_ms = q(roster, 0.5); r.roster_ms_p95 = q(roster, 0.95);
  both(r, 'tail', () => bus.tail(caughtUp, { seat: 'bot2@fleet', n: 20 }), 5);
  both(r, 'since', () => bus.since(caughtUp, { seat: 'bot2@fleet', seq: M - 10, limit: 50 }), 5);
  both(r, 'tasks', () => bus.tasks(caughtUp), 1);
  globalThis.gc?.();
  r.heap_mb = Math.round(process.memoryUsage().heapUsed / 1048576);
  fs.rmSync(root, { recursive: true, force: true });
  return r;
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-bench-'));
const log = genLog(M, SEATS);
const rounds = IMPLS.map(() => []);
for (let n = 0; n < REPEATS; n++) for (let i = 0; i < IMPLS.length; i++) rounds[i].push(await measure(IMPLS[i], base, log));
fs.rmSync(base, { recursive: true, force: true });

const summary = rounds.map((rs, i) => {
  const out = { impl: path.relative(REPO, path.resolve(IMPLS[i])) };
  for (const k of Object.keys(rs[0])) { const v = rs.map((r) => r[k]).sort((a, b) => a - b); out[k] = round(v[Math.floor(v.length / 2)]); out[`${k}_spread`] = [round(v[0]), round(v.at(-1))]; }
  return out;
});
const head = { cpus: os.cpus().length, cpu_model: os.cpus()[0]?.model || 'unknown', load1: round(os.loadavg()[0]), seats: SEATS, messages: M, repeats: REPEATS, log_mb: round(log.length / 1048576) };
if (JSON_OUT) console.log(JSON.stringify(IMPLS.length === 1 ? { ...head, ...summary[0] } : { ...head, runs: summary }));
else { console.log(`cpus ${head.cpus}  model ${head.cpu_model}  load1 ${head.load1}  seats ${SEATS}  messages ${M}  log ${head.log_mb} MB`); for (const s of summary) { console.log(s.impl); for (const k of Object.keys(s)) if (k !== 'impl' && !k.endsWith('_spread')) console.log(`  ${k.padEnd(30)} ${String(s[k]).padStart(10)}   spread ${s[`${k}_spread`].join(' to ')}`); } }
if (MAX_ROSTER != null && summary[0].roster_ms_p95 >= Number(MAX_ROSTER)) { console.error(`roster_ms_p95 ${summary[0].roster_ms_p95} is not under ${MAX_ROSTER}`); process.exit(1); }
