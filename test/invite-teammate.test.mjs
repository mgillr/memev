// Teammate invites: a colleague's computer joins under their name, and their apps' seats read
// <app>@<name>-<machine> on the shared roster. Teammate invites need the Team entitlement;
// without it the command prints the plan line and no code.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { mintInvite, redeemInvite, deviceKeygen } from '../src/engine/devices.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { Bus } from '../src/engine/bus.mjs';

after(() => cleanup());

const teamLic = { state: 'valid', tier: 'team', services: ['sync', 'backup', 'relay', 'team'], seats: 5, exp: '2027-12-31', days_left: 400 };

test('MEM-069 AC01: a teammate invite on a Team licence enrolls the colleague and their seats appear in the roster under their name', () => {
  const { root, v } = newVault();
  try {
    const policy = () => seatPolicy({ license: teamLic, devices: v.devices.list() });
    const minted = mintInvite(root, { address: 'http://127.0.0.1:9', ttlSec: 600, teammate: 'sam' });
    const row = JSON.parse(fs.readFileSync(path.join(root, '.memev', 'invites.json'), 'utf8')).invites[minted.id];
    assert.equal(row.teammate, 'sam');
    const { device } = redeemInvite(root, { code: minted.code, pubkey: deviceKeygen().publicKey, label: 'laptop', tokens: v.tokens, policy: policy() });
    v.devices.fresh();
    assert.equal(device.kind, 'remote-computer');
    assert.equal(device.label, 'sam-laptop');
    assert.equal(device.teammate, 'sam');
    const bus = new Bus({ root, devices: v.devices });
    const seat = bus.register({ client: 'cursor', device });
    assert.equal(seat.seat, 'cursor@sam-laptop');
    const r = bus.roster();
    const row2 = r.seats.find((s) => s.seat === 'cursor@sam-laptop');
    assert.ok(row2, JSON.stringify(r.seats, null, 1));
    assert.equal(row2.device_label, 'sam-laptop');
    assert.equal(row2.teammate, 'sam');
  } finally { v.close(); }
});

test('MEM-069 AC02: a teammate invite without Team prints the plan line and no code', () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const inv = sb.run(['invite', '--teammate', 'sam']);
    assert.equal(inv.code, 0, inv.err + inv.out);
    assert.match(inv.out, /Teammate invites are on the Team plan/);
    assert.match(inv.out, /free tier/);
    assert.doesNotMatch(inv.out, /^code: /m);
    assert.doesNotMatch(inv.out, /^link: /m);
  } finally { sb.stop(); }
});
