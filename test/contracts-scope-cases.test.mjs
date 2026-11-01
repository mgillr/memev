// SR-0.03 task 2: in a standalone repository with scope ['src/a/**'], every kind of change outside it is FAIL naming the path:
// a rename (the old path), a deletion, an untracked file (also one only .git/info/exclude hides), a file hidden by
// skip-worktree, and a non-ASCII name; a workdir below the repository root is still judged on the whole repository.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { repoAt, commitFiles, put, gitIn, verifyScope } from './helpers/scope.mjs';
after(cleanup);

const FILES = { 'src/a/ok.js': 'ok\n', 'src/b/x.js': 'x\n', 'src/b/y.js': 'y\n', 'src/b/z.js': 'z\n' };
const GLOBS = { T1: ['src/a/**'] };
const CASES = {
  'a committed rename src/b/x.js -> src/a/x.js': { path: 'src/b/x.js', change: (d) => { fs.mkdirSync(path.join(d, 'src/a'), { recursive: true }); gitIn(d, 'mv', 'src/b/x.js', 'src/a/x.js'); gitIn(d, 'commit', '-q', '-m', 'I move a file into the scope'); } },
  'a staged rename, not yet committed': { path: 'src/b/x.js', change: (d) => { gitIn(d, 'mv', 'src/b/x.js', 'src/a/x.js'); }, uncommitted: true },
  'a committed deletion of src/b/y.js': { path: 'src/b/y.js', change: (d) => { commitFiles(d, { 'src/b/y.js': null }, 'I delete a file'); } },
  'an uncommitted deletion of src/b/y.js': { path: 'src/b/y.js', change: (d) => { put(d, { 'src/b/y.js': null }); }, uncommitted: true },
  'an untracked src/b/new.js': { path: 'src/b/new.js', change: (d) => { put(d, { 'src/b/new.js': 'new\n' }); }, uncommitted: true },
  'an untracked file that only .git/info/exclude hides': { path: 'src/b/secret.js', change: (d) => { put(d, { 'src/b/secret.js': 's\n' }); fs.appendFileSync(path.join(d, '.git/info/exclude'), 'src/b/secret.js\n'); }, uncommitted: true },
  'a tracked src/b/z.js modified after update-index --skip-worktree': { path: 'src/b/z.js', change: (d) => { gitIn(d, 'update-index', '--skip-worktree', 'src/b/z.js'); put(d, { 'src/b/z.js': 'changed\n' }); }, uncommitted: true },
  'an untracked non-ASCII src/b/\u00e9.js': { path: 'src/b/\u00e9.js', change: (d) => { put(d, { 'src/b/\u00e9.js': 'e\n' }); }, uncommitted: true },
  'a committed non-ASCII src/b/\u00e9.js': { path: 'src/b/\u00e9.js', change: (d) => { commitFiles(d, { 'src/b/\u00e9.js': 'e\n' }, 'I add a file with an accent in its name'); } },
};

for (const [name, c] of Object.entries(CASES)) {
  test(`${name} is FAIL naming ${c.path}`, async () => {
    const { v } = newVault({ git: false });
    try {
      const { dir, base } = repoAt(FILES);
      c.change(dir);
      const r = (await verifyScope(v, { workdir: dir, base, tasks: GLOBS })).T1;
      assert.equal(r.status, 'FAIL', r.detail);
      assert.ok(r.detail.includes(c.path), `the detail does not name ${c.path}: ${r.detail}`);
      assert.ok(c.uncommitted ? r.detail.includes('uncommitted') : /commit [0-9a-f]{40}/.test(r.detail), r.detail);
    } finally { v.close(); }
  });
}

test('with the workdir set to src/a, a change to src/b/x.js elsewhere in the repository is FAIL, and a change only inside src/a is PASS with count 1', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    const sub = path.join(dir, 'src', 'a');
    put(dir, { 'src/a/ok.js': 'edited\n' });
    const inside = (await verifyScope(v, { workdir: sub, base, tasks: GLOBS })).T1;
    assert.equal(inside.status, 'PASS', inside.detail);
    assert.match(inside.detail, /\b1 changed file\b/);
    put(dir, { 'src/b/x.js': 'edited\n' });
    const bad = (await verifyScope(v, { workdir: sub, base, tasks: GLOBS })).T1;
    assert.equal(bad.status, 'FAIL', bad.detail);
    assert.ok(bad.detail.includes('src/b/x.js'), bad.detail);
  } finally { v.close(); }
});

test('a change only inside src/a/** is PASS with count 1, whether committed or not', async () => {
  const { v } = newVault({ git: false });
  try {
    const one = repoAt(FILES);
    commitFiles(one.dir, { 'src/a/ok.js': 'edited\n' }, 'I change a file inside the scope');
    const committed = (await verifyScope(v, { workdir: one.dir, base: one.base, tasks: GLOBS })).T1;
    assert.equal(committed.status, 'PASS', committed.detail);
    assert.match(committed.detail, /\b1 changed file\b/);
    const two = repoAt(FILES);
    put(two.dir, { 'src/a/ok.js': 'edited\n' });
    const dirty = (await verifyScope(v, { workdir: two.dir, base: two.base, tasks: GLOBS })).T1;
    assert.equal(dirty.status, 'PASS', dirty.detail);
    assert.match(dirty.detail, /\b1 changed file\b/);
  } finally { v.close(); }
});
