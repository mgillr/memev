// WO-05-A: the external merge engine is called only through the boundary in src/engine/merge.mjs.
// With no engine registered the free one-computer-at-a-time behaviour runs unchanged; a registered
// engine gets the merge; an engine that refuses, fails, or is removed keeps both versions.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { syncOnce, readConflicts } from '../src/cli/sync.mjs';
import { renderCard } from '../src/engine/card.mjs';
import { git } from '../src/engine/git.mjs';
import { signLicense } from '../src/engine/license.mjs';
import { resolveMerge, registerMergeProvider, commandProvider } from '../src/engine/merge.mjs';

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

// A note that the two computers changed differently, so the sync merge conflicts on it.
function conflictingNote(root, other, name) {
  const note = `notes/${name}`;
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, note), '# Note\n\nVersion A\n');
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'add note']);
  const p0 = git(root, ['push', '-q', 'origin', 'main']);
  assert.ok(p0.ok, `push: ${p0.err}`);
  const pl = otherGit(other, 'pull', '-q', 'origin', 'main');
  assert.ok(pl.ok, `other pull: ${pl.err}`);
  fs.writeFileSync(path.join(other, note), '# Note\n\nVersion B\n');
  otherGit(other, 'add', note); otherGit(other, 'commit', '-q', '-m', 'other version');
  const p1 = otherGit(other, 'push', '-q', 'origin', 'main');
  assert.ok(p1.ok, `other push: ${p1.err}`);
  fs.writeFileSync(path.join(root, note), '# Note\n\nVersion C\n');
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'this version']);
  return note;
}

// A test signing key and a licence that allows the merge engine.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
function mergeLicence() {
  return signLicense({ v: 1, lid: 'lic_wo05', tier: 'business', services: ['merge'], seats: 2, connectors: 0, iat: '2026-10-01', exp: null, grace_days: 14 }, pem, 't1');
}

// A stand-in for the merge engine: it records what it is given and returns a fixed merged text.
function stubProvider(text) {
  const calls = [];
  return { calls, resolve(args) { calls.push(args); return { text }; } };
}

test('WO-05-A AC02: with no engine registered, the free one-computer-at-a-time behaviour runs unchanged', () => {
  const { v, root, other } = twoComputers();
  const note = conflictingNote(root, other, 'wo05-note.md');
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  assert.equal(res.pushed, true, 'the resolved merge is pushed');
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assert.ok(rec.copy, 'the record names the conflict copy');
  // this computer's version stays at the path, the other's is kept whole next to it, each exactly as committed
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# Note\n\nVersion C\n', "this computer's version is kept at the path");
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# Note\n\nVersion B\n', "the other computer's version is kept whole in the copy");
  for (const f of [note, rec.copy]) assert.ok(!/^(<<<<<<<|=======|>>>>>>>)/m.test(fs.readFileSync(path.join(root, f), 'utf8')), `no conflict markers left in ${f}`);
  // the operator card shows the conflict and names both files
  process.env.MEMEV_ROOT = root;
  try {
    const rendered = renderCard({ operator: true });
    assert.ok(rendered.includes('Sync conflicts'), 'the operator card shows the conflict');
    assert.ok(rendered.includes(note), 'the operator card names the note');
    assert.ok(rendered.includes(rec.copy), 'the operator card names the conflict copy');
  } finally { delete process.env.MEMEV_ROOT; }
  // the conflict is in the sync job state, as the free behaviour records it
  assert.ok(readConflicts(root)?.files?.includes(note), 'the conflict is in the sync job state');
  v.close();
});

test('WO-05-A AC03: a registered engine gets the merge and its result is used', () => {
  const { v, root, other } = twoComputers();
  const note = conflictingNote(root, other, 'wo05-note.md');
  const stub = stubProvider('# Note\n\nMerged by the engine\n');
  v.config.merge = { provider: stub };
  const res = syncOnce(v, { root, license: mergeLicence(), keys, at: Date.parse('2026-11-01') });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  assert.equal(res.pushed, true, 'the resolved merge is pushed');
  assert.equal(stub.calls.length, 1, 'the engine got the merge');
  assert.equal(stub.calls[0].a, '# Note\n\nVersion C\n', 'the engine got this computer\'s version');
  assert.equal(stub.calls[0].b, '# Note\n\nVersion B\n', 'the engine got the other computer\'s version');
  assert.equal(stub.calls[0].base, '# Note\n\nVersion A\n', 'the engine got the common base');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# Note\n\nMerged by the engine\n', 'the engine\'s merged text is at the note\'s path');
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(!rec?.copy, 'no conflict copy is kept when the engine resolves the note');
  v.close();
});

test('WO-05-A AC03: an engine that refuses keeps both versions and names the reason', () => {
  const { v, root, other } = twoComputers();
  const note = conflictingNote(root, other, 'wo05-note.md');
  v.config.merge = { provider: { resolve: () => ({ refuse: true }) } };
  const res = syncOnce(v, { root, license: mergeLicence(), keys, at: Date.parse('2026-11-01') });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assert.ok(rec.copy, 'the record names the conflict copy');
  assert.equal(rec.how, 'kept both versions as separate files', 'the record says both versions are kept');
  assert.equal(rec.reason, 'kept both versions: the merge engine refused', 'the record names the reason');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# Note\n\nVersion C\n', "this computer's version is kept at the path");
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# Note\n\nVersion B\n', "the other computer's version is kept whole in the copy");
  v.close();
});

test('WO-05-A AC03: an engine that fails keeps both versions and names the reason', () => {
  const { v, root, other } = twoComputers();
  const note = conflictingNote(root, other, 'wo05-note.md');
  v.config.merge = { provider: { resolve: () => { throw new Error('the engine is down'); } } };
  const res = syncOnce(v, { root, license: mergeLicence(), keys, at: Date.parse('2026-11-01') });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assert.ok(rec.copy, 'the record names the conflict copy');
  assert.equal(rec.reason, 'kept both versions: the merge engine failed: the engine is down', 'the record names the reason');
  v.close();
});

test('WO-05-A AC03: removing a registered engine returns to the keep-both behaviour', () => {
  const { v, root, other } = twoComputers();
  const note = conflictingNote(root, other, 'wo05-note.md');
  v.config.merge = { provider: stubProvider('# Note\n\nMerged\n') };
  const res1 = syncOnce(v, { root, license: mergeLicence(), keys, at: Date.parse('2026-11-01') });
  assert.equal(res1.error, null, `sync should complete: ${res1.error}`);
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# Note\n\nMerged\n', 'the engine resolved the note');
  // the engine is removed: the install falls back to the free behaviour
  delete v.config.merge;
  const note2 = conflictingNote(root, other, 'wo05-note2.md');
  const res2 = syncOnce(v, { root, license: mergeLicence(), keys, at: Date.parse('2026-11-01') });
  assert.equal(res2.error, null, `sync should complete: ${res2.error}`);
  const rec = res2.conflicts?.find((c) => c.path === note2);
  assert.ok(rec, 'the note is recorded as a conflict');
  assert.ok(rec.copy, 'the record names the conflict copy');
  assert.equal(fs.readFileSync(path.join(root, note2), 'utf8'), '# Note\n\nVersion C\n', "this computer's version is kept at the path");
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# Note\n\nVersion B\n', "the other computer's version is kept whole in the copy");
  v.close();
});

test('WO-05-A AC04: the engine is reached as an external process, not a package dependency', () => {
  // a stand-in engine: a small program the boundary runs as a command
  const engine = path.join(tmpdir('engine-'), 'engine.mjs');
  fs.writeFileSync(engine, [
    "import fs from 'node:fs';",
    'let buf = "";',
    "process.stdin.on('data', (d) => { buf += d; });",
    "process.stdin.on('end', () => {",
    '  const { a } = JSON.parse(buf);',
    "  process.stdout.write(JSON.stringify({ text: a.replace('Version C', 'Merged by the external engine') }) + '\\n');",
    '});',
  ].join('\n'));
  const provider = commandProvider(process.execPath, { args: [engine] });
  const r = resolveMerge({ a: '# Note\n\nVersion C\n', b: '# Note\n\nVersion B\n', base: '# Note\n\nVersion A\n', license: mergeLicence(), keys, now: Date.parse('2026-11-01'), config: { merge: { provider } } });
  assert.equal(r.resolved, true, 'the external engine resolved the note');
  assert.equal(r.text, '# Note\n\nMerged by the external engine\n', 'the external engine\'s merged text is used');
  // the engine is a command the install points at, not a package dependency of this repository
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies, 'the core has no runtime dependencies');
  assert.ok(!pkg.dependencies?.['crdt-merge'], 'the engine is not a package dependency');
});

test('WO-05-A AC05: the boundary exports the registration point and imports no paid client', () => {
  // the registration point is exported from the boundary, and the engine registers into it
  assert.equal(typeof registerMergeProvider, 'function', 'the boundary exports the registration point');
  const stub = stubProvider('# Note\n\nMerged\n');
  registerMergeProvider(stub);
  try {
    const r = resolveMerge({ a: '# Note\n\nVersion C\n', b: '# Note\n\nVersion B\n', base: '# Note\n\nVersion A\n', license: mergeLicence(), keys, now: Date.parse('2026-11-01') });
    assert.equal(r.resolved, true, 'the registered engine gets the merge');
    assert.equal(r.text, '# Note\n\nMerged\n', 'the boundary calls the engine it was registered with');
    assert.equal(stub.calls.length, 1, 'the engine registers into the boundary, not the reverse');
  } finally {
    registerMergeProvider(null);
  }
  // the boundary imports no paid client: only node built-ins and the licence gate
  const src = fs.readFileSync(path.join(PKG, 'src/engine/merge.mjs'), 'utf8');
  const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'the boundary has imports to check');
  for (const spec of imports) {
    assert.ok(spec.startsWith('node:') || spec === './license.mjs', `the boundary imports no paid client, only node built-ins and the licence gate: ${spec}`);
  }
});
