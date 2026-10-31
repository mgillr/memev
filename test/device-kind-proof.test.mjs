// Issue 266: a User-Agent is the caller's choice, so it never decides whether a remote token must prove its device. A
// keyless computer token that names a cloud AI app stays refused on every request, after a restart too, and nothing it
// sends is written; an enrolled cloud connector still passes. The vault runs without git so the test needs no commits.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { createServer } from '../src/server/http.mjs';
import { Vault } from '../src/engine/vault.mjs';
after(cleanup);

const CLOUD_UA = 'Mozilla/5.0 ChatGPT-User/1.0';
async function serve(v) {
  const server = createServer(v, { tunnelKey: () => 'k'.repeat(32) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (tok, method, p, body) => {
    const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': '203.0.113.7', 'user-agent': CLOUD_UA, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { req, close: () => new Promise((r) => server.close(r)) };
}
const deviceOf = (v, tok) => v.devices.get(v.devices.byToken.get(v.tokens.verify(tok).id) || '');

test('issue 266: a keyless computer token that names a cloud app stays refused on every request and after a restart', async () => {
  const { v, root } = newVault({ git: false });
  const fresh = v.tokens.issue({ agent: 'copied-laptop', remote: true }).token; // no device record until its first request
  const legacy = v.tokens.issue({ agent: 'old-laptop', remote: true, note: 'old computer' }).token;
  v.devices.migrate(v.tokens); // a token from before the registry: inferred as a computer
  let s = await serve(v);
  try {
  for (const tok of [fresh, legacy]) {
    for (let i = 0; i < 3; i++) {
      const r = await s.req(tok, 'GET', '/v1/status');
      assert.equal(r.status, 401, `request ${i + 1} was let through`);
      assert.equal(r.json?.error, 'device_key');
    }
    const w = await s.req(tok, 'PUT', '/v1/notes/memory/planted.md', { body: 'written with no device key\n' });
    assert.equal(w.status, 401);
    assert.equal(deviceOf(v, tok).kind, 'remote-computer', 'the User-Agent changed the device kind');
    assert.ok(deviceOf(v, tok).flags.some((f) => f.type === 'cloud-app-on-computer-credential'), 'the device is not flagged');
  }
  assert.equal(fs.existsSync(path.join(root, 'memory', 'planted.md')), false, 'a refused write reached the disk');
  } finally { await s.close(); v.close(); }
  const v2 = new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys'), git: false }).open();
  s = await serve(v2);
  try {
    for (const tok of [fresh, legacy]) {
      assert.equal((await s.req(tok, 'GET', '/v1/status')).status, 401, 'after a restart the token was let through');
      assert.equal(deviceOf(v2, tok).kind, 'remote-computer');
    }
  } finally { await s.close(); v2.close(); }
});

test('issue 266: a cloud connector enrolled without a device key still passes', async () => {
  const { v } = newVault({ git: false });
  const { token } = v.devices.enroll(v.tokens, { kind: 'cloud-connector', label: 'cloud app' });
  const s = await serve(v);
  try {
    assert.equal((await s.req(token, 'GET', '/v1/status')).status, 200);
    assert.equal(deviceOf(v, token).kind, 'cloud-connector');
  } finally { await s.close(); v.close(); }
});

test('issue 266: a record an earlier version switched to cloud-connector goes back to a computer, and stays refused', async () => {
  const { v, root } = newVault({ git: false });
  const legacy = v.tokens.issue({ agent: 'old-laptop', remote: true, note: 'old computer' }).token;
  const connector = v.tokens.issue({ agent: 'chatgpt', remote: true, note: 'cloud connector' }).token; // made for a cloud app
  v.devices.migrate(v.tokens);
  // the record as main's code leaves it after one request with a cloud User-Agent
  const id = v.devices.byToken.get(v.tokens.verify(legacy).id);
  v.devices.data.devices[id].kind = 'cloud-connector'; v.devices.save();
  assert.equal(deviceOf(v, connector).kind, 'cloud-connector');
  let s = await serve(v);
  try {
    for (let i = 0; i < 2; i++) assert.equal((await s.req(legacy, 'GET', '/v1/status')).status, 401, `request ${i + 1} on the switched record was let through`);
    assert.equal((await s.req(legacy, 'PUT', '/v1/notes/memory/after-upgrade.md', { body: 'x\n' })).status, 401);
    assert.equal(deviceOf(v, legacy).kind, 'remote-computer');
    assert.ok(deviceOf(v, legacy).flags.some((f) => f.type === 'kind-restored'), 'the restored record is not flagged');
    assert.equal((await s.req(connector, 'GET', '/v1/status')).status, 200, 'a connector made for a cloud app was refused');
  } finally { await s.close(); v.close(); }
  assert.equal(fs.existsSync(path.join(root, 'memory', 'after-upgrade.md')), false, 'a refused write reached the disk');
  const v2 = new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys'), git: false }).open();
  s = await serve(v2);
  try {
    assert.equal((await s.req(legacy, 'GET', '/v1/status')).status, 401, 'after a restart the switched record was let through');
    assert.equal(deviceOf(v2, legacy).kind, 'remote-computer');
  } finally { await s.close(); v2.close(); }
});
