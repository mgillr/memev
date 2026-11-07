// SO-N-15: what the desktop app needs to follow the bus as a viewer. `bus since --from/--to` filters without marking anything read,
// `bus unread --peek` (peek and quiet) changes no presence and answers no comms check, and `runner status --days N` counts runs per day.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bus } from '../src/engine/bus.mjs';
import { filterMessages } from '../src/cli/bus-cli.mjs';
import { runsByDay } from '../src/cli/runner.mjs';

const device = { id: 'dev_viewerhost00', kind: 'host', label: 'box', status: 'active' };
const devices = { hostId: device.id, get: (id) => (id === device.id ? device : null), list: () => [device] };
const ID = { id: 't', agent: 't', scopes: ['read', 'write'], paths: ['**'] };
const ctxOf = (client) => ({ identity: ID, client, device });
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-viewer-')); dirs.push(root);
  for (const d of ['seats', 'pulse', 'log']) fs.mkdirSync(path.join(root, 'bus', d), { recursive: true });
  fs.writeFileSync(path.join(root, 'bus/operator.json'), JSON.stringify({ seat: null, set: null }));
  const at = '2026-01-01T00:00:00.000Z';
  for (const n of ['alpha', 'beta']) {
    fs.writeFileSync(path.join(root, 'bus/seats', `${n}~box.json`), JSON.stringify({ seat: `${n}@box`, client: n, device: device.id, device_kind: 'host', device_label: 'box', project: null, created: at, joined: at, removed: null }));
    fs.writeFileSync(path.join(root, 'bus/pulse', `${n}~box.json`), JSON.stringify({ seat: `${n}@box`, device: device.id, last_seen: at, beats: 1, read: {}, read_extra: {}, seen_seq: 0, seen_dseq: {} }));
  }
  const lines = [
    { id: 'viewerho-1', dseq: 1, ts: at, device: device.id, from: 'alpha@box', operator: false, to: 'beta@box', type: 'status', body: 'one', ref: null, project: null },
    { id: 'viewerho-2', dseq: 2, ts: at, device: device.id, from: 'alpha@box', operator: false, to: 'beta@box', type: 'question', body: 'are you there', ref: null, project: null, check: true },
  ];
  fs.writeFileSync(path.join(root, 'bus/log', `${device.id}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return root;
}
const pulseOf = (root, n) => fs.readFileSync(path.join(root, 'bus/pulse', `${n}~box.json`), 'utf8');
const logOf = (root) => fs.readFileSync(path.join(root, 'bus/log', `${device.id}.jsonl`), 'utf8');

test('unread with peek and quiet shows the messages and changes no presence, no read position and no log', () => {
  const root = fixture();
  const bus = new Bus({ root, devices });
  const before = pulseOf(root, 'beta'); const log = logOf(root);
  const r = bus.unread(ctxOf('beta'), { seat: 'beta@box', peek: true, quiet: true, capped: true });
  assert.equal(r.messages.length, 2);
  assert.deepEqual(r.acked, []);
  assert.equal(pulseOf(root, 'beta'), before, 'the pulse file changed');
  assert.equal(logOf(root), log, 'a comms check was answered');
  assert.equal(bus.unread(ctxOf('beta'), { seat: 'beta@box', peek: true, quiet: true, capped: true }).messages.length, 2, 'messages were marked read');
});

test('unread with peek alone still records presence and answers a comms check, as before', () => {
  const root = fixture();
  const bus = new Bus({ root, devices });
  const before = pulseOf(root, 'beta');
  const r = bus.unread(ctxOf('beta'), { seat: 'beta@box', peek: true, capped: true });
  assert.notEqual(pulseOf(root, 'beta'), before);
  assert.deepEqual(r.acked, ['viewerho-2']);
});

test('filterMessages keeps one sender, one recipient, or both; a message to all is to every seat', () => {
  const ms = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a,c' }, { from: 'c', to: 'all' }];
  assert.deepEqual(filterMessages(ms, { from: 'a' }), [ms[0]]);
  assert.deepEqual(filterMessages(ms, { to: 'c' }), [ms[1], ms[2]]);
  assert.deepEqual(filterMessages(ms, { from: 'b', to: 'a' }), [ms[1]]);
  assert.deepEqual(filterMessages(ms, {}), ms);
});

test('runsByDay counts the kept run times per UTC day, oldest first, with empty days', () => {
  const e = { runs: ['2026-11-05T09:00:00Z', '2026-11-07T01:00:00Z', '2026-11-07T23:59:00Z', '2026-10-01T00:00:00Z'] };
  assert.deepEqual(runsByDay(e, 3, new Date('2026-11-07T12:00:00Z')), [{ day: '2026-11-05', runs: 1 }, { day: '2026-11-06', runs: 0 }, { day: '2026-11-07', runs: 2 }]);
  assert.equal(runsByDay({}, 2, new Date('2026-11-07T12:00:00Z')).length, 2);
});
