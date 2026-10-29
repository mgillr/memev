// Renaming a computer keeps its seats, tasks and lead: the device rename drives renameSeat.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { Bus } from '../src/engine/bus.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { writeJson } from '../src/engine/util.mjs';

after(cleanup);

const ID = { scopes: ['read', 'write'], paths: ['**'] };

test('REV-010 AC01: renaming the host device renames every seat on that computer through renameSeat, and each renamed seat lists its old name in renamed_from', () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const bus = new Bus({ root, devices: v.devices });
    bus.register({ client: 'my-app', device: host });
    bus.register({ client: 'other-app', device: host });
    assert.equal(bus.seats().length, 2);
    v.devices.rename(host.id, 'my-laptop');
    const moved = bus.renameDeviceSeats(host.id);
    assert.equal(moved.length, 2, 'two seats were moved');
    const seats = bus.seats();
    assert.equal(seats.length, 2, 'still two seat records');
    for (const s of seats) {
      assert.ok(s.renamed_from && s.renamed_from.length >= 1, `seat ${s.seat} has renamed_from`);
      const app = s.client;
      assert.ok(s.renamed_from.includes(`${app}@host`), `seat ${s.seat} lists its old name ${app}@host`);
    }
    const myApp = seats.find((s) => s.client === 'my-app');
    assert.equal(myApp.seat, 'my-app@my-laptop');
    const otherApp = seats.find((s) => s.client === 'other-app');
    assert.equal(otherApp.seat, 'other-app@my-laptop');
    v.close();
  } finally { v.close(); }
});

test('REV-010 AC02: a task sent to a seat\'s old name before the rename is delivered to the renamed seat once, and earlier broadcasts are not delivered again', () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const bus = new Bus({ root, devices: v.devices });
    bus.register({ client: 'my-app', device: host });
    bus.register({ client: 'other-app', device: host });
    bus.send({ identity: ID, client: 'other-app', device: host }, { to: 'all', type: 'status', body: 'broadcast before rename' });
    const first = bus.unread({ identity: ID, client: 'my-app', device: host });
    assert.ok(first.messages.some((m) => m.body === 'broadcast before rename'), 'broadcast was read');
    bus.send({ identity: ID, client: 'other-app', device: host }, { to: 'my-app@host', type: 'task', body: 'task sent to old name' });
    v.devices.rename(host.id, 'my-laptop');
    bus.renameDeviceSeats(host.id);
    const inbox = bus.unread({ identity: ID, client: 'my-app', device: host });
    assert.equal(inbox.seat, 'my-app@my-laptop');
    const tasks = inbox.messages.filter((m) => m.type === 'task');
    assert.equal(tasks.length, 1, 'task delivered once');
    assert.equal(tasks[0].body, 'task sent to old name');
    const reBroadcasts = inbox.messages.filter((m) => m.body === 'broadcast before rename');
    assert.equal(reBroadcasts.length, 0, 'earlier broadcast not delivered again');
    v.close();
  } finally { v.close(); }
});

test('REV-010 AC03: the lead survives the rename: the app that was operator resolves as operator afterwards, and bus watch of the old seat name is accepted on this computer', () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const bus = new Bus({ root, devices: v.devices });
    bus.register({ client: 'my-app', device: host });
    bus.register({ client: 'other-app', device: host });
    bus.setOperator('my-app@host');
    assert.equal(bus.operator(), 'my-app@host');
    v.devices.rename(host.id, 'my-laptop');
    bus.renameDeviceSeats(host.id);
    assert.equal(bus.operator(), 'my-app@my-laptop', 'the lead follows the rename');
    const resolved = bus.resolve({ identity: ID, client: 'my-app', device: host, cli: true, local: true }, { seat: 'my-app@host' });
    assert.equal(resolved.seat, 'my-app@my-laptop', 'bus watch of the old name resolves to the renamed seat');
    v.close();
  } finally { v.close(); }
});

test('REV-010: renaming a host to another computer\'s label moves every seat, taking -2 where the name is held, and the lead follows', () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const bus = new Bus({ root, devices: v.devices });
    bus.register({ client: 'aider', device: host });
    bus.register({ client: 'claude-code', device: host });
    bus.setOperator('claude-code@host');
    const k = deviceKeygen();
    const remote = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'desk', pubkey: k.publicKey, policy: { can_enroll: true } });
    bus.register({ client: 'claude-code', device: remote.device });
    assert.equal(bus.seats().length, 3, 'two host seats plus the remote seat');
    assert.equal(bus.seat('claude-code@desk').device, remote.device.id, 'the remote computer holds claude-code@desk');
    v.devices.rename(host.id, 'desk');
    const moved = bus.renameDeviceSeats(host.id);
    assert.equal(moved.length, 2, 'both host seats moved, no error');
    const seats = bus.seats();
    assert.equal(seats.length, 3, 'still three seat records');
    assert.deepEqual(seats.map((s) => s.seat).sort(), ['aider@desk', 'claude-code@desk', 'claude-code@desk-2']);
    const lead = seats.find((s) => s.client === 'claude-code' && s.device === host.id);
    assert.equal(lead.seat, 'claude-code@desk-2', 'the host seat took -2 because the remote holds the plain name');
    assert.ok(lead.renamed_from.includes('claude-code@host'), 'the host lead lists its old name');
    assert.equal(bus.operator(), 'claude-code@desk-2', 'the lead follows the rename');
    assert.equal(seats.find((s) => s.device === remote.device.id).seat, 'claude-code@desk', 'the remote seat is untouched');
    v.close();
  } finally { v.close(); }
});
