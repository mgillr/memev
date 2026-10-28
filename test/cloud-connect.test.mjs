// memev cloud connect <chatgpt|claude>: prints the plan note and the copy-ready connector URL with a QR
// code, then waits until the app's first <app>@cloud seat shows up on the bus.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sandbox, BIN } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { clientToken } from '../src/cli/common.mjs';

after(() => cleanup());

// Run `memev cloud connect <app>` in a child process and resolve with its exit code and output.
function connect(sb, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, 'cloud', 'connect', ...args], { env: sb.env });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

// A cloud app's first request through its connector: a remote request (x-forwarded-for) with a
// non-computer user-agent, so the device is a cloud-connector and the seat lands at <app>@cloud.
async function cloudRegister(sb, token, app) {
  const r = await fetch(`http://127.0.0.1:${sb.port}/c/${token}/v1/bus-register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', 'user-agent': 'node' },
    body: JSON.stringify({ clients: [app] }),
  });
  return r.status;
}

function setup() {
  const sb = sandbox();
  const init = sb.run(['init', '--port', String(sb.port), '--no-connect']);
  assert.equal(init.code, 0, init.out + init.err);
  fs.writeFileSync(path.join(sb.root, '.memev', 'tunnel.json'), JSON.stringify({ url: `http://127.0.0.1:${sb.port}`, enabled: true, state: 'up', provider: 'test' }));
  const token = clientToken(sb.root, 'claude', { remote: true });
  return { sb, token };
}

test('MEM-095 AC01: memev cloud connect claude prints the URL and the plan note, and marks the row done when claude@cloud first appears', async () => {
  const { sb, token } = setup();
  try {
    const done = connect(sb, ['claude']);
    await new Promise((r) => setTimeout(r, 1000)); // let it print the URL and start waiting
    assert.equal(await cloudRegister(sb, token, 'claude'), 200, 'the cloud app registered its seat');
    const r = await done;
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(r.out.includes(`http://127.0.0.1:${sb.port}/c/${token}/mcp`), `the connector URL: ${r.out}`);
    assert.match(r.out, /Plan: free/, 'the plan note');
    assert.match(r.out, /claude@cloud is on the bus/, 'it saw the seat appear');
    // the onboarding row is done now that a cloud seat exists
    const ob = sb.run(['onboarding']);
    const row = ob.out.split('\n').find((l) => /Cloud AI apps/.test(l));
    assert.ok(row, ob.out);
    assert.match(row, /\u2713/, `the row is done: ${row}`);
    assert.ok(!/\u2192/.test(row), `not left as needs-manual: ${row}`);
  } finally { sb.stop(); }
});

test('MEM-095 AC02: memev cloud connect exits non-zero after --timeout when no cloud seat appears', async () => {
  const { sb } = setup();
  try {
    const r = await connect(sb, ['claude', '--timeout', '2']);
    assert.notEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /no claude@cloud seat after 2s/, r.out);
  } finally { sb.stop(); }
});
