// SPDX-License-Identifier: Apache-2.0
// SR-1.01 task 1: one writer per vault. An exclusive LOCK file in .memev/oplog, the VaultLocked error, and a read-only open.
// Each criterion that runs this file has a subtest whose name starts with T1-cNN: (NN is the criterion's position in the task).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as OPLOG from '../src/engine/oplog.mjs';
import { Vault } from '../src/engine/vault.mjs';
import { cleanup, tmpdir } from './helpers/tmp.mjs';
import { OWNER, killAll, makeVault, openVault, Child, holder, tryOpen, tree, bytes, files, STATE_FILES, isLocked, seqs, consecutive } from './helpers/oplog-lock.mjs';

after(() => { killAll(); cleanup(); });
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...ID, ...a], { encoding: 'utf8' }).trim();

test('T1-c01: two writers on one vault: the second is refused and the log verifies', async () => {
  const { root, dir, lock } = makeVault();
  const v = openVault(root);
  assert.ok(fs.existsSync(lock), 'the first writer created .memev/oplog/LOCK');
  const before = bytes(dir);
  const r = await tryOpen(root);
  assert.equal(r.event, 'refused', `the second writer must be refused: ${JSON.stringify(r)}`);
  assert.equal(r.name, 'VaultLocked');
  assert.ok(r.message.includes(String(process.pid)), `the message names the holder pid ${process.pid}: ${r.message}`);
  assert.deepEqual(bytes(dir), before, 'the refused opener changed nothing');
  v.write(OWNER, { path: 'notes/after.md', body: 'after\n' });
  const ver = v.log.verify();
  assert.ok(ver.ok, JSON.stringify(ver.errors));
  assert.ok(consecutive(seqs(v)));
  v.close();
  assert.ok(!fs.existsSync(lock), 'close releases the lock');
});

test('T1-c04: a read-only open reads, never writes, and its log refuses an append', async () => {
  const { root, dir } = makeVault({ notes: 3 });
  const h = await holder(root);
  fs.writeFileSync(path.join(root, 'notes', 'seed-1.md'), 'edited on disk\n');
  fs.rmSync(path.join(root, 'notes', 'seed-2.md'));
  await h.send({ cmd: 'partial' });
  const watch = [...STATE_FILES];
  const noteFiles = ['notes/seed-1.md', 'notes/seed-3.md'];
  const before = { log: tree(dir), state: files(root, watch), notes: files(root, noteFiles) };
  const v = new Vault(root, { readOnly: true, keyDir: path.join(root, '..', 'keys') }).open();
  assert.ok(v.materialize('notes/seed-3.md').includes('seed 3'));
  assert.ok([...v.log.iterate()].length >= 3);
  let appendErr = null;
  try { v.log.append({ type: 'put', path: 'x', data: {} }); } catch (e) { appendErr = e; }
  v.close();
  assert.deepEqual(tree(dir), before.log, 'every file under .memev/oplog keeps its sha256, size and mtime');
  assert.deepEqual(files(root, watch), before.state, 'index, graph, device and devices files are untouched');
  assert.deepEqual(files(root, noteFiles), before.notes, 'the note files are untouched');
  assert.equal(fs.existsSync(path.join(root, 'notes', 'seed-2.md')), false, 'the deleted note was not rebuilt');
  assert.ok(appendErr && /read-only/i.test(appendErr.message), `log.append() on a read-only log throws: ${appendErr && appendErr.message}`);
  await h.stop();
});

test('T1-c07: a partial line in the holder\'s segment is not touched by a refused opener', async () => {
  const { root, dir } = makeVault();
  const h = await holder(root);
  await h.send({ cmd: 'partial' });
  const seg = path.join(dir, fs.readdirSync(dir).filter((f) => /^seg-\d+\.jsonl$/.test(f)).sort().pop());
  const tracked = [seg, path.join(dir, 'manifest.json'), path.join(dir, 'snapshot.json'), path.join(root, '.memev', 'device.json')];
  const snap = () => tracked.map((f) => { const b = fs.readFileSync(f); return { f, b, m: fs.statSync(f).mtimeMs }; });
  const before = snap();
  assert.ok(!before[0].b.toString().endsWith('\n'), 'the segment ends in a partial fragment');
  let err = null;
  try { new Vault(root, { git: false, fsync: false }).open(); } catch (e) { err = e; }
  assert.ok(isLocked(err, h.pid), `the second open throws VaultLocked naming ${h.pid}: ${err && err.message}`);
  const after = snap();
  for (let i = 0; i < before.length; i++) {
    assert.ok(before[i].b.equals(after[i].b), `${path.basename(before[i].f)} is byte-identical`);
    assert.equal(after[i].m, before[i].m, `${path.basename(before[i].f)} keeps its mtime`);
  }
  assert.ok(after[0].b.toString().endsWith('"partial":'), 'the fragment is still there');
  await h.stop();
});

test('T1-c08: two processes calling new OpLog(dir).open() on one directory: the second gets VaultLocked', async () => {
  const dir = path.join(tmpdir('oplock-'), 'bare-oplog');
  const a = new Child({ kind: 'oplog', dir, wait: true });
  const ra = await a.opened();
  assert.equal(ra.event, 'open', JSON.stringify(ra));
  assert.equal(typeof OPLOG.VaultLocked, 'function', 'oplog.mjs exports VaultLocked');
  const b = new Child({ kind: 'oplog', dir, hold: 1 });
  const rb = await b.opened();
  assert.equal(rb.event, 'refused', JSON.stringify(rb));
  assert.equal(rb.locked, true, 'the error is an instanceof the exported VaultLocked');
  assert.ok(rb.message.includes(String(a.pid)));
  await a.stop();
});

test('T1-c12: a symlink, a trailing slash and a .. spelling of one vault are one lock', () => {
  const { root, dir, lock } = makeVault();
  const v = openVault(fs.realpathSync(root));
  const link = path.join(path.dirname(root), 'vault-link');
  fs.symlinkSync(root, link);
  const lockBytes = fs.readFileSync(lock);
  for (const spelled of [() => openVault(link), () => openVault(`${root}/`), () => new OPLOG.OpLog(path.join(dir, '..', 'oplog')).open(), () => new OPLOG.OpLog(path.join(root, '.memev', 'x', '..', 'oplog')).open()]) {
    let err = null;
    try { spelled(); } catch (e) { err = e; }
    assert.ok(isLocked(err, process.pid), `refused, naming ${process.pid}: ${err && err.message}`);
  }
  assert.ok(fs.readFileSync(lock).equals(lockBytes), 'LOCK is unchanged');
  v.write(OWNER, { path: 'notes/more.md', body: 'more\n' });
  assert.ok(v.log.verify().ok);
  v.close();
});

test('T1-c15: a read-only open creates nothing under bus/ and makes no commit', async () => {
  const { root } = makeVault({ git: true });
  const h = await holder(root, { git: true });
  fs.rmSync(path.join(root, 'bus'), { recursive: true, force: true });
  const head = git(root, 'rev-parse', 'HEAD'), status = git(root, 'status', '--porcelain');
  const v = new Vault(root, { readOnly: true, keyDir: path.join(root, '..', 'keys') }).open();
  v.materialize('notes/seed-1.md'); [...v.log.iterate()];
  v.close();
  assert.equal(fs.existsSync(path.join(root, 'bus')), false, 'no file under bus/');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'status', '--porcelain'), status);
  await h.stop();
});

test('T1-c25: a second writable open inside the process that holds the lock is refused', () => {
  const { root, lock } = makeVault();
  const v = openVault(root);
  const before = fs.readFileSync(lock);
  let err = null;
  try { openVault(root); } catch (e) { err = e; }
  assert.ok(isLocked(err, process.pid), `VaultLocked naming this process: ${err && err.message}`);
  assert.ok(fs.readFileSync(lock).equals(before));
  v.write(OWNER, { path: 'notes/still.md', body: 'usable\n' });
  assert.ok(v.log.verify().ok);
  v.close();
});

test('T1-c27: when the lock cannot be created the open fails with that error, not VaultLocked', async (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('does not run as root');
  const { root, dir } = makeVault();
  const before = tree(dir);
  fs.chmodSync(dir, 0o555);
  try {
    let err = null;
    try { openVault(root); } catch (e) { err = e; }
    assert.ok(err, 'the open must fail');
    assert.ok(['EACCES', 'EROFS'].includes(err.code), `EACCES or EROFS, got ${err.code}`);
    assert.ok(!isLocked(err), 'not VaultLocked');
    assert.ok(String(err.path).endsWith('LOCK'), `it is the creation of LOCK that failed: ${err.path}`);
  } finally { fs.chmodSync(dir, 0o700); }
  assert.deepEqual(tree(dir), before, 'no file under .memev/oplog changed');
});
