// SPDX-License-Identifier: Apache-2.0
// Separation and abuse guards for the Business trial (MEM-134). The guards live in
// src/engine/identity.mjs and are wired into the licence install and the member invite. A trial is
// a business licence with the trial's shape (TRIAL_DEFAULTS.computers seats over a
// TRIAL_DEFAULTS.days term); it installs only on a business identity into an organisation vault,
// and personal and business stay fully separate.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TRIAL_DEFAULTS, isTrialLicense, installGuard, separationGuard, memberInviteGuard, offboard,
} from '../src/engine/identity.mjs';
import { signLicense, extraFields } from '../src/engine/license.mjs';
import { memberInvite } from '../src/cli/invite.mjs';
import { tmpdir } from './helpers/tmp.mjs';

// A signed trial-shaped licence on a throwaway key: the guards read the shape, not the signature.
function makeTrialLicense({ tier = 'business', seats = TRIAL_DEFAULTS.computers, iat = '2026-01-01', exp = '2026-01-15' } = {}) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return signLicense({ v: 1, lid: 'lic_trial134', tier, services: ['sync'], seats, connectors: 10, iat, exp, grace_days: 14 }, pem, 'test-trial');
}

const PERSONAL = { kind: 'personal' };
const BUSINESS = { kind: 'business', organisation: true };
const ORG_VAULT = { profile: 'org' };
const PERSONAL_VAULT = { port: 7787 };

test('MEM-134 AC01: a trial licence installs only on a business identity, refused on a personal identity or a personal vault', () => {
  const lic = makeTrialLicense();
  assert.equal(isTrialLicense(lic), true, 'the fixture is a trial licence');
  const a = installGuard({ license: lic, identity: PERSONAL, vault: ORG_VAULT });
  assert.equal(a.ok, false); assert.match(a.reason, /personal identity/);
  const b = installGuard({ license: lic, identity: BUSINESS, vault: PERSONAL_VAULT });
  assert.equal(b.ok, false); assert.match(b.reason, /organisation/);
  const c = installGuard({ license: lic, identity: BUSINESS, vault: ORG_VAULT });
  assert.equal(c.ok, true); assert.equal(c.reason, null);
  assert.equal(installGuard({ license: { ...lic, seats: 3 }, identity: PERSONAL, vault: PERSONAL_VAULT }).ok, true, 'a non-trial licence is not guarded here');
});

test('MEM-134 AC02: with a trial, join, mount or release from a personal identity and a mount of a personal vault are refused', () => {
  const trial = isTrialLicense(makeTrialLicense());
  assert.equal(trial, true);
  for (const action of ['join', 'mount', 'release']) {
    const r = separationGuard({ action, identity: PERSONAL, vault: ORG_VAULT, trial });
    assert.equal(r.ok, false, `${action} from a personal identity`);
    assert.match(r.reason, /personal identity/);
  }
  const m = separationGuard({ action: 'mount', identity: BUSINESS, vault: PERSONAL_VAULT, trial });
  assert.equal(m.ok, false); assert.match(m.reason, /personal vault/);
  assert.equal(separationGuard({ action: 'join', identity: BUSINESS, vault: ORG_VAULT, trial }).ok, true);
  assert.equal(separationGuard({ action: 'join', identity: PERSONAL, vault: ORG_VAULT, trial: false }).ok, true, 'without a trial the guard does not refuse');
});

test('MEM-134 AC03: a member invite on a vault with no organisation, or redeemed from a personal identity, is refused and counts toward nothing', () => {
  const a = memberInviteGuard({ vault: PERSONAL_VAULT, identity: BUSINESS });
  assert.equal(a.ok, false); assert.equal(a.counts, false); assert.match(a.reason, /organisation/);
  const b = memberInviteGuard({ vault: ORG_VAULT, identity: PERSONAL });
  assert.equal(b.ok, false); assert.equal(b.counts, false); assert.match(b.reason, /personal identity/);
  const c = memberInviteGuard({ vault: ORG_VAULT, identity: BUSINESS });
  assert.equal(c.ok, true); assert.equal(c.counts, true);
  const root = tmpdir();
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memev', 'config.json'), JSON.stringify(PERSONAL_VAULT));
  const r = memberInvite(root);
  assert.equal(r.ok, false); assert.equal(r.counts, false);
});

test('MEM-134 AC04: offboarding is identical with and without a trial licence', () => {
  const lic = makeTrialLicense();
  const withTrial = offboard({ license: lic, trial: true, members: 3, computers: 4 });
  const noTrial = offboard({ license: null, trial: false, members: 3, computers: 4 });
  const otherLic = offboard({ license: { ...lic, seats: 3 }, trial: false, members: 3, computers: 4 });
  assert.deepEqual(withTrial, noTrial);
  assert.deepEqual(withTrial, otherLic);
  assert.equal(withTrial.revoked, true);
  assert.equal(withTrial.wiped, true);
  assert.equal(withTrial.export, 'refused');
  assert.equal(withTrial.audit, 'kept');
  assert.equal(withTrial.seats_released, 4);
});

test('MEM-134 AC05: a trial licence carries no domain, name, e-mail or machine', () => {
  const lic = makeTrialLicense();
  assert.deepEqual(extraFields(lic), []);
  for (const k of ['domain', 'name', 'email', 'machine']) assert.equal(k in lic, false, `${k} must not be on the licence`);
});

test('MEM-134 AC06: the issuing docs state the issuer rules and TRIAL_DEFAULTS numbers, and the issue script carries no domain logic', () => {
  const docs = fs.readFileSync(path.join('docs', 'BUSINESS-TRIAL-ISSUING.md'), 'utf8');
  assert.match(docs, new RegExp(TRIAL_DEFAULTS.members + '\\s+members'));
  assert.match(docs, new RegExp(TRIAL_DEFAULTS.computers + '\\s+computers'));
  assert.match(docs, new RegExp(TRIAL_DEFAULTS.days + '\\s+days'));
  assert.match(docs, new RegExp('one ' + TRIAL_DEFAULTS.extension_days + '-day extension'));
  assert.match(docs, /one trial per verified work domain/i);
  assert.match(docs, /per organisation id/i);
  assert.match(docs, /only as a hash/i);
  assert.match(docs, /consumer mail domains are refused/i);
  assert.match(docs, /second trial is only by the owner's exception/i);
  assert.match(docs, /configurable cap on members and computers/i);
  assert.match(docs, /order form/i);
  assert.match(docs, /issued on the day of install/i);
  assert.match(docs, /once per organisation/i);
  assert.match(docs, /self-serve on request/i);
  assert.match(docs, /verified work contact/i);
  const issue = fs.readFileSync(path.join('scripts', 'license', 'issue.mjs'), 'utf8');
  assert.doesNotMatch(issue, /TRIAL_DEFAULTS|isTrialLicense|installGuard|memberInviteGuard|separationGuard|offboard/i);
});

test('MEM-134 AC07: the refusal messages and the issuing docs pass the house writing check', () => {
  const docs = fs.readFileSync(path.join('docs', 'BUSINESS-TRIAL-ISSUING.md'), 'utf8');
  const lic = makeTrialLicense();
  const reasons = [
    installGuard({ license: lic, identity: PERSONAL, vault: ORG_VAULT }).reason,
    installGuard({ license: lic, identity: BUSINESS, vault: PERSONAL_VAULT }).reason,
    separationGuard({ action: 'join', identity: PERSONAL, vault: ORG_VAULT, trial: true }).reason,
    separationGuard({ action: 'mount', identity: BUSINESS, vault: PERSONAL_VAULT, trial: true }).reason,
    memberInviteGuard({ vault: PERSONAL_VAULT, identity: BUSINESS }).reason,
    memberInviteGuard({ vault: ORG_VAULT, identity: PERSONAL }).reason,
  ].filter(Boolean);
  assert.ok(reasons.length >= 6, 'the refusal messages are present');
  const hype = /\b(seamless|robust|powerful|leverage|unlock|cutting-edge)\b/i;
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}]/u;
  for (const text of [docs, ...reasons]) {
    assert.doesNotMatch(text, hype);
    assert.doesNotMatch(text, /not just [^.\n]{0,80}\bbut\b/i);
    assert.doesNotMatch(text, emoji);
    assert.doesNotMatch(text, /!/);
    assert.doesNotMatch(text, /[\u2014]/);
    assert.doesNotMatch(text, /\bcertified\b/i);
  }
});
