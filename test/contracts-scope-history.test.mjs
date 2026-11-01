// SR-0.03 task 2: the range is the commits reachable from HEAD and not from the base, and each is judged on its own: a merge on
// what it adds beyond its parents, a commit that names two tasks never passes, an untrailered commit is judged against the union
// of the task scopes. The labelled tests (T2-c07, T2-c10) are the ones the contract's criteria run by name.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { repoAt, commitFiles, put, gitIn, signScope, scopeResults, trailer, OWNER } from './helpers/scope.mjs';
after(cleanup);

const verify = async (v, id) => scopeResults(await v.contractVerify(OWNER, { id }));
const FILES = { 'src/a/ok.js': 'ok\n', 'src/b/x.js': 'x\n', 'src/b/z.js': 'z\n' };

test('T2-c07: a merge that adds src/b/evil.js, a commit naming two tasks, and untrailered commits are judged as the contract says', async () => {
  const { v } = newVault({ git: false });
  try {
    // (i) a merge commit whose tree adds src/b/evil.js, which neither parent has
    { const { dir, base } = repoAt(FILES);
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
      gitIn(dir, 'checkout', '-q', '-b', 'side');
      commitFiles(dir, { 'src/a/side.js': 'side\n' }, 'I add a file on the side branch');
      gitIn(dir, 'checkout', '-q', 'main');
      commitFiles(dir, { 'src/a/main.js': 'main\n' }, 'I add a file on main');
      gitIn(dir, 'merge', '--no-commit', '--no-ff', '-q', 'side');
      put(dir, { 'src/b/evil.js': 'evil\n' });
      gitIn(dir, 'add', '-A');
      gitIn(dir, 'commit', '-q', '-m', 'I merge the side branch');
      const merge = gitIn(dir, 'rev-parse', 'HEAD');
      assert.equal(gitIn(dir, 'rev-list', '--parents', '-n', '1', merge).split(' ').length, 3, 'the commit is not a merge');
      const r = (await verify(v, id)).T1;
      assert.equal(r.status, 'FAIL', r.detail);
      assert.ok(r.detail.includes('src/b/evil.js') && r.detail.includes(merge), r.detail);
      assert.ok(!r.detail.includes('src/a/side.js') && !r.detail.includes('src/a/main.js'), `the merge was judged on what its parents bring: ${r.detail}`); }
    // (ii) one commit with 'Contract-Task: <id> T1' and 'Contract-Task: <id> T2' in separate paragraphs, changing src/b/x.js
    { const { dir, base } = repoAt(FILES);
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'], T2: ['src/a/**'] } });
      const sha = commitFiles(dir, { 'src/b/x.js': 'changed\n' }, `I change src/b/x.js\n\nFirst part of a squashed change.${trailer(id, 'T1')}\n\nSecond part of a squashed change.${trailer(id, 'T2')}`);
      const r = await verify(v, id);
      for (const t of ['T1', 'T2']) { assert.equal(r[t].status, 'FAIL', r[t].detail); assert.ok(/more than one task/.test(r[t].detail) || r[t].detail.includes('src/b/x.js'), r[t].detail); assert.ok(r[t].detail.includes(sha), r[t].detail); } }
    // (iii) an untrailered commit that changes src/a/ok.js passes; one that changes src/b/z.js fails naming the path and the commit
    { const { dir, base } = repoAt(FILES);
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
      commitFiles(dir, { 'src/a/ok.js': 'changed\n' }, 'I change src/a/ok.js');
      const ok = (await verify(v, id)).T1;
      assert.equal(ok.status, 'PASS', ok.detail);
      const sha = commitFiles(dir, { 'src/b/z.js': 'changed\n' }, 'I change src/b/z.js');
      const bad = (await verify(v, id)).T1;
      assert.equal(bad.status, 'FAIL', bad.detail);
      assert.ok(bad.detail.includes('src/b/z.js') && bad.detail.includes(sha), bad.detail); }
  } finally { v.close(); }
});

test('T2-c10: untrailered commits are judged against the union of the task scopes (the R2.4 rule), each case in its own fixture and verify', async () => {
  const { v } = newVault({ git: false });
  try {
    // (1) an untrailered commit changing src/a/ok.js is PASS with count 1
    { const { dir, base } = repoAt(FILES);
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
      commitFiles(dir, { 'src/a/ok.js': 'changed\n' }, 'I change src/a/ok.js');
      const r = (await verify(v, id)).T1;
      assert.equal(r.status, 'PASS', r.detail);
      assert.match(r.detail, /\b1 changed file\b/); }
    // (2) an untrailered commit changing src/b/z.js, a path outside every task, is FAIL naming src/b/z.js and the commit
    { const { dir, base } = repoAt(FILES);
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
      const sha = commitFiles(dir, { 'src/b/z.js': 'changed\n' }, 'I change src/b/z.js');
      const r = (await verify(v, id)).T1;
      assert.equal(r.status, 'FAIL', r.detail);
      assert.ok(r.detail.includes('src/b/z.js') && r.detail.includes(sha), r.detail); }
    // (3) in the two-task fixture, a commit trailered T1 that changes b.js is FAIL for T1, naming b.js and the commit
    { const { dir, base } = repoAt({ 'a.js': 'a\n', 'b.js': 'b\n' });
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['a.js'], T2: ['b.js'] } });
      const sha = commitFiles(dir, { 'b.js': 'changed\n' }, `I change b.js${trailer(id, 'T1')}`);
      const r = await verify(v, id);
      assert.equal(r.T1.status, 'FAIL', r.T1.detail);
      assert.ok(r.T1.detail.includes('b.js') && r.T1.detail.includes(sha), r.T1.detail); }
    // (4) an uncommitted b.js edit with no trailered commits is PASS for both T1 and T2
    { const { dir, base } = repoAt({ 'a.js': 'a\n', 'b.js': 'b\n' });
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['a.js'], T2: ['b.js'] } });
      put(dir, { 'b.js': 'edited\n' });
      const r = await verify(v, id);
      assert.equal(r.T1.status, 'PASS', r.T1.detail);
      assert.equal(r.T2.status, 'PASS', r.T2.detail); }
  } finally { v.close(); }
});

test('a merge that only brings in what its parents have is judged on those commits, not on itself', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    gitIn(dir, 'checkout', '-q', '-b', 'side');
    commitFiles(dir, { 'src/a/side.js': 'side\n' }, 'I add a file on the side branch');
    gitIn(dir, 'checkout', '-q', 'main');
    commitFiles(dir, { 'src/a/main.js': 'main\n' }, 'I add a file on main');
    gitIn(dir, 'merge', '--no-ff', '-q', '-m', 'I merge the side branch', 'side');
    const r = (await verify(v, id)).T1;
    assert.equal(r.status, 'PASS', r.detail);
  } finally { v.close(); }
});

test('an octopus merge that adds a file outside the scope is FAIL naming the file and the merge', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    for (const n of ['one', 'two']) { gitIn(dir, 'checkout', '-q', '-b', n, 'main'); commitFiles(dir, { [`src/a/${n}.js`]: `${n}\n` }, `I add ${n}`); }
    gitIn(dir, 'checkout', '-q', 'main');
    gitIn(dir, 'merge', '--no-commit', '--no-ff', '-q', 'one', 'two');
    put(dir, { 'src/b/octo.js': 'evil\n' });
    gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', 'I merge both branches');
    const merge = gitIn(dir, 'rev-parse', 'HEAD');
    const r = (await verify(v, id)).T1;
    assert.equal(r.status, 'FAIL', r.detail);
    assert.ok(r.detail.includes('src/b/octo.js') && r.detail.includes(merge), r.detail);
  } finally { v.close(); }
});
