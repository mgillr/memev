// SPDX-License-Identifier: Apache-2.0
// Only computers are metered, and a computer holds its own device key. A remote token with no device key is refused by
// the server, so it cannot act as a computer and must not fill a seat. Not counting it opens no way past the seat count.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { createServer } from '../src/server/http.mjs';

after(cleanup);

const PLUS = { state: 'valid', tier: 'personal_more', seats: 3 };
const policy = (v) => seatPolicy({ license: PLUS, devices: v.devices.list() });

test('remote tokens with no device key leave every seat free, and a computer can still enrol', () => {
  const { v } = newVault();
  try {
    for (const note of ['', 'my bot', undefined]) v.tokens.issue({ agent: `bot-${note}`, remote: true, note });
    v.devices.migrate(v.tokens);
    assert.equal(policy(v).enrolled, 1, 'only this computer is enrolled');
    assert.equal(policy(v).can_enroll, true);
    assert.equal(v.devices.enrolledComputers(), 1);
    for (const d of v.devices.list()) v.devices.data.devices[d.id].last_seen = new Date().toISOString();
    assert.equal(v.devices.countSeats().computers, 1);
    const { device } = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: deviceKeygen().publicKey, policy: policy(v) });
    assert.ok(device.pubkey);
    assert.equal(policy(v).enrolled, 2);
  } finally { v.close(); }
});

test('computers with a device key are still counted and still capped', () => {
  const { v } = newVault();
  try {
    for (const label of ['a', 'b']) v.devices.enroll(v.tokens, { kind: 'remote-computer', label, pubkey: deviceKeygen().publicKey, policy: policy(v) });
    assert.equal(policy(v).enrolled, 3);
    assert.equal(policy(v).can_enroll, false);
    assert.throws(() => v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'c', pubkey: deviceKeygen().publicKey, policy: policy(v) }), /licensed for 3/);
  } finally { v.close(); }
});

test('not counting a keyless token opens no way in: the server refuses it from another computer', async () => {
  const { v } = newVault();
  const server = createServer(v, { tunnelKey: () => null, env: { MEMEV_CONFIG_DIR: tmpdir('keyless-conf-') } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { token } = v.tokens.issue({ agent: 'second-computer', remote: true, note: '' });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', 'user-agent': 'node' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'device_key');
  } finally { server.close(); v.close(); }
});
