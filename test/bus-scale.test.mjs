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

test('lines from another computer go in without sorting the bus again', () => {
  const root = fixture(2000); const bus = new Bus({ root, devices }); const peer = path.join(root, 'bus/log/dev_peer00000000.jsonl');
  const line = (n, t) => `${JSON.stringify({ id: `peer0000-${n}`, dseq: n, ts: new Date(Date.parse('2026-01-01T00:00:00Z') + t).toISOString(), device: 'dev_peer00000000', from: 'bot1@fleet', operator: false, to: 'all', type: 'status', body: `peer ${n}`, ref: null, project: null })}\n`;
  bus.all();
  // a new file, and growth of a file this process has only read once, which has no digest yet
  fs.writeFileSync(peer, line(1, 500));
  assert.deepEqual(bus.all(), new Bus({ root, devices }).all());
  const realSort = Array.prototype.sort; let sorts = 0;
  Array.prototype.sort = function counted(...a) { if (this.length > 1000) sorts++; return realSort.apply(this, a); };
  try {
    for (let n = 2; n < 8; n++) { fs.appendFileSync(peer, line(n, n * 700)); const got = bus.roster({ at: 1 }); assert.equal(got.seats.length, 50); assert.equal(bus.all().find((m) => m.id === `peer0000-${n}`).body, `peer ${n}`); }
  } finally { Array.prototype.sort = realSort; }
  assert.equal(sorts, 0, 'the whole bus was sorted again');
  assert.deepEqual(bus.all(), new Bus({ root, devices }).all());
  // a file that was rewritten, longer than before, is read again whole
  const text = fs.readFileSync(peer, 'utf8').trim().split('\n'); fs.writeFileSync(peer, `${[...text].reverse().join('\n')}\n${line(9, 90)}`);
  assert.deepEqual(bus.all(), new Bus({ root, devices }).all());
  assert.equal(bus.health({ at: 1 }).bad_lines, 0);
});

test('on one computer whose times do not follow its counters, unread is still in bus order', () => {
  const root = fixture(0); const bus = new Bus({ root, devices }); const f = path.join(root, 'bus/log', `${device.id}.jsonl`);
  const at = (n, t) => JSON.stringify({ id: `scalehos-${n}`, dseq: n, ts: `2026-01-01T00:00:0${t}.000Z`, device: device.id, from: 'bot1@fleet', operator: false, to: 'all', type: 'status', body: `m${n}`, ref: null, project: null });
  fs.writeFileSync(f, `${[at(1, 5), at(2, 3), at(3, 9), at(4, 1)].join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'bus/pulse/bot2~fleet.json'), JSON.stringify({ seat: 'bot2@fleet', device: device.id, read: {} }));
  const got = bus.unread(ctxOf(2), { seat: 'bot2@fleet', peek: true }).messages;
  assert.deepEqual(got.map((m) => m.body), ['m4', 'm2', 'm1', 'm3']);
  assert.deepEqual(got.map((m) => m.seq), [1, 2, 3, 4]);
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

test('warm does the first read in slices, and a call after it reads no file', async () => {
  const root = fixture(6000); const bus = new Bus({ root, devices }); const logDir = path.join(root, 'bus', 'log');
  let turns = 0; let on = true; const tick = () => { turns++; if (on) setImmediate(tick); }; setImmediate(tick);
  await bus.warm({ sliceMs: 1 }); on = false;
  assert.ok(turns >= 5, `the thread got ${turns} turns during the read`);
  const reads = []; const real = fs.readFileSync;
  fs.readFileSync = function counted(p, ...rest) { if (String(p).startsWith(logDir)) reads.push(p); return real.call(this, p, ...rest); };
  let got; try { got = bus.all(); } finally { fs.readFileSync = real; }
  assert.deepEqual(reads, []);
  assert.deepEqual(got, new Bus({ root, devices }).all());
});

test('anything that happens during warm stands: a read, a send, a foreign line, a rewrite, in any slice', async () => {
  const f = (root) => path.join(root, 'bus/log', `${device.id}.jsonl`);
  const events = {
    read: (bus) => bus.all(),
    roster: (bus) => bus.roster(),
    send: (bus) => bus.send(ctxOf(2), { seat: 'bot2@fleet', to: 'all', type: 'status', body: 'during warm' }),
    'send then a late message': (bus, root) => { bus.send(ctxOf(2), { seat: 'bot2@fleet', to: 'all', type: 'status', body: 'during warm' }); fs.appendFileSync(path.join(root, 'bus/log/dev_late00000000.jsonl'), `${JSON.stringify({ id: 'late0000-1', dseq: 1, ts: '2026-01-01T00:00:03.500Z', device: 'dev_late00000000', from: 'bot1@fleet', operator: false, to: 'all', type: 'status', body: 'late', ref: null, project: null })}\n`); bus.send(ctxOf(2), { seat: 'bot2@fleet', to: 'all', type: 'status', body: 'after late' }); },
    foreign: (bus, root) => fs.appendFileSync(f(root), `${JSON.stringify({ id: 'x-9', dseq: 90000, ts: '2026-01-01T00:00:01.500Z', device: device.id, from: 'bot1@fleet', operator: false, to: 'all', type: 'status', body: 'foreign', ref: null, project: null })}\n`),
    rewrite: (bus, root) => fs.writeFileSync(f(root), `${fs.readFileSync(f(root), 'utf8').split('\n').slice(0, 50).join('\n')}\n`),
  };
  let ran = 0;
  for (const [name, act] of Object.entries(events)) for (const after of [0, 1, 2, 3, 5, 9, 15, 30]) {
    const root = fixture(2500); const bus = new Bus({ root, devices });
    let turn = 0; const done = bus.warm({ sliceMs: 0.2 });
    await new Promise((res) => { const go = () => { if (turn++ === after) { act(bus, root); res(); } else setImmediate(go); }; setImmediate(go); });
    await done;
    const fresh = new Bus({ root, devices });
    assert.deepEqual(bus.all(), fresh.all(), `${name} after ${after} turns`);
    assert.deepEqual(bus.roster({ at: 1 }), fresh.roster({ at: 1 }), `${name} after ${after} turns`);
    fs.rmSync(root, { recursive: true, force: true }); ran++;
  }
  assert.equal(ran, 48);
});
