// MEM-137: the tier names people read are the four names from the docs, the licence tooling
// takes the new ids, and the older ids still verify with the same limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TIERS, TIER_LABELS, tierLabel, limitsFor, seatPolicy, report } from '../src/engine/entitlements.mjs';
import { TIER_NAMES, canonicalTier, verifyLicense, signLicense } from '../src/engine/license.mjs';
import { FIXTURE_KID, FIXTURE_PUBLIC_KEY, FIXTURE_LICENSES } from './helpers/tier-fixtures.mjs';
import { command } from '../src/cli/licensing.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { personalActive } from '../src/cli/relay.mjs';
import { sandbox } from './helpers/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');
const DOCS_NAMES = ['Personal', 'Personal with more computers', 'Business', 'Corporate'];
const OLD_IDS = ['personal', 'team', 'office', 'business', 'enterprise', 'founder'];
const captureLog = async (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines.join('\n');
};
const initSandbox = () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  return sb;
};

test('MEM-137 AC01: TIER_LABELS and tierLabel read the four tier names from the docs table header', () => {
  const docs = read('../docs/tiers/README.md');
  const header = docs.split('\n').find((l) => l.startsWith('| |'));
  assert.ok(header, 'the docs table header line');
  assert.deepEqual([...header.matchAll(/\[([^\]]+)\]\(/g)].map((m) => m[1]), DOCS_NAMES);
  assert.deepEqual([TIER_LABELS.free, TIER_LABELS.personal_more, TIER_LABELS.business, TIER_LABELS.corporate], DOCS_NAMES);
  assert.equal(TIER_LABELS.personal, TIER_LABELS.personal_more);
  assert.equal(TIER_LABELS.team, TIER_LABELS.business);
  assert.equal(TIER_LABELS.office, TIER_LABELS.business);
  assert.equal(TIER_LABELS.enterprise, TIER_LABELS.corporate);
  assert.equal(TIER_LABELS.founder, 'Founder');
  for (const [id, label] of Object.entries(TIER_LABELS)) assert.equal(tierLabel(id), label, id);
});

test('MEM-137 AC02: TIER_NAMES takes the new ids, canonicalTier maps the old ones, and the signed fixtures still verify', () => {
  for (const id of [...OLD_IDS, 'personal_more', 'corporate']) assert.ok(TIER_NAMES.includes(id), id);
  assert.equal(canonicalTier('personal'), 'personal_more');
  assert.equal(canonicalTier('team'), 'business');
  assert.equal(canonicalTier('office'), 'business');
  assert.equal(canonicalTier('enterprise'), 'corporate');
  for (const id of ['personal_more', 'business', 'corporate', 'founder']) assert.equal(canonicalTier(id), id, id);
  const keys = { [FIXTURE_KID]: FIXTURE_PUBLIC_KEY };
  assert.deepEqual(Object.keys(FIXTURE_LICENSES).sort(), [...OLD_IDS].sort());
  for (const [id, lic] of Object.entries(FIXTURE_LICENSES)) {
    const r = verifyLicense(lic, { keys });
    assert.equal(r.state, 'valid', id);
    assert.equal(r.tier, id, id);
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const bad = signLicense({ v: 1, lid: 'lic_fix_bad', tier: 'platinum', services: [], seats: 1, iat: '2026-01-01', exp: null, grace_days: 14 }, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), 'throwaway');
  const r = verifyLicense(bad, { keys: { throwaway: pub } });
  assert.equal(r.state, 'invalid');
  assert.match(r.reason, /unknown tier/);
});

test('MEM-137 AC03: personal_more and corporate match their existing entries, and limitsFor is unchanged for existing ids', () => {
  for (const f of ['computers', 'connectors', 'local_clients', 'services']) {
    assert.deepEqual(TIERS.personal_more[f], TIERS.personal[f], f);
    assert.deepEqual(TIERS.corporate[f], TIERS.enterprise[f], f);
  }
  for (const [alias, existing] of [['personal_more', 'personal'], ['corporate', 'enterprise']]) {
    const a = limitsFor({ state: 'valid', tier: alias, seats: 5, connectors: 8, services: ['sync'] });
    const b = limitsFor({ state: 'valid', tier: existing, seats: 5, connectors: 8, services: ['sync'] });
    assert.equal(a.tier, alias);
    assert.equal(b.tier, existing);
    const { tier: ta, ...ra } = a;
    const { tier: tb, ...rb } = b;
    assert.deepEqual(ra, rb, alias);
  }
  for (const id of OLD_IDS) {
    const l = limitsFor({ state: 'valid', tier: id, seats: 2, connectors: 4 });
    assert.equal(l.tier, id, id);
    assert.equal(l.computers, 2, id);
    assert.equal(l.connectors, 4, id);
    assert.deepEqual(l.services, (TIERS[id] || TIERS.personal).services, id);
    assert.equal(l.local_clients, null, id);
  }
  assert.deepEqual(limitsFor(null), { tier: 'free', ...TIERS.free });
});

test('MEM-137 AC04: no old tier names in the printed strings, the over-limit note uses the label, and the JSON keeps ids with tier_label added', () => {
  const src = read('../src/engine/entitlements.mjs');
  for (const w of ['Free', 'Team', 'Office', 'Enterprise']) {
    assert.doesNotMatch(src, new RegExp(`['"\`][^'"\`\\n]*\\b${w}\\b[^'"\`\\n]*['"\`]`), `${w} in a printed string`);
  }
  const over = report({ license: { state: 'valid', tier: 'team', seats: 5, connectors: 10 }, seats: { computers: 2, connectors: 12, local_clients: 0 } });
  assert.ok(over.notes.some((n) => n.includes('the Business tier covers 10')), over.notes.join(' | '));
  assert.ok(over.notes.every((n) => !/\bteam\b/.test(n)), over.notes.join(' | '));
  const free = report({ license: null, seats: { computers: 1, connectors: 1, local_clients: 0 } });
  assert.equal(free.effective_tier, 'free');
  assert.equal(free.tier_label, 'Personal');
  assert.equal(free.licensed_tier, 'free');
  const sb = initSandbox();
  const j = JSON.parse(sb.run(['license', 'status', '--json']).out);
  assert.equal(j.license.state, 'none');
  assert.equal(j.effective_tier, 'free');
  assert.equal(j.tier_label, 'Personal');
});

test('MEM-137 AC05: license status, devices and the doctor print the labels', async () => {
  const sb = initSandbox();
  assert.match(sb.run(['license', 'status']).out, /Personal, no licence needed/);
  assert.match(sb.run(['devices']).out, /Personal, no licence needed/);
  const checks = JSON.parse(sb.run(['doctor', '--json']).out);
  assert.match(checks.find((c) => c.id === 'license').detail, /Personal, no licence needed/);
  const lic = { state: 'valid', tier: 'team', lid: 'lic_ac05team', seats: 5, exp: '2027-11-15', reason: 'valid until 2027-11-15' };
  const status = await captureLog(() => command('license', ['status'], {}, { root: sb.root, env: sb.env, license: lic }));
  assert.match(status, /licence valid \(Business\)/);
  const devices = await captureLog(() => command('devices', [], {}, { root: sb.root, env: sb.env, license: lic }));
  assert.match(devices, /licence valid \(Business\)/);
  const withLic = fileChecks({ root: sb.root, env: sb.env, license: lic });
  assert.match(withLic.find((c) => c.id === 'license').detail, /licence valid \(Business\)/);
});

test('MEM-137 AC06: issue.mjs and license-dev.mjs show the new names in usage and errors', () => {
  const issue = read('../scripts/license/issue.mjs');
  assert.match(issue, /usage: issue\.mjs --key FILE --tier personal_more\|business\|corporate\|founder/);
  assert.match(issue, /--tier must be one of personal_more, business, corporate or founder \(the older ids personal, team, office and enterprise are still accepted\)/);
  assert.match(issue, /Personal needs no licence/);
  assert.match(issue, /new licences for this tier use the id \${newer}/);
  assert.match(read('../scripts/license-dev.mjs'), /--tier personal_more\|business\|corporate\|founder/);
  const run = (file, args) => {
    try {
      execFileSync('node', [path.join(here, file), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, err: '' };
    } catch (e) {
      return { code: e.status, err: e.stderr };
    }
  };
  const noargs = run('../scripts/license/issue.mjs', []);
  assert.equal(noargs.code, 2);
  assert.match(noargs.err, /--tier personal_more\|business\|corporate\|founder/);
  const free = run('../scripts/license/issue.mjs', ['--tier', 'free', '--seats', '1']);
  assert.equal(free.code, 2);
  assert.match(free.err, /Personal needs no licence/);
  const dev = run('../scripts/license-dev.mjs', []);
  assert.equal(dev.code, 2);
  assert.match(dev.err, /--tier personal_more\|business\|corporate\|founder/);
  // the older ids still pass the tier check: the run fails on the key, not the tier
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const keyFile = path.join(os.tmpdir(), `mem137-key-${process.pid}.pem`);
  fs.writeFileSync(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), { mode: 0o600 });
  try {
    for (const id of OLD_IDS) {
      const r = run('../scripts/license/issue.mjs', ['--key', keyFile, '--tier', id, '--seats', '3']);
      assert.equal(r.code, 2, id);
      assert.doesNotMatch(r.err, /--tier must be one of/, id);
      assert.match(r.err, /not the vendor key/, id);
    }
  } finally {
    fs.rmSync(keyFile, { force: true });
  }
});

test('MEM-137 AC07: personalActive treats personal and personal_more the same', () => {
  for (const tier of ['personal', 'personal_more']) {
    assert.equal(personalActive({ state: 'valid', tier }), true, `${tier} valid`);
    assert.equal(personalActive({ state: 'grace', tier }), true, `${tier} grace`);
    assert.equal(personalActive({ state: 'expired', tier }), false, `${tier} expired`);
  }
  assert.equal(personalActive(null), false);
  assert.equal(personalActive({ state: 'valid', tier: 'business' }), false);
});

test('MEM-137 AC08: the copy this contract adds follows the house writing rules', async () => {
  const files = ['../src/engine/entitlements.mjs', '../src/cli/licensing.mjs', '../src/cli/doctor.mjs', '../scripts/license/issue.mjs', '../scripts/license-dev.mjs', '../changelog.d/MEM-137.md'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\u2014/, `${f}: em-dash`);
    assert.doesNotMatch(src, /\b(seamless|robust|powerful|leverage|unlock|cutting[- ]edge)\b/i, `${f}: hype word`);
    assert.doesNotMatch(src, /\bcertified\b/i, `${f}: certified`);
    assert.doesNotMatch(src, /not just\b/i, `${f}: not just`);
    assert.doesNotMatch(src, /[\u{1F000}-\u{1FAFF}]/u, `${f}: emoji`);
  }
  // the printed tier text, the usage and error lines, and the changelog carry no exclamation marks
  const printed = [];
  const p = seatPolicy({ license: null, devices: [{ id: 'c2', kind: 'remote-computer', status: 'active', created: '2026-01-01' }] });
  printed.push(p.reason, ...p.notes);
  const expired = seatPolicy({ license: { state: 'expired', tier: 'team', seats: 1, exp: '2026-01-01' }, devices: [] });
  printed.push(expired.reason, ...expired.notes);
  const grace = seatPolicy({ license: { state: 'grace', tier: 'team', seats: 1, exp: '2026-01-01' }, devices: [] });
  printed.push(...grace.notes);
  const over = report({ license: { state: 'valid', tier: 'team', seats: 5, connectors: 10 }, seats: { computers: 2, connectors: 12, local_clients: 0 } });
  printed.push(...over.notes);
  const run = (file, args) => {
    try {
      execFileSync('node', [path.join(here, file), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return '';
    } catch (e) {
      return e.stderr;
    }
  };
  printed.push(run('../scripts/license/issue.mjs', []), run('../scripts/license/issue.mjs', ['--tier', 'free', '--seats', '1']), run('../scripts/license-dev.mjs', []));
  const sb = initSandbox();
  printed.push(sb.run(['license', 'status']).out, sb.run(['devices']).out);
  printed.push(fileChecks({ root: sb.root, env: sb.env }).find((c) => c.id === 'license').detail);
  printed.push(read('../changelog.d/MEM-137.md'));
  for (const s of printed) assert.doesNotMatch(String(s), /!/, `exclamation mark in: ${String(s).slice(0, 80)}`);
});
