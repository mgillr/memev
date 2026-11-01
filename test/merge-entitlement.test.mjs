// MEM-131: the external merge engine is called only through a provider the install supplies, and
// only when the licence allows it; otherwise both versions of a conflicted note are kept whole.
// The engine itself is a separate component under its own licence, not in this repository; this
// test drives the gate with its own stub.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { syncOnce, readConflicts } from '../src/cli/sync.mjs';
import { git } from '../src/engine/git.mjs';
import { signLicense } from '../src/engine/license.mjs';
import { resolveMerge, engineAllowed } from '../src/engine/merge.mjs';

after(cleanup);

// The other computer's clone commits as a plain test user, since it has no vault of its own.
const otherGit = (root, ...args) => git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args]);

// Two computers sharing one bare backup: the vault on `root` and a plain clone the other computer pushes from.
function twoComputers() {
  const { v, root } = newVault();
  const bare = tmpdir('remote-');
  const b = git(bare, ['init', '-q', '--bare', '-b', 'main']);
  assert.ok(b.ok, `bare init: ${b.err}`);
  git(root, ['remote', 'add', 'origin', bare]);
  const p = git(root, ['push', '-q', '-u', 'origin', 'main']);
  assert.ok(p.ok, `first push: ${p.err}`);
  const other = tmpdir('other-');
  const c = git(other, ['clone', '-q', bare, path.join(other, 'work')]);
  assert.ok(c.ok, `clone: ${c.err}`);
  return { v, root, other: path.join(other, 'work') };
}

// A same-note concurrent edit: both computers rewrite the same note from a shared base, so the
// next merge on this computer conflicts.
function noteConflict() {
  const { v, root, other } = twoComputers();
  const note = 'notes/note.md';
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, note), '# N\n\nBase\n');
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'base']);
  const p0 = git(root, ['push', '-q', 'origin', 'main']);
  assert.ok(p0.ok, `push: ${p0.err}`);
  const pl = otherGit(other, 'pull', '-q', 'origin', 'main');
  assert.ok(pl.ok, `other pull: ${pl.err}`);
  fs.writeFileSync(path.join(other, note), '# N\n\nTheirs\n');
  otherGit(other, 'add', note); otherGit(other, 'commit', '-q', '-m', 'theirs');
  const p1 = otherGit(other, 'push', '-q', 'origin', 'main');
  assert.ok(p1.ok, `other push: ${p1.err}`);
  fs.writeFileSync(path.join(root, note), '# N\n\nOurs\n');
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'ours']);
  return { v, root, other, note };
}

// A test signing key and the licences it signs. A trial carries trial and an org id on the signed object.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
function trialLicence(exp) {
  return signLicense({ v: 1, lid: 'lic_trial01', tier: 'business', services: ['merge'], seats: 2, connectors: 0, iat: '2026-10-01', exp, grace_days: 14, trial: true, org: 'org_merge0001' }, pem, 't1');
}

// A stand-in for the merge engine: it records what it is given and returns a fixed merged text.
function stubProvider(text) {
  const calls = [];
  return { calls, resolve(args) { calls.push(args); return { text }; } };
}

const NOW = Date.parse('2026-11-01');

test('MEM-131 AC01: the engine is called only when the licence allows it', () => {
  // a valid trial licence lets the engine merge a conflicted note
  let { v, root, note } = noteConflict();
  const stub = stubProvider('# N\n\nMerged\n');
  v.config.merge = { provider: stub };
  let res = syncOnce(v, { root, license: trialLicence('2027-11-15'), keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  assert.equal(stub.calls.length, 1, 'the provider is called');
  let rec = res.conflicts?.find((c) => c.path === note);
  assert.equal(rec?.how, 'merged by the merge engine', 'the engine merged the note');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# N\n\nMerged\n', 'the merged text is at the path');
  v.close();
  // a grace, expired, or absent licence does not call the engine and keeps both versions
  for (const [label, lic] of [['grace', trialLicence('2026-10-25')], ['expired', trialLicence('2026-10-05')], ['absent', null]]) {
    ({ v, root, note } = noteConflict());
    const s = stubProvider('# N\n\nMerged\n');
    v.config.merge = { provider: s };
    res = syncOnce(v, { root, license: lic, keys, at: NOW });
    assert.equal(res.error, null, `${label}: sync completes: ${res.error}`);
    assert.equal(s.calls.length, 0, `${label}: the provider is not called`);
    rec = res.conflicts?.find((c) => c.path === note);
    assert.equal(rec?.how, 'kept both versions as separate files', `${label}: both versions are kept`);
    v.close();
  }
});

test('MEM-131 AC02: the entitlement is checked on every merge, not once at start', () => {
  const lic = trialLicence('2027-11-15');
  // while the trial is current, the engine is called
  let stub = stubProvider('# N\n\nMerged\n');
  let r = resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: lic, config: { merge: { provider: stub } }, now: Date.parse('2026-11-01'), keys });
  assert.equal(r.resolved, true, 'inside the trial the engine is called');
  assert.equal(stub.calls.length, 1, 'the provider is called once');
  // the same licence, checked after the trial has expired, stops calling the engine
  stub = stubProvider('# N\n\nMerged\n');
  r = resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: lic, config: { merge: { provider: stub } }, now: Date.parse('2027-11-20'), keys });
  assert.equal(r.resolved, false, 'after the trial the engine is not called');
  assert.equal(stub.calls.length, 0, 'the provider is not called');
  assert.equal(r.keepBoth, true, 'both versions are kept');
});

test('MEM-131 AC03: a failing, missing, or refusing provider keeps both versions and logs the reason', () => {
  // a failing provider: both versions are kept byte for byte
  const { v, root, note } = noteConflict();
  v.config.merge = { provider: { resolve: () => { throw new Error('unavailable'); } } };
  const res = syncOnce(v, { root, license: trialLicence('2027-11-15'), keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded');
  assert.ok(rec.copy, 'the conflict copy is named');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# N\n\nOurs\n', "this computer's version is kept byte for byte");
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# N\n\nTheirs\n', "the other computer's version is kept byte for byte");
  v.close();
  // a missing or refusing provider: keep both and log one line naming the reason
  const lic = trialLicence('2027-11-15');
  let lines = [];
  let r = resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: lic, config: {}, now: NOW, keys, log: (l) => lines.push(l) });
  assert.equal(r.keepBoth, true, 'a missing provider keeps both');
  assert.equal(lines.length, 1, 'one line is logged');
  assert.ok(lines[0].includes('no merge provider'), 'the line names the reason');
  lines = [];
  r = resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: lic, config: { merge: { provider: { resolve: () => ({}) } } }, now: NOW, keys, log: (l) => lines.push(l) });
  assert.equal(r.keepBoth, true, 'a refusing provider keeps both');
  assert.equal(lines.length, 1, 'one line is logged');
  assert.ok(lines[0].includes('refused'), 'the line names the reason');
});

test('MEM-131 AC04: copies kept while the engine was off are listed by the conflict-copy listing', () => {
  const { v, root, note } = noteConflict();
  const res = syncOnce(v, { root, license: null, keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  const listed = readConflicts(root);
  assert.ok(listed, 'the conflict-copy listing has a record');
  const rec = listed.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the conflicted note is listed');
  assert.ok(rec.copy, 'the listing names the conflict copy');
  assert.ok(listed.files?.includes(note), 'the listing names the note');
  assert.ok(fs.existsSync(path.join(root, ...rec.copy.split('/'))), 'the conflict copy is on disk');
  v.close();
});

test('MEM-131 AC05: the provider receives the two versions and their common base and nothing else', () => {
  const stub = stubProvider('# N\n\nMerged\n');
  resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: trialLicence('2027-11-15'), config: { merge: { provider: stub } }, now: NOW, keys });
  assert.equal(stub.calls.length, 1, 'the provider is called once');
  const args = stub.calls[0];
  assert.deepEqual(Object.keys(args).sort(), ['a', 'b', 'base'], 'the provider receives only the two versions and the base');
  assert.equal(args.a, 'A\n', 'the first version');
  assert.equal(args.b, 'B\n', 'the second version');
  assert.equal(args.base, 'base\n', 'the common base');
});

test('MEM-131 AC06: the repository contains no engine source and the test uses its own stub', () => {
  // the gate is in the repository; the engine itself is external and not here
  const gate = fs.readFileSync(path.join(PKG, 'src', 'engine', 'merge.mjs'), 'utf8');
  assert.ok(gate.includes('export function engineAllowed'), 'the gate is present');
  assert.ok(gate.includes('export function resolveMerge'), 'the gate calls the provider');
  assert.ok(!/require\(|import[^'"]*['"]\.\.\/(engine|merge-engine)/.test(gate), 'the gate does not pull in engine source');
  // the test uses its own stub, not the engine
  const testSrc = fs.readFileSync(new URL('./merge-entitlement.test.mjs', import.meta.url), 'utf8');
  assert.ok(testSrc.includes('function stubProvider'), 'the test defines its own stub');
  assert.ok(testSrc.includes('provider: stub'), 'the test uses the stub as the provider');
});

test('MEM-131 AC07: the logged fallback line and the changelog note pass the house writing check', () => {
  const hype = ['seamless', 'robust', 'powerful', 'leverage', 'unlock', 'cutting-edge'];
  const check = (text, label) => {
    const lower = text.toLowerCase();
    for (const w of hype) assert.ok(!lower.includes(w), `${label}: no hype word "${w}"`);
    assert.ok(!/not just .* but /.test(lower), `${label}: no "not just X but Y" framing`);
    assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text), `${label}: no emoji`);
    assert.ok(!text.includes('!'), `${label}: no exclamation mark`);
    assert.ok(!text.includes('\u2014'), `${label}: no em-dash`);
    assert.ok(!lower.includes('certified'), `${label}: never "certified"`);
  };
  // the logged fallback lines, produced by the gate
  const lines = [];
  const lic = trialLicence('2027-11-15');
  resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: null, config: { merge: { provider: stubProvider('M\n') } }, now: NOW, keys, log: (l) => lines.push(l) });
  resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: lic, config: {}, now: NOW, keys, log: (l) => lines.push(l) });
  resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: lic, config: { merge: { provider: { resolve: () => ({}) } } }, now: NOW, keys, log: (l) => lines.push(l) });
  resolveMerge({ a: 'A\n', b: 'B\n', base: 'base\n', license: lic, config: { merge: { provider: { resolve: () => { throw new Error('x'); } } } }, now: NOW, keys, log: (l) => lines.push(l) });
  assert.ok(lines.length >= 4, 'the fallback lines are logged');
  for (const l of lines) check(l, 'fallback line');
  // the changelog note
  const note = fs.readFileSync(path.join(PKG, 'changelog.d', 'MEM-131.md'), 'utf8');
  check(note, 'changelog note');
});

test('T1-c40: the merge gate allows a paid licence in its window and in grace, and a trial only in its window', () => {
  const paidLic = (exp) => signLicense({ v: 1, lid: 'lic_paid0001', tier: 'business', services: ['merge'], seats: 2, iat: '2026-10-01', exp, grace_days: 14 }, pem, 't1');
  const noMerge = signLicense({ v: 1, lid: 'lic_nomerge1', tier: 'business', services: ['sync'], seats: 2, iat: '2026-10-01', exp: '2027-11-15', grace_days: 14 }, pem, 't1');
  assert.equal(typeof engineAllowed, 'function', 'engineAllowed exists');
  assert.equal(engineAllowed(paidLic('2027-11-15'), { now: NOW, keys }), true, 'paid, in its window');
  assert.equal(engineAllowed(paidLic('2026-10-25'), { now: NOW, keys }), true, 'paid, in grace');
  assert.equal(engineAllowed(paidLic('2026-10-05'), { now: NOW, keys }), false, 'paid, past grace');
  assert.equal(engineAllowed(trialLicence('2027-11-15'), { now: NOW, keys }), true, 'a trial in its window');
  assert.equal(engineAllowed(trialLicence('2026-10-25'), { now: NOW, keys }), false, 'the same trial in grace');
  assert.equal(engineAllowed(noMerge, { now: NOW, keys }), false, 'a licence without the merge service');
  assert.equal(engineAllowed(null, { now: NOW, keys }), false, 'no licence');
});
