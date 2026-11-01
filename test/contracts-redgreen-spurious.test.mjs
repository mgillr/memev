// SR-0.03 task 3: a base run that fails for a reason other than an assertion proves nothing, so it is BLOCKED naming the cause;
// a base run that fails exactly one assertion is the red half working.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, signed, first } from './helpers/redgreen.mjs';
after(cleanup);

const F = "import { f } from '../src/f.mjs';";
const CASES = [
  // the copied test imports a helper the base does not have, outside test/helpers and not in support_files
  ['a helper absent at the base', { 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/util/h.mjs': 'export const two = 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), two);', `${F}\nimport { two } from './util/h.mjs';`) }, {}, /load error/],
  // at the base the code under test makes the test sleep past timeout_s
  ['a base run past timeout_s', { 'src/f.mjs': 'export const slow = true; export const f = () => 1;\n' }, { 'src/f.mjs': 'export const slow = false; export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('if (slow) await new Promise((r) => setTimeout(r, 6000)); assert.equal(f(), 2);', "import { f, slow } from '../src/f.mjs';") }, { timeout_s: 2 }, /timed out/],
  // at the base the test prints 2 MiB and then fails
  ['a base run printing 2 MiB', { 'src/f.mjs': 'export const loud = true; export const f = () => 1;\n' }, { 'src/f.mjs': 'export const loud = false; export const f = () => 2;\n', 'test/f.test.mjs': nodeTest("if (loud) process.stdout.write('x'.repeat(2 * 1024 * 1024)); assert.equal(f(), 2);", "import { f, loud } from '../src/f.mjs';") }, {}, /output.*too large/],
];

for (const [name, base, head, extra, cause] of CASES) {
  test(`${name}: the head test passes, and the criterion is BLOCKED naming the cause, not PASS`, async () => {
    const { v } = newVault({ git: false });
    try {
      const fx = baseAndHead(base, head);
      const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs', 'node --test {test}', extra)] }) }));
      assert.equal(r.status, 'BLOCKED', r.detail);
      assert.match(r.detail, cause);
    } finally { v.close(); }
  });
}

test('a base run that fails exactly one assertion is PASS with the exit codes and the base in the detail', async () => {
  const { v } = newVault({ git: false });
  try {
    const fx = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', F) });
    const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs')] }) }));
    assert.equal(r.status, 'PASS', r.detail);
    assert.equal(r.detail, `red exit 1, green exit 0, base ${fx.base}`);
  } finally { v.close(); }
});
