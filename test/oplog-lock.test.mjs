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
import { OWNER, killAll, sleep, stealLock, bytesNoLock, readLock, makeVault, openVault, Child, holder, tryOpen, tree, bytes, files, STATE_FILES, isLocked, seqs, consecutive } from './helpers/oplog-lock.mjs';

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

test('T1-readonly: every writer of a read-only log refuses and nothing on disk changes', () => {
  const { dir } = makeVault();
  const before = tree(dir);
  const log = new OPLOG.OpLog(dir, { readOnly: true }).open();
  assert.equal(fs.existsSync(path.join(dir, 'LOCK')), false, 'a read-only open takes no lock');
  for (const call of [() => log.append({ type: 'put', path: 'x', data: {} }), () => log.snapshot(), () => log.roll(), () => log.archiveSealed(), () => log._saveManifest()]) {
    assert.throws(call, /read-only/i);
  }
  log.close();
  assert.deepEqual(tree(dir), before);
  assert.ok(log.verify().ok, 'a read-only log still reads and verifies');
});

test('T1-readonly: a read-only open of a vault with a torn tail reads it as absent and leaves it', () => {
  const { root, dir } = makeVault();
  const seg = path.join(dir, 'seg-000001.jsonl');
  const seq = new OPLOG.OpLog(dir, { readOnly: true }).open().seq;
  fs.appendFileSync(seg, '{"seq":99,"torn":');
  const before = tree(dir);
  const v = new Vault(root, { readOnly: true }).open();
  assert.equal(v.log.seq, seq, 'the torn fragment is not a record');
  v.close();
  assert.deepEqual(tree(dir), before, 'the fragment was not truncated');
  const w = openVault(root);
  assert.equal(fs.readFileSync(seg, 'utf8').endsWith('"torn":'), false, 'a writable open still truncates it');
  w.close();
});

// ---- the lease: renewed from a worker thread, checked before every write, never taken back by a holder that lost it

/** A holder (with a fast lease) whose lock another opener has since replaced, and what its folder held at that moment. */
async function lostHolder(spec = {}, env = {}) {
  const v = makeVault(spec.notes === undefined ? {} : { notes: spec.notes });
  const h = await holder(v.root, { ...spec }, { MEMEV_LOCK_RENEW_MS: '200', ...env });
  if (spec.appends) await h.next((e) => e.event === 'appended');
  return { ...v, h };
}

test('T1-c09: a holder that lost its lock fails closed on append, snapshot and close, and neither renews nor deletes the new lock', async () => {
  const { dir, lock, h } = await lostHolder();
  const before = bytesNoLock(dir);
  const stolen = stealLock(lock);
  const m0 = fs.statSync(lock).mtimeMs;
  const a = await h.send({ cmd: 'append' });
  assert.equal(a.ok, false); assert.equal(a.name, 'VaultLocked'); assert.equal(a.from, 'append');
  const s = await h.send({ cmd: 'snapshot' });
  assert.equal(s.name, 'VaultLocked', 'snapshot refuses too');
  await h.send({ cmd: 'close' });
  assert.deepEqual(bytesNoLock(dir), before, 'every segment, manifest.json and snapshot.json is byte-identical');
  assert.ok(fs.readFileSync(lock).equals(stolen), 'LOCK still holds the other opener\'s bytes');
  await sleep(1000);
  assert.equal(fs.statSync(lock).mtimeMs, m0, 'the lost holder does not renew a lock that is not its own');
  await h.stop();
  assert.ok(fs.readFileSync(lock).equals(stolen), 'and its exit does not delete it');
});

test('T1-c20: compact on a lost holder throws VaultLocked and moves nothing', async () => {
  const { dir, lock, h } = await lostHolder({ segmentBytes: 512, appends: 8, notes: 0 });
  const sealed = fs.readdirSync(dir).filter((f) => /^seg-\d+\.jsonl$/.test(f)).length;
  assert.ok(sealed >= 3, `at least two segments are sealed (${sealed} segment files)`);
  const names = fs.readdirSync(dir).sort(), before = bytesNoLock(dir);
  const stolen = stealLock(lock);
  const r = await h.send({ cmd: 'compact' });
  assert.equal(r.ok, false); assert.equal(r.name, 'VaultLocked');
  assert.equal(fs.existsSync(path.join(dir, 'archive')), false, 'no archive/ folder');
  assert.deepEqual(fs.readdirSync(dir).sort(), names, 'no new seg-* file');
  assert.deepEqual(bytesNoLock(dir), before);
  assert.ok(fs.readFileSync(lock).equals(stolen));
  await h.stop();
});

test('T1-c23: the lost holder\'s vault.close() writes no index, graph, device or devices file and makes no commit', async () => {
  const { root, dir, lock } = makeVault({ git: true });
  const h = await holder(root, { git: true, commitDelayMs: 600000 }, { MEMEV_LOCK_RENEW_MS: '200' });
  assert.equal((await h.send({ cmd: 'append' })).ok, true, 'a note is written and its commit is pending');
  const state = files(root, STATE_FILES), head = git(root, 'rev-parse', 'HEAD');
  stealLock(lock);
  const r = await h.send({ cmd: 'close' });
  assert.equal(r.name, 'VaultLocked', 'close fails closed');
  assert.deepEqual(files(root, STATE_FILES), state, 'index.jsonl, graph.json, device.json and devices.json are byte-identical');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head, 'no commit');
  assert.ok(Object.keys(bytes(dir)).includes('LOCK'));
  await h.stop();
});

test('T1-c24: the lease is renewed from a worker thread: a main thread stuck for 2 s keeps its lock', async () => {
  const { dir, lock, h } = await lostHolder({}, { MEMEV_LOCK_RENEW_MS: '500' });
  const bytes0 = fs.readFileSync(lock), seen = new Set([fs.statSync(lock).mtimeMs]);
  const busy = h.send({ cmd: 'busy', ms: 2000 });
  for (let i = 0; i < 18; i++) { await sleep(100); seen.add(fs.statSync(lock).mtimeMs); }
  await busy;
  assert.ok(seen.size >= 3, `the lock's mtime advanced at least twice during the loop: ${[...seen].length - 1} advances`);
  assert.ok(fs.readFileSync(lock).equals(bytes0), 'its bytes never change');
  const a = await h.send({ cmd: 'append' });
  assert.equal(a.ok, true, 'the next append succeeds');
  assert.ok(readLock(lock).token, 'and the lock still carries its token');
  assert.ok(fs.readFileSync(lock).equals(bytes0));
  assert.equal((await h.send({ cmd: 'close' })).ok, true);
  await h.stop();
  assert.ok(!fs.existsSync(path.join(dir, 'LOCK')), 'a clean close releases the lock');
});

test('T1-lease: the default interval is 15 s, so a lock is not renewed within a second or two', async () => {
  const v = makeVault();
  const h = await holder(v.root);
  const m0 = fs.statSync(v.lock).mtimeMs;
  await sleep(1500);
  assert.equal(fs.statSync(v.lock).mtimeMs, m0);
  await h.stop();
});

test('T1-guards: append, snapshot, roll, archive, the manifest write and close each check the lock first', () => {
  const calls = {
    append: (l) => l.append({ type: 'put', path: 'n', data: { content: 'x', ch: 'x' } }),
    snapshot: (l) => l.snapshot(),
    roll: (l) => l.roll(),
    archiveSealed: (l) => l.archiveSealed(),
    _saveManifest: (l) => l._saveManifest(),
    close: (l) => l.close(),
  };
  for (const [name, call] of Object.entries(calls)) {
    const dir = path.join(tmpdir('oplock-'), 'oplog');
    const log = new OPLOG.OpLog(dir, { segmentBytes: 256, fsync: false }).open();
    for (let i = 0; i < 4; i++) log.append({ type: 'put', path: `n${i}`, data: { content: 'x'.repeat(200), ch: 'x' } });
    const lock = path.join(dir, 'LOCK');
    const stolen = stealLock(lock), before = bytes(dir), names = fs.readdirSync(dir).sort();
    assert.equal(log.holds(), false);
    assert.throws(() => call(log), (e) => e.name === 'VaultLocked' && e instanceof OPLOG.VaultLocked, `${name} throws VaultLocked`);
    assert.deepEqual(bytes(dir), before, `${name} changed nothing`);
    assert.deepEqual(fs.readdirSync(dir).sort(), names, `${name} added no file`);
    assert.ok(fs.readFileSync(lock).equals(stolen), `${name} left the other lock alone`);
  }
});
