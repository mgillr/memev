// The commit queue's timed commit runs off the daemon's thread. What must not change: commits in order, nothing lost at a stop or a
// hard kill, the bus's seed commit first, a failed commit kept and retried, and no other git command in this process racing it.
// A pre-commit hook that sleeps holds each batch open, so the tests look at what happens during one instead of hoping to land in one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { git, CommitQueue } from '../src/engine/git.mjs';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { initVault, Vault } from '../src/engine/vault.mjs';
after(cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const subjects = (root) => git(root, ['log', '--reverse', '--format=%s']).out.split('\n');
const dirty = (root) => git(root, ['status', '--porcelain']).out;

function slowRepo(hookMs = 400) {
  const { root, v } = newVault({ git: true, commitDelayMs: 60000 });
  v.close();
  const hooks = path.join(root, '.git', 'hooks'); fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'pre-commit'), `#!/bin/sh\nnode -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${hookMs})"\n`, { mode: 0o755 });
  return root;
}
const note = (root, name, text) => { const f = path.join(root, 'notes', name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return `notes/${name}`; };
const untilFlying = async (q) => { const t = Date.now(); while (!q.flying) { if (Date.now() - t > 20000) throw new Error('no batch started'); await sleep(2); } };
const untilLanded = async (q) => { const t = Date.now(); while (q.flying || q.timer) { if (Date.now() - t > 40000) throw new Error('no batch landed'); await sleep(5); } };

test('a timed commit leaves this thread free: it keeps turning while the batch runs', async () => {
  const root = slowRepo(800);
  const q = new CommitQueue(root, { delayMs: 5 });
  q.add(note(root, 'a.md', 'a\n'), 'c');
  const before = q.commits; const t0 = performance.now(); let last = t0; let worst = 0; let turns = 0;
  while (q.commits === before) {
    await new Promise((r) => setImmediate(r));
    const t = performance.now(); worst = Math.max(worst, t - last); last = t; turns++;
    if (t - t0 > 30000) throw new Error('no commit');
  }
  assert.ok(performance.now() - t0 >= 700, 'the hook did not hold the batch open, so this measures nothing');
  assert.ok(worst < 400, `the thread stopped for ${Math.round(worst)} ms of an 800 ms commit`);
  assert.ok(turns > 50, `only ${turns} turns`);
  assert.equal(dirty(root), '');
});

test('flush during a running batch waits for it, then commits the rest after it, in order, with nothing dropped', async () => {
  const root = slowRepo(300);
  const q = new CommitQueue(root, { delayMs: 5 });
  q.add(note(root, 'first.md', '1\n'), 'c');
  await untilFlying(q);
  q.add(note(root, 'second.md', '2\n'), 'c');
  const r = q.flush();
  assert.equal(r.ok, true, `the flush must not meet the batch's index lock: ${r.err}`);
  assert.equal(q.pending.size, 0); assert.equal(q.flying, null);
  const s = subjects(root);
  assert.deepEqual(s.slice(-2), ['memev: notes/first.md', 'memev: notes/second.md']);
  assert.equal(dirty(root), '');
});

test('a note changed during its own batch is committed again, so the last commit holds what the disk holds', async () => {
  const root = slowRepo(300);
  const q = new CommitQueue(root, { delayMs: 5 });
  const p = note(root, 'moving.md', 'one\n');
  q.add(p, 'c');
  await untilFlying(q);
  fs.appendFileSync(path.join(root, p), 'two\n'); q.add(p, 'c');
  fs.appendFileSync(path.join(root, p), 'three\n'); q.add(p, 'c');
  await untilLanded(q); await sleep(30); await untilLanded(q);
  assert.equal(git(root, ['show', `HEAD:${p}`]).out, 'one\ntwo\nthree');
  assert.equal(dirty(root), '');
  assert.equal(q.pending.size, 0);
});

test('every git command in this process waits for a running batch', async () => {
  const root = slowRepo(300);
  const count = () => Number(git(root, ['rev-list', '--count', 'HEAD']).out);
  const n = count();
  const q = new CommitQueue(root, { delayMs: 5 });
  q.add(note(root, 'a.md', 'a\n'), 'c');
  await untilFlying(q);
  assert.equal(count(), n + 1, 'git() ran beside the batch');
  assert.equal(q.flying, null);
});

test('a failed timed commit stays pending and the next flush retries it and reports', async () => {
  const root = slowRepo(1);
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const q = new CommitQueue(root, { delayMs: 5 });
  q.add(note(root, 'a.md', 'a\n'), 'c');
  await untilFlying(q); await untilLanded(q);
  assert.ok(q.pending.has('notes/a.md'), 'the path was dropped on a failed commit');
  assert.equal(q.commits, 0);
  assert.equal(q.flush().ok, false, 'the failure is reported to the caller');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(q.flush().ok, true);
  assert.equal(q.pending.size, 0); assert.equal(dirty(root), '');
});

test('a note written and deleted inside one quiet period does not stop every later commit', () => {
  const { root, v } = newVault({ commitDelayMs: 60000 });
  try {
    v.write(OWNER, { path: 'notes/keep.md', body: '# keep\n' });
    v.write(OWNER, { path: 'notes/gone.md', body: '# gone\n' });
    v.delete(OWNER, { path: 'notes/gone.md' });
    const r = v.commits.flush();
    assert.equal(r?.ok, true, `the flush failed: ${r?.err}`);
    assert.equal(v.commits.pending.size, 0);
    assert.equal(git(root, ['show', 'HEAD:notes/keep.md']).out, '# keep');
    assert.equal(dirty(root), '');
    // nothing but the vanished note in a batch is an empty batch, as a note edited back is
    v.write(OWNER, { path: 'notes/gone2.md', body: '# gone\n' });
    v.delete(OWNER, { path: 'notes/gone2.md' });
    assert.equal(v.commits.flush(), null);
    assert.equal(v.commits.pending.size, 0);
  } finally { v.close(); }
});

test('the vault: the bus seed commit stays first, and a stop during a running batch leaves everything committed in order', async () => {
  const root = slowRepo(300);
  fs.rmSync(path.join(root, 'bus'), { recursive: true, force: true });
  git(root, ['add', '-A']); git(root, ['commit', '-q', '--no-verify', '-m', 'no bus yet']);
  const v = new Vault(root, { commitDelayMs: 5, fsync: false, keyDir: path.join(root, '..', 'keys') }).open();
  const afterOpen = subjects(root);
  const seedFiles = git(root, ['show', '--name-only', '--format=', 'HEAD']).out.split('\n').filter(Boolean);
  assert.ok(seedFiles.length && seedFiles.every((f) => f.startsWith('bus/')), `the seed commit is not bus files alone: ${seedFiles.join(', ')}`);
  v.write(OWNER, { path: 'notes/stop-1.md', body: '# 1\n' });
  await untilFlying(v.commits);
  v.write(OWNER, { path: 'notes/stop-2.md', body: '# 2\n' });
  v.close();
  const s = subjects(root);
  const seed = s.indexOf(afterOpen.at(-1)); const a = s.indexOf('memev: notes/stop-1.md'); const b = s.indexOf('memev: notes/stop-2.md');
  assert.ok(seed >= 0 && seed < a && a < b, `order: ${s.slice(-4).join(' | ')}`);
  assert.equal(dirty(root), '');
});

// The kill test: a child acknowledges each append, is SIGKILLed mid-run, and the vault reopens.
const WRITER = `
const { Vault } = await import(${JSON.stringify(path.join(PKG, 'src/engine/vault.mjs'))});
import('node:fs').then((fs) => {
  const ID = { id: 'x', agent: 'x', scopes: ['read', 'write', 'admin'], paths: ['**'] };
  const root = process.argv[1];
  const v = new Vault(root, { fsync: true, commitDelayMs: 30, keyDir: root + '/../keys' }).open();
  let i = 0;
  const go = () => { const p = 'notes/k' + (i % 4) + '.md'; const t = 'tick-' + process.pid + '-' + i; v.append(ID, { path: p, text: t, client: 'kill' }); fs.writeSync(1, p + ' ' + t + '\\n'); i++; setTimeout(go, 1 + (i % 45)); };
  go();
});`;
test('a hard kill loses no acknowledged write, and the reopened vault commits what the kill left uncommitted', async () => {
  const root = path.join(tmpdir(), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  let acked = 0, leftDirty = 0;
  for (let k = 0; k < 8; k++) {
    const c = spawn(process.execPath, ['--input-type=module', '-e', WRITER, root], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    const t = Date.now(); while (out.split('\n').length < 6 + (k * 3) && Date.now() - t < 30000) await sleep(3);
    c.kill('SIGKILL');
    await new Promise((r) => c.on('close', r));
    for (let i = 0; i < 100 && fs.existsSync(path.join(root, '.git', 'index.lock')); i++) await sleep(30); // an orphan git finishes
    const sawDirty = !!dirty(root);
    if (sawDirty) leftDirty++;
    const v = new Vault(root, { fsync: true, commitDelayMs: 5, keyDir: path.join(root, '..', 'keys') }).open();
    const lines = out.split('\n').filter(Boolean).map((l) => l.split(' '));
    assert.ok(lines.length >= 5, 'the writer acknowledged nothing');
    for (const [p, text] of lines) { acked++; assert.ok(fs.readFileSync(path.join(root, p), 'utf8').includes(text), `acknowledged ${text} is not in ${p}`); }
    const q = v.commits; const w = Date.now();
    while (dirty(root) && Date.now() - w < 15000) await sleep(20);
    assert.equal(dirty(root), '', `kill ${k}: still uncommitted after reopening`);
    await untilLanded(q);
    v.close();
  }
  assert.ok(acked > 40, `only ${acked} acknowledged writes`);
  assert.ok(leftDirty > 0, 'no kill left anything uncommitted, so this proved nothing');
});

test('a clean stop writes the commit record, so the next open queues nothing', () => {
  const { root, v } = newVault({ commitDelayMs: 60000 });
  v.write(OWNER, { path: 'notes/a.md', body: '# a\n' });
  v.close();
  assert.equal(dirty(root), '');
  const v2 = new Vault(root, { commitDelayMs: 60000, fsync: false, keyDir: path.join(root, '..', 'keys') }).open();
  try { assert.equal(v2.commits.pending.size, 0, 'a clean stop left work for the next open'); } finally { v2.close(); }
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout, '');
});
