// The vault's one Personal trial: the first invite asks the licence endpoint for it, the signed
// file is verified offline before it is installed, the vault records it, and a second invite asks
// for nothing. When the trial ends, the usual grace then read-only rules apply.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { newVault, tmpdir, cleanup } from './helpers/tmp.mjs';
import { signLicense, loadLicense, licenseFile } from '../src/engine/license.mjs';
import { writePrivate } from '../src/engine/util.mjs';
import { TRIAL_DAYS, seatPolicy, readOnlyReason } from '../src/engine/entitlements.mjs';
import { issueTrial } from '../src/cli/invite.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';

after(cleanup);

const DAY = 86400e3;
const day = (o) => new Date(Date.now() + o * DAY).toISOString().slice(0, 10);
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const keys = { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const fields = () => ({ v: 1, lid: 'lic_trial067', tier: 'personal', services: ['sync', 'backup', 'relay'], seats: 4, iat: day(0), exp: day(TRIAL_DAYS), grace_days: 14 });
const recordFile = (root) => path.join(root, '.memev', 'trial.json');
const env = () => ({ MEMEV_CONFIG_DIR: tmpdir('trial-conf-') });

/** A local licence server that signs the trial. `answer` replaces the licence it sends. */
function trialServer({ answer, refuse = null } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: b });
      res.setHeader('content-type', 'application/json');
      if (refuse) { res.statusCode = refuse.status; res.end(JSON.stringify(refuse.body)); return; }
      res.end(JSON.stringify(answer ? answer() : signLicense(fields(), pem, 'test-vendor')));
    });
  });
  let closed = false;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    seen,
    url: `http://127.0.0.1:${server.address().port}/v1/trial`,
    close: () => { if (closed) return Promise.resolve(); closed = true; return new Promise((r) => server.close(r)); },
  })));
}

test('MEM-067 AC01: the first invite on a Free vault obtains a trial licence that verifies offline and allows the second computer', async () => {
  const { root, v } = newVault();
  const e = env();
  // an answer that is not a 14-day personal trial is refused and leaves nothing installed
  for (const [why, mut] of [
    ['longer than 14 days', () => ({ ...fields(), exp: day(30) })],
    ['not a personal licence', () => ({ ...fields(), tier: 'team' })],
    ['email', () => ({ ...fields(), email: 'someone@example.invalid' })],
  ]) {
    const srv = await trialServer({ answer: () => signLicense(mut(), pem, 'test-vendor') });
    try {
      const r = await issueTrial({ root, env: e, flags: { server: srv.url }, keys });
      assert.equal(r.issued, false, r.reason);
      assert.match(r.reason, new RegExp(why));
      assert.equal(fs.existsSync(licenseFile(e)), false, 'nothing installed');
      assert.equal(fs.existsSync(recordFile(root)), false, 'no trial recorded');
    } finally { await srv.close(); }
  }
  // the real trial: one call, the word "trial" and nothing else
  const srv = await trialServer();
  try {
    const r = await issueTrial({ root, env: e, flags: { server: srv.url }, keys });
    assert.equal(r.issued, true, r.reason);
    assert.equal(srv.seen.length, 1, 'one call');
    assert.equal(srv.seen[0].method, 'POST');
    assert.deepEqual(JSON.parse(srv.seen[0].body), { purpose: 'trial' }, 'the word trial is all that is sent');
    const rec = JSON.parse(fs.readFileSync(recordFile(root), 'utf8'));
    assert.equal(rec.lid, 'lic_trial067');
    assert.equal(rec.days, TRIAL_DAYS);
    assert.equal(fs.statSync(licenseFile(e)).mode & 0o777, 0o600);
    // the network is gone: the server is closed and any attempt to open a connection or fetch fails the test
    await srv.close();
    const realFetch = globalThis.fetch; const realConnect = net.Socket.prototype.connect;
    globalThis.fetch = () => { throw new Error('network used'); };
    net.Socket.prototype.connect = function () { throw new Error('network used'); };
    try {
      const l = loadLicense({ env: e, keys });
      assert.equal(l.state, 'valid'); assert.equal(l.tier, 'personal'); assert.equal(l.seats, 4);
      assert.equal(Date.parse(l.exp) - Date.parse(l.iat), TRIAL_DAYS * DAY, 'the trial is 14 days');
      // the second computer may join: the trial covers four computers
      const p = seatPolicy({ license: l, devices: v.devices.list() });
      assert.equal(p.can_enroll, true, p.reason);
      const key = deviceKeygen();
      const enrolled = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: key.publicKey, policy: p });
      assert.equal(enrolled.device.kind, 'remote-computer');
    } finally { globalThis.fetch = realFetch; net.Socket.prototype.connect = realConnect; }
  } finally { await srv.close(); }
});

test('MEM-067 AC02: a second invite does not issue another trial', async () => {
  const { root } = newVault();
  const e = env();
  const srv = await trialServer();
  try {
    const first = await issueTrial({ root, env: e, flags: { server: srv.url }, keys });
    assert.equal(first.issued, true, first.reason);
    const licBefore = fs.readFileSync(licenseFile(e), 'utf8');
    const recBefore = fs.readFileSync(recordFile(root), 'utf8');
    const second = await issueTrial({ root, env: e, flags: { server: srv.url }, keys });
    assert.equal(second.issued, false);
    assert.match(second.reason, /a licence is already installed/);
    assert.equal(srv.seen.length, 1, 'the endpoint is asked once per vault');
    assert.equal(fs.readFileSync(licenseFile(e), 'utf8'), licBefore, 'the installed licence is untouched');
    assert.equal(fs.readFileSync(recordFile(root), 'utf8'), recBefore, 'the record is untouched');
    // a vault that already has any licence never asks for a trial
    const e2 = env();
    writePrivate(licenseFile(e2), JSON.stringify(signLicense({ ...fields(), lid: 'lic_paid0067', exp: day(300) }, pem, 'test-vendor')));
    const paid = await issueTrial({ root, env: e2, flags: { server: srv.url }, keys });
    assert.equal(paid.issued, false);
    assert.match(paid.reason, /already installed/);
    assert.equal(srv.seen.length, 1, 'no call for a vault with a licence');
    // removing the trial licence does not give the vault a second trial
    fs.rmSync(licenseFile(e), { force: true });
    const again = await issueTrial({ root, env: e, flags: { server: srv.url }, keys });
    assert.equal(again.issued, false);
    assert.match(again.reason, /already had its trial/);
    assert.equal(srv.seen.length, 1, 'no call when the vault has already had its trial');
  } finally { await srv.close(); }
  // a trial the server refuses is not the vault's trial: the next invite still gets one
  const { root: rootB } = newVault();
  const eB = env();
  const refuse = await trialServer({ refuse: { status: 403, body: { error: 'trial_unavailable', error_description: 'trials are not available' } } });
  try {
    const r1 = await issueTrial({ root: rootB, env: eB, flags: { server: refuse.url }, keys });
    assert.equal(r1.issued, false);
    assert.match(r1.reason, /trials are not available/);
    assert.equal(fs.existsSync(licenseFile(eB)), false);
    assert.equal(fs.existsSync(recordFile(rootB)), false, 'a refusal records nothing');
  } finally { await refuse.close(); }
  const ok = await trialServer();
  try {
    const r2 = await issueTrial({ root: rootB, env: eB, flags: { server: ok.url }, keys });
    assert.equal(r2.issued, true, r2.reason);
  } finally { await ok.close(); }
});

test('MEM-067 AC03: after the trial ends (clock injected), grace then read-only rules apply', async () => {
  const { root, v } = newVault();
  const e = env();
  const srv = await trialServer();
  try {
    const r = await issueTrial({ root, env: e, flags: { server: srv.url }, keys });
    assert.equal(r.issued, true, r.reason);
    await srv.close();
    const lic = loadLicense({ env: e, keys });
    assert.equal(lic.state, 'valid');
    // the second computer joins while the trial is valid
    const p = seatPolicy({ license: lic, devices: v.devices.list() });
    assert.equal(p.can_enroll, true, p.reason);
    const key = deviceKeygen();
    const laptop = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: key.publicKey, policy: p }).device;
    // the day after the trial ends: inside the grace period, the second computer still writes
    const g = loadLicense({ env: e, keys, now: Date.parse(lic.exp) + DAY });
    assert.equal(g.state, 'grace');
    const pg = seatPolicy({ license: g, devices: v.devices.list() });
    assert.equal(pg.can_enroll, true, pg.reason);
    assert.equal(pg.writable.has(laptop.id), true, 'grace: the second computer may still write');
    assert.equal(pg.read_only.length, 0);
    // after the grace: expired, the second computer reads only and no computer can be added
    const x = loadLicense({ env: e, keys, now: Date.parse(lic.exp) + (lic.grace_days + 1) * DAY });
    assert.equal(x.state, 'expired');
    const px = seatPolicy({ license: x, devices: v.devices.list() });
    assert.equal(px.can_enroll, false);
    assert.equal(px.writable.has(laptop.id), false);
    assert.ok(px.read_only.includes(laptop.id));
    assert.match(readOnlyReason(px, laptop), /expired/);
  } finally { await srv.close(); }
});
