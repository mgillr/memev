// The computer limit: each computer has its own key, the vault refuses computers past the
// licensed count, and the licence is checked offline. One computer needs no licence at all.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { signLicense, loadLicense, verifyLicense, LICENSE_KEYS } from '../src/engine/license.mjs';
import { seatPolicy, TIERS } from '../src/engine/entitlements.mjs';
import { deviceKeygen, signRequest, SeatError } from '../src/engine/devices.mjs';
import { createServer } from '../src/server/http.mjs';
import { remoteFetch, deviceKeyFile } from '../src/cli/remote.mjs';
import { writePrivate } from '../src/engine/util.mjs';
after(cleanup);

const DAY = 86400e3;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
const licence = (o = {}) => signLicense({ v: 1, lid: 'lic_seats001', tier: 'team', services: ['sync'], seats: 3, iat: day(-60), exp: day(300), grace_days: 14, ...o }, vendor.pem, 'test-vendor');
const timed = async (t, label, fn) => { const s = performance.now(); const r = await fn(); t.diagnostic(`${label}: ${(performance.now() - s).toFixed(1)} ms`); return r; };

/** A vault with a server in front of it, as it is seen through a tunnel. */
async function vaultServer(lic) {
  const { v } = newVault();
  const conf = tmpdir('vault-conf-');
  if (lic) fs.writeFileSync(path.join(conf, 'license.json'), JSON.stringify(lic));
  const env = { MEMEV_CONFIG_DIR: conf };
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: vendor.keys, env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const policy = () => seatPolicy({ license: loadLicense({ env, keys: vendor.keys }), devices: v.devices.list() });
  const close = () => { server.close(); v.close(); };
  return { v, url, env, policy, close };
}
/** A second computer: its own config dir and its own device key, made there. */
function computer(name) {
  const env = { MEMEV_CONFIG_DIR: tmpdir(`${name}-conf-`) };
  const k = deviceKeygen();
  fs.mkdirSync(path.dirname(deviceKeyFile(env)), { recursive: true });
  writePrivate(deviceKeyFile(env), k.privateKeyPem);
  return { env, pub: k.publicKey, ip: `198.51.100.${10 + name.length}` };
}
const enroll = (s, c, label) => { const r = s.v.devices.enroll(s.v.tokens, { kind: 'remote-computer', label, pubkey: c.pub, policy: s.policy() }); return { id: r.device.id, remote: { url: s.url, token: r.token } }; };
const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const tool = (name, args) => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
const send = (c, remote, body) => remoteFetch(remote, 'mcp', { body, env: c.env, headers: { 'x-forwarded-for': c.ip } });
const isError = (r) => r.json?.result?.isError === true || !!r.json?.error;

test('a copied config is refused on a second machine', async (t) => {
  const s = await vaultServer(licence());
  try {
    const a = computer('laptop'); const b = computer('desktop');
    const { remote } = enroll(s, a, 'laptop');
    assert.equal((await timed(t, 'enrolled computer, signed request', () => send(a, remote, list))).status, 200);
    // the whole config copied to another computer, which has its own key
    const copied = await timed(t, 'copied config on another computer', () => send(b, remote, list));
    assert.equal(copied.status, 401); assert.equal(copied.json.error, 'device_key');
    assert.match(copied.json.error_description, /only work on the computer that holds its device key/);
    // the token alone, no signature
    const bare = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${remote.token}`, 'content-type': 'application/json', 'x-forwarded-for': b.ip, 'user-agent': 'claude-code/2' }, body: JSON.stringify(list) });
    assert.equal(bare.status, 401);
    // a signed request captured and replayed
    const body = JSON.stringify(list);
    const h = signRequest(fs.readFileSync(deviceKeyFile(a.env), 'utf8'), { method: 'POST', path: '/mcp', body });
    const again = () => fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${remote.token}`, 'content-type': 'application/json', 'x-forwarded-for': a.ip, ...h }, body }).then((r) => r.status);
    assert.equal(await again(), 200); assert.equal(await again(), 401, 'replay');
    // a cloud connector URL pasted into a coding app on a computer
    const conn = s.v.tokens.issue({ agent: 'cloud', remote: true, note: 'cloud connector' }).token;
    const pasted = await fetch(`${s.url}/c/${conn}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': b.ip, 'user-agent': 'claude-code/2.1' }, body });
    assert.equal(pasted.status, 403); assert.equal((await pasted.json()).error, 'connector_on_computer');
    const cloud = await fetch(`${s.url}/c/${conn}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Claude-User' }, body });
    assert.equal(cloud.status, 200, 'the same URL from the cloud app works');
  } finally { s.close(); }
});

test('enrolment past the cap is refused, on free and on a licence', async () => {
  const free = await vaultServer(null);
  try {
    assert.equal(free.policy().seats, 1);
    assert.throws(() => enroll(free, computer('extra'), 'extra'), (e) => e instanceof SeatError && e.message === `Free covers this computer. Adding more computers is part of Personal (up to ${TIERS.personal.computers} computers). Run memev upgrade to see plans.`);
  } finally { free.close(); }
  const s = await vaultServer(licence({ seats: 3 }));
  try {
    enroll(s, computer('one'), 'one'); enroll(s, computer('two'), 'two');
    assert.equal(s.policy().enrolled, 3);
    assert.throws(() => enroll(s, computer('three'), 'three'), (e) => e instanceof SeatError && /licensed for 3 computers\. Remove one with `memev devices remove <id>` or contact us for more\./.test(e.message));
    // connectors and apps on the vault's own computer are not capped
    for (let i = 0; i < 5; i++) s.v.devices.enroll(s.v.tokens, { kind: 'cloud-connector', label: `app${i}`, policy: s.policy() });
    for (let i = 0; i < 5; i++) s.v.devices.enroll(s.v.tokens, { kind: 'local-client', label: `local${i}`, policy: s.policy() });
  } finally { s.close(); }
});

test('a removed device frees a seat', async () => {
  const s = await vaultServer(licence({ seats: 2 }));
  try {
    const a = computer('first'); const first = enroll(s, a, 'first');
    assert.throws(() => enroll(s, computer('second'), 'second'), SeatError);
    s.v.devices.remove(s.v.tokens, first.id);
    assert.equal(s.policy().enrolled, 1); assert.equal(s.policy().can_enroll, true);
    const c = computer('second'); const second = enroll(s, c, 'second');
    assert.equal((await send(c, second.remote, list)).status, 200);
    assert.equal((await send(a, first.remote, list)).status, 401, 'the removed computer is out, even with its key');
  } finally { s.close(); }
});

test('a forged or edited licence is rejected and the vault counts as free', async () => {
  const good = licence({ seats: 10 });
  assert.equal(verifyLicense(good, { keys: vendor.keys }).state, 'valid');
  const edited = { ...good, seats: 50 };
  const forger = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const forged = signLicense({ ...good, sig: undefined, kid: undefined, seats: 50 }, forger, 'test-vendor');
  const relabelled = { ...good, tier: 'enterprise' };
  const later = { ...good, exp: day(3000) };
  for (const [name, l] of Object.entries({ edited, forged, relabelled, later })) assert.equal(verifyLicense(l, { keys: vendor.keys }).state, 'invalid', name);
  assert.equal(verifyLicense(good).state, 'invalid', 'not signed by the vendor key built into memev');
  const s = await vaultServer(edited);
  try {
    const p = s.policy();
    assert.equal(p.state, 'invalid'); assert.equal(p.seats, 1); assert.equal(p.tier, 'free');
    assert.throws(() => enroll(s, computer('x'), 'x'), SeatError);
  } finally { s.close(); }
});

test('an expired licence follows the grace rules', async (t) => {
  // inside the grace period: still works, and computers can still be added
  const g = await vaultServer(licence({ exp: day(-3), grace_days: 14 }));
  try {
    assert.equal(g.policy().state, 'grace');
    const c = computer('grace'); const { remote } = enroll(g, c, 'grace');
    const w = await send(c, remote, tool('memev_remember', { text: 'Grace period check: this computer can still write.' }));
    assert.equal(w.status, 200); assert.equal(isError(w), false, w.text);
  } finally { g.close(); }
  // past the grace period: nothing new can be added; added computers read but do not write
  const lic = licence({ exp: day(300), grace_days: 14 });
  const s = await vaultServer(lic);
  try {
    const c = computer('old'); const { remote } = enroll(s, c, 'old');
    fs.writeFileSync(path.join(s.env.MEMEV_CONFIG_DIR, 'license.json'), JSON.stringify(licence({ iat: day(-400), exp: day(-30), grace_days: 14 })));
    await new Promise((r) => setTimeout(r, 3100)); // the server re-reads the licence every 3 s
    const p = s.policy();
    assert.equal(p.state, 'expired'); assert.equal(p.can_enroll, false);
    assert.match(p.reason, /grace period is over\. Computers already added can still read, but none can be added/);
    assert.throws(() => enroll(s, computer('new'), 'new'), SeatError);
    const r = await timed(t, 'expired licence, read from an added computer', () => send(c, remote, tool('memev_get', { path: 'memory/north-star.md' })));
    assert.equal(r.status, 200); assert.equal(isError(r), false, r.text);
    const w = await send(c, remote, tool('memev_remember', { text: 'Past grace: this write must be refused.' }));
    assert.equal(isError(w), true); assert.match(w.text, /expired/);
    // the vault's own computer is never limited
    const host = s.v.tokens.issue({ agent: 'claude-code' }).token;
    const hw = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${host}`, 'content-type': 'application/json' }, body: JSON.stringify(tool('memev_remember', { text: 'The host keeps writing after the licence lapses.' })) }).then((x) => x.json());
    assert.equal(hw.result?.isError ?? false, false, JSON.stringify(hw));
  } finally { s.close(); }
});

test('Free works with no licence, no network and no setup step', async (t) => {
  const sb = sandbox();
  try {
    const init = await timed(t, 'memev init on one computer, no licence', () => sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']));
    assert.equal(init.code, 0, init.err);
    assert.equal(fs.existsSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'license.json')), false);
    const st = sb.run(['license', 'status']);
    assert.match(st.out, /free tier needs none/); assert.match(st.out, /Computers: 1 of 1 enrolled/);
    const rem = sb.run(['remember', 'Free tier check: one computer, no licence, full use.']);
    assert.equal(rem.code, 0, rem.err + rem.out);
    // adding another computer on free is refused with the plain message
    const k = deviceKeygen().publicKey;
    const e = sb.run(['devices', 'enroll', '--kind', 'remote-computer', '--label', 'second', '--pubkey', k]);
    assert.equal(e.code, 1); assert.match(e.out + e.err, new RegExp(`Free covers this computer\\. Adding more computers is part of Personal \\(up to ${TIERS.personal.computers} computers\\)\\. Run memev upgrade to see plans\\.`));
    // the licence check imports nothing that reaches a network
    for (const f of ['license.mjs', 'entitlements.mjs']) assert.doesNotMatch(fs.readFileSync(path.join(PKG, 'src', 'engine', f), 'utf8'), /node:(http|https|net|dns|tls)|fetch\(/, f);
    assert.deepEqual(Object.keys(LICENSE_KEYS), ['memev-2026-10']);
  } finally { sb.stop(); }
});

test('the licence issue script refuses keys in the repository and keys that are not the vendor key', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = (...a) => spawnSync(process.execPath, [path.join(PKG, 'scripts', 'license', 'issue.mjs'), ...a], { encoding: 'utf8' });
  const inRepo = run('--key', path.join(PKG, 'package.json'), '--tier', 'team', '--seats', '3');
  assert.equal(inRepo.status, 2); assert.match(inRepo.stderr, /inside the repository/);
  const other = path.join(tmpdir('issue-'), 'k.pem');
  fs.writeFileSync(other, vendor.pem, { mode: 0o600 });
  const wrong = run('--key', other, '--tier', 'team', '--seats', '3');
  assert.equal(wrong.status, 2); assert.match(wrong.stderr, /not the vendor key/);
  assert.equal(wrong.stdout, ''); assert.doesNotMatch(wrong.stderr, /PRIVATE KEY/);
});
