// SR-0.03 task 3: the temporary worktree of the base is cleaned up even when a verify is killed, two verifies in one
// repository do not disturb each other, and the worktree lives outside the workdir and the vault.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, signed, first, worktrees, engineWorktrees, childVerify, killMidRun } from './helpers/redgreen.mjs';
after(cleanup);

const fixed = () => baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });

test('(a) a verify SIGKILLed while its worktree exists leaves it stale; the next verify removes it and its folder', async () => {
  const fx = fixed();
  const stale = await killMidRun(fx.dir, fx.base, [redGreen('test/f.test.mjs', 'sleep 30; node --test {test}')]);
  assert.ok(worktrees(fx.dir).includes(stale), 'the killed run left no stale worktree to clean');
  const { v } = newVault({ git: false });
  try {
    const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs')] }) }));
    assert.equal(r.status, 'PASS', r.detail);
    assert.deepEqual(worktrees(fx.dir), [fx.dir], 'a worktree besides the main one is still listed');
    assert.equal(fs.existsSync(stale), false, 'the killed run\'s folder is still there');
  } finally { v.close(); }
});

test('(b) two verifies in one repository at the same time each report their own red exit and verdict', async () => {
  const fx = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'marker-from-base': 'x\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });
  // the marker exists only at the head, so the red run (sleep, then test -f) exits 1 and the green run goes on to the test
  const crit = [redGreen('test/f.test.mjs', 'sleep 2; test -f marker-from-base && node --test {test}')];
  const a = childVerify({ workdir: fx.dir, base: fx.base, criteria: crit });
  const b = childVerify({ workdir: fx.dir, base: fx.base, criteria: crit });
  const [ra, rb] = await Promise.all([a.result, b.result]);
  for (const [r, c] of [[ra, a], [rb, b]]) {
    assert.ok(r, `a child gave no result: ${c.output()}`);
    assert.equal(r.status, 'PASS', r.detail);
    assert.match(r.detail, /^red exit 1, green exit 0, base /);
    assert.doesNotMatch(r.detail, /exit null|ENOENT/);
  }
  assert.deepEqual(worktrees(fx.dir), [fx.dir]);
});

test('(c) the temporary worktree is outside both the workdir and the vault root', async () => {
  const fx = fixed();
  const seen = path.join(tmpdir('rg-pwd-'), 'pwd');
  const { v, root } = newVault({ git: false });
  try {
    // red runs first, so the first line is the red run's folder
    first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs', `pwd -P >> '${seen}'; exit 1`)] }) }));
    const wt = fs.readFileSync(seen, 'utf8').split('\n')[0].trim();
    assert.notEqual(wt, fs.realpathSync(fx.dir), 'the red run ran in the workdir');
    for (const outer of [fs.realpathSync(fx.dir), fs.realpathSync(root)]) {
      const rel = path.relative(outer, wt);
      assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `the worktree ${wt} is inside ${outer}`);
    }
    assert.deepEqual(engineWorktrees(fx.dir), []);
  } finally { v.close(); }
});
