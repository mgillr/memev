// SR-0.03 task 3: a red-green criterion runs its test against the base (it must fail) and against the head (it must pass).
// This file imports only what any earlier commit has, so its red half runs at the recorded base without the engine it tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
after(cleanup);

const git = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(dir, files) {
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), t); }
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'c');
  return git(dir, 'rev-parse', 'HEAD');
}
const TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { f } from '../src/f.mjs';\ntest('f is fixed', () => { assert.equal(f(), 2); });\n";
// a repository whose base has `baseCode` in src/f.mjs and whose head has `headCode` and the test
function fixture(baseCode, headCode) {
  const dir = fs.realpathSync(tmpdir('rg-'));
  git(dir, 'init', '-q');
  const base = commit(dir, { 'src/f.mjs': baseCode });
  commit(dir, { 'src/f.mjs': headCode, 'test/f.test.mjs': TEST });
  return { dir, base };
}
const worktrees = (dir) => git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
async function verifyOne(v, { dir, base }, { local = true } = {}) {
  const d = v.contractDraft(OWNER, { title: 'Red green', workdir: dir, base, tasks: [{ id: 'T1', title: 'fix f', scope: ['**'], criteria: [
    { statement: 'red then green', verifier: { type: 'test_red_green', test_file: 'test/f.test.mjs', cmd: 'node --test {test}' } },
  ] }] });
  v.contractSign(OWNER, { id: d.id, local });
  return (await v.contractVerify(OWNER, { id: d.id })).tasks[0].criteria[0];
}

test('a test that fails on the base and passes on the head is PASS, one that passes on the base is FAIL, an unapproved remote one is BLOCKED, and no worktree is left', async () => {
  const { v } = newVault({ git: false });
  try {
    const fixed = fixture('export const f = () => 1;\n', 'export const f = () => 2;\n');
    const r1 = await verifyOne(v, fixed);
    assert.equal(r1.status, 'PASS', r1.detail);
    assert.match(r1.detail, new RegExp(`red exit 1, green exit 0, base ${fixed.base}`));

    const already = fixture('export const f = () => 2;\n', 'export const f = () => 2;\n');
    const r2 = await verifyOne(v, already);
    assert.equal(r2.status, 'FAIL', r2.detail);
    assert.match(r2.detail, /red exit 0/);

    const remote = fixture('export const f = () => 1;\n', 'export const f = () => 2;\n');
    const r3 = await verifyOne(v, remote, { local: false });
    assert.equal(r3.status, 'BLOCKED');
    assert.match(r3.detail, /approval/);

    for (const f of [fixed, already, remote]) assert.equal(worktrees(f.dir).length, 1, `a worktree was left in ${f.dir}`);
  } finally { v.close(); }
});
