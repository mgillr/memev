// PG-19.1 (WP19-02): the work command run through bin/memev.mjs against a real project store. The test spawns the CLI, reads its real
// output and exit code, and imports neither runWork nor openStore and passes no store. Only the work status command is run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup, PKG } from './helpers/tmp.mjs';
after(cleanup);

test('WP19-02 AC01: the end-to-end test fails before and passes after: memev work status prints a real project from the daemon', async () => {
  const sb = sandbox();
  try {
    let init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    for (let i = 0; i < 2 && init.code !== 0 && /did not start/.test(init.out + init.err); i++) init = sb.run(['start']); // a slow first start
    assert.equal(init.code, 0, init.err + init.out);
    const c = mcpClient(sb, 'e2e-client');
    const planned = await c.tool('memev_task_plan', { project: 'shop', tasks: [{ id: 'A', title: 'build the cart', artifacts: ['src/cart.js'] }, { id: 'B', title: 'write the copy', artifacts: ['src/copy.js'] }] });
    assert.ok(!planned.isError, JSON.stringify(planned));
    await c.close();
    const r = sb.run(['work', 'status', 'shop']);
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /shop: /);
    assert.match(r.out, /build the cart/);
    assert.match(r.out, /write the copy/);
    const j = sb.run(['work', 'status', 'shop', '--json']);
    assert.equal(j.code, 0, j.err);
    const data = JSON.parse(j.out);
    assert.equal(data.project, 'shop');
    assert.deepEqual(Object.keys(data.tasks).sort(), ['A', 'B']);
    const none = sb.run(['work', 'status', 'nothing-here']);
    assert.equal(none.code, 1);
    assert.match(none.err, /no project nothing-here/);
  } finally { sb.stop(); }
});

test('WP19-02 AC02: the test spawns the CLI and imports neither runWork nor openStore', () => {
  const src = fs.readFileSync(path.join(PKG, 'test', 'cli-work-e2e.test.mjs'), 'utf8');
  const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
  assert.doesNotMatch(imports, /work\.mjs|work-store\.mjs|runWork|openStore/);
  assert.match(src, /sb\.run\(\['work', 'status'/);
});
