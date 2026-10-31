// A conflicted note larger than git's 1 MB default output buffer was read as missing: the sync
// recorded "both computers deleted the note", removed it and sent the removal to the backup.
// Both versions are kept now, and a side that cannot be read stops the merge instead.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
import { git } from '../src/engine/git.mjs';

after(cleanup);

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
  return { v, root, bare, other: path.join(other, 'work') };
}

// The same note edited differently on both computers; only the first line differs, the rest is `bytes` long.
function conflictedNote(bytes) {
  const { v, root, bare, other } = twoComputers();
  const note = 'notes/large.md';
  const rest = '\n\n' + `${'x'.repeat(99)}\n`.repeat(Math.ceil(bytes / 100));
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, note), `# Large${rest}`);
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'add note']);
  assert.ok(git(root, ['push', '-q', 'origin', 'main']).ok, 'push');
  assert.ok(otherGit(other, 'pull', '-q', 'origin', 'main').ok, 'other pull');
  const theirs = `# Large B${rest}`;
  fs.writeFileSync(path.join(other, note), theirs);
  otherGit(other, 'add', note); otherGit(other, 'commit', '-q', '-m', 'other version');
  assert.ok(otherGit(other, 'push', '-q', 'origin', 'main').ok, 'other push');
  const ours = `# Large C${rest}`;
  fs.writeFileSync(path.join(root, note), ours);
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'this version']);
  return { v, root, bare, note, ours, theirs };
}

test('a 2 MB conflicted note keeps both versions; it is not recorded as deleted', () => {
  const { v, root, bare, note, ours, theirs } = conflictedNote(2 * 1024 * 1024);
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assert.equal(rec.how, 'kept both versions as separate files');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), ours, "this computer's version is kept at the path");
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), theirs, "the other computer's version is kept whole in the copy");
  const backup = git(bare, ['ls-tree', '--name-only', '-r', 'main', 'notes']).out.split('\n');
  assert.ok(backup.includes(note), 'the note is still in the backup');
  v.close();
});

test('a side too large to read stops the merge: nothing is removed and nothing is sent', () => {
  // over the 64 MB read buffer
  const { v, root, bare, note, ours, theirs } = conflictedNote(70 * 1024 * 1024);
  const before = git(root, ['rev-parse', 'HEAD']).out;
  const res = syncOnce(v, { root });
  assert.match(res.error || '', /merge conflict/, 'the sync reports the merge it could not finish');
  assert.equal(res.pushed, false);
  assert.equal(git(root, ['rev-parse', 'HEAD']).out, before, 'the merge is aborted, HEAD is where it was');
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), ours, "this computer's version is still at the path");
  assert.equal(git(bare, ['log', '-1', '--format=%s', 'main']).out, 'other version', "the backup still ends at the other computer's commit");
  assert.ok(!fs.existsSync(path.join(root, '.git', 'MERGE_HEAD')), 'no merge is left half done');
  assert.ok(theirs.length > 64 * 1024 * 1024);
  v.close();
});
