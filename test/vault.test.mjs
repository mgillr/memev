import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../src/engine/vault.mjs';
import { newVault, cleanup, OWNER, tmpdir } from './helpers/tmp.mjs';
after(cleanup);

test('an edit to a large note is logged as a small splice, not the whole note', () => {
  const { v } = newVault();
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(v.write(OWNER, { path: 'notes/big.md', body: big }).op, 'put');
  const r = v.write(OWNER, { path: 'notes/big.md', body: big.replace('line 1000', 'line one thousand') });
  assert.equal(r.op, 'splice');
  const last = [...v.log.iterate({ path: 'notes/big.md' })].at(-1);
  assert.ok(Buffer.byteLength(JSON.stringify(last)) < 600, 'splice record is small');
  v.close();
});

test('a lost note is rebuilt and a cut-short append completed, byte for byte, from the log', () => {
  const { root, v } = newVault();
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nfirst\n' });
  v.append(OWNER, { path: 'notes/a.md', text: 'second' });
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nfirst\nsecond\nthird\n' });
  v.append(OWNER, { path: 'notes/b.md', text: 'one\ntwo\nthree' });
  const wantA = fs.readFileSync(path.join(root, 'notes/a.md')), wantB = fs.readFileSync(path.join(root, 'notes/b.md'));
  v.close();
  fs.rmSync(path.join(root, 'notes/a.md'));
  fs.writeFileSync(path.join(root, 'notes/b.md'), wantB.subarray(0, 6));
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  assert.deepEqual(v2.recovered.sort(), ['notes/a.md', 'notes/b.md']);
  assert.deepEqual(fs.readFileSync(path.join(root, 'notes/a.md')), wantA);
  assert.deepEqual(fs.readFileSync(path.join(root, 'notes/b.md')), wantB);
  v2.close();
});

test('a note edited by hand is never overwritten: the edit is logged and the old version kept', () => {
  const { root, v } = newVault();
  const w = v.write(OWNER, { path: 'notes/h.md', body: 'original\n' });
  v.close();
  fs.writeFileSync(path.join(root, 'notes/h.md'), 'edited in an editor\n');
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  assert.equal(fs.readFileSync(path.join(root, 'notes/h.md'), 'utf8'), 'edited in an editor\n');
  assert.equal(v2.materialize('notes/h.md', { uptoSeq: w.seq }), 'original\n');
  fs.writeFileSync(path.join(root, 'notes/h.md'), 'edited again while running\n');
  v2.append(OWNER, { path: 'notes/h.md', text: 'and appended' });
  assert.equal(v2.materialize('notes/h.md'), 'edited again while running\nand appended\n');
  v2.close();
});

test('the whole vault can be rebuilt from the log alone, byte for byte, after rolls and snapshots', () => {
  const { root, v: v0 } = newVault(); v0.close();
  const v = new Vault(root, { git: false, fsync: false, segmentBytes: 8192, snapshotEvery: 40 }).open();
  for (let i = 0; i < 300; i++) {
    if (i % 3 === 0) v.remember(OWNER, { text: `fact number ${i} about ${['cats', 'ships', 'tea'][i % 3]} ${i * 7}`, kind: 'fact' });
    else if (i % 3 === 1) v.append(OWNER, { path: `notes/n${i % 11}.md`, text: `entry ${i}` });
    else v.write(OWNER, { path: `notes/w${i % 5}.md`, body: `# W\n${'line\n'.repeat(i % 17)}version ${i}\n` });
  }
  assert.ok(v.log.stats().segments > 2);
  const out = path.join(root, '..', 'rebuilt');
  const paths = v.rebuildInto(out);
  for (const p of v.allNotes()) assert.deepEqual(fs.readFileSync(path.join(out, p)), fs.readFileSync(path.join(root, p)), p);
  assert.equal(paths.length, v.allNotes().length);
  assert.equal(v.log.verify().ok, true);
  v.close();
});

test('secrets, signed contracts and paths outside the vault are refused', () => {
  const { v } = newVault();
  assert.throws(() => v.remember(OWNER, { text: `the key is AKIA${'Q'.repeat(16)}` }), /credential/);
  assert.throws(() => v.write(OWNER, { path: 'contracts/signed/x.json', body: '{}' }), /immutable/);
  assert.throws(() => v.write(OWNER, { path: '../escape.md', body: 'x' }), /not a vault path/);
  assert.throws(() => v.write(OWNER, { path: '.memev/tokens.json', body: '{}' }), /not a vault path/);
  v.close();
});

test('remember shards by month, skips duplicates and recall finds it from the index', () => {
  const { v } = newVault();
  const a = v.remember(OWNER, { text: 'Deploys go out on Tuesdays only, never Fridays', kind: 'decision', project: 'shop' });
  assert.match(a.path, /^memory\/decisions\/\d{4}-\d{2}\.md$/);
  assert.equal(v.remember(OWNER, { text: 'Deploys go out on Tuesdays only, never Fridays', kind: 'decision' }).duplicate, true);
  const orig = v.log.iterate; v.log.iterate = () => { throw new Error('recall must not read the log'); };
  const hits = v.recall(OWNER, { query: 'which day do deploys go out', log: false });
  v.log.iterate = orig;
  assert.ok(hits.some((h) => h.path === a.path && /Tuesdays/.test(h.snippet)));
  v.close();
});

test('checkpoints accumulate done items and the latest next/doing win', () => {
  const { v } = newVault();
  v.checkpoint(OWNER, { project: 'Shop API', task: 'add refunds', done: ['schema'], doing: 'handler', next: ['tests', 'docs'] });
  v.checkpoint(OWNER, { project: 'Shop API', done: ['handler'], doing: 'tests', next: ['docs'] });
  const s = v.projectState('shop-api');
  assert.deepEqual(s.done, ['schema', 'handler']);
  assert.equal(s.doing, 'tests');
  assert.deepEqual(s.next, ['docs']);
  assert.equal(s.checkpoints, 2);
  v.close();
});

test('a token limited to some paths cannot read or write others', () => {
  const { v } = newVault();
  v.write(OWNER, { path: 'private/x.md', body: 'secret plans for the orchard' });
  const limited = { id: 'l', agent: 'cloud', scopes: ['read', 'write'], paths: ['memory/**'] };
  const reader = { id: 'r', agent: 'reader', scopes: ['read'], paths: ['**'] };
  assert.throws(() => v.get(limited, 'private/x.md'), /may not read/);
  assert.equal(v.recall(limited, { query: 'orchard plans' }).length, 0);
  assert.throws(() => v.write(reader, { path: 'memory/x.md', body: 'x' }), /may not write/);
  v.close();
});

test('every write lands in git', async () => {
  const { root, v } = newVault();
  v.remember(OWNER, { text: 'Use UTC everywhere', kind: 'decision', client: 'test-client' });
  v.commits.flush();
  const { git } = await import('../src/engine/git.mjs');
  assert.match(git(root, ['log', '-1', '--format=%B']).out, /Memev-Client: test-client/);
  v.close();
});

test('MEM-003 AC02: when git init fails on a folder that already has files, the files that were there before are not removed', async () => {
  const os = await import('node:os');
  const { initVault } = await import('../src/engine/vault.mjs');
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshim-'));
  fs.writeFileSync(path.join(shim, 'git'), '#!/bin/sh\nif [ "$1" = "init" ]; then echo "git: init: boom" >&2; exit 1; fi\nexec /usr/bin/false\n', { mode: 0o755 });
  const root = path.join(tmpdir(), 'vault');
  const kept = path.join(root, 'my-notes', 'thesis.md');
  fs.mkdirSync(path.dirname(kept), { recursive: true });
  fs.writeFileSync(kept, 'my work\n');
  const prev = process.env.PATH;
  process.env.PATH = `${shim}:${prev}`;
  try {
    assert.throws(() => initVault(root), /git/);
  } finally {
    process.env.PATH = prev;
  }
  assert.ok(fs.existsSync(root), 'the folder that existed before the call is still there');
  assert.equal(fs.readFileSync(kept, 'utf8'), 'my work\n', 'the file that was there before is still there');
  assert.ok(!fs.existsSync(path.join(root, '.git')), 'no half built git repo is left behind');
});

test('incremental indexing of appends gives the same recall as a full rebuild', () => {
  const { v } = newVault();
  for (let i = 0; i < 60; i++) v.journal(OWNER, { session: 'long-session', client: 'c', role: i % 2 ? 'assistant' : 'user', text: `turn ${i}: ${['the deploy pipeline', 'database migrations', 'the cache layer', 'login errors'][i % 4]} detail ${i * 13}` });
  const q = (x) => v.recall(OWNER, { query: x, log: false, limit: 5 }).map((h) => `${h.path}#${h.heading}|${h.score}`);
  const before = ['cache layer detail', 'login errors', 'migrations 351'].map(q);
  v.index.reset();
  v.reindexAll();
  assert.deepEqual(['cache layer detail', 'login errors', 'migrations 351'].map(q), before);
  v.close();
});
