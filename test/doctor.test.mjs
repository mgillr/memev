// When the daemon cannot listen, init and doctor say why, and doctor --fix calls a fix done only once the
// check passes again.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sandbox, initWithRetry } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

after(() => cleanup());

// a program that holds a port and never answers, so the port is neither free nor a Memev daemon
const HOLD = "require('net').createServer(() => {}).listen(+process.argv[1], '127.0.0.1', () => process.stdout.write('up\\n'))";
async function hold(port) {
  const p = spawn(process.execPath, ['-e', HOLD, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { p.stdout.once('data', resolve); p.once('exit', (c) => reject(new Error(`the holder exited with ${c}`))); });
  return p;
}
const release = (p) => new Promise((resolve) => { if (p.exitCode !== null) return resolve(); p.once('exit', resolve); p.kill(); });

test("MEM-006 AC02: init prints the daemon's listen error instead of only 'did not start'", () => {
  const sb = sandbox();
  try {
    // an address this machine does not have: the daemon starts, cannot listen, logs why and exits
    const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { extraEnv: { MEMEV_BIND: '192.0.2.1' } });
    const out = r.out + r.err;
    assert.match(out, /did not start/);
    assert.match(out, new RegExp(`Memev running: the last start could not listen on 192\\.0\\.2\\.1:${sb.port}: listen E[A-Z]+`), out);
    assert.equal(out.includes(':undefined'), false, out);
  } finally { sb.stop(); }
});

test('MEM-006 AC03: doctor --fix re-runs the health check and reports a fix as done only when it passes', async () => {
  const sb = sandbox();
  let holder = null;
  try {
    assert.equal(initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    assert.equal(sb.run(['stop']).code, 0);
    const port = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8')).port;
    holder = await hold(port);
    const d = sb.run(['doctor']);
    assert.match(d.out, new RegExp(`daemon running: port ${port} is held by another program; run memev init --port \\d+`), d.out);
    // the start fails while the port is held, so the fix is not reported as done
    const f = sb.run(['doctor', '--fix']);
    assert.equal(f.out.includes('fixed: daemon running'), false, f.out);
    assert.match(f.out, new RegExp(`could not fix daemon running: port ${port} is held by another program`), f.out);
    assert.match(f.out, /Still failing: (.*, )?daemon running/);
    assert.equal(f.code, 1);
    // once the port is free the same fix works, and only then is it reported as done
    await release(holder); holder = null;
    const g = sb.run(['doctor', '--fix']);
    assert.match(g.out, /✓ fixed: daemon running/, g.out);
    assert.doesNotMatch(g.out, /Still failing: (.*, )?daemon running/);
  } finally { if (holder) await release(holder); sb.stop(); }
});
