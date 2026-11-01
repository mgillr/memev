// SPDX-License-Identifier: Apache-2.0
// SR-1.01 task 1: one writer per vault. An exclusive LOCK file in .memev/oplog, the VaultLocked error, and a read-only open.
// Each criterion that runs this file has a subtest whose name starts with T1-cNN: (NN is the criterion's position in the task).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import * as OPLOG from '../src/engine/oplog.mjs';
import * as UTIL from '../src/engine/util.mjs';
import { Vault } from '../src/engine/vault.mjs';
import { cleanup, tmpdir } from './helpers/tmp.mjs';
import { command as runnerCommand, watch as runnerWatch, entry as runnerEntry } from '../src/cli/runner.mjs';
import { OWNER, killAll, sleep, stealLock, bytesNoLock, readLock, writeLock, age, deadPid, bootMs, bareDir, sampleBare, plant, releaseTogether, makeVault, openVault, Child, holder, tryOpen, tree, bytes, files, STATE_FILES, isLocked, seqs, consecutive } from './helpers/oplog-lock.mjs';

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

// ---- stale locks, recovery and the checks that tell a live holder from a dead one

const LINUX = process.platform === 'linux';
const verifyOf = (dir) => { const l = new OPLOG.OpLog(dir, { readOnly: true }).open(); return { v: l.verify(), seqs: [...l.iterate()].map((r) => r.seq) }; };
/** Open writable in this process, append `n` records, check the log, release. */
function openAppendVerify(dir, n = 3) {
  const log = new OPLOG.OpLog(dir, { fsync: false }).open();
  try {
    for (let i = 0; i < n; i++) log.append({ type: 'put', path: `p${i}`, data: { content: 'x', ch: 'x' } });
    const ver = log.verify();
    assert.ok(ver.ok, JSON.stringify(ver.errors));
    assert.ok(consecutive([...log.iterate()].map((r) => r.seq)));
  } finally { log.close(); }
}
const refuses = (dir, pid) => {
  let err = null;
  try { new OPLOG.OpLog(dir, { fsync: false }).open().close(); } catch (e) { err = e; }
  assert.ok(isLocked(err, pid), `VaultLocked${pid ? ` naming ${pid}` : ''}: ${err && `${err.name}: ${err.message}`}`);
  assert.ok(err instanceof OPLOG.VaultLocked);
  return err;
};
const lockPath = (dir) => path.join(dir, 'LOCK');

test('T1-c03: a lock held by a child refuses the parent; after kill -9 the next open recovers', async () => {
  const { root, dir } = makeVault();
  const h = await holder(root);
  const before = bytes(dir);
  let err = null;
  try { openVault(root); } catch (e) { err = e; }
  assert.ok(isLocked(err, h.pid), `VaultLocked naming the child ${h.pid}: ${err && err.message}`);
  assert.notEqual(h.pid, process.pid);
  assert.deepEqual(bytes(dir), before, 'every file under .memev/oplog is byte-identical');
  await h.kill9();
  const v = openVault(root);
  v.write(OWNER, { path: 'notes/after-kill.md', body: 'recovered\n' });
  assert.ok(v.log.verify().ok);
  assert.ok(consecutive(seqs(v)));
  v.close();
});

/** `n` children released together against `dir`; each opens an op log, appends 50 records and holds it for `hold` ms. */
async function race(dir, n, hold = 1000) {
  const startFile = path.join(path.dirname(dir), `go-${crypto.randomBytes(4).toString('hex')}`);
  const kids = Array.from({ length: n }, () => new Child({ kind: 'oplog', dir, startFile, appends: 50, hold }));
  await releaseTogether(kids, startFile);
  const results = await Promise.all(kids.map((k) => k.opened()));
  await Promise.all(kids.map((k) => k.exited));
  return results;
}
const opened = (rs) => rs.filter((r) => r.event === 'open').length;
const allFromOpen = (rs) => rs.filter((r) => r.event === 'refused').every((r) => r.locked && r.from === 'open');
async function rounds(count, per, fn) { for (let i = 0; i < count; i += per) await Promise.all(Array.from({ length: Math.min(per, count - i) }, (_, k) => fn(i + k))); }

test('T1-c05: eight children released together: absent, empty-and-fresh and dead-pid locks admit exactly the one the rule allows, over 20 rounds', async () => {
  const dead = await deadPid();
  await rounds(20, 5, async (round) => {
    // (i) the lock is absent
    const a = bareDir(); fs.mkdirSync(a, { recursive: true });
    const ra = await race(a, 8);
    assert.equal(opened(ra), 1, `round ${round} (i): exactly one child opens: ${JSON.stringify(ra.map((r) => r.event))}`);
    assert.ok(allFromOpen(ra), 'every refusal comes from open(), not append()');
    const va = verifyOf(a); assert.ok(va.v.ok); assert.deepEqual(va.seqs, Array.from({ length: 50 }, (_, i) => i + 1));
    // (ii) present, empty, fresh: all eight are refused; 61 s old: exactly one opens
    const b = bareDir(); fs.mkdirSync(b, { recursive: true });
    writeLock(lockPath(b), '');
    const rb = await race(b, 8, 300);
    assert.equal(opened(rb), 0, `round ${round} (ii): an empty lock younger than 60 s is held by all`);
    assert.ok(allFromOpen(rb));
    age(lockPath(b), 61);
    const rb2 = await race(b, 8);
    assert.equal(opened(rb2), 1, `round ${round} (ii): 61 s old, exactly one opens`);
    assert.ok(allFromOpen(rb2));
    const vb = verifyOf(b); assert.ok(vb.v.ok); assert.deepEqual(vb.seqs, Array.from({ length: 50 }, (_, i) => i + 1));
    // (iii) a dead pid on this host and boot
    const c = bareDir(); plant(c, (o) => ({ ...o, pid: dead }));
    const rc = await race(c, 8);
    assert.equal(opened(rc), 1, `round ${round} (iii): exactly one child opens`);
    assert.ok(allFromOpen(rc));
    const vc = verifyOf(c); assert.ok(vc.v.ok); assert.deepEqual(vc.seqs, Array.from({ length: 50 }, (_, i) => i + 1));
    assert.deepEqual(fs.readdirSync(c).filter((f) => f.startsWith('LOCK')), [], 'no lock, mutex or renamed-away file is left behind');
  });
});

test('T1-c06: another host or boot is held while the mtime is fresh and stale after 90 s; this pid\'s old lock is recovered', async () => {
  const { root, dir, lock } = makeVault();
  const h = await holder(root);
  const edit = (f) => { writeLock(lock, { ...readLock(lock), ...f }); };
  const real = readLock(lock);
  edit({ host: 'other-host' });
  assert.ok(isLocked((() => { try { openVault(root); } catch (e) { return e; } })(), h.pid), 'other host: VaultLocked');
  edit({ host: real.host, boot: 'other-boot' });
  assert.ok(isLocked((() => { try { openVault(root); } catch (e) { return e; } })(), h.pid), 'other boot: VaultLocked');
  await h.kill9();
  edit({ host: 'other-host', boot: real.boot });
  assert.ok(isLocked((() => { try { openVault(root); } catch (e) { return e; } })(), h.pid), 'the holder is dead but the host is another: held while the mtime is fresh');
  age(lock, 91);
  const v = openVault(root);
  assert.ok(v.log.verify().ok);
  const mine = readLock(lock);
  assert.ok(typeof mine.boot === 'string' && mine.boot.length > 0, 'the lock records a boot');
  if (process.platform === 'linux' || process.platform === 'darwin') assert.ok(typeof mine.machine === 'string' && mine.machine.length > 0, 'and a non-empty per-boot machine identifier');
  assert.equal(mine.pid, process.pid);
  v.close();
  // no open in this process: a lock naming this pid, host and boot (an earlier run with the same pid) is recovered
  plant(dir, (o) => ({ ...o, pid: process.pid }));
  const w = openVault(root);
  assert.ok(w.log.verify().ok);
  w.close();
});

test('T1-c10: a lock of NUL bytes, a cut-off lock or a JSON object with no pid is held while fresh and stale after 60 s', async () => {
  const real = JSON.stringify(sampleBare(bareDir()));
  const variants = { nul: Buffer.alloc(64), cut: real.slice(0, 10), nopid: '{"host":"h","boot":"1"}', pid0: JSON.stringify({ ...JSON.parse(real), pid: 0 }), negative: JSON.stringify({ ...JSON.parse(real), pid: -1 }) };
  for (const [name, content] of Object.entries(variants)) {
    const dir = bareDir(); fs.mkdirSync(dir, { recursive: true });
    writeLock(lockPath(dir), content);
    const before = bytes(dir);
    const err = refuses(dir);
    assert.equal(err.name, 'VaultLocked', `${name}: not a SyntaxError or TypeError`);
    assert.deepEqual(bytes(dir), before, `${name}: nothing under .memev/oplog changed`);
    age(lockPath(dir), 59);
    refuses(dir);
    age(lockPath(dir), 61);
    const rs = await race(dir, 4);
    assert.equal(opened(rs), 1, `${name}: exactly one open succeeds`);
    const ver = verifyOf(dir); assert.ok(ver.v.ok); assert.deepEqual(ver.seqs, Array.from({ length: 50 }, (_, i) => i + 1));
  }
});

test('T1-c11: one field at a time: another boot is held while fresh and stale after 90 s; on linux another pid namespace counts as another host', async () => {
  const dead = await deadPid();
  const dir = bareDir();
  const sample = sampleBare(dir);
  const boot = Number(sample.boot);
  assert.ok(Math.abs(boot - bootMs()) < 120000, `the recorded boot is this boot, as the test works it out: ${sample.boot} vs ${bootMs()}`);
  // case A
  plant(dir, (o) => ({ ...o, pid: dead, host: os.hostname(), boot: 'other-boot' }));
  refuses(dir);
  age(lockPath(dir), 91);
  openAppendVerify(dir);
  // the same lock with its boot a little off is still this boot; far off it is another one
  plant(dir, (o) => ({ ...o, pid: dead, boot: String(boot + 100000) }));
  openAppendVerify(dir);
  plant(dir, (o) => ({ ...o, pid: dead, boot: String(boot + 150000) }));
  refuses(dir);
  fs.rmSync(lockPath(dir));
  // case B
  if (LINUX) {
    assert.equal(sample.ns, fs.readlinkSync('/proc/self/ns/pid'), 'the lock records the pid namespace');
    plant(dir, (o) => ({ ...o, pid: dead, ns: 'pid:[1]' }));
    refuses(dir);
    fs.rmSync(lockPath(dir));
    plant(dir, (o) => ({ ...o, pid: dead }));
    openAppendVerify(dir);
  }
});

test('T1-c13: a recoverer that finds the renamed-away lock changed reports VaultLocked and puts nothing over the new LOCK', async () => {
  const dead = await deadPid();
  const dir = bareDir();
  plant(dir, (o) => ({ ...o, pid: dead }));
  const names = new Set(fs.readdirSync(dir));
  const b = new Child({ kind: 'oplog', dir, hold: 1 }, { env: { MEMEV_LOCK_TEST_PAUSE: 'after-rename:1500' } });
  const lock = lockPath(dir);
  for (let i = 0; i < 2000 && fs.existsSync(lock); i++) await sleep(5);
  assert.equal(fs.existsSync(lock), false, 'B renamed the stale lock away');
  const away = fs.readdirSync(dir).filter((f) => !names.has(f) && f !== 'LOCK.recover');
  assert.equal(away.length, 1, `one renamed-away file: ${away}`);
  const awayFile = path.join(dir, away[0]);
  fs.appendFileSync(awayFile, ' ');                                   // the parent rewrites the renamed-away file
  const c = { ...JSON.parse(fs.readFileSync(awayFile, 'utf8')), pid: process.pid, token: 'C'.repeat(32) };
  fs.writeFileSync(lock, `${JSON.stringify(c)}\n`, { flag: 'wx' });  // and creates a new LOCK with token C
  const cBytes = fs.readFileSync(lock);
  const during = bytes(dir); delete during['LOCK.recover'];
  const rb = await b.opened();
  await b.exited;
  assert.equal(rb.event, 'refused', JSON.stringify(rb));
  assert.equal(rb.locked, true);
  assert.ok(fs.readFileSync(lock).equals(cBytes), 'LOCK still holds C\'s bytes');
  const after = bytes(dir); assert.equal(fs.existsSync(path.join(dir, 'LOCK.recover')), false, 'the mutex is released');
  assert.deepEqual(after, during, 'no other file under .memev/oplog changed, and the renamed-away file was not moved over LOCK');
});

test('T1-c19: a recoverer paused after judging a lock stale does not touch a lock created meanwhile', async () => {
  const dead = await deadPid();
  const dir = bareDir();
  plant(dir, (o) => ({ ...o, pid: dead }));
  const names = new Set(fs.readdirSync(dir));
  const b = new Child({ kind: 'oplog', dir, hold: 1 }, { env: { MEMEV_LOCK_TEST_PAUSE: 'after-judge:3000' } });
  await b.next((e) => e.event === 'starting');
  await sleep(500);
  fs.rmSync(lockPath(dir));                                          // the parent deletes the lock
  const a = new Child({ kind: 'oplog', dir, every: 10, for: 3500, wait: true });
  const ra = await a.opened();
  assert.equal(ra.event, 'open', JSON.stringify(ra));
  const aBytes = fs.readFileSync(lockPath(dir));
  let missing = 0, differ = 0, reads = 0, done = false;
  const bDone = b.exited.then(() => { done = true; });
  while (!done) {
    reads++;
    try { if (!fs.readFileSync(lockPath(dir)).equals(aBytes)) differ++; } catch { missing++; }
    await sleep(5);
  }
  await bDone;
  const rb = await b.opened();
  assert.equal(rb.event, 'refused', JSON.stringify(rb));
  assert.ok(isLocked(rb, a.pid), `B names A's pid ${a.pid}: ${rb.message}`);
  assert.equal(rb.from, 'open');
  const ticked = await a.next((e) => e.event === 'ticked', 10000);
  assert.equal(ticked.errors, 0, 'every append of A succeeds');
  assert.ok(ticked.n > 100, `A appended throughout: ${ticked.n}`);
  assert.equal(missing + differ, 0, `LOCK always exists with A's bytes (${reads} reads)`);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => !names.has(f)), [], 'no file that was not there before B started');
  await a.stop();
});

test('T1-c14: a second opener in another time zone is refused; a pid-reuse lock is judged stale by an opener with an empty PATH', async () => {
  const { root, dir, lock } = makeVault();
  const h = await holder(root, {}, { TZ: 'UTC' });
  const r = await tryOpen(root, {}, { TZ: 'Pacific/Kiritimati', LC_ALL: 'C' });
  assert.equal(r.event, 'refused', JSON.stringify(r));
  assert.equal(r.name, 'VaultLocked');
  assert.ok(r.message.includes(String(h.pid)));
  writeLock(lock, { ...readLock(lock), start: readLock(lock).start - 3600000 });   // one hour before its real start
  const r2 = await tryOpen(root, {}, { PATH: '' });
  assert.equal(r2.event, 'open', `judged stale with no PATH: ${JSON.stringify(r2)}`);
  assert.ok(new Vault(root, { readOnly: true }).open().log.verify().ok);
  await h.kill9();
});

test('T1-c16: a holder whose pid started 3 s before node is still seen as alive', async () => {
  const { root, dir, lock } = makeVault();
  const h = new Child({ root, kind: 'vault', wait: true }, { sh: 3 });
  const ro = await h.opened();
  assert.equal(ro.event, 'open', JSON.stringify(ro));
  const before = fs.readFileSync(lock);
  const r = await tryOpen(root);
  assert.equal(r.event, 'refused', JSON.stringify(r));
  assert.ok(isLocked(r, h.pid), r.message);
  assert.ok(fs.readFileSync(lock).equals(before), 'LOCK is unchanged');
  assert.equal((await h.send({ cmd: 'append' })).ok, true);
  assert.equal((await h.send({ cmd: 'state' })).verify, true);
  await h.stop();
});

test('T1-c17: with no open in this process, a lock naming this pid is held on another host, boot or pid namespace, and stale after 90 s', async () => {
  const dir = bareDir();
  const cases = { host: (o) => ({ ...o, host: 'other-host' }), boot: (o) => ({ ...o, boot: 'other-boot' }), ...(LINUX ? { ns: (o) => ({ ...o, ns: 'pid:[1]' }) } : {}) };
  for (const [name, edit] of Object.entries(cases)) {
    plant(dir, edit);
    const before = fs.readFileSync(lockPath(dir));
    refuses(dir, process.pid);
    assert.ok(fs.readFileSync(lockPath(dir)).equals(before), `${name}: LOCK unchanged`);
    if (name !== 'ns') { age(lockPath(dir), 91); openAppendVerify(dir); }
    else fs.rmSync(lockPath(dir));
  }
});

test('T1-c18: a lock whose per-boot machine identifier differs is held while fresh and stale after 90 s', async () => {
  const dead = await deadPid();
  const dir = bareDir();
  plant(dir, (o) => ({ ...o, pid: dead, machine: crypto.randomUUID() }));
  refuses(dir);
  age(lockPath(dir), 91);
  openAppendVerify(dir);
  if (process.platform === 'linux' || process.platform === 'darwin') {
    const o = sampleBare(dir);
    assert.match(o.machine, /^[0-9a-f-]{8,}$/i, 'the lock records the machine identifier');
    if (LINUX) assert.equal(o.machine, fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim());
  }
});

test('T1-c21: pid reuse is judged without PATH: a ps in PATH is never run', async () => {
  const { root, lock } = makeVault();
  const h = await holder(root);
  const rec = readLock(lock);
  const bin = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'oplock-bin-')), marker = path.join(bin, 'ran');
  const when = new Date(Date.now() - 3600000).toUTCString();
  fs.writeFileSync(path.join(bin, 'ps'), `#!/bin/sh\ntouch ${marker}\ndate -u -d "@${Math.floor((Date.now() - 3600000) / 1000)}" '+%a %b %e %H:%M:%S %Y'\n`, { mode: 0o755 }); void when;
  writeLock(lock, { ...rec, start: rec.start - 3600000 });
  const r = await tryOpen(root, {}, { PATH: bin });
  assert.equal(r.event, 'open', `stale: ${JSON.stringify(r)}`);
  assert.ok(new Vault(root, { readOnly: true }).open().log.verify().ok);
  assert.equal(fs.existsSync(marker), false, 'the ps in PATH did not run');
  await h.kill9();
  fs.rmSync(bin, { recursive: true, force: true });
});

test('T1-c26: a live process whose recorded start time is an hour off is a reused pid: the lock is stale', async () => {
  const { root, lock } = makeVault();
  const h = await holder(root);
  writeLock(lock, { ...readLock(lock), start: readLock(lock).start - 3600000 });
  const v = openVault(root);
  v.write(OWNER, { path: 'notes/reuse.md', body: 'reused pid\n' });
  assert.ok(v.log.verify().ok);
  v.close();
  await h.kill9();
});

test('T1-judge: a start time within 2 s is the same process, further is not; an unreadable one or a pid we may not signal counts as alive', async () => {
  const { root, lock } = makeVault();
  const h = await holder(root);
  const rec = readLock(lock);
  for (const [delta, held] of [[1000, true], [-1000, true], [3000, false], [-3000, false]]) {
    writeLock(lock, { ...rec, start: rec.start + delta });
    if (held) refuses(path.dirname(lock), h.pid);
    else { openAppendVerify(path.dirname(lock)); break; }
  }
  await h.kill9();
  const dir = bareDir();
  plant(dir, (o) => ({ ...o, pid: 1, start: null }));
  refuses(dir, 1);                                   // pid 1 exists and is not ours to signal: alive, and its start time is unknown
  fs.rmSync(lockPath(dir));
});

test('T1-mutex: a recovery mutex younger than 10 s, or older with a live writer, keeps an opener out; an old one with a dead writer is itself stale', async () => {
  const dead = await deadPid();
  const live = await holder(makeVault().root);
  for (const [name, mutexPid, ageS, stale] of [['young', dead, 1, false], ['old live writer', live.pid, 11, false], ['old dead writer', dead, 11, true]]) {
    const dir = bareDir();
    const sample = plant(dir, (o) => ({ ...o, pid: dead }));
    const mutex = path.join(dir, 'LOCK.recover');
    writeLock(mutex, { ...sample, pid: mutexPid, start: UTIL.processStart(mutexPid) });
    age(mutex, ageS);
    if (stale) { openAppendVerify(dir); assert.equal(fs.existsSync(mutex), false, `${name}: the stale mutex is gone`); }
    else {
      const before = bytes(dir);
      refuses(dir, mutexPid);
      assert.deepEqual(bytes(dir), before, `${name}: nothing changed`);
    }
  }
  await live.kill9();
});

test('T1-platform: the macOS and Linux readers run the commands they should, by absolute path, with no PATH', () => {
  const calls = [];
  const exec = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return cmd === '/bin/ps' ? 'Sun Nov  1 09:00:00 2026\n' : 'ABCD-UUID\n'; };
  assert.equal(UTIL.processStart(4242, { platform: 'darwin', exec }), Date.UTC(2026, 10, 1, 9, 0, 0));
  assert.equal(calls[0].cmd, '/bin/ps');
  assert.deepEqual(calls[0].args, ['-o', 'lstart=', '-p', '4242']);
  assert.equal(calls[0].opts.env.TZ, 'UTC'); assert.equal(calls[0].opts.env.LC_ALL, 'C'); assert.equal(calls[0].opts.env.PATH, undefined);
  assert.equal(UTIL.machineBootId({ platform: 'darwin', exec }), 'ABCD-UUID');
  assert.equal(calls[1].cmd, '/usr/sbin/sysctl');
  assert.deepEqual(calls[1].args, ['-n', 'kern.bootsessionuuid']);
  assert.deepEqual(calls[1].opts.env, {}, 'sysctl runs with an empty environment');
  const reads = [];
  const readFile = (f) => { reads.push(f); return f.endsWith('boot_id') ? ' 11111111-2222 \n' : '4242 (a b) c) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 777 0 0'; };
  assert.equal(UTIL.machineBootId({ platform: 'linux', readFile }), '11111111-2222');
  assert.equal(UTIL.processStart(4242, { platform: 'linux', readFile }), 7770, 'field 22 of /proc/<pid>/stat, past a comm with spaces and a bracket');
  assert.deepEqual(reads, ['/proc/sys/kernel/random/boot_id', '/proc/4242/stat']);
  assert.equal(UTIL.pidNamespace({ platform: 'linux', readlink: (f) => (f === '/proc/self/ns/pid' ? 'pid:[7]' : null) }), 'pid:[7]');
  assert.equal(UTIL.pidNamespace({ platform: 'darwin' }), null);
  assert.equal(UTIL.processStart(1, { platform: 'win32' }), null);
  assert.equal(UTIL.machineBootId({ platform: 'win32' }), null);
  assert.equal(UTIL.processStart(1, { platform: 'darwin', exec: () => { throw new Error('gone'); } }), null);
  assert.equal(UTIL.machineBootId({ platform: 'linux', readFile: () => { throw new Error('no'); } }), null);
  assert.equal(UTIL.parseLstart('garbage'), null);
  assert.equal(UTIL.parseLstart('Mon Foo  1 09:00:00 2026'), null);
  assert.equal(UTIL.parseLstart('Wed Dec 31 23:59:59 1969'), -1000);
  assert.ok(Number.isFinite(UTIL.processStart(process.pid)) || !LINUX, 'this process\'s own start time is readable');
});

test('T1-runner: runner on, status, watch and off work while another process holds the vault, and change nothing under .memev/oplog', async () => {
  const { root, dir, lock } = makeVault();
  const seat = 'cursor@host';
  const op = { identity: OWNER, client: 'codex', local: true, cli: true };
  const w = openVault(root);
  const host = w.devices.get(w.devices.hostId);
  w.bus.register({ client: 'codex', device: host });
  w.bus.register({ client: 'cursor', device: host });
  w.bus.setOperator('codex@host', { by: 'terminal' });
  w.close();
  const quiet = console.log; console.log = () => {};
  const ran = [];
  try {
    assert.equal(await runnerCommand('runner', ['on', seat], { 'max-runs-per-day': '3', command: 'echo' }, { root, env: {} }), 0);
    const w2 = openVault(root);                                                  // a task arrives after the runner was turned on
    w2.bus.send({ ...op, device: w2.devices.get(w2.devices.hostId) }, { to: seat, type: 'task', body: 'do it' });
    w2.close();
    const h = await holder(root);                                                // and another process holds the vault from here on
    const before = bytes(dir), held = fs.readFileSync(lock);
    assert.equal(await runnerCommand('runner', ['status'], {}, { root, env: {} }), 0);
    await runnerWatch({ root, seat, pollMs: 5, stop: () => ran.length > 0, run: async (r) => { ran.push(r.body); return { code: 0 }; } });
    assert.equal(await runnerCommand('runner', ['off', seat], {}, { root, env: {} }), 0);
    assert.deepEqual(bytes(dir), before, 'nothing under .memev/oplog changed');
    assert.ok(fs.readFileSync(lock).equals(held), 'the holder still holds its lock');
    await h.kill9();
  } finally { console.log = quiet; }
  assert.deepEqual(ran, ['do it'], 'watch read the bus and started the task');
  assert.equal(runnerEntry(root, seat).enabled, false);
});
