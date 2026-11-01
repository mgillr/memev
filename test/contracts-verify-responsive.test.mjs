// SR-0.03 task 3: a verify runs its criterion commands without blocking the daemon, so /healthz and other tools answer while
// a slow red-green criterion runs, and memev verify waits for the result.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, tmpdir } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { baseAndHead, nodeTest } from './helpers/redgreen.mjs';
after(cleanup);

async function timed(fn) { const t0 = Date.now(); try { const v = await fn(); return { ms: Date.now() - t0, v }; } catch (e) { return { ms: Date.now() - t0, error: e }; } }

test('during a verify whose red and green runs each sleep 8 s, /healthz and memev_contract_status answer within 2 s, and memev verify prints the PASS line with its counts', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const fx = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });
    const spec = path.join(tmpdir('rg-spec-'), 'spec.json');
    fs.writeFileSync(spec, JSON.stringify({ title: 'Slow red green', workdir: null, tasks: [{ id: 'T1', title: 'fix f', scope: ['**'], criteria: [
      { statement: 'red then green, slowly', verifier: { type: 'test_red_green', test_file: 'test/f.test.mjs', cmd: 'sleep 8; node --test {test}' } },
    ] }] }));
    const made = sb.run(['contract', 'new', spec, '--workdir', fx.dir, '--base', fx.base]);
    assert.equal(made.code, 0, made.err + made.out);
    const id = /k-[a-z0-9-]+/.exec(made.out)?.[0];
    assert.ok(id, made.out);
    const signedRun = sb.run(['contract', 'sign', id]);
    assert.equal(signedRun.code, 0, signedRun.err + signedRun.out);
    const verify = sb.runAsync(['verify', id]);
    await new Promise((r) => setTimeout(r, 3000)); // the red run is sleeping now
    const health = await timed(() => fetch(`http://127.0.0.1:${sb.port}/healthz`, { signal: AbortSignal.timeout(5000) }).then((r) => r.status));
    const status = await timed(() => sb.runAsync(['contract', 'status', id]));
    const v = await verify;
    assert.ok(!health.error && health.v === 200 && health.ms < 2000, `/healthz took ${health.ms} ms (${health.error?.message || health.v})`);
    assert.ok(!status.error && status.v.code === 0 && status.ms < 2000, `memev_contract_status took ${status.ms} ms`);
    assert.equal(v.code, 0, v.err + v.out);
    assert.match(v.out, new RegExp(`PASS ${id}`));
    assert.match(v.out, /behaviour \d+\/\d+/);
    assert.match(v.out, /documents \d+\/\d+/);
  } finally { sb.stop(); }
});
