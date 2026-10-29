// MEM-133: a paid licence installed over a trial converts in place. No restart, no vault change,
// no re-enrolment.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { signLicense, verifyLicense, loadLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { installLicense, readTrialRecord, mergeAllowed, pendingMergeCopies, command } from '../src/cli/licensing.mjs';
import { stringLiterals } from './helpers/string-literals.mjs';

const vendor = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } };
})();

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function snapshot(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) out[r] = sha(fs.readFileSync(p));
    }
  };
  walk(dir, '');
  return out;
}
const capture = async (fn) => {
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines.join('\n');
};

after(() => cleanup());

test('MEM-133 AC01: a paid licence installed over a trial replaces it in place, with no restart, no vault change and no re-enrolment', () => {
  const { root, v } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('convert1-conf-') };
  const trialNow = Date.parse('2026-01-10T00:00:00Z');
  const lapsedNow = Date.parse('2026-01-25T00:00:00Z');
  const trial = signLicense({ v: 1, lid: 'lic_trial0001', tier: 'business', services: ['merge'], seats: 4, iat: '2026-01-01', exp: '2026-01-15', grace_days: 7, trial: true, org: 'org_acme0001' }, vendor.pem, 'test-vendor');
  const paid = signLicense({ v: 1, lid: 'lic_paid0001', tier: 'business', services: ['merge'], seats: 3, iat: '2026-01-01', exp: '2027-01-01', grace_days: 7 }, vendor.pem, 'test-vendor');
  const trialFile = path.join(tmpdir('convert1-t-'), 'licence.json');
  const paidFile = path.join(tmpdir('convert1-p-'), 'licence.json');
  fs.writeFileSync(trialFile, JSON.stringify(trial));
  fs.writeFileSync(paidFile, JSON.stringify(paid));

  const t0 = installLicense({ file: trialFile, env, keys: vendor.keys, now: trialNow, root });
  assert.equal(t0.ok, true, t0.reason);
  assert.equal(t0.trial, true);

  const policy = (now) => seatPolicy({ license: loadLicense({ env, keys: vendor.keys, now }), devices: v.devices.list() });
  const ids = [];
  for (const label of ['alpha', 'beta', 'gamma']) {
    const k = deviceKeygen();
    ids.push(v.devices.enroll(v.tokens, { kind: 'remote-computer', label, pubkey: k.publicKey, policy: policy(trialNow) }).device.id);
  }
  v.devices.data.devices[ids[0]].created = '2026-01-01T00:00:00Z';
  v.devices.data.devices[ids[1]].created = '2026-01-02T00:00:00Z';
  v.devices.data.devices[ids[2]].created = '2026-01-03T00:00:00Z';
  v.devices.save();

  assert.equal(policy(trialNow).writable.size, 3, 'while the trial is live all three write');
  assert.equal(policy(lapsedNow).state, 'expired', 'the trial lapses');
  assert.equal(policy(lapsedNow).writable.size, 0, 'a lapsed trial lets no computer write');

  const before = snapshot(path.join(root, '.memev'));
  const r = installLicense({ file: paidFile, env, keys: vendor.keys, now: lapsedNow, root });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.converted, true);

  assert.deepEqual(snapshot(path.join(root, '.memev')), before, 'no vault change: no re-enrolment, tokens and keys kept');

  const lic = loadLicense({ env, keys: vendor.keys, now: lapsedNow });
  assert.equal(lic.lid, 'lic_paid0001', 'no restart: the licence is re-read from disk and is now the paid one');
  assert.equal(lic.state, 'valid');

  const p = seatPolicy({ license: lic, devices: v.devices.list() });
  assert.equal(p.seats, 3);
  assert.deepEqual([...p.writable].sort(), [ids[0], ids[1]].sort(), 'the two oldest write again');
  assert.deepEqual(p.read_only, [ids[2]], 'the newest stays read-only');
  v.close();
});

test('MEM-133 AC02: a paid licence installed over a trial resumes the merge engine at the next sync, and the keep-both copies are listed but never merged', () => {
  const { root, v } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('convert2-conf-') };
  const now = Date.parse('2026-01-25T00:00:00Z');
  const trial = signLicense({ v: 1, lid: 'lic_trial0002', tier: 'business', services: ['merge'], seats: 4, iat: '2026-01-01', exp: '2026-01-15', grace_days: 7, trial: true, org: 'org_acme0002' }, vendor.pem, 'test-vendor');
  const paid = signLicense({ v: 1, lid: 'lic_paid0002', tier: 'business', services: ['merge'], seats: 3, iat: '2026-01-01', exp: '2027-01-01', grace_days: 7 }, vendor.pem, 'test-vendor');
  const trialFile = path.join(tmpdir('convert2-t-'), 'licence.json');
  const paidFile = path.join(tmpdir('convert2-p-'), 'licence.json');
  fs.writeFileSync(trialFile, JSON.stringify(trial));
  fs.writeFileSync(paidFile, JSON.stringify(paid));

  // a sync left a keep-both copy on disk
  const copyRel = 'notes/plan.conflict-20260101.md';
  const copyAbs = path.join(root, copyRel);
  fs.mkdirSync(path.dirname(copyAbs), { recursive: true });
  fs.writeFileSync(copyAbs, 'the other computer kept this version\n');
  const jobsPath = path.join(root, '.memev', 'jobs.json');
  fs.mkdirSync(path.dirname(jobsPath), { recursive: true });
  fs.writeFileSync(jobsPath, JSON.stringify({ sync: { conflicts: [{ path: 'notes/plan.md', kind: 'note', how: 'kept both versions as separate files', copy: copyRel }] } }));

  const before = fs.readFileSync(copyAbs);
  installLicense({ file: trialFile, env, keys: vendor.keys, now, root });
  const r = installLicense({ file: paidFile, env, keys: vendor.keys, now, root });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.converted, true);

  assert.equal(r.merge.resumes, true, 'the merge engine is allowed at the next sync');
  assert.equal(r.merge.pending.length, 1, 'the keep-both copy is listed');
  assert.equal(r.merge.pending[0].copy, copyRel);

  assert.deepEqual(fs.readFileSync(copyAbs), before, 'the copy is left exactly as the sync left it');
  const conflicts = JSON.parse(fs.readFileSync(jobsPath, 'utf8')).sync.conflicts;
  assert.equal(conflicts.length, 1, 'the conflict record is intact, not merged');
  assert.equal(conflicts[0].copy, copyRel);
  v.close();
});

test('MEM-133 AC03: a trial is refused over a live paid licence, and a second trial for the same org is refused locally', () => {
  const env = { MEMEV_CONFIG_DIR: tmpdir('convert3-conf-') };
  const now = Date.parse('2026-02-01T00:00:00Z');
  const paid = signLicense({ v: 1, lid: 'lic_paid0003', tier: 'business', services: ['merge'], seats: 3, iat: '2026-01-01', exp: '2027-01-01', grace_days: 7 }, vendor.pem, 'test-vendor');
  const paidFile = path.join(tmpdir('convert3-p-'), 'licence.json');
  fs.writeFileSync(paidFile, JSON.stringify(paid));
  const r0 = installLicense({ file: paidFile, env, keys: vendor.keys, now });
  assert.equal(r0.ok, true, r0.reason);

  // a trial over the live paid licence is refused
  const trialA = signLicense({ v: 1, lid: 'lic_trial0003', tier: 'business', services: ['merge'], seats: 4, iat: '2026-02-01', exp: '2026-02-15', grace_days: 7, trial: true, org: 'org_acme0003' }, vendor.pem, 'test-vendor');
  const trialFileA = path.join(tmpdir('convert3-a-'), 'licence.json');
  fs.writeFileSync(trialFileA, JSON.stringify(trialA));
  const r1 = installLicense({ file: trialFileA, env, keys: vendor.keys, now });
  assert.equal(r1.ok, false, 'a trial cannot be installed over a live paid licence');
  assert.match(r1.reason, /paid licence is already active/);
  assert.equal(loadLicense({ env, keys: vendor.keys, now }).lid, 'lic_paid0003', 'the paid licence is untouched');

  // a fresh org may take a trial
  const env2 = { MEMEV_CONFIG_DIR: tmpdir('convert3-conf2-') };
  const trialB = signLicense({ v: 1, lid: 'lic_trial0004', tier: 'business', services: ['merge'], seats: 4, iat: '2026-02-01', exp: '2026-02-15', grace_days: 7, trial: true, org: 'org_fresh0003' }, vendor.pem, 'test-vendor');
  const trialFileB = path.join(tmpdir('convert3-b-'), 'licence.json');
  fs.writeFileSync(trialFileB, JSON.stringify(trialB));
  const r2 = installLicense({ file: trialFileB, env: env2, keys: vendor.keys, now });
  assert.equal(r2.ok, true, r2.reason);
  assert.equal(r2.trial, true);

  // a second trial for the same org is refused locally
  const trialC = signLicense({ v: 1, lid: 'lic_trial0005', tier: 'business', services: ['merge'], seats: 4, iat: '2026-02-20', exp: '2026-03-05', grace_days: 7, trial: true, org: 'org_fresh0003' }, vendor.pem, 'test-vendor');
  const trialFileC = path.join(tmpdir('convert3-c-'), 'licence.json');
  fs.writeFileSync(trialFileC, JSON.stringify(trialC));
  const r3 = installLicense({ file: trialFileC, env: env2, keys: vendor.keys, now: Date.parse('2026-02-20T00:00:00Z') });
  assert.equal(r3.ok, false, 'a second trial for the same org is refused');
  assert.match(r3.reason, /already had a trial/);
  assert.equal(loadLicense({ env: env2, keys: vendor.keys, now: Date.parse('2026-02-20T00:00:00Z') }).lid, 'lic_trial0004', 'the first trial is untouched');
});

test('MEM-133 AC04: the trial ends the day the paid licence is installed, and the paid licence takes its own dates', () => {
  const env = { MEMEV_CONFIG_DIR: tmpdir('convert4-conf-') };
  const now = Date.parse('2026-01-05T00:00:00Z');
  const trial = signLicense({ v: 1, lid: 'lic_trial0006', tier: 'business', services: ['merge'], seats: 4, iat: '2026-01-01', exp: '2026-01-15', grace_days: 7, trial: true, org: 'org_acme0004' }, vendor.pem, 'test-vendor');
  const paid = signLicense({ v: 1, lid: 'lic_paid0006', tier: 'business', services: ['merge'], seats: 3, iat: '2026-01-01', exp: '2027-01-01', grace_days: 7 }, vendor.pem, 'test-vendor');
  const trialFile = path.join(tmpdir('convert4-t-'), 'licence.json');
  const paidFile = path.join(tmpdir('convert4-p-'), 'licence.json');
  fs.writeFileSync(trialFile, JSON.stringify(trial));
  fs.writeFileSync(paidFile, JSON.stringify(paid));

  installLicense({ file: trialFile, env, keys: vendor.keys, now });
  const r = installLicense({ file: paidFile, env, keys: vendor.keys, now });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.converted, true);

  const rec = readTrialRecord(env)['org_acme0004'];
  assert.equal(rec.ended, '2026-01-05', 'the trial ends the day the paid licence is installed');
  assert.equal(rec.converted_to, 'lic_paid0006');

  const lic = loadLicense({ env, keys: vendor.keys, now });
  assert.equal(lic.exp, '2027-01-01', 'the paid licence takes its own expiry');
  assert.equal(lic.iat, '2026-01-01', 'the paid licence takes its own issue date');
  assert.notEqual(lic.exp, '2026-01-15', 'no unused trial days carry over');
});

test('MEM-133 AC05: after conversion, the licence status reports the paid tier and no trial remains', async () => {
  const { root, v } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('convert5-conf-') };
  const now = Date.parse('2026-01-25T00:00:00Z');
  const trial = signLicense({ v: 1, lid: 'lic_trial0007', tier: 'business', services: ['merge'], seats: 4, iat: '2026-01-01', exp: '2026-01-15', grace_days: 7, trial: true, org: 'org_acme0005' }, vendor.pem, 'test-vendor');
  const paid = signLicense({ v: 1, lid: 'lic_paid0007', tier: 'business', services: ['merge'], seats: 3, iat: '2026-01-01', exp: '2027-01-01', grace_days: 7 }, vendor.pem, 'test-vendor');
  const trialFile = path.join(tmpdir('convert5-t-'), 'licence.json');
  const paidFile = path.join(tmpdir('convert5-p-'), 'licence.json');
  fs.writeFileSync(trialFile, JSON.stringify(trial));
  fs.writeFileSync(paidFile, JSON.stringify(paid));

  installLicense({ file: trialFile, env, keys: vendor.keys, now });
  const r = installLicense({ file: paidFile, env, keys: vendor.keys, now });
  assert.equal(r.converted, true);

  const lic = loadLicense({ env, keys: vendor.keys, now });
  const out = await capture(() => command('license', ['status'], {}, { root, env, license: lic }));
  assert.match(out, /Business/, 'the status reports the paid tier');
  assert.doesNotMatch(out, /trial/i, 'no trial remains in the status');
  v.close();
});

test('MEM-133 AC06: the user-facing copy stays plain, with no hype words, no em-dash, no exclamation and no emoji', () => {
  const files = [
    path.join(process.cwd(), 'src', 'cli', 'licensing.mjs'),
    path.join(process.cwd(), 'changelog.d', 'MEM-133.md'),
  ];
  const banned = ['seamless', 'robust', 'powerful', 'leverage', 'unlock', 'cutting-edge', 'certified', 'not just'];
  for (const f of files) {
    const lits = stringLiterals(fs.readFileSync(f, 'utf8'));
    for (const s of lits) {
      for (const w of banned) assert.ok(!s.toLowerCase().includes(w), `${f} copy contains the hype word "${w}": ${s}`);
      assert.ok(!s.includes('!'), `${f} copy has an exclamation: ${s}`);
      assert.ok(!s.includes('\u2014'), `${f} copy has an em-dash: ${s}`);
      assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s), `${f} copy has an emoji: ${s}`);
    }
  }
});

test('MEM-133 review 1: an expired licence file is refused over a live licence, and the live trial stays installed', () => {
  const env = { MEMEV_CONFIG_DIR: tmpdir('convert6-conf-') };
  const now = Date.parse('2026-03-05T00:00:00Z');
  const trial = signLicense({ v: 1, lid: 'lic_trial0008', tier: 'business', services: ['merge'], seats: 4, iat: '2026-03-01', exp: '2026-03-15', grace_days: 7, trial: true, org: 'org_acme0006' }, vendor.pem, 'test-vendor');
  const expired = signLicense({ v: 1, lid: 'lic_paidold01', tier: 'business', services: ['merge'], seats: 3, iat: '2024-02-01', exp: '2025-02-01', grace_days: 7 }, vendor.pem, 'test-vendor');
  const trialFile = path.join(tmpdir('convert6-t-'), 'licence.json');
  const expiredFile = path.join(tmpdir('convert6-e-'), 'licence.json');
  fs.writeFileSync(trialFile, JSON.stringify(trial));
  fs.writeFileSync(expiredFile, JSON.stringify(expired));

  const t0 = installLicense({ file: trialFile, env, keys: vendor.keys, now });
  assert.equal(t0.ok, true, t0.reason);

  const r = installLicense({ file: expiredFile, env, keys: vendor.keys, now });
  assert.equal(r.ok, false, 'an expired file is refused over a live licence');
  assert.match(r.reason, /expired/);

  const lic = loadLicense({ env, keys: vendor.keys, now });
  assert.equal(lic.lid, 'lic_trial0008', 'the live trial stays installed');
  assert.equal(lic.state, 'valid');
  const rec = readTrialRecord(env)['org_acme0006'];
  assert.equal(rec.ended, null, 'the trial is not ended');
  assert.equal(rec.converted_to, null);
});

test('MEM-133 review 2: a conversion without the merge service does not resume it, and no user-facing line claims it does', () => {
  const { root, v } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('convert7-conf-') };
  const now = Date.parse('2026-01-25T00:00:00Z');
  const trial = signLicense({ v: 1, lid: 'lic_trial0009', tier: 'business', services: ['merge'], seats: 4, iat: '2026-01-01', exp: '2026-01-15', grace_days: 7, trial: true, org: 'org_acme0007' }, vendor.pem, 'test-vendor');
  const paid = signLicense({ v: 1, lid: 'lic_paid0009', tier: 'business', services: [], seats: 3, iat: '2026-01-01', exp: '2027-01-01', grace_days: 7 }, vendor.pem, 'test-vendor');
  const trialFile = path.join(tmpdir('convert7-t-'), 'licence.json');
  const paidFile = path.join(tmpdir('convert7-p-'), 'licence.json');
  fs.writeFileSync(trialFile, JSON.stringify(trial));
  fs.writeFileSync(paidFile, JSON.stringify(paid));

  const t0 = installLicense({ file: trialFile, env, keys: vendor.keys, now, root });
  assert.equal(t0.ok, true, t0.reason);
  const r = installLicense({ file: paidFile, env, keys: vendor.keys, now, root });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.converted, true);
  assert.equal(r.merge.resumes, false, 'a licence without the merge service does not resume the merge engine');

  // the copy the CLI prints makes no claim about the merge engine (the CLI takes the production key, so the line is checked over the file)
  const lits = stringLiterals(fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'licensing.mjs'), 'utf8'));
  assert.ok(!lits.some((s) => s.includes('merge engine')), 'no user-facing line claims the merge engine runs');
  v.close();
});
