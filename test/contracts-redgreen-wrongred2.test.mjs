// SR-0.03 task 3: the red run carries the head's test helpers and fixtures, so a test that depends only on test-side files added
// at the head passes at the base too, and the criterion is never PASS when the code under test did not change.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, signed, first } from './helpers/redgreen.mjs';
after(cleanup);

const SAME = 'export const f = () => 2;\n';
const CASES = [
  ['(a) a namespace import of a helper whose function was added at the head', { 'src/f.mjs': SAME, 'test/helpers/h.mjs': 'export const old = 1;\n' }, { 'test/helpers/h.mjs': 'export const old = 1;\nexport function addedAtHead() { return 2; }\n', 'test/f.test.mjs': nodeTest("assert.equal(typeof H.addedAtHead, 'function');", "import * as H from './helpers/h.mjs';") }],
  ['(b) a fixture file added at the head and not in support_files', { 'src/f.mjs': SAME, 'test/fixtures/old.json': '{}\n' }, { 'test/fixtures/new.json': '{"n":1}\n', 'test/f.test.mjs': nodeTest("assert.ok(fs.existsSync(new URL('./fixtures/new.json', import.meta.url)));", "import fs from 'node:fs';") }],
];

for (const [name, base, head] of CASES) {
  test(`${name}: FAIL with red exit 0, or BLOCKED, never PASS`, async () => {
    const { v } = newVault({ git: false });
    try {
      const fx = baseAndHead(base, head);
      const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs')] }) }));
      assert.notEqual(r.status, 'PASS', r.detail);
      if (r.status === 'FAIL') assert.match(r.detail, /red exit 0/);
      else { assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /not found|load error|failed with|timed out|too large|no passing/, 'BLOCKED without a red-green cause'); }
    } finally { v.close(); }
  });
}
