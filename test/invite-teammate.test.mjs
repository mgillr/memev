// Teammate invites: a colleague's computer joins under their name, and their apps' seats read
// <app>@<name>-<machine> on the shared roster. Teammate invites need the Team entitlement;
// without it the command prints the plan line and no code. A teammate's computer is a computer like any other, so the
// seat policy and the address rule of memev invite come before the Team check.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { mintInvite, redeemInvite, deviceKeygen } from '../src/engine/devices.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { Bus } from '../src/engine/bus.mjs';
import { command } from '../src/cli/invite.mjs';

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

// memev invite in this process, with the licence passed in, capturing what it prints
async function invite(root, flags, license) {
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { const code = await command(null, null, { ttl: '600', ...flags }, { root, env: process.env, license }); return { code, out: logs.join('\n') }; }
  finally { console.log = orig; }
}
const personalLic = { state: 'valid', tier: 'personal', seats: 3, exp: '2027-01-01' };

test('MEM-069 AC02: a teammate invite without Team prints the plan line and no code', async () => {
  const { root, v } = newVault({ git: false });
  try {
    const r = await invite(root, { teammate: 'sam', local: true }, personalLic);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Teammate invites are on the Team plan/);
    assert.match(r.out, /personal tier/);
    assert.doesNotMatch(r.out, /^code: /m);
    assert.doesNotMatch(r.out, /^link: /m);
  } finally { v.close(); }
});

test('MEM-069: a teammate invite on a vault that cannot add a computer is refused by the seat policy, before the Team check', async () => {
  const { root, v } = newVault({ git: false });
  try {
    const r = await invite(root, { teammate: 'sam', local: true }, null);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(seatPolicy({ license: null, devices: v.devices.list() }).reason), r.out);
    assert.doesNotMatch(r.out, /Teammate invites are on the Team plan/);
    assert.doesNotMatch(r.out, /^code: /m);
  } finally { v.close(); }
});

test('MEM-069: a teammate invite keeps the address rule: with no tunnel and no --local it is refused', async () => {
  const { root, v } = newVault({ git: false });
  try {
    // either refusal of the rule (link off, or on with no address yet) points at memev invite --local
    await assert.rejects(invite(root, { teammate: 'sam' }, teamLic), /memev invite --local/);
  } finally { v.close(); }
});

test('MEM-069: with Team, a teammate invite past both checks prints the teammate and the code', async () => {
  const { root, v } = newVault({ git: false });
  try {
    const r = await invite(root, { teammate: 'Sam', local: true }, teamLic);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^teammate: sam$/m);
    assert.match(r.out, /^code: /m);
  } finally { v.close(); }
});
