// Issues 256 and 230: memev never follows a symbolic link in the vault. A link to a file outside is not read into the
// log, a write through a linked folder or file is refused and lands nowhere, a dangling link named like a note does not
// stop the vault opening, and a note replaced by a link is never rebuilt through it. The vault runs without git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { Vault } from '../src/engine/vault.mjs';
after(cleanup);

const REMOTE = { id: 'dev-remote', agent: 'laptop', scopes: ['read', 'write'], paths: ['memory/**', 'work/**', 'contracts/**'], remote: true };
const reopen = (root) => new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys'), git: false }).open();
const skip = process.platform === 'win32' && 'symbolic links need privileges on Windows';

function setup() {
  const { root, v } = newVault({ git: false });
  const outside = path.join(root, '..', 'outside'); fs.mkdirSync(path.join(outside, 'dir'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET-OUTSIDE-THE-VAULT\n');
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  return { root, v, outside };
}

test('issue 256: a link to a file outside is not read, and a write through a linked file or folder lands nowhere', { skip }, () => {
  const { root, v, outside } = setup();
  v.close();
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'memory', 'l.md'));
  fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'memory', 'ext'));
  const v2 = reopen(root);
  try {
    assert.equal(v2.log.heads.has('memory/l.md'), false, 'the linked file was imported into the log');
    assert.equal(v2._read('memory/l.md'), null);
    for (const who of [OWNER, REMOTE]) {
      assert.throws(() => v2.write(who, { path: 'memory/ext/x.md', body: 'through the folder link\n' }), (e) => e.code === 'bad_path');
      assert.throws(() => v2.write(who, { path: 'memory/l.md', body: 'over the secret\n' }), (e) => e.code === 'bad_path');
      assert.throws(() => v2.append(who, { path: 'memory/l.md', text: 'appended\n' }), (e) => e.code === 'bad_path');
      assert.throws(() => v2.delete(who, { path: 'memory/l.md' }), (e) => e.code === 'bad_path');
    }
    assert.equal(fs.existsSync(path.join(outside, 'dir', 'x.md')), false, 'a write went through the folder link');
    assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'SECRET-OUTSIDE-THE-VAULT\n');
    // an ordinary note beside the links still works
    v2.write(OWNER, { path: 'memory/ok.md', body: 'fine\n' });
    assert.equal(v2._read('memory/ok.md'), 'fine\n');
  } finally { v2.close(); }
});

test('issue 230: a dangling link named like a note does not stop the vault opening, and nothing is created at its target', { skip }, () => {
  const { root, v, outside } = setup();
  v.close();
  fs.symlinkSync(path.join(outside, 'nowhere.md'), path.join(root, 'memory', 'dangling.md'));
  let v2;
  assert.doesNotThrow(() => { v2 = reopen(root); });
  try {
    assert.equal(fs.existsSync(path.join(outside, 'nowhere.md')), false);
    assert.throws(() => v2.write(OWNER, { path: 'memory/dangling.md', body: 'x\n' }), (e) => e.code === 'bad_path');
    assert.equal(fs.existsSync(path.join(outside, 'nowhere.md')), false, 'a write created the dangling link\'s target');
  } finally { v2.close(); }
});

test('issue 256: a note replaced by a link is never rebuilt through it at the next start', { skip }, () => {
  const { root, v, outside } = setup();
  v.write(OWNER, { path: 'memory/n.md', body: 'the note\n' });
  v.close();
  fs.rmSync(path.join(root, 'memory', 'n.md'));
  fs.symlinkSync(path.join(outside, 'target.md'), path.join(root, 'memory', 'n.md')); // dangling: recover would create it
  const v2 = reopen(root);
  try {
    assert.equal(fs.existsSync(path.join(outside, 'target.md')), false, 'recover wrote the note through the link');
    assert.equal(fs.lstatSync(path.join(root, 'memory', 'n.md')).isSymbolicLink(), true, 'the link was replaced');
  } finally { v2.close(); }
});
