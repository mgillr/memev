// SPDX-License-Identifier: Apache-2.0
// Loop 2 and 3 of the bus search, the costs the main bench does not reach:
//   node scripts/bench/speed/lab/bus-loop3.mjs --impl <bus module> [--impl <another>] --messages 100000
// foreign: another computer's line arrives by sync, then a roster. ahead: this computer's message lands before k messages from a
// clock that is ahead. extras: unread for a seat holding thousands of read counters beyond a gap. peers: first read and rebuild with
// ten computers interleaved. Also, with no module, rank (a seq worked out on demand) and columns (no message objects in memory).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const impls = argv.flatMap((a, i) => (a === '--impl' ? [argv[i + 1]] : []));
const M = Number(arg('messages', 100000)); const SEATS = 50;
const HOST = { id: 'dev_labhost00000', kind: 'host', label: 'pc', status: 'active' };
const devices = { hostId: HOST.id, get: (id) => (id === HOST.id ? HOST : null), list: () => [HOST] };
const ID = { id: 't', agent: 't', scopes: ['read', 'write'], paths: ['**'] };
const ctx = { identity: ID, client: 'bot2', device: HOST };
const body = 'lorem ipsum dolor '.repeat(19);
const T0 = Date.parse('2026-01-01T00:00:00Z');
const msg = (device, dseq, t, i) => ({ id: `${device.slice(4, 12)}-${dseq}`, dseq, ts: new Date(t).toISOString(), device, from: `bot${i % SEATS}@pc`, operator: false, to: 'all', type: i % 33 === 0 ? 'task' : i % 33 === 1 ? 'claim' : i % 40 === 2 ? 'verdict' : 'status', body, ref: i % 33 === 1 || i % 40 === 2 ? `x-${i - i % 33}` : null, project: null });
function room({ devicesN = 1 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-l3-'));
  for (const d of ['seats', 'pulse', 'log']) fs.mkdirSync(path.join(root, 'bus', d), { recursive: true });
  fs.writeFileSync(path.join(root, 'bus/operator.json'), '{"seat":null}');
  const at = new Date().toISOString();
  for (let i = 0; i < SEATS; i++) { const seat = `bot${i}@pc`; fs.writeFileSync(path.join(root, 'bus/seats', `bot${i}~pc.json`), JSON.stringify({ seat, client: `bot${i}`, device: HOST.id, device_kind: 'host', device_label: 'pc', project: null, created: at, joined: at, removed: null })); fs.writeFileSync(path.join(root, 'bus/pulse', `bot${i}~pc.json`), JSON.stringify({ seat, device: HOST.id, last_seen: at, beats: 1, read: { [HOST.id]: M }, read_extra: {} })); }
  const parts = Array.from({ length: devicesN }, () => []); const names = Array.from({ length: devicesN }, (_, d) => (d === 0 ? HOST.id : `dev_peer${String(d).padStart(8, '0')}`)); const dseq = new Array(devicesN).fill(0);
  for (let i = 1; i <= M; i++) { const d = i % devicesN; dseq[d]++; parts[d].push(JSON.stringify(msg(names[d], dseq[d], T0 + i * 1000, i))); }
  names.forEach((n, d) => { if (parts[d].length) fs.writeFileSync(path.join(root, 'bus/log', `${n}.jsonl`), `${parts[d].join('\n')}\n`); });
  return root;
}
const ms = (fn) => { const c = process.cpuUsage(); fn(); const u = process.cpuUsage(c); return (u.user + u.system) / 1000; };
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (a) => `${med(a).toFixed(1)} (${Math.min(...a).toFixed(1)} to ${Math.max(...a).toFixed(1)})`;

for (const impl of impls) {
  const { Bus } = await import(pathToFileURL(path.resolve(impl)).href);
  console.log(path.basename(impl));
  { const root = room(); const bus = new Bus({ root, devices }); bus.all(); const rounds = [];
    for (let i = 0; i < 5; i++) { fs.appendFileSync(path.join(root, 'bus/log/dev_peer0000099.jsonl'), `${JSON.stringify(msg('dev_peer0000099', i + 1, T0 + (M + i) * 1000, 7))}\n`); rounds.push(ms(() => bus.roster())); }
    console.log(`  foreign line then roster, cpu ms: ${fmt(rounds)}`); fs.rmSync(root, { recursive: true, force: true }); }
  for (const k of [1000, 20000]) { if (impl.includes('main') && k > 1000) continue; const root = room(); const lines = []; for (let i = 0; i < k; i++) lines.push(JSON.stringify(msg('dev_ahead0000000', i + 1, Date.now() + 86400e3 + i, i))); fs.writeFileSync(path.join(root, 'bus/log/dev_ahead0000000.jsonl'), `${lines.join('\n')}\n`);
    const bus = new Bus({ root, devices }); bus.all(); const rounds = []; for (let i = 0; i < 5; i++) rounds.push(ms(() => bus.send(ctx, { seat: 'bot2@pc', to: 'all', type: 'status', body: 'x' })));
    console.log(`  send landing before ${k} messages, cpu ms: ${fmt(rounds)}`); fs.rmSync(root, { recursive: true, force: true }); }
  { const m20 = 20000; const root = room(); const extra = []; for (let i = 2; i <= m20; i += 2) extra.push(i); const f = path.join(root, 'bus/pulse/bot7~pc.json'); const write = () => fs.writeFileSync(f, JSON.stringify({ seat: 'bot7@pc', device: HOST.id, last_seen: new Date().toISOString(), beats: 1, read: { [HOST.id]: 1 }, read_extra: { [HOST.id]: extra } })); write();
    const bus = new Bus({ root, devices }); bus.all(); const c7 = { identity: ID, client: 'bot7', device: HOST }; const rounds = []; for (let i = 0; i < 2; i++) { rounds.push(ms(() => bus.unread(c7, { seat: 'bot7@pc', peek: true, capped: true }))); }
    console.log(`  unread with ${extra.length} counters beyond a gap, cpu ms: ${fmt(rounds)}`); fs.rmSync(root, { recursive: true, force: true }); }
  { const root = room({ devicesN: 10 }); const bus = new Bus({ root, devices }); const first = ms(() => bus.all()); const again = []; for (let i = 0; i < 3; i++) { fs.appendFileSync(path.join(root, 'bus/log/dev_peer0000099.jsonl'), `${JSON.stringify(msg('dev_peer0000099', i + 1, T0 + (M + i) * 1000, 7))}\n`); again.push(ms(() => bus.roster())); }
    console.log(`  ten computers: first read ${first.toFixed(0)}, foreign line then roster ${fmt(again)}`); fs.rmSync(root, { recursive: true, force: true }); }
}

if (!impls.length) {
  // seq worked out on demand instead of a merged array: the sum over computers of the count before this key
  const N = 10; const per = Array.from({ length: N }, () => []);
  for (let i = 1; i <= M; i++) per[i % N].push({ ts: new Date(T0 + i * 1000).toISOString(), device: `d${i % N}`, dseq: per[i % N].length + 1 });
  const order = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.device < b.device ? -1 : a.device > b.device ? 1 : a.dseq - b.dseq);
  const sorts = []; for (let r = 0; r < 3; r++) sorts.push(ms(() => { const out = per.flat(); out.sort(order); for (let i = 0; i < out.length; i++) out[i].seq = i + 1; }));
  const rank = (m) => { let n = 0; for (const run of per) { let lo = 0; let hi = run.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (order(run[mid], m) < 0) lo = mid + 1; else hi = mid; } n += lo; } return n + 1; };
  const probe = per[3][per[3].length >> 1];
  const ranks = []; for (let r = 0; r < 3; r++) ranks.push(ms(() => { for (let i = 0; i < 1000; i++) rank(probe); }) / 1000);
  console.log(`rank: merged sort and number ${fmt(sorts)} ms; one seq on demand ${fmt(ranks.map((x) => x * 1000))} microseconds; agree ${rank(probe) === probe.seq}`);

  // columns: load and answer a roster's fold, reading only the bodies it shows
  const root = room(); const file = path.join(root, 'bus/log', `${HOST.id}.jsonl`); const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const table = new Map(); const idx = (s) => { const k = s === null ? '' : String(s); let i = table.get(k); if (i === undefined) { i = table.size; table.set(k, i); } return i; };
  const n = lines.length; const off = new Float64Array(n); const from = new Int32Array(n); const type = new Int32Array(n); const ref = new Int32Array(n); let o = 0;
  lines.forEach((l, i) => { const m = JSON.parse(l); off[i] = o; o += Buffer.byteLength(l) + 1; from[i] = idx(m.from); type[i] = idx(m.type); ref[i] = idx(m.ref); });
  const cols = Buffer.concat([off, from, type, ref].map((a) => Buffer.from(a.buffer))); const colFile = path.join(root, 'cols.bin'); fs.writeFileSync(colFile, cols); fs.writeFileSync(`${colFile}.json`, JSON.stringify([...table.keys()]));
  const seatIds = Array.from({ length: SEATS }, (_, i) => `bot${i}@pc`);
  const objects = []; for (let r = 0; r < 3; r++) objects.push(ms(() => { const ms2 = lines.map((l) => JSON.parse(l)); const last = new Map(); for (const m of ms2) last.set(m.from, m); void last; }));
  let shown = 0;
  const columns = []; for (let r = 0; r < 3; r++) columns.push(ms(() => {
    const b = fs.readFileSync(colFile); const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length); const t = JSON.parse(fs.readFileSync(`${colFile}.json`, 'utf8')); const id = new Map(t.map((s, i) => [s, i]));
    const of = new Float64Array(ab, 0, n); const fr = new Int32Array(ab, n * 8, n); const ty = new Int32Array(ab, n * 12, n); const re = new Int32Array(ab, n * 16, n);
    const lastAt = new Int32Array(t.length).fill(-1); const statusAt = new Int32Array(t.length).fill(-1); const verdict = new Uint8Array(t.length); const claimN = new Int32Array(t.length); const S = id.get('status'); const V = id.get('verdict'); const C = id.get('claim');
    for (let i = 0; i < n; i++) { lastAt[fr[i]] = i; if (ty[i] === S) statusAt[fr[i]] = i; else if (ty[i] === V) verdict[re[i]] = 1; }
    for (let i = 0; i < n; i++) if (ty[i] === C && !verdict[re[i]]) claimN[fr[i]]++;
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(8192); shown = 0;
    for (const s of seatIds) for (const at of [lastAt[id.get(s)], statusAt[id.get(s)]]) if (at >= 0) { const len = fs.readSync(fd, buf, 0, 8192, of[at]); const m = JSON.parse(buf.latin1Slice(0, buf.indexOf(10) < 0 ? len : buf.indexOf(10))); if (m.body) shown++; }
    fs.closeSync(fd);
  }));
  console.log(`columns: parse every line and fold ${fmt(objects)} ms; load columns, fold them, read back ${shown} bodies ${fmt(columns)} ms`);
  fs.rmSync(root, { recursive: true, force: true });
}
