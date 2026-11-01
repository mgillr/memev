// SR-0.03 task 2: a scope criterion fails on a change outside the task's globs and passes on one inside.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { repoAt, commitFiles, put, verifyScope } from './helpers/scope.mjs';
after(cleanup);

test('a committed change outside the task globs is FAIL naming the file and the commit, and one inside is PASS', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt({ 'src/a/one.js': '1\n', 'src/b/two.js': '2\n' });
    const inside = commitFiles(dir, { 'src/a/one.js': 'one\n' }, 'I change a file inside the scope');
    const ok = await verifyScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    assert.equal(ok.T1.status, 'PASS', ok.T1.detail);
    assert.match(ok.T1.detail, /\b1 changed file\b/);
    const outside = commitFiles(dir, { 'src/b/two.js': 'two\n' }, 'I change a file outside the scope');
    const bad = await verifyScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    assert.equal(bad.T1.status, 'FAIL', bad.T1.detail);
    assert.ok(bad.T1.detail.includes('src/b/two.js'), bad.T1.detail);
    assert.ok(bad.T1.detail.includes(outside), 'the detail names the commit');
    assert.ok(!bad.T1.detail.includes(inside), 'the in-scope commit is not named');
  } finally { v.close(); }
});

test('an uncommitted change outside the globs is FAIL naming the file and "uncommitted", and no change is PASS with a count of 0', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt({ 'src/a/one.js': '1\n', 'src/b/two.js': '2\n' });
    const none = await verifyScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    assert.equal(none.T1.status, 'PASS', none.T1.detail);
    assert.match(none.T1.detail, /\b0 changed files\b/);
    put(dir, { 'src/a/one.js': 'edited\n' });
    const inside = await verifyScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    assert.equal(inside.T1.status, 'PASS', inside.T1.detail);
    put(dir, { 'src/b/two.js': 'edited\n' });
    const bad = await verifyScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    assert.equal(bad.T1.status, 'FAIL', bad.T1.detail);
    assert.ok(bad.T1.detail.includes('src/b/two.js') && bad.T1.detail.includes('uncommitted'), bad.T1.detail);
  } finally { v.close(); }
});
