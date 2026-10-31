// WO-11-A: regression guards for the four paid paths. Each guard proves the charter's promise
// that a paid gate changes sync behaviour and never deletes or locks a user's files, and the
// doctor names each path on every run so a regression is reported, not silent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { git } from '../src/engine/git.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
import { signLicense, verifyLicense, loadLicense, licenseFile, LICENSE_KEYS } from '../src/engine/license.mjs';
import { seatPolicy, readOnlyReason } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { setRelay, relayStateFile } from '../src/cli/relay.mjs';
import { selectProvider } from '../src/services/providers.mjs';
import { installLicense, registry } from '../src/cli/licensing.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { sha256 } from '../src/engine/util.mjs';

after(cleanup);

// A test signing key and the licences it signs. The merge service is what the paid paths need.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const NOW = Date.parse('2026-11-01');
const DAY = 86400e3;
const day = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);
const paidLicence = (exp) => signLicense({ v: 1, lid: 'lic_wo11a', tier: 'business', services: ['merge'], seats: 3, iat: day(-30), exp, grace_days: 14 }, pem, 't1');
const verified = (l) => (l ? verifyLicense(l, { keys, now: NOW }) : null);

// Every user-visible file under root (not .git or .memev), as [relative path, sha256] sorted by path.
function tree(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '.git' && e.name !== '.memev' && e.name !== '.memev-writers') walk(p); }
      else out.push([path.relative(root, p), sha256(fs.readFileSync(p))]);
    }
  };
  walk(root);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// Two computers sharing one bare backup: the vault on `root` and a plain clone the other pushes from.
const otherGit = (root, ...args) => git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args]);
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

test('WO-11-A AC01: with the relay down, the vault keeps working through the git backup and the doctor names the state', () => {
  const { v, root } = newVault();
  const bare = tmpdir('remote-');
  const b = git(bare, ['init', '-q', '--bare', '-b', 'main']);
  assert.ok(b.ok, `bare init: ${b.err}`);
  git(root, ['remote', 'add', 'origin', bare]);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes/keep.md'), '# Keep\n\nThis note must survive the relay going down.\n');
  git(root, ['add', 'notes/keep.md']); git(root, ['commit', '-q', '-m', 'add note']);
  const p0 = git(root, ['push', '-q', '-u', 'origin', 'main']);
  assert.ok(p0.ok, `first push: ${p0.err}`);
  // the relay is on but cannot be reached: the state file says so
  setRelay(root, { enabled: true, url: 'relay://127.0.0.1:9', domain: 'relay.test' });
  fs.writeFileSync(relayStateFile(root), JSON.stringify({ state: 'cannot reach the relay (retrying)', updated: new Date(NOW).toISOString() }));
  // the sync still runs through the git backup, not the relay
  assert.equal(selectProvider('sync', { root, config: v.config }).id, 'git', 'the sync provider is the git backup');
  const before = tree(root);
  const r = syncOnce(v, { root });
  assert.equal(r.error, null, `sync with the relay down: ${r.error}`);
  assert.equal(r.pushed, true, 'the sync pushed through the git backup');
  // no note was lost: the user-visible tree is byte for byte the same
  assert.deepEqual(tree(root), before, 'the vault tree is unchanged with the relay down');
  // the doctor names the relay state
  const relay = fileChecks({ root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') }, vault: v }).find((c) => c.id === 'relay');
  assert.ok(relay, 'the doctor has a relay check');
  assert.equal(relay.status, 'warn', 'the relay check is a warning while the relay is down');
  assert.match(relay.detail, /down or not started/, 'the relay check names the down state');
  assert.match(relay.detail, /git backup/, 'the relay check names the git backup fallback');
  v.close();
});

// A merge provider that counts its calls.
const counting = (resolve) => { const p = { calls: 0, resolve: (args) => { p.calls++; return resolve(args); } }; return p; };

test('WO-11-A AC02: a same-note conflict keeps both versions with the engine off and with a refusing or timing out engine', () => {
  // each case has a provider that counts its calls: the engine cases reach it once, and with the flag off it is never
  // called (it would merge if it were, so a wrong call fails twice)
  const cases = [
    ['the engine flag off', null, counting(() => ({ text: '# N\n\nMerged\n' })), 0],
    ['a refusing engine', paidLicence(day(30)), counting(() => ({})), 1],
    ['a timing out engine', paidLicence(day(30)), counting(() => { throw new Error('timed out'); }), 1],
  ];
  for (const [label, lic, provider, calls] of cases) {
    const { v, root, note } = noteConflict();
    v.config.merge = { provider };
    // at is the clock syncOnce hands on to the merge (syncSteps passes it as now), so the licence is checked at NOW
    const res = syncOnce(v, { root, license: lic, keys, at: NOW });
    assert.equal(res.error, null, `${label}: sync completes: ${res.error}`);
    assert.equal(provider.calls, calls, `${label}: the merge engine was called ${provider.calls} time(s), not ${calls}`);
    const rec = res.conflicts?.find((c) => c.path === note);
    assert.ok(rec, `${label}: the note is recorded`);
    assert.ok(rec.copy, `${label}: the conflict copy is named`);
    assert.equal(rec.how, 'kept both versions as separate files', `${label}: both versions are kept`);
    assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# N\n\nOurs\n', `${label}: this computer's version is kept byte for byte`);
    assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# N\n\nTheirs\n', `${label}: the other computer's version is kept byte for byte`);
    v.close();
  }
});

test('WO-11-A AC03: an expired licence past its grace keeps this computer reading and writing and the added computers read only', () => {
  const { v, root } = newVault();
  const expired = verified(paidLicence(day(-30)));
  assert.equal(expired.state, 'expired', 'the licence is past its grace period');
  // an added computer, enrolled while the licence was live
  const k = deviceKeygen();
  v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: k.publicKey, policy: seatPolicy({ license: verified(paidLicence(day(30))), devices: v.devices.list() }) });
  const remote = v.devices.list().find((d) => d.kind === 'remote-computer');
  // this computer keeps reading and writing
  const r = v.remember(OWNER, { text: 'A fact that must stay readable after the licence lapses.', force: true });
  assert.equal(r.saved, true, 'this computer can still write');
  const got = v.get(OWNER, r.path);
  assert.ok(got.body.includes('must stay readable'), 'this computer can still read');
  // the notes are readable and exportable as plain Markdown
  const onDisk = fs.readFileSync(path.join(root, r.path), 'utf8');
  assert.ok(onDisk.includes('must stay readable'), 'the note is plain Markdown on disk');
  assert.ok(onDisk.startsWith('#'), 'the note is a Markdown document, not a lock or a blob');
  // the added computer can read but cannot write
  const policy = seatPolicy({ license: expired, devices: v.devices.list() });
  assert.ok(policy.read_only.includes(remote.id), 'the added computer is read only');
  assert.ok(!policy.writable.has(remote.id), 'the added computer cannot write');
  assert.match(readOnlyReason(policy, remote), /expired/, 'the read only reason names the expired licence');
  // nothing is deleted or locked
  assert.ok(fs.existsSync(path.join(root, r.path)), 'the note is not deleted');
  assert.equal(v.get(OWNER, r.path).body, got.body, 'the note is not locked');
  v.close();
});

test('WO-11-A AC04: installing a licence over a lapsed one restores writing and removing it returns to the free path', () => {
  const { v, root } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') };
  const note = v.remember(OWNER, { text: 'A note that must survive the licence changing.', force: true });
  assert.equal(note.saved, true);
  const k = deviceKeygen();
  v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: k.publicKey, policy: seatPolicy({ license: verified(paidLicence(day(30))), devices: v.devices.list() }) });
  const remote = v.devices.list().find((d) => d.kind === 'remote-computer');
  const deviceId = remote.id;
  // a lapsed licence: the added computer is read only
  const lapsed = paidLicence(day(-30));
  const lapsedFile = path.join(tmpdir('lic-'), 'lapsed.json');
  fs.writeFileSync(lapsedFile, JSON.stringify(lapsed, null, 2));
  assert.equal(installLicense({ file: lapsedFile, env, keys, now: NOW, root }).state, 'expired', 'the lapsed licence is installed');
  let policy = seatPolicy({ license: verified(lapsed), devices: v.devices.list() });
  assert.ok(policy.read_only.includes(remote.id), 'under the lapsed licence the added computer is read only');
  // install a current licence over it: writing is restored at once, no re-enrolment, no restart
  const current = paidLicence(day(30));
  const currentFile = path.join(tmpdir('lic-'), 'current.json');
  fs.writeFileSync(currentFile, JSON.stringify(current, null, 2));
  const res = installLicense({ file: currentFile, env, keys, now: NOW, root });
  assert.equal(res.ok, true, 'the current licence installs over the lapsed one');
  assert.equal(res.state, 'valid', 'the licence is now valid');
  policy = seatPolicy({ license: verified(current), devices: v.devices.list() });
  assert.ok(policy.writable.has(remote.id), 'writing is restored for the added computer');
  const still = v.devices.list().find((d) => d.id === deviceId);
  assert.ok(still, 'the added computer is still enrolled (no re-enrolment)');
  assert.equal(still.status, 'active', 'the added computer is still active (no restart)');
  // remove the licence: back to the free path, nothing deleted
  fs.rmSync(licenseFile(env), { force: true });
  assert.equal(loadLicense({ env, keys, now: NOW }).state, 'none', 'removing the licence returns to the free path');
  policy = seatPolicy({ license: loadLicense({ env, keys, now: NOW }), devices: v.devices.list() });
  assert.ok(policy.read_only.includes(remote.id), 'on the free path the added computer is read only again');
  assert.ok(fs.existsSync(path.join(root, note.path)), 'the note is not deleted by the licence changing');
  v.close();
});

test('WO-11-A AC05: the doctor reports one check for each paid path, and each check id has its troubleshooting row', () => {
  const { v, root } = newVault();
  const ids = ['relay', 'merge', 'license-expired', 'license-change'];
  const checks = fileChecks({ root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') }, vault: v });
  for (const id of ids) {
    const found = checks.filter((c) => c.id === id);
    assert.equal(found.length, 1, `the doctor reports exactly one ${id} check`);
    assert.ok(found[0].detail, `the ${id} check names its state`);
  }
  // each check id has its row and fix in the troubleshooting table
  const doc = fs.readFileSync(path.join(PKG, 'docs', 'TROUBLESHOOTING.md'), 'utf8');
  for (const id of ids) {
    const row = doc.split('\n').find((l) => l.startsWith('|') && l.split('|')[1].trim() === `\`${id}\``);
    assert.ok(row, `TROUBLESHOOTING.md has a row for the ${id} check`);
    assert.ok(row.split('|').length >= 4, `the ${id} row has a symptom and a fix`);
  }
  v.close();
});

test('WO-11-A AC05: after a same-note conflict the merge check warns and names the note and its copy', () => {
  const { v, root, note } = noteConflict();
  v.config.merge = { provider: { resolve: () => ({}) } };
  const res = syncOnce(v, { root, license: paidLicence(day(30)), keys, at: NOW });
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec?.copy, `the conflict copy is named: ${JSON.stringify(res)}`);
  const merge = fileChecks({ root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') }, vault: v }).find((c) => c.id === 'merge');
  assert.equal(merge.status, 'warn', `the merge check warns: ${merge.detail}`);
  assert.ok(merge.detail.includes(note), `the merge check names the note: ${merge.detail}`);
  assert.ok(merge.detail.includes(rec.copy), `the merge check names the copy: ${merge.detail}`);
  v.close();
});

test('WO-11-A AC05: the license-expired check warns on an expired licence, and license-change names the tier with an added computer writing', () => {
  // the doctor as the CLI runs it with no vault open: the vault and its device registry on disk
  const root = path.join(tmpdir(), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') };
  const current = verified(paidLicence(day(30)));
  const { reg, tokens } = registry(root);
  reg.enroll(tokens, { kind: 'remote-computer', label: 'laptop', pubkey: deviceKeygen().publicKey, policy: seatPolicy({ license: current, devices: reg.list() }) });
  const check = (license, id) => fileChecks({ root, env, license }).find((c) => c.id === id);
  // an expired licence past its grace: a warning; the added computer only reads, which is not a regression, and the tier is Personal
  const expired = check(verified(paidLicence(day(-30))), 'license-expired');
  assert.equal(expired.status, 'warn', `an expired licence is a warning: ${expired.detail}`);
  assert.match(expired.detail, /past its grace period/);
  const lapsed = check(verified(paidLicence(day(-30))), 'license-change');
  assert.equal(lapsed.status, 'ok', lapsed.detail);
  assert.match(lapsed.detail, /^Personal tier/, 'the license-change check names the tier in force');
  // a valid licence: no expiry warning, and the added computer within the seat count writes
  assert.equal(check(current, 'license-expired').status, 'ok');
  const valid = check(current, 'license-change');
  assert.equal(valid.status, 'ok', valid.detail);
  assert.match(valid.detail, /^Business tier/, 'the license-change check names the tier in force');
});
