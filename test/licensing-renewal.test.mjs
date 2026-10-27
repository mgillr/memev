// The seats line in memev devices, and the renewal reminder 14 days before licence expiry:
// one line in doctor and license status, and never in the AI context.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { signLicense, verifyLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { command, renewalReminder, RENEWAL_REMINDER_DAYS } from '../src/cli/licensing.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { renderCard, PROTOCOL, PROTOCOL_POINTER } from '../src/engine/card.mjs';

after(cleanup);

const DAY = 86400e3;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
const licence = (exp, seats = 3) => signLicense({ v: 1, lid: 'lic_renew001', tier: 'team', services: ['sync'], seats, iat: day(-60), exp, grace_days: 14 }, vendor.pem, 'test-vendor');
const loaded = (l) => verifyLicense(l, { keys: vendor.keys });
const capture = async (fn) => { const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' ')); try { await fn(); } finally { console.log = orig; } return lines.join('\n'); };

test('MEM-083 AC01: memev devices prints a seats line of N of M computers', async () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const l = sb.run(['devices']);
    assert.equal(l.code, 0, l.err);
    assert.match(l.out, /Seats: 1 of 1 computers/);
  } finally { sb.stop(); }
  // a licence for 3 computers with one enrolled remote computer: 2 of 3
  const { root, v } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') };
  const lic = loaded(licence(day(300)));
  const k = deviceKeygen();
  v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: k.publicKey, policy: seatPolicy({ license: lic, devices: v.devices.list() }) });
  const out = await capture(() => command('devices', [], {}, { root, env, license: lic }));
  assert.match(out, /Seats: 2 of 3 computers/);
});

test('MEM-083 AC02: a licence expiring within 14 days reminds once in doctor and status, and never in the AI context', async () => {
  const { root, v } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') };
  const soon = loaded(licence(day(10)));
  const far = loaded(licence(day(15)));
  assert.equal(RENEWAL_REMINDER_DAYS, 14);
  assert.match(renewalReminder(soon), /expires in 10 days \(/);
  assert.equal(renewalReminder(far), null);
  assert.equal(renewalReminder(null), null);
  assert.equal(renewalReminder(loaded(licence(day(-5)))), null); // expired, inside grace: no reminder

  // license status: exactly one reminder line, and none past the window
  const st = await capture(() => command('license', ['status'], {}, { root, env, license: soon }));
  assert.equal(st.split('\n').filter((l) => l.includes('expires in 10 days')).length, 1, st);
  const stFar = await capture(() => command('license', ['status'], {}, { root, env, license: far }));
  assert.doesNotMatch(stFar, /expires in/);

  // doctor: the licence check warns, with the reminder on its one line
  const lic = fileChecks({ root, env, vault: v, license: soon }).find((c) => c.id === 'license');
  assert.equal(lic.status, 'warn');
  assert.equal(lic.detail.split('expires in 10 days').length - 1, 1, lic.detail);
  const licFar = fileChecks({ root, env, vault: v, license: far }).find((c) => c.id === 'license');
  assert.equal(licFar.status, 'ok');
  assert.doesNotMatch(licFar.detail, /expires in/);

  // the AI context (resume card and protocol) never carries the reminder
  const card = renderCard(v.sessionStart(OWNER, { task: 'renew the licence' }));
  assert.doesNotMatch(card, /expires in/);
  assert.doesNotMatch(PROTOCOL + PROTOCOL_POINTER, /expires in/);
});
