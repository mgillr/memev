// SR-0.03 task 3: two verifies in one repository at once each keep their own worktree of the base through the other's cleanup.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, childVerify, worktrees } from './helpers/redgreen.mjs';
after(cleanup);

test('both runs report red exit 3: each red run found the base marker at the base commit, and each detail names its base', async () => {
  // marker-from-base is committed at the base and removed at the head
  const fx = baseAndHead({ 'marker-from-base': 'x\n', 'src/f.mjs': 'export const f = () => 1;\n' }, { 'marker-from-base': null, 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });
  const crit = [redGreen('test/f.test.mjs', 'sleep 2; test -f marker-from-base && test $(git rev-parse HEAD) = $MEMEV_CONTRACT_BASE && exit 3; node --test {test}')];
  const runs = [childVerify({ workdir: fx.dir, base: fx.base, criteria: crit }), childVerify({ workdir: fx.dir, base: fx.base, criteria: crit })];
  const results = await Promise.all(runs.map((r) => r.result));
  results.forEach((r, i) => {
    assert.ok(r, `run ${i} gave no result: ${runs[i].output()}`);
    assert.match(r.detail, new RegExp(`^red exit 3, green exit 0, base ${fx.base}$`), `run ${i}: ${r.detail}`);
    assert.equal(r.status, 'PASS');
  });
  assert.deepEqual(worktrees(fx.dir), [fx.dir]);
});
