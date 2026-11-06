// A computer's message file stops growing at SEGMENT_BYTES, because a blob over 100 MiB in history stops every later backup for
// good. The order, the counters and every answer stay what they were; a vault from before this reads unchanged, and a computer
// still on the code from before this reads the new files too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bus, SEGMENT_BYTES } from '../src/engine/bus.mjs';
import { Bus as OldBus } from './fixtures/bus-main-oracle.mjs';
import { lockstep } from './helpers/bus-lockstep.mjs';
import { newVault, cleanup } from './helpers/tmp.mjs';
after(cleanup);

const HOST = { id: 'dev_host00000000', kind: 'host', label: 'hostpc', status: 'active' };
const devices = { hostId: HOST.id, get: (id) => (id === HOST.id ? HOST : null), list: () => [HOST] };
const ID = { id: 't', agent: 't', scopes: ['read', 'write'], paths: ['**'] };
const ctx = { identity: ID, client: 'codex', device: HOST };
const room = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-rot-')); fs.mkdirSync(path.join(root, 'bus', 'log'), { recursive: true }); return root; };
const logs = (root) => fs.readdirSync(path.join(root, 'bus', 'log')).sort();
const size = (root, f) => fs.statSync(path.join(root, 'bus', 'log', f)).size;

test('the limit is under half of what the backup refuses, so two merged files still fit', () => {
  assert.ok(SEGMENT_BYTES * 2 + 2 * 24 * 1024 < 100 * 1048576);
});

test('a full file is left alone and the next message goes on in the next one, with the counter running on', () => {
  const root = room();
  const bus = new Bus({ root, devices, config: { segment_bytes: 2000 } });
  bus.ensure(HOST.id);
  const sent = []; for (let i = 0; i < 40; i++) sent.push(bus.send(ctx, { to: 'all', type: 'status', body: `message ${i} ${'x'.repeat(100)}` }));
  const files = logs(root);
  assert.ok(files.length > 3, `expected several files, got ${files}`);
  assert.equal(files.includes(`${HOST.id}.jsonl`), true, 'the first file keeps its old name');
  assert.ok(files.includes(`${HOST.id}.2.jsonl`));
  for (const f of files) assert.ok(size(root, f) < 2000 + 2 * 1024, `${f} is ${size(root, f)} bytes`);
  // the counter never repeats and never skips, and seq is the place in the order
  assert.deepEqual(bus.all().filter((m) => m.type === 'status').map((m) => m.body.split(' ')[1]), sent.map((_, i) => String(i)));
  const counters = bus.all().map((m) => m.dseq);
  assert.deepEqual(counters, counters.map((_, i) => i + 1));
  assert.deepEqual(bus.all().map((m) => m.seq), counters);
  // a restart finds the newest file and the counter
  const again = new Bus({ root, devices, config: { segment_bytes: 2000 } });
  const next = again.send(ctx, { to: 'all', type: 'status', body: 'after a restart' });
  assert.equal(next.dseq, counters.length + 1);
  assert.deepEqual(again.all(), new Bus({ root, devices, config: { segment_bytes: 2000 } }).all());
});

test('a full file that nothing can be read from does not reset the counter', () => {
  const root = room();
  const bus = new Bus({ root, devices, config: { segment_bytes: 500 } });
  bus.ensure(HOST.id);
  for (let i = 0; i < 12; i++) bus.send(ctx, { to: 'all', type: 'status', body: 'y'.repeat(100) });
  const high = logs(root).sort((a, b) => (Number(a.split('.')[1]) || 1) - (Number(b.split('.')[1]) || 1)).at(-1); const before = bus.all().at(-1).dseq;
  const kept = bus.all().filter((m) => !fs.readFileSync(path.join(root, 'bus/log', high), 'utf8').includes(`"id":"${m.id}"`)).at(-1).dseq;
  fs.writeFileSync(path.join(root, 'bus/log', high), 'not json\n');
  const after_ = new Bus({ root, devices, config: { segment_bytes: 500 } }).send(ctx, { to: 'all', type: 'status', body: 'z' });
  assert.ok(after_.dseq === kept + 1 && kept < before, `counter ${after_.dseq}, kept ${kept}`);
});

test('a vault in the old layout reads the same after the upgrade, and only new messages go in new files', () => {
  const root = room();
  const old = new OldBus({ root, devices });
  old.ensure(HOST.id);
  for (let i = 0; i < 30; i++) old.send(ctx, { to: 'all', type: i % 7 === 0 ? 'task' : 'status', body: `old ${i} ${'x'.repeat(80)}` });
  const flat = path.join(root, 'bus/log', `${HOST.id}.jsonl`); const frozen = fs.readFileSync(flat, 'utf8');
  const before = { all: old.all(), roster: old.roster({ at: 1 }), tasks: old.tasks(ctx) };
  const bus = new Bus({ root, devices, config: { segment_bytes: 1000 } });
  assert.deepEqual(bus.all(), before.all);
  assert.deepEqual(bus.roster({ at: 1 }), before.roster);
  assert.deepEqual(bus.tasks(ctx), before.tasks);
  const m = bus.send(ctx, { to: 'all', type: 'status', body: 'first after the upgrade' });
  assert.equal(m.dseq, before.all.length + 1);
  assert.equal(fs.readFileSync(flat, 'utf8'), frozen, 'an old file over the limit is not rewritten');
  assert.deepEqual(logs(root), [`${HOST.id}.2.jsonl`, `${HOST.id}.jsonl`]);
});

test('a computer still on the old code reads every message in the new files', () => {
  const root = room();
  const bus = new Bus({ root, devices, config: { segment_bytes: 800 } });
  bus.ensure(HOST.id);
  for (let i = 0; i < 25; i++) bus.send(ctx, { to: 'all', type: 'status', body: `new ${i} ${'x'.repeat(80)}` });
  assert.ok(logs(root).length > 2);
  const old = new OldBus({ root, devices });
  assert.deepEqual(old.all(), bus.all());
  assert.deepEqual(old.roster({ at: 1 }), bus.roster({ at: 1 }));
});

test('every answer matches the reference while the files roll over on random histories', async () => {
  let ran = 0;
  for (let seed = 201; seed <= 212; seed++) {
    const diff = await lockstep({ A: Bus, B: OldBus, seed, steps: 120, compareLog: 'lines', optionsA: { segment_bytes: 700 }, skipHalfLine: true });
    assert.equal(diff, null, diff || '');
    ran++;
  }
  assert.equal(ran, 12);
});

test('in a real vault the next file is committed with the vault', async () => {
  const { v, root } = newVault();
  try {
    v.bus.segmentBytes = 600;
    const host = v.devices.get(v.devices.hostId);
    const c = { identity: ID, client: 'codex', device: host };
    for (let i = 0; i < 10; i++) v.bus.send(c, { to: 'all', type: 'status', body: 'x'.repeat(120) });
    assert.ok(fs.existsSync(path.join(root, 'bus/log', `${host.id}.2.jsonl`)));
    await v.commits?.flush?.();
    v.close?.();
    const { spawnSync } = await import('node:child_process');
    const tracked = spawnSync('git', ['-C', root, 'ls-files', 'bus/log'], { encoding: 'utf8' }).stdout;
    assert.match(tracked, new RegExp(`${host.id}\\.2\\.jsonl`));
  } finally { v.close?.(); }
});
