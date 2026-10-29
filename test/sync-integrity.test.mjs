// REV-005: the git sync keeps every note. Three ways it used to lose or corrupt notes:
// non-ASCII paths quoted out of the diff, a deleted note turned into a 0-byte file, and a failed
// commit reported as pushed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
import { git, CommitQueue } from '../src/engine/git.mjs';

after(cleanup);

// The other computer's clone commits as a plain test user, since it has no vault of its own.
const otherGit = (root, ...args) => git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args]);

// Two computers sharing one bare backup: the vault on `root` and a plain clone the other pushes from.
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

test('REV-005 AC01: a non-ASCII note changed on the other computer is imported', () => {
  const { v, root, other } = twoComputers();
  const note = 'notes/\u4e2d\u6587\u7b14\u8bb0.md';
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
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  // the real path reached syncFromDisk: the note is counted as pulled and holds the other version
  assert.ok(res.pulled >= 1, `the non-ASCII note is imported: pulled=${res.pulled}`);
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# Note\n\nVersion B\n', 'the note holds the other computer version');
  v.close();
});

test('REV-005 AC02: a conflict on a non-ASCII note resolves without a quoted junk file or merge abort', () => {
  const { v, root, other } = twoComputers();
  const note = 'notes/\u4e2d\u6587\u7b14\u8bb0.md';
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
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `the conflict is resolved, no merge abort: ${res.error}`);
  assert.equal(res.pushed, true, 'the resolved merge is pushed');
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the non-ASCII note is recorded as a conflict by its real path');
  assert.ok(rec.copy, 'the record names the conflict copy');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# Note\n\nVersion C\n', "this computer's version stays at the path");
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# Note\n\nVersion B\n', "the other computer's version is kept whole in the copy");
  // no quoted junk file: nothing in the folder carries the octal-escaped or double-quoted name
  for (const n of fs.readdirSync(path.join(root, 'notes'))) assert.ok(!n.includes('\\') && !n.includes('"'), `no quoted junk file: ${n}`);
  v.close();
});

test('REV-005 AC03: a note this computer deleted and the other edited is not written as 0 bytes', () => {
  const { v, root, other } = twoComputers();
  const note = 'notes/gone.md';
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
  // this computer deletes the note
  git(root, ['rm', '-q', note]); git(root, ['commit', '-q', '-m', 'delete note']);
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `the conflict is resolved: ${res.error}`);
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the deleted note is recorded as a conflict');
  assert.equal(rec.kind, 'note');
  assert.ok(/deleted/.test(rec.how), `the record says this computer deleted it: ${rec.how}`);
  assert.ok(rec.copy, 'the record names the conflict copy');
  // the path stays removed, no 0-byte note is written
  assert.ok(!fs.existsSync(path.join(root, note)), 'the note stays removed at the path');
  // the other computer's version is kept whole in the conflict copy
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# Note\n\nVersion B\n', 'the other version is kept in the copy');
  v.close();
});

test('REV-005 AC04: a failed commit stays pending, is retried, and syncOnce reports it', () => {
  // CommitQueue.flush keeps its paths pending and returns the failure when the commit fails
  const root = tmpdir('cq-');
  const b = git(root, ['init', '-q', '-b', 'main']);
  assert.ok(b.ok, `init: ${b.err}`);
  git(root, ['config', 'user.name', 't']); git(root, ['config', 'user.email', 't@example.invalid']);
  const q = new CommitQueue(root, { delayMs: 60000 });
  fs.writeFileSync(path.join(root, 'a.md'), 'v1\n');
  q.add('a.md', 'test');
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  const r1 = q.flush();
  assert.ok(r1, 'flush returns a result');
  assert.equal(r1.ok, false, 'the failed commit is returned');
  assert.ok(q.pending.has('a.md'), 'the path stays pending after a failed commit');
  fs.rmSync(hook);
  const r2 = q.flush();
  assert.equal(r2.ok, true, `the next flush retries and commits: ${r2.err}`);
  assert.equal(q.pending.size, 0, 'the path is no longer pending after a successful commit');
  assert.equal(git(root, ['status', '--porcelain', '--', 'a.md']).out, '', 'a.md is committed, working tree clean');

  // syncOnce reports the commit failure instead of claiming pushed
  const { v, root: vroot } = newVault();
  fs.mkdirSync(path.join(vroot, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(vroot, 'notes/x.md'), 'v1\n');
  v.commits.add('notes/x.md', 'test');
  const vhook = path.join(vroot, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(vhook, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(vhook, 0o755);
  const res = syncOnce(v, { root: vroot });
  assert.equal(res.pushed, false, 'syncOnce does not claim pushed when the commit failed');
  assert.ok(res.error, `syncOnce reports the commit failure: ${res.error}`);
  assert.ok(v.commits.pending.has('notes/x.md'), 'the note stays pending for the next sync');
  v.close();
});
