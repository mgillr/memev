// SR-0.03 task 3: when the code under test is the same at the base and the head, a red-green criterion is never PASS: the red
// run passes too (FAIL, red exit 0) or cannot run the test for a named reason (BLOCKED).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, signed, first } from './helpers/redgreen.mjs';
after(cleanup);

const SAME = 'export const f = () => 2;\n';
const T = (expr, imports = "import { f } from '../src/f.mjs';") => nodeTest(expr, imports);
const CASES = [
  ['(1) the workdir is a subdirectory, repo/pkg', { 'pkg/src/f.mjs': SAME }, { 'pkg/test/f.test.mjs': T('assert.equal(f(), 2);') }, { sub: 'pkg' }],
  ['(2) the red command is a script added at the head', { 'src/f.mjs': SAME }, { 'run.sh': '#!/bin/sh\nexec node --test "$1"\n', 'test/f.test.mjs': T('assert.equal(f(), 2);') }, { cmd: './run.sh {test}' }],
  ['(3) the test imports a named export added at the head to an existing helper', { 'src/f.mjs': SAME, 'test/helpers/h.mjs': 'export const a = 1;\n' }, { 'test/helpers/h.mjs': 'export const a = 1;\nexport const two = 2;\n', 'test/f.test.mjs': T('assert.equal(f(), two);', "import { f } from '../src/f.mjs';\nimport { two } from './helpers/h.mjs';") }, {}],
  ['(4) the base run throws a TypeError before any assertion', { 'src/f.mjs': SAME }, { 'src/config.mjs': 'export const value = 2;\n', 'test/f.test.mjs': T("const cfg = await import('../src/config.mjs').catch(() => null); const want = cfg.value; assert.equal(f(), want);") }, {}],
  ['(5) the test reads test/data.json, added at the head and not in support_files', { 'src/f.mjs': SAME }, { 'test/data.json': '{"want":2}\n', 'test/f.test.mjs': T("const fs = await import('node:fs'); const { want } = JSON.parse(fs.readFileSync(new URL('./data.json', import.meta.url), 'utf8')); assert.equal(f(), want);") }, {}],
];

for (const [name, base, head, opt] of CASES) {
  test(`${name}: FAIL with red exit 0, or BLOCKED naming the cause, never PASS`, async () => {
    const { v } = newVault({ git: false });
    try {
      const fx = baseAndHead(base, head);
      const workdir = opt.sub ? path.join(fx.dir, opt.sub) : fx.dir;
      const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir, base: fx.base, criteria: [redGreen('test/f.test.mjs', opt.cmd)] }) }));
      assert.notEqual(r.status, 'PASS', r.detail);
      // in a subdirectory workdir the red run runs in the same subdirectory of the base, so the unchanged test passes there
      if (opt.sub) assert.equal(r.status, 'FAIL', r.detail);
      if (r.status === 'FAIL') assert.match(r.detail, /red exit 0/);
      else { assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /not found|load error|failed with|timed out|too large|no passing/); }
    } finally { v.close(); }
  });
}

test('(5) with support_files [test/data.json] the red run has the data, passes, and the criterion is FAIL with red exit 0', async () => {
  const { v } = newVault({ git: false });
  try {
    const [, base, head] = CASES[4];
    const fx = baseAndHead(base, head);
    const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs', undefined, { support_files: ['test/data.json'] })] }) }));
    assert.equal(r.status, 'FAIL', r.detail);
    assert.match(r.detail, /red exit 0/);
  } finally { v.close(); }
});
