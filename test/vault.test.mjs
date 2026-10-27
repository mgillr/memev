import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../src/engine/vault.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
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

test('a lost or damaged note is rebuilt byte for byte from the log', () => {
  const { root, v } = newVault();
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nfirst\n' });
  v.append(OWNER, { path: 'notes/a.md', text: 'second' });
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nfirst\nsecond\nthird\n' });
  const want = fs.readFileSync(path.join(root, 'notes/a.md'));
  v.close();
  fs.writeFileSync(path.join(root, 'notes/a.md'), 'garbage');
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  assert.deepEqual(v2.recovered, ['notes/a.md']);
  assert.deepEqual(fs.readFileSync(path.join(root, 'notes/a.md')), want);
  v2.close();
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
