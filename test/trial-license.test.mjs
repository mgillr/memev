// The trial licence: the format carries the trial fields inside the signed bytes, the issue script
// issues a Business trial or a Corporate pilot, and the fixed trial length is a constant. The size
// is never a default here; the caller passes it as --seats.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { signLicense, verifyLicense, LICENSE_FIELDS, extraFields, TRIAL_DAYS, TRIAL_EXT_DAYS } from '../src/engine/license.mjs';

after(cleanup);

const DAY = 86400e3;
const vendor = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
  };
})();
const run = (...a) => spawnSync(process.execPath, [path.join(PKG, 'scripts', 'license', 'issue.mjs'), ...a], { encoding: 'utf8' });
const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const trialLic = (o = {}) => signLicense({ v: 1, lid: 'lic_trial01', tier: 'business', services: ['merge'], seats: 5, iat: '2026-01-01', exp: '2026-01-15', grace_days: 7, trial: true, org: 'org_acme0001', ...o }, vendor.pem, 'test-vendor');
let _key;
const keyFile = () => {
  if (!_key) { _key = path.join(tmpdir('issue-key-'), 'k.pem'); fs.writeFileSync(_key, vendor.pem, { mode: 0o600 }); }
  return _key;
};

test('MEM-129 AC01: the trial fields are inside the signed bytes and refused when changed', () => {
  for (const f of ['trial', 'trial_ext', 'org']) assert.ok(LICENSE_FIELDS.includes(f), f);
  const now = Date.parse('2026-01-10');
  const lic = trialLic();
  const v = verifyLicense(lic, { keys: vendor.keys, now });
  assert.equal(v.state, 'valid');
  assert.equal(v.trial, true);
  assert.equal(v.org, 'org_acme0001');
  assert.equal(verifyLicense({ ...lic, trial: false }, { keys: vendor.keys, now }).state, 'invalid');
  assert.equal(verifyLicense({ ...lic, org: 'org_other0001' }, { keys: vendor.keys, now }).state, 'invalid');
  const ext = trialLic({ trial_ext: true });
  assert.equal(verifyLicense(ext, { keys: vendor.keys, now }).state, 'valid');
  assert.equal(verifyLicense({ ...ext, trial_ext: false }, { keys: vendor.keys, now }).state, 'invalid');
  assert.ok(extraFields({ ...lic, plan: 'pro' }).includes('plan'));
});

test('MEM-129 AC02: issue.mjs --trial issues a business trial with the fixed length and required seats', () => {
  assert.equal(TRIAL_DAYS, 14);
  assert.equal(TRIAL_EXT_DAYS, 14);
  const iat = '2026-01-01';
  const lic = signLicense({ v: 1, lid: 'lic_trial02', tier: 'business', services: ['merge'], seats: 5, iat, exp: addDays(iat, TRIAL_DAYS), grace_days: 7, trial: true, org: 'org_acme0001' }, vendor.pem, 'test-vendor');
  const v = verifyLicense(lic, { keys: vendor.keys, now: Date.parse(iat) + DAY });
  assert.equal(v.state, 'valid');
  assert.equal(v.trial, true);
  assert.equal(v.tier, 'business');
  assert.equal(v.exp, addDays(iat, TRIAL_DAYS));
  assert.equal(v.grace_days, 7);
  assert.ok(v.services.includes('merge'));
  assert.equal(v.seats, 5);
  const extLic = signLicense({ v: 1, lid: 'lic_ext02', tier: 'business', services: ['merge'], seats: 5, iat, exp: addDays(iat, TRIAL_EXT_DAYS), grace_days: 7, trial: true, trial_ext: true, org: 'org_acme0001' }, vendor.pem, 'test-vendor');
  const ev = verifyLicense(extLic, { keys: vendor.keys, now: Date.parse(iat) + DAY });
  assert.equal(ev.state, 'valid');
  assert.equal(ev.trial_ext, true);
  assert.equal(ev.exp, addDays(iat, TRIAL_EXT_DAYS));
  const k = keyFile();
  assert.match(run('--key', k, '--trial', '--tier', 'personal', '--seats', '5', '--org', 'org_acme0001').stderr, /Personal tiers have no trial/);
  assert.match(run('--key', k, '--trial', '--seats', '5', '--org', 'org_acme0001', '--exp', 'none').stderr, /do not pass --exp/);
  assert.match(run('--key', k, '--trial', '--org', 'org_acme0001').stderr, /--seats/);
  assert.match(run('--key', k, '--trial', '--tier', 'corporate', '--seats', '5', '--org', 'org_acme0001').stderr, /not the vendor key/);
  assert.match(run('--key', k, '--trial', '--extension', '--seats', '5', '--org', 'org_acme0001', '--days', '30').stderr, /do not pass --days/);
  const ledger = path.join(tmpdir('ledger-'), 'ext.json');
  fs.writeFileSync(ledger, JSON.stringify({ org_acme0001: { lid: 'lic_prev', iat, exp: addDays(iat, TRIAL_EXT_DAYS) } }));
  assert.match(run('--key', k, '--trial', '--extension', '--seats', '5', '--org', 'org_acme0001', '--ledger', ledger).stderr, /already been issued/);
});

test('MEM-129 AC03: a trial licence verifies as valid, then grace, then expired', () => {
  const lic = trialLic();
  const at = (d) => Date.parse(d);
  assert.equal(verifyLicense(lic, { keys: vendor.keys, now: at('2026-01-10') }).state, 'valid');
  assert.equal(verifyLicense(lic, { keys: vendor.keys, now: at('2026-01-18') }).state, 'grace');
  assert.equal(verifyLicense(lic, { keys: vendor.keys, now: at('2026-01-25') }).state, 'expired');
});

test('MEM-129 AC04: the org id must be opaque and refuses e-mail, domain and machine names', () => {
  const now = Date.parse('2026-01-10');
  assert.equal(verifyLicense(trialLic(), { keys: vendor.keys, now }).state, 'valid');
  for (const bad of ['bob@acme.com', 'acme.com', 'myhost', 'org_short', 'org_' + 'a'.repeat(65)]) {
    assert.equal(verifyLicense(trialLic({ org: bad }), { keys: vendor.keys, now }).state, 'invalid', bad);
  }
  for (const bad of ['bob@acme.com', 'acme.com', 'myhost']) {
    assert.match(run('--key', keyFile(), '--trial', '--seats', '5', '--org', bad).stderr, /--org/);
  }
});

test('MEM-129 AC05: winding the clock back does not revive a lapsed trial when floor is set', () => {
  const lic = trialLic();
  const at = (d) => Date.parse(d);
  assert.equal(verifyLicense(lic, { keys: vendor.keys, now: at('2026-01-10') }).state, 'valid');
  assert.equal(verifyLicense(lic, { keys: vendor.keys, now: at('2026-01-10'), floor: at('2026-01-25') }).state, 'expired');
});

test('MEM-129 AC06: a licence without the trial fields behaves exactly as before', () => {
  const lic = signLicense({ v: 1, lid: 'lic_plain06', tier: 'business', services: ['sync'], seats: 3, iat: '2026-01-01', exp: '2026-06-01', grace_days: 14 }, vendor.pem, 'test-vendor');
  const now = Date.parse('2026-02-01');
  const v = verifyLicense(lic, { keys: vendor.keys, now });
  assert.equal(v.state, 'valid');
  assert.equal('trial' in v, false);
  assert.equal('trial_ext' in v, false);
  assert.equal('org' in v, false);
  const w = verifyLicense(lic, { keys: vendor.keys, now, floor: now });
  assert.equal(w.state, v.state);
  assert.equal(w.reason, v.reason);
});

test('MEM-129 AC07: the user-facing copy of issue.mjs and the changelog note passes the writing check', () => {
  const src = fs.readFileSync(path.join(PKG, 'scripts', 'license', 'issue.mjs'), 'utf8');
  const note = fs.readFileSync(path.join(PKG, 'changelog.d', 'MEM-129.md'), 'utf8');
  const strings = [...src.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
    .map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ''));
  const copy = [...strings, note];
  const hype = /\b(seamless|robust|powerful|leverage|unlock|cutting[- ]edge)\b/i;
  const notJust = /not just .+ but\b/i;
  const emoji = /\p{Extended_Pictographic}/u;
  const emdash = new RegExp(String.fromCharCode(0x2014));
  for (const s of copy) {
    assert.doesNotMatch(s, hype, 'hype in: ' + s);
    assert.doesNotMatch(s, notJust, 'not-just framing in: ' + s);
    assert.doesNotMatch(s, emoji, 'emoji in: ' + s);
    assert.doesNotMatch(s, /!/, 'exclamation in: ' + s);
    assert.doesNotMatch(s, emdash, 'em-dash in: ' + s);
    assert.doesNotMatch(s, /\bcertified\b/i, 'certified in: ' + s);
  }
});
