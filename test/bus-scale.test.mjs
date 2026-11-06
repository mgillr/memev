// SR-1.17: a bus that scales to a team. 50 seats and 100,000 messages: roster under 50 ms. Time on a shared machine is noisy, so
// the time limit reads the median, and what makes it true is pinned by counting: after the first read, nothing rereads a message
// file, and the work of a call does not follow the number of messages on the bus.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Bus } from '../src/engine/bus.mjs';

const device = { id: 'dev_scalehost000', kind: 'host', label: 'fleet', status: 'active' };
const devices = { hostId: device.id, get: (id) => (id === device.id ? device : null), list: () => [device] };
const ID = { id: 't', agent: 't', scopes: ['read', 'write'], paths: ['**'] };
const ctxOf = (n) => ({ identity: ID, client: `bot${n}`, device });
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function fixture(messages, seats = 50) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-scale-')); dirs.push(root);
  for (const d of ['seats', 'pulse', 'log']) fs.mkdirSync(path.join(root, 'bus', d), { recursive: true });
  fs.writeFileSync(path.join(root, 'bus/operator.json'), JSON.stringify({ seat: null, set: null }));
  const at = new Date().toISOString();
  for (let i = 0; i < seats; i++) {
    const seat = `bot${i}@fleet`;
    fs.writeFileSync(path.join(root, 'bus/seats', `bot${i}~fleet.json`), JSON.stringify({ seat, client: `bot${i}`, device: device.id, device_kind: 'host', device_label: 'fleet', project: null, created: at, joined: at, removed: null }));
    fs.writeFileSync(path.join(root, 'bus/pulse', `bot${i}~fleet.json`), JSON.stringify({ seat, device: device.id, last_seen: at, beats: 1, read: { [device.id]: messages }, read_extra: {}, seen_seq: messages, seen_dseq: { [device.id]: messages } }));
  }
  const tasks = []; const start = Date.parse('2026-01-01T00:00:00Z'); const parts = [];
  for (let i = 1; i <= messages; i++) {
    const roll = i % 100; const type = roll < 3 ? 'task' : roll < 6 ? 'claim' : roll < 8 ? 'verdict' : roll < 30 ? 'ack' : 'status';
    const id = `scalehos-${i}`; if (type === 'task') tasks.push(id);
    const ref = type === 'claim' || type === 'verdict' ? tasks[i % tasks.length] ?? null : null;
    parts.push(JSON.stringify({ id, dseq: i, ts: new Date(start + i * 1000).toISOString(), device: device.id, from: `bot${i % seats}@fleet`, operator: false, to: type === 'task' ? `bot${(i + 1) % seats}@fleet` : 'all', type, body: 'word '.repeat(70), ref, project: null }));
  }
  fs.writeFileSync(path.join(root, 'bus/log', `${device.id}.jsonl`), `${parts.join('\n')}\n`);
  return root;
}
const median = (fn, n) => { const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); fn(); t.push(performance.now() - s); } t.sort((a, b) => a - b); return t[Math.floor(n / 2)]; };

test('50 seats and 100,000 messages: roster under 50 ms', () => {
  const bus = new Bus({ root: fixture(100000), devices });
  assert.equal(bus.all().length, 100000);
  const ms = median(() => bus.roster(), 9);
  console.log(`roster median ${ms.toFixed(1)} ms; ${os.cpus().length} cpus, ${os.cpus()[0]?.model}, load ${os.loadavg()[0].toFixed(1)}`);
  assert.equal(bus.roster().seats.length, 50);
  assert.ok(ms < 50, `roster took ${ms.toFixed(1)} ms`);
});

test('nothing rereads a message file after the first read, and a send does not read it either', () => {
  const root = fixture(3000); const bus = new Bus({ root, devices }); const logDir = path.join(root, 'bus', 'log');
  bus.all();
  const reads = []; const real = fs.readFileSync;
  fs.readFileSync = function counted(f, ...rest) { if (String(f).startsWith(logDir)) reads.push(f); return real.call(this, f, ...rest); };
  try {
    const before = bus.all().length;
    for (let i = 0; i < 5; i++) {
      bus.send(ctxOf(2), { seat: 'bot2@fleet', to: 'all', type: 'status', body: `one more ${i}` });
      bus.roster(); bus.tasks(ctxOf(2)); bus.unread(ctxOf(3), { seat: 'bot3@fleet', capped: true }); bus.since(ctxOf(2), { seat: 'bot2@fleet', seq: 0, limit: 5 }); bus.tail(ctxOf(2), { seat: 'bot2@fleet' });
    }
    assert.equal(bus.all().length, before + 5, 'the new messages are all there');
  } finally { fs.readFileSync = real; }
  assert.deepEqual(reads, []);
  // and the file did not change behind what memory says
  assert.deepEqual(bus.all(), new Bus({ root, devices }).all());
});

test('a line another process added is seen at once, and so is a rewrite', () => {
  const root = fixture(200); const bus = new Bus({ root, devices }); const f = path.join(root, 'bus/log', `${device.id}.jsonl`);
  assert.equal(bus.all().length, 200);
  fs.appendFileSync(f, `${JSON.stringify({ id: 'scalehos-201', dseq: 201, ts: '2027-01-01T00:00:00.000Z', device: device.id, from: 'bot1@fleet', operator: false, to: 'all', type: 'status', body: 'from elsewhere', ref: null, project: null })}\n`);
  assert.equal(bus.all().at(-1).body, 'from elsewhere');
  assert.equal(bus.tail(ctxOf(2), { seat: 'bot2@fleet', n: 1 }).messages[0].body, 'from elsewhere');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').slice(0, 10).join('\n') + '\n');
  assert.equal(bus.all().length, 10);
  assert.equal(bus.since(ctxOf(2), { seat: 'bot2@fleet', seq: 0, limit: 50 }).messages.length, 10);
});

test('another writer getting in just before an append is seen, not papered over', () => {
  const root = fixture(20); const bus = new Bus({ root, devices }); const f = path.join(root, 'bus/log', `${device.id}.jsonl`);
  bus.all();
  const line = `${JSON.stringify({ id: 'scalehos-999', dseq: 999, ts: '2026-01-01T00:00:00.500Z', device: device.id, from: 'bot1@fleet', operator: false, to: 'all', type: 'status', body: 'the other writer', ref: null, project: null })}\n`;
  const real = fs.appendFileSync; let once = true;
  fs.appendFileSync = function racing(file, data, ...rest) { if (once && String(file) === f) { once = false; real.call(this, file, line); } return real.call(this, file, data, ...rest); };
  try { bus.send(ctxOf(2), { seat: 'bot2@fleet', to: 'all', type: 'status', body: 'mine' }); } finally { fs.appendFileSync = real; }
  assert.deepEqual(bus.all(), new Bus({ root, devices }).all());
  assert.ok(bus.all().some((m) => m.body === 'the other writer'));
});

test('what the bus hands out is the caller\'s own: changing it changes nothing inside', () => {
  const root = fixture(50); const bus = new Bus({ root, devices }); const ctx = ctxOf(2);
  for (const list of [bus.all(), bus.tail(ctx, { seat: 'bot2@fleet', n: 5 }).messages, bus.since(ctx, { seat: 'bot2@fleet', seq: 0, limit: 5 }).messages]) { list[0].body = 'changed'; list[0].seq = -1; list.length = 0; }
  const m = bus.send(ctx, { seat: 'bot2@fleet', to: 'all', type: 'status', body: 'x' }); m.body = 'changed';
  assert.deepEqual(bus.all(), new Bus({ root, devices }).all());
});

test('unread does not mark or show by testing every message against every read counter', () => {
  // a seat that reads capped keeps its read counters beyond a gap; the old per-message copy of them made this quadratic
  const root = fixture(20000); const bus = new Bus({ root, devices });
  const extra = []; for (let i = 2; i <= 19000; i += 2) extra.push(i);
  fs.writeFileSync(path.join(root, 'bus/pulse/bot7~fleet.json'), JSON.stringify({ seat: 'bot7@fleet', device: device.id, last_seen: new Date().toISOString(), beats: 1, read: { [device.id]: 1 }, read_extra: { [device.id]: extra } }));
  bus.all();
  const ms = median(() => bus.unread(ctxOf(7), { seat: 'bot7@fleet', peek: true, capped: true }), 3);
  console.log(`unread with ${extra.length} read counters beyond a gap: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000, `unread took ${ms.toFixed(1)} ms`);
});
