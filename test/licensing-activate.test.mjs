// memev license activate <key>: one call to a licence endpoint, the signed file verified offline from then on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { signLicense, loadLicense, licenseFile } from '../src/engine/license.mjs';
import { activateLicense, licenseEndpoint } from '../src/cli/licensing.mjs';
import { applyRelayDefault, relaySetting } from '../src/cli/relay.mjs';
after(cleanup);

const BIN = path.join(PKG, 'bin', 'memev.mjs');
const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const keys = { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const fields = () => ({ v: 1, lid: 'lic_act00063', tier: 'personal', services: ['sync'], seats: 4, connectors: 10, iat: day(-1), exp: day(300), grace_days: 14 });

/** A local licence server: GOOD-KEY gets a signed licence, anything else is refused. `answer` replaces the licence it sends. */
function licenceServer({ answer } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: b });
      const { key } = JSON.parse(b || '{}');
      res.setHeader('content-type', 'application/json');
      if (key !== 'GOOD-KEY-0001') { res.statusCode = 403; res.end(JSON.stringify({ error: 'unknown_key', error_description: 'that key is not valid or was already used on too many computers' })); return; }
      res.end(JSON.stringify(answer ? answer() : signLicense(fields(), pem, 'test-vendor')));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/v1/activate`, close: () => new Promise((r) => server.close(r)) })));
}
const env = () => ({ MEMEV_CONFIG_DIR: tmpdir('act-conf-') });
const cli = (args, e) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: e.MEMEV_CONFIG_DIR, ...e } });
  let o = '', er = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { er += d; });
  p.on('close', (code) => resolve({ code, out: o, err: er }));
});

test('MEM-030-FU2: a relay reply that is not a relay URL is not stored', async () => {
  const sb = sandbox();
  const srv = await licenceServer({ answer: () => ({ license: signLicense(fields(), pem, 'test-vendor'), relay: { default_url: 'https://x', default_domain: 'relay.test' } }) });
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--no-connect', '--local-only']).code, 0);
    const r = await activateLicense({ key: 'GOOD-KEY-0001', endpoint: srv.url, env: sb.env, keys, root: sb.root });
    assert.equal(r.ok, true, r.reason);
    assert.equal(relaySetting(sb.root).default_url, null);
    assert.equal(relaySetting(sb.root).default_domain, null);
    assert.equal(applyRelayDefault(sb.root, { default_url: 'relay://127.0.0.1:9', default_domain: 'bad domain' }), false);
    assert.equal(relaySetting(sb.root).default_url, null);
  } finally { await srv.close(); sb.stop(); }
});

test('MEM-030-FU: activation stores the relay address from the licence service reply', async () => {
  const sb = sandbox();
  const srv = await licenceServer({ answer: () => ({ license: signLicense(fields(), pem, 'test-vendor'), relay: { default_url: 'relay://127.0.0.1:9', default_domain: 'relay.test' } }) });
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--no-connect', '--local-only']).code, 0);
    const r = await activateLicense({ key: 'GOOD-KEY-0001', endpoint: srv.url, env: sb.env, keys, root: sb.root });
    assert.equal(r.ok, true, r.reason);
    const saved = relaySetting(sb.root);
    assert.equal(saved.default_url, 'relay://127.0.0.1:9');
    assert.equal(saved.default_domain, 'relay.test');
    assert.equal(saved.enabled, false);
  } finally { await srv.close(); sb.stop(); }
});

test('MEM-063 AC01: against a local test licence server, activate stores a licence that verifies offline with the network disabled', async () => {
  const srv = await licenceServer(); const e = env();
  const r = await activateLicense({ key: 'GOOD-KEY-0001', endpoint: srv.url, env: e, keys });
  assert.equal(r.ok, true, r.reason);
  assert.equal(srv.seen.length, 1, 'one call');
  assert.equal(srv.seen[0].method, 'POST');
  assert.deepEqual(JSON.parse(srv.seen[0].body), { key: 'GOOD-KEY-0001' }, 'the key is all that is sent');
  await srv.close();
  // the network is gone: the server is closed and any attempt to open a connection or fetch fails the test
  const realFetch = globalThis.fetch; const realConnect = net.Socket.prototype.connect;
  globalThis.fetch = () => { throw new Error('network used'); };
  net.Socket.prototype.connect = function () { throw new Error('network used'); };
  try {
    const l = loadLicense({ env: e, keys });
    assert.equal(l.state, 'valid'); assert.equal(l.lid, 'lic_act00063'); assert.equal(l.seats, 4); assert.equal(l.tier, 'personal');
    assert.equal(fs.statSync(licenseFile(e)).mode & 0o777, 0o600);
  } finally { globalThis.fetch = realFetch; net.Socket.prototype.connect = realConnect; }
  // and it is the exact signed file: any edit no longer verifies
  const f = JSON.parse(fs.readFileSync(licenseFile(e), 'utf8')); fs.writeFileSync(licenseFile(e), JSON.stringify({ ...f, seats: 400 }));
  assert.equal(loadLicense({ env: e, keys }).state, 'invalid');
});

test('MEM-063 AC02: a key the server rejects leaves no licence file and prints why', async () => {
  const srv = await licenceServer();
  try {
    const e = env();
    const r = await activateLicense({ key: 'WRONG-KEY-0002', endpoint: srv.url, env: e, keys });
    assert.equal(r.ok, false); assert.match(r.reason, /that key is not valid/);
    assert.equal(fs.existsSync(licenseFile(e)), false);
    // through the command: exit 1, the reason on screen, no file, and the key is never echoed
    const c = await cli(['license', 'activate', 'WRONG-KEY-0002', '--server', srv.url], e);
    assert.equal(c.code, 1); assert.match(c.out, /not activated: the licence server refused the key: that key is not valid/);
    assert.equal(c.out.includes('WRONG-KEY-0002') || c.err.includes('WRONG-KEY-0002'), false);
    assert.equal(fs.existsSync(licenseFile(e)), false);
    // a good key whose answer is signed by a key this build does not trust is refused too, and an earlier licence stays
    const kept = path.join(e.MEMEV_CONFIG_DIR, 'license.json'); fs.writeFileSync(kept, JSON.stringify(signLicense({ ...fields(), lid: 'lic_kept0063' }, pem, 'test-vendor')));
    const before = fs.readFileSync(kept, 'utf8');
    const d = await cli(['license', 'activate', 'GOOD-KEY-0001', '--server', srv.url], e);
    assert.equal(d.code, 1); assert.match(d.out, /unknown signing key test-vendor/);
    assert.equal(fs.readFileSync(kept, 'utf8'), before);
    // an unreachable server and a missing endpoint also leave nothing
    const e2 = env();
    const dead = await activateLicense({ key: 'GOOD-KEY-0001', endpoint: 'http://127.0.0.1:1/x', env: e2, keys });
    assert.equal(dead.ok, false); assert.match(dead.reason, /could not reach the licence server/); assert.equal(fs.existsSync(licenseFile(e2)), false);
    const none = await cli(['license', 'activate', 'GOOD-KEY-0001'], e2);
    assert.equal(none.code, 1); assert.match(none.out, /no licence server is set/); assert.equal(fs.existsSync(licenseFile(e2)), false);
    // an expired licence and a plain-http remote endpoint are refused
    const old = await licenceServer({ answer: () => signLicense({ ...fields(), iat: '2020-01-01', exp: '2020-06-01' }, pem, 'test-vendor') });
    try { const x = await activateLicense({ key: 'GOOD-KEY-0001', endpoint: old.url, env: e2, keys }); assert.equal(x.ok, false); assert.match(x.reason, /expired/); assert.equal(fs.existsSync(licenseFile(e2)), false); } finally { await old.close(); }
    assert.throws(() => licenseEndpoint({ flags: { server: 'http://licences.example.invalid/activate' }, env: {} }), /must be https/);
    assert.equal(licenseEndpoint({ flags: {}, env: {} }), null, 'no built-in address');
    assert.equal(licenseEndpoint({ flags: {}, env: { MEMEV_LICENSE_URL: 'https://licences.example.invalid/activate' } }), 'https://licences.example.invalid/activate');
  } finally { await srv.close(); }
});

test('MEM-063 AC03: the stored licence contains no identity', async () => {
  const e = env();
  // the server answers with a signed licence that also names a person and a machine: it is refused, nothing stored
  const withId = await licenceServer({ answer: () => signLicense({ ...fields(), email: 'someone@example.invalid', name: 'Someone', machine: 'host-1' }, pem, 'test-vendor') });
  try {
    const r = await activateLicense({ key: 'GOOD-KEY-0001', endpoint: withId.url, env: e, keys });
    assert.equal(r.ok, false); assert.match(r.reason, /email, name, machine/);
    assert.equal(fs.existsSync(licenseFile(e)), false);
  } finally { await withId.close(); }
  // the normal answer is stored with licence fields only, and neither the key nor anything about this computer is in it
  const srv = await licenceServer();
  try {
    const r = await activateLicense({ key: 'GOOD-KEY-0001', endpoint: srv.url, env: e, keys });
    assert.equal(r.ok, true, r.reason);
    const raw = fs.readFileSync(licenseFile(e), 'utf8'); const stored = JSON.parse(raw);
    const allowed = ['v', 'lid', 'tier', 'services', 'seats', 'connectors', 'iat', 'exp', 'grace_days', 'kid', 'sig'];
    assert.deepEqual(Object.keys(stored).filter((k) => !allowed.includes(k)), []);
    assert.equal(raw.includes('GOOD-KEY-0001'), false);
    assert.equal(/@|hostname|machine|email|name"/i.test(raw), false);
    assert.equal(srv.seen[0].body.includes(e.MEMEV_CONFIG_DIR), false);
  } finally { await srv.close(); }
});
