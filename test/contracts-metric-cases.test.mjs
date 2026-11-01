// SR-0.03 task 4: the ways a metric reading can be wrong are FAIL with the reason in the detail, never PASS.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { signByHand, task } from './helpers/contracts-base.mjs';
after(cleanup);

const metric = (extra) => ({ statement: 'the metric', verifier: { type: 'metric', key: 'p50', op: '<', value: 20, ...extra } });
async function verify(v, root, dir, criteria) {
  const { id } = signByHand(root, { workdir: dir, tasks: task(criteria, ['**']) });
  return (await v.contractVerify(OWNER, { id })).tasks[0].criteria;
}

test('(a) a passing JSON line with exit 1 is FAIL', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const [r] = await verify(v, root, tmpdir('mc-'), [metric({ cmd: `echo '{"p50": 1}'; exit 1` })]);
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /exited 1/);
  } finally { v.close(); }
});

test('(b) an output_file that already holds a passing value, with a command that writes nothing, is FAIL: output_file not written by this run', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const dir = tmpdir('mc-');
    fs.writeFileSync(path.join(dir, 'bench.json'), '{"p50": 1}\n');
    const [stale, fresh] = await verify(v, root, dir, [metric({ cmd: 'true', output_file: 'bench.json' }), metric({ cmd: `echo '{"p50": 2}' > bench.json`, output_file: 'bench.json' })]);
    assert.equal(stale.status, 'FAIL');
    assert.match(stale.detail, /output_file not written by this run/);
    assert.equal(fresh.status, 'PASS', fresh.detail);
  } finally { v.close(); }
});

test('(c) pretty-printed output is read as one object: the top-level p50 counts, not the last one-line object nested in it', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const out = '{\n  "p50": 99,\n  "warm": {"p50": 1}\n}';
    const [r, nested, logged] = await verify(v, root, tmpdir('mc-'), [
      metric({ cmd: `printf '%s\\n' '${out}'` }),
      metric({ cmd: `printf '%s\\n' '${out}'`, key: 'warm.p50' }),
      metric({ cmd: `echo 'bench starting {not json'; echo '{"p50": 50}'; echo '{"p50": 3}'; echo 'done'` }),
    ]);
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /99/);
    assert.doesNotMatch(r.detail, /= 1,/);
    assert.equal(nested.status, 'PASS', nested.detail);
    assert.equal(logged.status, 'PASS', `the last JSON object wins: ${logged.detail}`);
  } finally { v.close(); }
});

test('(d) a null, empty or boolean value, and no JSON at all, are FAIL', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const r = await verify(v, root, tmpdir('mc-'), [
      metric({ cmd: `echo '{"p50": null}'` }),
      metric({ cmd: `echo '{"p50": ""}'` }),
      metric({ cmd: `echo '{"p50": true}'` }),
      metric({ cmd: `echo '{"p50": "5"}'` }),
      metric({ cmd: 'echo no json here' }),
    ]);
    for (const x of r) { assert.equal(x.status, 'FAIL', x.detail); assert.ok(x.detail.length > 8); }
    assert.match(r[0].detail, /not a number/);
    assert.match(r[4].detail, /no JSON/);
  } finally { v.close(); }
});

test('(e) a key that is not in the output, including an inherited one, is FAIL', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const r = await verify(v, root, tmpdir('mc-'), [
      metric({ cmd: `echo '{"p50": 1}'`, key: 'constructor.length' }),
      metric({ cmd: `echo '{"p50": 1}'`, key: 'p95' }),
      metric({ cmd: `echo '{"a": {"b": 1}}'`, key: 'a.c' }),
      metric({ cmd: `echo '{"p50": 1}'`, key: '__proto__' }),
    ]);
    for (const x of r) { assert.equal(x.status, 'FAIL', x.detail); assert.match(x.detail, /is not in the output/); }
  } finally { v.close(); }
});

test('a threshold, operator or key that is unusable is FAIL, and a timeout is FAIL', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const r = await verify(v, root, tmpdir('mc-'), [
      metric({ cmd: `echo '{"p50": 1}'`, op: '~' }),
      metric({ cmd: `echo '{"p50": 1}'`, value: 'twenty' }),
      metric({ cmd: 'sleep 20', timeout_s: 1 }),
    ]);
    for (const x of r) assert.equal(x.status, 'FAIL', x.detail);
    assert.match(r[2].detail, /timed out/);
  } finally { v.close(); }
});
