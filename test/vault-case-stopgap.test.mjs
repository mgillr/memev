// Issue 243, the note-level part: a note whose path differs from an existing note's only in letter case or Unicode form is
// refused before the log advances, naming the existing note, because a case-insensitive disk keeps the two as one file. The
// rule is the same on every file system, so CI on a case-sensitive one runs it too. The vault runs without git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { Vault } from '../src/engine/vault.mjs';
after(cleanup);

const reopen = (root) => new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys'), git: false }).open();
const live = (v) => [...v.log.heads].filter(([, h]) => !h.deleted).map(([p]) => p).filter((p) => p.startsWith('notes/')).sort();
const refused = (v, fn, existing, what) => {
  const seq = v.log.seq;
  assert.throws(fn, (e) => e.code === 'bad_path' && e.message.includes(existing), `${what} was not refused naming ${existing}`);
  assert.equal(v.log.seq, seq, `${what}: the log advanced`);
};

test('issue 243: a note that differs from an existing one only in letter case or Unicode form is refused before the log advances', () => {
  const { root, v } = newVault({ git: false });
  v.write(OWNER, { path: 'notes/a.md', body: '# A\n' });
  v.write(OWNER, { path: 'notes/café.md', body: '# Cafe\n' });
  refused(v, () => v.write(OWNER, { path: 'notes/A.md', body: 'other\n' }), 'notes/a.md', 'write notes/A.md');
  refused(v, () => v.append(OWNER, { path: 'notes/A.md', text: 'other' }), 'notes/a.md', 'append notes/A.md');
  refused(v, () => v.write(OWNER, { path: 'Notes/a.md', body: 'other\n' }), 'notes/a.md', 'write Notes/a.md');
  refused(v, () => v.write(OWNER, { path: 'notes/café.md', body: 'other\n' }), 'notes/café.md', 'write the decomposed form');
  // the existing spelling still writes and appends
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nmore\n' });
  v.append(OWNER, { path: 'notes/a.md', text: 'appended' });
  v.close();
  const v2 = reopen(root);
  try {
    assert.deepEqual(live(v2), ['notes/a.md', 'notes/café.md']);
    assert.equal(v2.get(OWNER, 'notes/a.md').body, '# A\nmore\nappended\n');
  } finally { v2.close(); }
});

test('issue 243: once a note is deleted, a case variant of its path can be written', () => {
  const { v } = newVault({ git: false });
  try {
    v.write(OWNER, { path: 'notes/b.md', body: '# B\n' });
    v.delete(OWNER, { path: 'notes/b.md' });
    const r = v.write(OWNER, { path: 'notes/B.md', body: '# B again\n' });
    assert.ok(r.seq, 'the variant of a deleted note was refused');
    assert.deepEqual(live(v), ['notes/B.md']);
  } finally { v.close(); }
});
