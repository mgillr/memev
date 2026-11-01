// SR-0.03 task 3: verify never runs a bare git worktree prune, so a user's prunable worktree stays listed while the engine's own
// stale worktree is removed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, signed, first, worktrees, worktreeBlocks, gitIn, killMidRun } from './helpers/redgreen.mjs';
after(cleanup);

test('a stale engine worktree is removed, and a user worktree whose folder was moved away stays listed as prunable', async () => {
  const fx = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });
  const outer = fs.realpathSync(tmpdir('rg-gone-'));
  const gone = path.join(outer, 'user-gone');
  gitIn(fx.dir, 'worktree', 'add', '-q', '--detach', gone, 'HEAD');
  fs.renameSync(gone, path.join(outer, 'moved-away'));
  const stale = await killMidRun(fx.dir, fx.base, [redGreen('test/f.test.mjs', 'sleep 30; node --test {test}')]);
  const { v } = newVault({ git: false });
  try {
    const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs')] }) }));
    assert.equal(r.status, 'PASS', r.detail);
    assert.equal(worktrees(fx.dir).includes(stale), false, 'the stale engine worktree is still listed');
    assert.equal(fs.existsSync(stale), false, 'the stale engine worktree\'s folder is still there');
    assert.ok(fs.existsSync(path.join(fx.dir, '.git', 'worktrees', 'user-gone')), '.git/worktrees/user-gone was pruned');
    const block = worktreeBlocks(fx.dir).find((b) => b.path === gone);
    assert.ok(block, 'the user worktree is no longer listed');
    assert.ok(block.lines.some((l) => l.startsWith('prunable')), 'the user worktree is not listed as prunable');
  } finally { v.close(); }
});
