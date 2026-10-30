// WO-05-B: the paid engine client behind a flag, off by default. When the flag is on and the
// licence allows it, the sync conflict resolver hands a same-note conflict to the external merge
// engine, which runs as a separate process the install points at. The engine is a separate
// component under its own licence, not in this repository; this test drives the client with its
// own stub process.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { syncOnce, paidEngineStatus } from '../src/cli/sync.mjs';
import { git } from '../src/engine/git.mjs';
import { signLicense } from '../src/engine/license.mjs';

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
  const p1 = git(other, ['push', '-q', 'origin', 'main']);
  assert.ok(p1.ok, `push: ${p1.err}`);
  fs.writeFileSync(path.join(root, note), '# N\n\nOurs\n');
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'ours']);
  return { v, root, other, note };
}

// A test signing key and the licences it signs. The trial field is carried on the signed object.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
function trialLicence(exp) {
  return signLicense({ v: 1, lid: 'lic_trial01', tier: 'business', services: ['merge'], seats: 2, connectors: 0, iat: '2026-10-01', exp, grace_days: 14, trial: true }, pem, 't1');
}
const NOW = Date.parse('2026-11-01');

// A stand-in for the merge engine as a separate process: it writes a marker file when it starts,
// reads one JSON line on standard input, and answers according to the mode.
function stubEngine(mode) {
  const dir = tmpdir('engine-');
  const script = path.join(dir, 'engine.mjs');
  const marker = path.join(dir, 'called');
  fs.writeFileSync(script, [
    "import fs from 'node:fs';",
    `fs.writeFileSync(${JSON.stringify(marker)}, 'called');`,
    "let buf = '';",
    "process.stdin.on('data', (d) => { buf += d; });",
    "process.stdin.on('end', () => {",
    `  if (${JSON.stringify(mode)} === 'slow') { setTimeout(() => process.exit(0), 4000); return; }`,
    `  if (${JSON.stringify(mode)} === 'refuse') { console.log(JSON.stringify({ refuse: true })); return; }`,
    `  if (${JSON.stringify(mode)} === 'error') { process.stderr.write('the engine stopped'); process.exit(1); }`,
    `  if (${JSON.stringify(mode)} === 'silent') { return; }`,
    "  console.log(JSON.stringify({ text: '# N\\n\\nMerged\\n' }));",
    "});",
  ].join('\n'));
  return { command: process.execPath, args: [script], marker };
}

// The free behaviour for a conflicted note: this computer's version at the path, the other
// computer's version whole in the conflict copy, each exactly as committed.
function assertFree(root, note, rec) {
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# N\n\nOurs\n', "this computer's version is kept at the path");
  assert.ok(rec.copy, 'the record names the conflict copy');
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# N\n\nTheirs\n', "the other computer's version is kept whole in the copy");
}

test('WO-05-B AC01: the flag is off by default and no call leaves the computer', () => {
  // the flag reports off when the install has not turned it on, and on when it has
  assert.deepEqual(paidEngineStatus({}), { on: false, installed: true, reason: 'the paid engine flag is off' });
  assert.deepEqual(paidEngineStatus({ merge: {} }), { on: false, installed: true, reason: 'the paid engine flag is off' });
  assert.deepEqual(paidEngineStatus({ merge: { paid: true } }), { on: true, installed: true, reason: null });
  // and when the paid client module is entirely absent from the tree, the flag reports that the engine is not installed
  const absent = paidEngineStatus({ merge: { paid: true } }, { client: new URL('file:///nonexistent/paid-merge.mjs') });
  assert.equal(absent.on, true);
  assert.equal(absent.installed, false);
  assert.equal(absent.reason, 'the engine is not installed');
  // a sync with no flag at all keeps the free behaviour, even when an engine command is configured
  const eng = stubEngine('ok');
  let { v, root, note } = noteConflict();
  v.config.merge = { command: eng.command, args: eng.args };
  let res = syncOnce(v, { root, license: trialLicence('2027-11-15'), keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  let rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assertFree(root, note, rec);
  assert.ok(!fs.existsSync(eng.marker), 'the engine is not called');
  v.close();
  // and the same holds when the paid client module is absent: the free behaviour, and the reason says so
  const eng2 = stubEngine('ok');
  ({ v, root, note } = noteConflict());
  v.config.merge = { paid: true, command: eng2.command, args: eng2.args };
  res = syncOnce(v, { root, license: trialLicence('2027-11-15'), keys, at: NOW, client: new URL('file:///nonexistent/paid-merge.mjs') });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assertFree(root, note, rec);
  assert.equal(rec.reason, 'kept both versions: the engine is not installed');
  assert.ok(!fs.existsSync(eng2.marker), 'the engine is not called');
  v.close();
});

test('WO-05-B AC02: the flag on calls the boundary and falls back to the free behaviour on any failure', () => {
  // the flag on and a licence: the conflicted note goes to the engine and the merge lands
  let eng = stubEngine('ok');
  let { v, root, note } = noteConflict();
  v.config.merge = { paid: true, command: eng.command, args: eng.args };
  let res = syncOnce(v, { root, license: trialLicence('2027-11-15'), keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  assert.ok(fs.existsSync(eng.marker), 'the engine is called');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# N\n\nMerged\n', 'the merged note lands at the path');
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.equal(rec?.how, 'merged by the merge engine');
  v.close();
  // and on any failure the free behaviour runs, losing no line
  for (const [mode, why] of [
    ['refuse', 'the merge engine refused'],
    ['error', 'the merge engine failed'],
    ['silent', 'no answer'],
    ['slow', 'the merge engine failed'],
  ]) {
    eng = stubEngine(mode);
    ({ v, root, note } = noteConflict());
    v.config.merge = { paid: true, command: eng.command, args: eng.args, timeout_ms: mode === 'slow' ? 300 : 30000 };
    res = syncOnce(v, { root, license: trialLicence('2027-11-15'), keys, at: NOW });
    assert.equal(res.error, null, `sync completes (${mode}): ${res.error}`);
    const r2 = res.conflicts?.find((c) => c.path === note);
    assert.ok(r2, `the note is recorded as a conflict (${mode})`);
    assertFree(root, note, r2);
    assert.match(r2.reason, new RegExp(why), `the reason names the failure (${mode}): ${r2.reason}`);
    v.close();
  }
});

test('WO-05-B AC03: the licence gate still decides when the engine is called', () => {
  // no licence: the engine is not called and the free behaviour runs
  let eng = stubEngine('ok');
  let { v, root, note } = noteConflict();
  v.config.merge = { paid: true, command: eng.command, args: eng.args };
  let res = syncOnce(v, { root, license: null, keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  assert.ok(!fs.existsSync(eng.marker), 'the engine is not called without a licence');
  let rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assertFree(root, note, rec);
  assert.equal(rec.reason, 'kept both versions: the licence does not allow the merge engine');
  v.close();
  // a licence outside its valid and grace states: the same
  eng = stubEngine('ok');
  ({ v, root, note } = noteConflict());
  v.config.merge = { paid: true, command: eng.command, args: eng.args };
  res = syncOnce(v, { root, license: trialLicence('2026-09-01'), keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  assert.ok(!fs.existsSync(eng.marker), 'the engine is not called with an expired licence');
  rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assertFree(root, note, rec);
  v.close();
  // a valid licence: the gate allows it and the engine is called
  eng = stubEngine('ok');
  ({ v, root, note } = noteConflict());
  v.config.merge = { paid: true, command: eng.command, args: eng.args };
  res = syncOnce(v, { root, license: trialLicence('2027-11-15'), keys, at: NOW });
  assert.equal(res.error, null, `sync completes: ${res.error}`);
  assert.ok(fs.existsSync(eng.marker), 'the engine is called with a valid licence');
  v.close();
});
