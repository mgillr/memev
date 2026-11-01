// SR-0.03 task 3: the green half. With a red run that fails exactly one assertion, a head run that fails, cannot find its
// command or runs past timeout_s is never PASS; only a head run that passes is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, redGreen, signed, first } from './helpers/redgreen.mjs';
after(cleanup);

const T = nodeTest('if (slow) await new Promise((r) => setTimeout(r, 6000)); assert.equal(f(), 2);', "import { f, slow } from '../src/f.mjs';");
const BASE = { 'src/f.mjs': 'export const slow = false; export const f = () => 1;\n', 'run.sh': '#!/bin/sh\nexec node --test "$1"\n' };
const CASES = [
  ['(a) the head run fails one assertion', { 'src/f.mjs': 'export const slow = false; export const f = () => 3;\n', 'test/f.test.mjs': T }, {}, (r, fx) => { assert.equal(r.status, 'FAIL'); assert.equal(r.detail, `red exit 1, green exit 1, base ${fx.base}`); }],
  ['(b) the head run exits 127', { 'src/f.mjs': 'export const slow = false; export const f = () => 2;\n', 'run.sh': null, 'test/f.test.mjs': T }, { cmd: './run.sh {test}' }, (r) => { assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /command was not found/); }],
  ['(c) the head run sleeps past timeout_s', { 'src/f.mjs': 'export const slow = true; export const f = () => 2;\n', 'test/f.test.mjs': T }, { timeout_s: 2 }, (r) => { assert.ok(['FAIL', 'BLOCKED'].includes(r.status)); assert.match(r.detail, /timed out/); }],
  ['(d) the head run passes with a name filter that matches no test (the red run is a real assertion failure)', { 'src/f.mjs': 'export const slow = false; export const f = () => 2;\n', 'test/f.test.mjs': T }, { cmd: 'if [ "$(git rev-parse HEAD)" = "$MEMEV_CONTRACT_BASE" ]; then node --test {test}; else node --test --test-name-pattern=no-such-test {test}; fi' }, (r) => { assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /no passing test line/); }],
  ['control: the head run passes', { 'src/f.mjs': 'export const slow = false; export const f = () => 2;\n', 'test/f.test.mjs': T }, {}, (r, fx) => { assert.equal(r.status, 'PASS'); assert.equal(r.detail, `red exit 1, green exit 0, base ${fx.base}`); }],
];

for (const [name, head, opt, check] of CASES) {
  test(`${name}: ${name.startsWith('control') ? 'PASS' : 'never PASS'}`, async () => {
    const { v } = newVault({ git: false });
    try {
      const fx = baseAndHead(BASE, head);
      const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen('test/f.test.mjs', opt.cmd, opt.timeout_s ? { timeout_s: opt.timeout_s } : {})] }) }));
      check(r, fx);
    } finally { v.close(); }
  });
}
