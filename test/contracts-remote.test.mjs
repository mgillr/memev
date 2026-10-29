import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { signLicense, loadLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { createServer } from '../src/server/http.mjs';
import { remoteFetch, deviceKeyFile } from '../src/cli/remote.mjs';
import { writePrivate } from '../src/engine/util.mjs';
after(cleanup);

const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
const DAY = 86400e3; const day = (o) => new Date(Date.now() + o * DAY).toISOString().slice(0, 10);
const rpc = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
function unwrap(j, status) {
  if (!j?.result) { const e = new Error(j?.error_description || j?.error?.message || `status ${status}`); e.status = status; throw e; }
  if (j.result.isError) { const e = new Error(j.result.content[0].text); e.status = status; throw e; }
  return j.result.structuredContent?.result ?? j.result.structuredContent;
}
// A vault with an HTTP server and one enrolled remote computer, so a test can call tools the way
// another machine would: signed with its own device key, through a proxy header, never local.
async function remoteVault() {
  const { v, root } = newVault();
  const conf = tmpdir('rev-conf-');
  fs.writeFileSync(path.join(conf, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_rev0001', tier: 'team', services: ['sync'], seats: 3, iat: day(-10), exp: day(300), grace_days: 14 }, vendor.pem, 'test-vendor')));
  const env = { MEMEV_CONFIG_DIR: conf };
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: vendor.keys, env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const policy = () => seatPolicy({ license: loadLicense({ env, keys: vendor.keys }), devices: v.devices.list() });
  const cenv = { MEMEV_CONFIG_DIR: tmpdir('rev-computer-') };
  const k = deviceKeygen();
  fs.mkdirSync(path.dirname(deviceKeyFile(cenv)), { recursive: true }); writePrivate(deviceKeyFile(cenv), k.privateKeyPem);
  const r = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'rev-test', pubkey: k.publicKey, policy: policy() });
  const call = async (name, args = {}) => { const res = await remoteFetch({ url, token: r.token }, 'mcp', { body: rpc(name, args), env: cenv, headers: { 'x-forwarded-for': '198.51.100.40' } }); return unwrap(res.json, res.status); };
  return { v, root, url, call, draft: () => v.contractDraft(OWNER, { title: 'Remote contract test', project: 'api', workdir: path.join(root, 'work'), tasks: [{ id: 'T1', title: 'health endpoint', scope: ['**'], criteria: [
    { statement: 'the handler exists', verifier: { type: 'file_exists', path: 'health.js' } },
    { statement: 'the check script passes', verifier: { type: 'command', cmd: 'test -f health.js' } },
  ] }] }), close: () => { server.close(); v.close(); } };
}

function setup() {
  const { root, v } = newVault();
  const work = path.join(root, 'work'); fs.mkdirSync(work, { recursive: true });
  const d = v.contractDraft(OWNER, { title: 'Remote contract test', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'health endpoint', scope: ['**'], criteria: [
    { statement: 'the handler exists', verifier: { type: 'file_exists', path: 'health.js' } },
    { statement: 'the check script passes', verifier: { type: 'command', cmd: 'test -f health.js' } },
  ] }] });
  return { root, v, work, d };
}

test('REV-002 AC01: a remote-signed contract records origin remote and blocks commands until approved', () => {
  const { v, d, work } = setup();
  const s = v.contractSign(OWNER, { id: d.id, local: false });
  assert.equal(s.origin, 'remote');
  const r1 = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r1.tasks[0].criteria[1].status, 'BLOCKED');
  assert.match(r1.tasks[0].criteria[1].detail, /approve/);
  fs.writeFileSync(path.join(work, 'health.js'), 'ok\n');
  const r2 = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r2.tasks[0].criteria[1].status, 'BLOCKED');
  v.contractApprove(OWNER, { id: d.id });
  const r3 = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r3.tasks[0].criteria[1].status, 'PASS');
  assert.equal(r3.ok, true);
  v.close();
});

test('REV-002 AC02: the resume card does not solicit verify for an unapproved remote contract', () => {
  const { v, d } = setup();
  v.contractSign(OWNER, { id: d.id, local: false, session: 'sess-remote' });
  const card = v.sessionStart(OWNER, { task: 'test', project: 'api', session: 'sess-remote' });
  const text = JSON.stringify(card.open_contracts || []);
  assert.ok(text.includes(d.id));
  const oc = card.open_contracts.find((k) => k.id === d.id);
  assert.equal(oc.origin, 'remote');
  assert.equal(oc.approved, false);
  v.close();
});

test('REV-002 AC03: file_exists and grep paths are confined to the vault root', () => {
  const { v, d, work } = setup();
  v.contractSign(OWNER, { id: d.id, local: true });
  const r = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r.tasks[0].criteria[0].status, 'FAIL');
  const d2 = v.contractDraft(OWNER, { title: 'Escape test', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'escape', scope: ['**'], criteria: [
    { statement: 'escape vault', verifier: { type: 'file_exists', path: '../../etc/passwd' } },
    { statement: 'absolute path', verifier: { type: 'grep', file: '/etc/passwd', pattern: 'root' } },
  ] }] });
  v.contractSign(OWNER, { id: d2.id, local: true });
  const r2 = v.contractVerify(OWNER, { id: d2.id }, { local: true });
  assert.equal(r2.tasks[0].criteria[0].status, 'BLOCKED');
  assert.match(r2.tasks[0].criteria[0].detail, /escapes/);
  assert.equal(r2.tasks[0].criteria[1].status, 'BLOCKED');
  assert.match(r2.tasks[0].criteria[1].detail, /absolute/);
  v.close();
});

test('REV-002 AC04: no caller-supplied string is interpolated into a shell command', () => {
  const { v, d, work } = setup();
  v.contractSign(OWNER, { id: d.id, local: true });
  const marker = path.join(work, 'pwned');
  const d2 = v.contractDraft(OWNER, { title: 'Injection test', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'inject', scope: ['**'], criteria: [
    { statement: 'injection', verifier: { type: 'command', cmd: `touch ${marker}` } },
  ] }] });
  v.contractSign(OWNER, { id: d2.id, local: true });
  const r = v.contractVerify(OWNER, { id: d2.id }, { local: true });
  assert.equal(r.tasks[0].criteria[0].status, 'PASS');
  assert.ok(fs.existsSync(marker));
  v.close();
});

test('REV-002 AC05: a remote caller cannot approve a contract', async () => {
  const { v, draft, call, close } = await remoteVault();
  try {
    const d = draft();
    v.contractSign(OWNER, { id: d.id, local: false });
    assert.throws(() => v.contractApprove(OWNER, { id: d.id, local: false }), /local operator/);
    await assert.rejects(call('memev_contract_approve', { id: d.id }), /local operator/);
    assert.equal(v._contractApproved(d.id), false, 'the remote call did not write an approval');
  } finally { close(); }
});

test('REV-002 AC06: a remote caller cannot prove files outside the vault', async () => {
  const { v, call, close } = await remoteVault();
  try {
    const outside = tmpdir('rev-outside-');
    fs.writeFileSync(path.join(outside, 'health.js'), 'ok\n');
    const d = v.contractDraft(OWNER, { title: 'Remote escape', project: 'api', workdir: outside, tasks: [{ id: 'T1', title: 'escape', scope: ['**'], criteria: [
      { statement: 'the handler exists', verifier: { type: 'file_exists', path: 'health.js' } },
    ] }] });
    v.contractSign(OWNER, { id: d.id, local: false });
    v.contractApprove(OWNER, { id: d.id });
    const r = await call('memev_contract_verify', { id: d.id });
    assert.equal(r.tasks[0].criteria[0].status, 'FAIL', 'the file outside the vault is not proof of the criterion');
  } finally { close(); }
});
