// SR-0.03 task 4: a metric criterion runs its command under the same gates as a command criterion, reads the last JSON object
// it prints and compares one number with a threshold. A bench stub that meets the threshold passes, one that misses fails with
// the measured value in the detail, a busy machine blocks without running the command.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { signByHand, task } from './helpers/contracts-base.mjs';
after(cleanup);

const metric = (extra) => ({ statement: 'the metric', verifier: { type: 'metric', key: 'p50', op: '<', value: 20, ...extra } });
async function verify(v, root, criteria, fields = {}) {
  const dir = tmpdir('metric-wd-');
  const { id } = signByHand(root, { workdir: dir, tasks: task(criteria, ['**']), fields });
  return { dir, r: (await v.contractVerify(OWNER, { id })).tasks[0].criteria };
}

test('a bench stub that meets the threshold passes and its detail carries the value, the threshold, the CPU count and the load', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const { r } = await verify(v, root, [metric({ cmd: `echo '{"p50": 12}'` })]);
    assert.equal(r[0].status, 'PASS', r[0].detail);
    assert.match(r[0].detail, /12/);
    assert.match(r[0].detail, /20/);
    assert.match(r[0].detail, /\d+ CPUs?/);
    assert.match(r[0].detail, /load \d/);
  } finally { v.close(); }
});

test('a bench stub that misses the threshold fails with the measured value in the detail', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const { r } = await verify(v, root, [metric({ cmd: `echo '{"p50": 31.5}'` })]);
    assert.equal(r[0].status, 'FAIL');
    assert.match(r[0].detail, /31\.5/);
  } finally { v.close(); }
});

test('every operator compares as named, against a reading of 10', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const cases = [['<', 11, 'PASS'], ['<', 10, 'FAIL'], ['<=', 10, 'PASS'], ['<=', 9, 'FAIL'], ['>', 9, 'PASS'], ['>', 10, 'FAIL'], ['>=', 10, 'PASS'], ['>=', 11, 'FAIL'], ['==', 10, 'PASS'], ['==', 11, 'FAIL']];
    const { r } = await verify(v, root, cases.map(([op, value]) => metric({ cmd: `echo '{"p50": 10}'`, op, value })));
    cases.forEach(([op, value, want], i) => assert.equal(r[i].status, want, `${op} ${value}: ${r[i].detail}`));
  } finally { v.close(); }
});

test('a busy machine blocks and the command is not run; an exit of 127 blocks; the same gates as a command apply', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const marker = path.join(tmpdir('metric-mark-'), 'ran');
    // a ceiling below zero is exceeded by any load at all, so the machine always counts as busy
    const busy = await verify(v, root, [metric({ cmd: `touch '${marker}'; echo '{"p50": 1}'` })], { defaults: { max_load_per_cpu: -1 } });
    assert.equal(busy.r[0].status, 'BLOCKED');
    assert.match(busy.r[0].detail, /machine busy/);
    assert.ok(!fs.existsSync(marker), 'the command ran on a busy machine');
    const roomy = await verify(v, root, [metric({ cmd: `echo '{"p50": 1}'` })], { defaults: { max_load_per_cpu: 100000 } });
    assert.equal(roomy.r[0].status, 'PASS', roomy.r[0].detail);
    const missing = await verify(v, root, [metric({ cmd: 'no-such-bench-command-xyz' })]);
    assert.equal(missing.r[0].status, 'BLOCKED');
    assert.match(missing.r[0].detail, /not found|127/);
  } finally { v.close(); }
});
