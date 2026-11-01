// SR-0.03 task 2: nothing a worker controls can hide a change from scope. With scope ['src/a/**'], each of these is FAIL
// naming the path: a tracked file edited after update-index --assume-unchanged, an untracked .gitignore holding '*' beside a new
// file, and an untracked file excluded only by a core.excludesFile set in .git/config.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { repoAt, put, gitIn, verifyScope } from './helpers/scope.mjs';
after(cleanup);

const FILES = { 'src/a/ok.js': 'ok\n', 'package.json': '{"name":"x"}\n', 'src/b/keep.js': 'k\n' };
const GLOBS = { T1: ['src/a/**'] };

async function failsNaming(change, file) {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    change(dir);
    const r = (await verifyScope(v, { workdir: dir, base, tasks: GLOBS })).T1;
    assert.equal(r.status, 'FAIL', r.detail);
    assert.ok(r.detail.includes(file), `the detail does not name ${file}: ${r.detail}`);
    assert.ok(r.detail.includes('uncommitted'), r.detail);
  } finally { v.close(); }
}

test('(a) a tracked package.json edited after update-index --assume-unchanged is FAIL naming it', () => failsNaming((d) => {
  gitIn(d, 'update-index', '--assume-unchanged', 'package.json');
  put(d, { 'package.json': '{"name":"changed"}\n' });
}, 'package.json'));

test('(b) an untracked src/b/.gitignore holding * beside an untracked src/b/new2.js is FAIL naming src/b/new2.js', () => failsNaming((d) => {
  put(d, { 'src/b/.gitignore': '*\n', 'src/b/new2.js': 'new\n' });
}, 'src/b/new2.js'));

test('(c) an untracked src/b/x.tmp excluded only by a core.excludesFile in .git/config is FAIL naming it', () => failsNaming((d) => {
  const excludes = path.join(tmpdir('hidden-excludes-'), 'ignore');
  fs.writeFileSync(excludes, '*.tmp\n');
  gitIn(d, 'config', 'core.excludesFile', excludes);
  put(d, { 'src/b/x.tmp': 'tmp\n' });
}, 'src/b/x.tmp'));

test('an assume-unchanged or skip-worktree file that was not edited is not a change, and a file a .gitignore tracked at the base ignores is not one either', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt({ ...FILES, '.gitignore': 'build/\n*.log\n' });
    gitIn(dir, 'update-index', '--assume-unchanged', 'package.json');
    gitIn(dir, 'update-index', '--skip-worktree', 'src/b/keep.js');
    put(dir, { 'build/out.js': 'built\n', 'src/a/debug.log': 'log\n' });
    const r = (await verifyScope(v, { workdir: dir, base, tasks: GLOBS })).T1;
    assert.equal(r.status, 'PASS', r.detail);
    assert.match(r.detail, /\b0 changed files\b/);
  } finally { v.close(); }
});

test('a .gitignore edited after the base does not hide a file: the base\'s own rules apply', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt({ ...FILES, '.gitignore': 'build/\n' });
    put(dir, { '.gitignore': 'build/\nsrc/b/\n', 'src/b/new3.js': 'new\n' });
    const r = (await verifyScope(v, { workdir: dir, base, tasks: GLOBS })).T1;
    assert.equal(r.status, 'FAIL', r.detail);
    assert.ok(r.detail.includes('src/b/new3.js') && r.detail.includes('.gitignore'), r.detail);
  } finally { v.close(); }
});
