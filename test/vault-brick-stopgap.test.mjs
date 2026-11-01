// Issue 230: one write can no longer make the vault unopenable. A path the file system cannot take is refused before the
// log advances (a NUL or other control character, a path under an existing note, a folder with notes in it at the path),
// an empty folder a delete left behind is cleared, and a vault whose log already holds such a path opens and skips it
// with the reason. The vault runs without git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { Vault } from '../src/engine/vault.mjs';
import { sha256 } from '../src/engine/util.mjs';
after(cleanup);

const reopen = (root) => new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys'), git: false }).open();
const refusedBeforeLog = (v, fn, what) => {
  const seq = v.log.seq;
  assert.throws(fn, (e) => e.code === 'bad_path', `${what} was not refused with bad_path`);
  assert.equal(v.log.seq, seq, `${what}: the log advanced before the refusal`);
};

test('issue 230: a control character in a path is refused before the log advances, and the vault reopens', () => {
  const { root, v } = newVault({ git: false });
  for (const p of ['notes/a\u0000b.md', 'notes/tab\there.md', 'notes/line\nbreak.md']) {
    refusedBeforeLog(v, () => v.write(OWNER, { path: p, body: 'x\n' }), `write ${JSON.stringify(p)}`);
    refusedBeforeLog(v, () => v.append(OWNER, { path: p, text: 'x' }), `append ${JSON.stringify(p)}`);
  }
  v.close();
  const v2 = reopen(root);
  try { assert.deepEqual(v2.skipped, []); } finally { v2.close(); }
});

test('issue 230: a note under an existing note, or over a folder with notes in it, is refused before the log advances', () => {
  const { root, v } = newVault({ git: false });
  v.write(OWNER, { path: 'notes/a.md', body: '# A\n' });
  refusedBeforeLog(v, () => v.write(OWNER, { path: 'notes/a.md/b.md', body: 'under a note\n' }), 'write under a note');
  refusedBeforeLog(v, () => v.append(OWNER, { path: 'notes/a.md/b.md', text: 'under a note' }), 'append under a note');
  v.write(OWNER, { path: 'notes/e.md/f.md', body: '# F\n' });
  refusedBeforeLog(v, () => v.write(OWNER, { path: 'notes/e.md', body: 'over a folder\n' }), 'write over a folder with a note in it');
  refusedBeforeLog(v, () => v.append(OWNER, { path: 'notes/e.md', text: 'over a folder' }), 'append over a folder with a note in it');
  v.close();
  const v2 = reopen(root);
  try {
    assert.deepEqual(v2.skipped, []);
    assert.equal(fs.readFileSync(path.join(root, 'notes', 'a.md'), 'utf8'), '# A\n');
    assert.equal(fs.readFileSync(path.join(root, 'notes', 'e.md', 'f.md'), 'utf8'), '# F\n');
  } finally { v2.close(); }
});

test('issue 230: a note written where a delete left an empty folder is written, and the vault reopens', () => {
  const { root, v } = newVault({ git: false });
  v.write(OWNER, { path: 'notes/c.md/d.md', body: '# D\n' });
  v.delete(OWNER, { path: 'notes/c.md/d.md' });
  assert.ok(fs.statSync(path.join(root, 'notes', 'c.md')).isDirectory(), 'the delete left the folder (the case this guards)');
  const r = v.write(OWNER, { path: 'notes/c.md', body: '# C\n' });
  assert.ok(r.seq, 'the write was logged');
  v.close();
  const v2 = reopen(root);
  try {
    assert.deepEqual(v2.skipped, []);
    assert.equal(v2.get(OWNER, 'notes/c.md').body, '# C\n');
  } finally { v2.close(); }
});

test('issue 230: a vault whose log already holds paths the file system cannot take opens, skips them with the reason, and keeps the rest', () => {
  const { root, v } = newVault({ git: false });
  v.write(OWNER, { path: 'notes/keep.md', body: '# Keep\n' });
  v.write(OWNER, { path: 'notes/x.md', body: '# X\n' });
  fs.mkdirSync(path.join(root, 'notes', 'dir.md', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'dir.md', 'sub', 'n.md'), '# N\n');
  // what the code before this change logged and then failed to write
  const put = (p, content) => v.log.append({ type: 'put', path: p, agent: 'owner', client: null, data: { content, ch: sha256(content) } });
  put('notes/x.md/y.md', 'under a note\n');
  put('notes/n\u0000ul.md', 'nul\n');
  put('notes/dir.md', 'over a folder\n');
  v.close();
  let v2;
  assert.doesNotThrow(() => { v2 = reopen(root); }, 'the vault did not open');
  try {
    const skipped = new Map(v2.skipped.map((s) => [s.path, s.reason]));
    for (const p of ['notes/x.md/y.md', 'notes/n\u0000ul.md', 'notes/dir.md']) assert.ok(skipped.has(p), `${JSON.stringify(p)} was not reported as skipped`);
    for (const reason of skipped.values()) assert.ok(reason, 'a skipped path has no reason');
    assert.equal(v2.get(OWNER, 'notes/keep.md').body, '# Keep\n');
    assert.equal(fs.readFileSync(path.join(root, 'notes', 'x.md'), 'utf8'), '# X\n', 'the note in the way was changed');
    assert.equal(fs.readFileSync(path.join(root, 'notes', 'dir.md', 'sub', 'n.md'), 'utf8'), '# N\n', 'the folder in the way was changed');
    v2.write(OWNER, { path: 'notes/after.md', body: 'still writable\n' });
  } finally { v2?.close(); }
});
