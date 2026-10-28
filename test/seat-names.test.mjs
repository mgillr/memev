// Seat names use the short machine name and can be renamed; older '@host' seats keep working.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { Bus, fileOf } from '../src/engine/bus.mjs';
import { writeJson } from '../src/engine/util.mjs';

after(cleanup);

test('MEM-094 AC01: new seats use the short machine name, not host', () => {
  const saved = process.env.MEMEV_MACHINE_NAME;
  process.env.MEMEV_MACHINE_NAME = 'my-laptop';
  try {
    const { v, root } = newVault();
    const host = v.devices.get(v.devices.hostId);
    assert.equal(host.label, 'my-laptop', 'host device label is the machine name');
    const bus = new Bus({ root, devices: v.devices });
    const rec = bus.register({ client: 'my-app', device: host });
    assert.equal(rec.seat, 'my-app@my-laptop', 'seat uses the machine name');
    assert.notEqual(rec.seat, 'my-app@host', 'seat does not use the old host word');
    const found = bus.seat('my-app@my-laptop');
    assert.ok(found, 'seat is found by its machine-name');
    v.close();
  } finally {
    if (saved === undefined) delete process.env.MEMEV_MACHINE_NAME;
    else process.env.MEMEV_MACHINE_NAME = saved;
  }
});

test('MEM-094 AC02: rename keeps history and the old name still finds the seat', () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const bus = new Bus({ root, devices: v.devices });
    const rec = bus.register({ client: 'my-app', device: host });
    assert.equal(rec.seat, 'my-app@host');
    const renamed = bus.renameSeat('my-app@host', 'my-app@my-laptop');
    assert.equal(renamed.seat, 'my-app@my-laptop');
    assert.deepEqual(renamed.renamed_from, ['my-app@host']);
    const byOld = bus.seat('my-app@host');
    assert.ok(byOld, 'old name still resolves');
    assert.equal(byOld.seat, 'my-app@my-laptop', 'old name finds the renamed seat');
    const byNew = bus.seat('my-app@my-laptop');
    assert.ok(byNew, 'new name resolves');
    assert.equal(byNew.seat, 'my-app@my-laptop');
    const seats = bus.seats();
    assert.equal(seats.length, 1, 'only one seat record exists');
    assert.equal(seats[0].seat, 'my-app@my-laptop');
    v.close();
  } finally {
    v.close();
  }
});

test('MEM-094 AC03: existing @host seats keep working on a machine with a different name', () => {
  const saved = process.env.MEMEV_MACHINE_NAME;
  process.env.MEMEV_MACHINE_NAME = 'my-laptop';
  try {
    const { v, root } = newVault();
    const host = v.devices.get(v.devices.hostId);
    assert.equal(host.label, 'my-laptop');
    const bus = new Bus({ root, devices: v.devices });
    const legacyName = 'my-app@host';
    const seatsDir = path.join(root, 'bus', 'seats');
    fs.mkdirSync(seatsDir, { recursive: true });
    const legacy = { seat: legacyName, client: 'my-app', device: host.id, device_kind: 'host', device_label: 'host', project: null, created: new Date().toISOString(), joined: null, removed: null };
    writeJson(path.join(seatsDir, `${fileOf(legacyName)}.json`), legacy);
    const found = bus.seat(legacyName);
    assert.ok(found, 'legacy @host seat is found');
    assert.equal(found.seat, legacyName);
    const own = bus.ownSeatName('my-app', host);
    assert.equal(own, legacyName, 'ownSeatName falls back to the existing @host seat');
    const rec = bus.register({ client: 'my-app', device: host });
    assert.equal(rec.seat, legacyName, 'register reuses the existing @host seat');
    v.close();
  } finally {
    if (saved === undefined) delete process.env.MEMEV_MACHINE_NAME;
    else process.env.MEMEV_MACHINE_NAME = saved;
  }
});

const ID = { scopes: ['read', 'write'], paths: ['**'] };

test('MEM-094-FIX: two computers with the same short name each get their own seat, and the second posts as <app>@<machine>-2', () => {
  const saved = process.env.MEMEV_MACHINE_NAME;
  process.env.MEMEV_MACHINE_NAME = 'macbook-pro';
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const other = v.devices._add({ kind: 'remote-computer', label: 'MacBook-Pro' });
    const bus = new Bus({ root, devices: v.devices });
    const a = bus.register({ client: 'claude-code', device: host });
    const b = bus.register({ client: 'claude-code', device: other });
    assert.deepEqual([a.seat, a.device], ['claude-code@macbook-pro', host.id]);
    assert.deepEqual([b.seat, b.device], ['claude-code@macbook-pro-2', other.id], 'the second computer gets a numbered seat of its own');
    assert.equal(bus.register({ client: 'claude-code', device: other }).seat, 'claude-code@macbook-pro-2', 'and keeps it');
    assert.equal(bus.send({ identity: ID, client: 'claude-code', device: other }, { type: 'status', body: 'from the other computer' }).from, 'claude-code@macbook-pro-2');
    assert.equal(bus.send({ identity: ID, client: 'claude-code', device: host }, { type: 'status', body: 'from the vault computer' }).from, 'claude-code@macbook-pro');
    assert.throws(() => bus.register({ client: 'claude-code', device: other, seat: 'claude-code@macbook-pro' }), /belongs to another computer/);
  } finally {
    v.close();
    if (saved === undefined) delete process.env.MEMEV_MACHINE_NAME;
    else process.env.MEMEV_MACHINE_NAME = saved;
  }
});

test('MEM-094-FIX: after a rename, messages sent to the old name still reach the seat, and the lead moves to the new name', () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const bus = new Bus({ root, devices: v.devices });
    bus.register({ client: 'my-app', device: host });
    bus.register({ client: 'other-app', device: host });
    writeJson(path.join(root, 'bus', 'operator.json'), { seat: 'my-app@host', set: null });
    const task = bus.send({ identity: ID, client: 'other-app', device: host }, { to: 'my-app@host', type: 'task', body: 'sent before the rename' });
    bus.send({ identity: ID, client: 'my-app', device: host }, { type: 'claim', ref: task.id, body: 'claimed before the rename' });
    bus.renameSeat('my-app@host', 'my-app@my-laptop');
    assert.equal(bus.operator(), 'my-app@my-laptop', 'the lead follows the rename');
    const inbox = bus.unread({ identity: ID, client: 'my-app', device: host });
    assert.equal(inbox.seat, 'my-app@my-laptop');
    assert.ok(inbox.messages.some((m) => m.body === 'sent before the rename'), JSON.stringify(inbox.messages.map((m) => m.body)));
    assert.deepEqual(bus.unread({ identity: ID, client: 'my-app', device: host }).messages, [], 'and it is marked read');
    const row = bus.roster().seats.find((r) => r.seat === 'my-app@my-laptop');
    assert.deepEqual(row?.claims, [task.id], 'the roster counts the claim made under the old name as the seat\'s own');
  } finally { v.close(); }
});
