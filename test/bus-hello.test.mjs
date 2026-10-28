// memev bus hello: a guided test of the bus from the terminal. It posts one hello to a seat,
// waits for the seat to read it on its next turn, and says what to do in the app meanwhile.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cleanup } from './helpers/tmp.mjs';
import { sandbox, mcpClient, BIN } from './helpers/cli.mjs';
after(cleanup);

// A vault with two apps (claude-code leads) and the daemon running, the way init leaves it.
function setUp() {
  const sb = sandbox();
  for (const d of ['.claude', '.cursor']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
  const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--lead', 'claude-code@host']);
  assert.equal(init.code, 0, init.err + init.out);
  return sb;
}
// Run the hello command in its own process, like a person at the terminal would.
function runHello(sb, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, 'bus', 'hello', ...args], { env: sb.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => out += d);
    p.stderr.on('data', (d) => err += d);
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('MEM-032 AC01: memev bus hello <seat> posts one message to that seat and reports when it is read', async () => {
  const sb = setUp();
  const c = mcpClient(sb, 'cursor');
  try {
    const hello = runHello(sb, ['cursor@host', '--timeout', '20']);
    // wait until the hello is on the bus, then let the app take its turn
    for (let i = 0; i < 100 && !JSON.parse(sb.run(['bus', 'tail', '--json', '--type', 'hello']).out).some((m) => m.to === 'cursor@host'); i++) await sleep(200);
    // the app's next turn: it checks the bus first, the way every turn does
    const u = (await c.tool('bus_unread', {})).structuredContent;
    assert.ok(u.messages.some((m) => m.type === 'hello' && m.to === 'cursor@host' && m.operator), 'the app sees the hello on its next turn');
    const r = await hello;
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /sent #\d+ to cursor@host/);
    assert.match(r.out, /cursor@host read it \d+ s after you sent it/);
    // exactly one message was posted to the seat: the hello itself
    const hellos = JSON.parse(sb.run(['bus', 'tail', '--json', '--type', 'hello']).out).filter((m) => m.to === 'cursor@host');
    assert.equal(hellos.length, 1, JSON.stringify(hellos, null, 1));
    assert.equal(hellos[0].operator, true);
  } finally { await c.close(); sb.stop(); }
});

test('MEM-032 AC02: memev bus hello --timeout N exits non-zero and says waiting for its next turn if unread', async () => {
  const sb = setUp();
  try {
    // no session in the app: the seat never takes a turn, so the hello stays unread
    const r = await runHello(sb, ['cursor@host', '--timeout', '2']);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /sent #\d+ to cursor@host/);
    assert.match(r.out, /waiting for its next turn/);
  } finally { sb.stop(); }
});
