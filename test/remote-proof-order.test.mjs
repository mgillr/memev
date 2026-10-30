// The device-proof gate is decided from the device kind as stored before observe() runs, so a
// keyless computer cannot pass it by sending a cloud-like User-Agent. A remote grep criterion is
// bounded the same way: the pattern length is capped and the match is terminated when it does not
// finish in time.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { signLicense, loadLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { createServer } from '../src/server/http.mjs';
after(cleanup);

const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
const DAY = 86400e3; const day = (o) => new Date(Date.now() + o * DAY).toISOString().slice(0, 10);
const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

async function vaultServer() {
  const { v } = newVault();
  const conf = tmpdir('rev12-conf-');
  fs.writeFileSync(path.join(conf, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_rev012', tier: 'team', services: ['sync'], seats: 3, iat: day(-10), exp: day(300), grace_days: 14 }, vendor.pem, 'test-vendor')));
  const env = { MEMEV_CONFIG_DIR: conf };
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: vendor.keys, env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const policy = () => seatPolicy({ license: loadLicense({ env, keys: vendor.keys }), devices: v.devices.list() });
  return { v, url, policy, close: () => { server.close(); v.close(); } };
}

test('REV-012 AC01: a keyless computer token with a cloud-like User-Agent is refused with device_key', async () => {
  const s = await vaultServer();
  try {
    // a token from before the device registry: migrate() infers a computer from it, no device key
    const legacy = s.v.tokens.issue({ agent: 'legacy', remote: true, note: 'old computer', paths: ['memory/**', 'work/**'] });
    s.v.devices.migrate(s.v.tokens);
    const dev = s.v.devices.get(s.v.devices.byToken.get(legacy.id) || '');
    assert.equal(dev.kind, 'remote-computer');
    assert.equal(dev.pubkey, null);
    const res = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${legacy.token}`, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', 'user-agent': 'claude/1.0' }, body: JSON.stringify(list) });
    assert.equal(res.status, 401);
    const j = await res.json();
    assert.equal(j.error, 'device_key');
    assert.match(j.error_description, /only work on the computer that holds its device key/);
  } finally { s.close(); }
});

test('REV-012 AC02: a cloud connector enrolled without a device key still passes the gate', async () => {
  const s = await vaultServer();
  try {
    const r = s.v.devices.enroll(s.v.tokens, { kind: 'cloud-connector', label: 'app', policy: s.policy() });
    assert.equal(r.device.pubkey, null);
    const res = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${r.token}`, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8', 'user-agent': 'Claude-User' }, body: JSON.stringify(list) });
    assert.equal(res.status, 200);
  } finally { s.close(); }
});

test('REV-012 AC03: a remote grep criterion is bounded by a pattern cap and a match timeout', async (t) => {
  const { root, v } = newVault();
  const work = path.join(root, 'work'); fs.mkdirSync(work, { recursive: true });
  const REMOTE = { id: 'oa_rev012', agent: 'cloud-app', scopes: ['read', 'write'], paths: ['memory/**', 'work/**', 'contracts/**', 'bus/**'], remote: true };
  const draft = (criteria) => { const d = v.contractDraft(REMOTE, { title: 'Bounded grep', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'grep', scope: ['**'], criteria }] }); v.contractSign(REMOTE, { id: d.id, local: false }); return d.id; };
  // the pattern length is capped
  const cap = draft([{ statement: 'too long', verifier: { type: 'grep', file: 'big.txt', pattern: 'a'.repeat(201) } }]);
  const r1 = v.contractVerify(REMOTE, { id: cap }, { local: false });
  assert.equal(r1.tasks[0].criteria[0].status, 'FAIL');
  assert.match(r1.tasks[0].criteria[0].detail, /200/);
  // a pathological pattern over a large file is terminated, not allowed to hang
  fs.writeFileSync(path.join(work, 'big.txt'), 'a'.repeat(1_000_000));
  const redos = draft([{ statement: 'pathological', verifier: { type: 'grep', file: 'big.txt', pattern: '(a+)+b' } }]);
  const s0 = performance.now();
  const r2 = v.contractVerify(REMOTE, { id: redos }, { local: false });
  const ms = performance.now() - s0;
  t.diagnostic(`pathological grep returned in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 15000, `the verify took ${ms.toFixed(0)} ms`);
  assert.equal(r2.tasks[0].criteria[0].status, 'FAIL');
  assert.match(r2.tasks[0].criteria[0].detail, /did not finish/);
  // a normal pattern still passes
  const ok = draft([{ statement: 'plain', verifier: { type: 'grep', file: 'big.txt', pattern: 'aa' } }]);
  const r3 = v.contractVerify(REMOTE, { id: ok }, { local: false });
  assert.equal(r3.tasks[0].criteria[0].status, 'PASS');
  v.close();
});
