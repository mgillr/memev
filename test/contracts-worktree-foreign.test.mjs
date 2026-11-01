// SR-0.03 task 3: verify cleans up only its own stale worktrees; a user's worktree, its uncommitted work and a lock survive.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, signed, first, worktrees, worktreeBlocks, gitIn, killMidRun } from './helpers/redgreen.mjs';
after(cleanup);

test('a stale engine worktree is removed; a user worktree with uncommitted work and a locked worktree are untouched', async () => {
  const fx = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });
  const outer = fs.realpathSync(tmpdir('rg-user-'));
  const userWt = path.join(outer, 'user-wt');
  const lockedWt = path.join(outer, 'locked-wt');
  gitIn(fx.dir, 'worktree', 'add', '-q', '--detach', userWt, 'HEAD');
  fs.writeFileSync(path.join(userWt, 'keep.txt'), 'my uncommitted work\n');
  gitIn(fx.dir, 'worktree', 'add', '-q', '--detach', lockedWt, 'HEAD');
  gitIn(fx.dir, 'worktree', 'lock', '--reason', 'mine', lockedWt);
  const stale = await killMidRun(fx.dir, fx.base, [redGreen('test/f.test.mjs', 'sleep 30; node --test {test}')]);
  const { v } = newVault({ git: false });
  try {
    const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs')] }) }));
    assert.equal(r.status, 'PASS', r.detail);
    const listed = worktrees(fx.dir);
    assert.equal(listed.includes(stale), false, 'the stale engine worktree is still listed');
    assert.equal(fs.existsSync(stale), false, 'the stale engine worktree\'s folder is still there');
    assert.ok(listed.includes(userWt), 'the user worktree was removed');
    assert.ok(listed.includes(lockedWt), 'the locked worktree was removed');
    assert.equal(fs.readFileSync(path.join(userWt, 'keep.txt'), 'utf8'), 'my uncommitted work\n');
    assert.ok(worktreeBlocks(fx.dir).find((b) => b.path === lockedWt).lines.some((l) => l.startsWith('locked')), 'the lock was lifted');
  } finally { v.close(); }
});

test('a stale engine worktree that is locked, and a worktree with the engine\'s name outside the temp folder, are both kept', async () => {
  const fx = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });
  const lookalike = path.join(fs.realpathSync(tmpdir('rg-look-')), 'memev-verify-999999-0badc0de');
  gitIn(fx.dir, 'worktree', 'add', '-q', '--detach', lookalike, 'HEAD');
  const stale = await killMidRun(fx.dir, fx.base, [redGreen('test/f.test.mjs', 'sleep 30; node --test {test}')]);
  gitIn(fx.dir, 'worktree', 'lock', '--reason', 'kept on purpose', stale);
  const { v } = newVault({ git: false });
  try {
    const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs')] }) }));
    assert.equal(r.status, 'PASS', r.detail);
    assert.ok(worktrees(fx.dir).includes(stale), 'a locked stale engine worktree was removed');
    assert.ok(fs.existsSync(stale));
    assert.ok(worktrees(fx.dir).includes(lookalike), 'a worktree outside the temp folder was removed for its name');
  } finally {
    v.close();
    gitIn(fx.dir, 'worktree', 'unlock', stale); gitIn(fx.dir, 'worktree', 'remove', '--force', stale);
  }
});
