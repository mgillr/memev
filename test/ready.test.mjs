// memev ready, through the real CLI, hooks and daemon: an app joins with the first session it opens (a heartbeat on the
// bus), and two apps share one memory once one recalls a memory the other one wrote.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sandbox, mcpClient, BIN } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

const MEMORY = 'Invoice exports run nightly at 02:00 from the reporting replica, never from the primary database.';
const ASK = 'when do invoice exports run and from which database';
let sb; const running = []; const clients = [];
// a failed assertion must not leave memev ready or an MCP client running
afterEach(() => { for (const p of running.splice(0)) p.kill(); for (const m of clients.splice(0)) m.close(); sb?.stop(); sb = null; });
after(() => cleanup());

// Claude Code and Cursor connected, neither has opened a session yet
function setup() {
  sb = sandbox();
  for (const d of ['.claude', '.cursor']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
  const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
  assert.equal(r.code, 0, r.out + r.err);
}
// memev ready in the background: `seen(re)` waits for its output to match and fails if it exits first; `done` gives the
// exit code and output
function ready(args) {
  const p = spawn(process.execPath, [BIN, 'ready', ...args], { env: { ...sb.env, MEMEV_READY_POLL_MS: '100' } });
  running.push(p);
  let out = ''; let exited = false; const waits = [];
  const feed = (d) => { out += d; for (const w of waits.filter((x) => x.re.test(out))) { waits.splice(waits.indexOf(w), 1); w.resolve(); } };
  p.stdout.on('data', feed); p.stderr.on('data', feed);
  const done = new Promise((resolve) => p.on('close', (code) => {
    exited = true;
    for (const w of waits.splice(0)) w.reject(new Error(`memev ready exited (${code}) without printing ${w.re}:\n${out}`));
    resolve({ code, out });
  }));
  const seen = (re) => new Promise((resolve, reject) => {
    if (re.test(out)) resolve(); else if (exited) reject(new Error(`memev ready exited without printing ${re}:\n${out}`)); else waits.push({ re, resolve, reject });
  });
  return { done, seen, out: () => out, kill: () => p.kill() };
}
// an app opens a session: its session-start hook sends the first heartbeat
const open = (client, session) => assert.equal(sb.hook('session-start', { session_id: session, source: 'startup' }, client, client === 'cursor' ? ['--format', 'cursor'] : []).code, 0);
async function app(client) { const m = mcpClient(sb, client); clients.push(m); await m.request('initialize', { protocolVersion: '2025-06-18' }); return m; }

test("MEM-010 AC01: memev ready prints '<App> joined at' for a seat whose heartbeat arrives during the wait", { timeout: 60000 }, async () => {
  setup();
  const r = ready(['--timeout', '30']);
  await r.seen(/Waiting for Claude Code and Cursor to join/);
  assert.doesNotMatch(r.out(), /joined at/, 'no app has opened a session yet');
  open('claude-code', 'ready-a1');
  await r.seen(/Claude Code joined at \d\d:\d\d/);
  assert.doesNotMatch(r.out(), /Cursor joined at/);
  open('cursor', 'ready-a2');
  await r.seen(/Cursor joined at \d\d:\d\d/);
  await r.seen(/Now ask Claude Code to remember something, then ask Cursor about it/);
  r.kill(); await r.done;
});

test("MEM-010 AC02: memev ready prints 'share one memory' only after two seats joined and a cross-app recall succeeded", { timeout: 60000 }, async () => {
  setup();
  const cc = await app('claude-code'); const cu = await app('cursor');
  try {
    // Claude Code keeps a memory, then recalls it itself: one app, nothing shared yet
    const saved = await cc.tool('memev_remember', { text: MEMORY, kind: 'decision', project: 'billing', force: true });
    assert.ok(!saved.isError, JSON.stringify(saved));
    const own = await cc.tool('memev_recall', { query: ASK, project: 'billing' });
    assert.match(JSON.stringify(own.structuredContent), /reporting replica/);
    const r = ready(['--timeout', '30']);
    open('claude-code', 'ready-b1');
    await r.seen(/Claude Code joined at/);
    // Cursor recalls it before it has joined: the recall is recorded, but only one app has joined
    const early = await cu.tool('memev_recall', { query: ASK, project: 'billing' });
    assert.match(JSON.stringify(early.structuredContent), /reporting replica/);
    await new Promise((res) => setTimeout(res, 500));
    assert.doesNotMatch(r.out(), /share one memory/, 'one app has joined');
    open('cursor', 'ready-b2');
    const { code, out } = await r.done;
    assert.equal(code, 0, out);
    assert.match(out, /Cursor joined at[\s\S]*Ready: Claude Code and Cursor share one memory/);
  } finally { await cc.close(); await cu.close(); }
});

test('MEM-010 AC02: two apps that joined but never recalled each other do not share one memory', { timeout: 60000 }, async () => {
  setup();
  const cc = await app('claude-code'); const cu = await app('cursor');
  try {
    await cc.tool('memev_remember', { text: MEMORY, kind: 'decision', project: 'billing', force: true });
    await cc.tool('memev_recall', { query: ASK, project: 'billing' }); // its own memory only
    open('claude-code', 'ready-c1'); open('cursor', 'ready-c2');
    const { code, out } = await ready(['--timeout', '1']).done;
    assert.equal(code, 1, out);
    assert.match(out, /Claude Code joined at/); assert.match(out, /Cursor joined at/);
    assert.doesNotMatch(out, /share one memory/);
    assert.match(out, /none has recalled a memory another app wrote/);
  } finally { await cc.close(); await cu.close(); }
});

test('MEM-010 AC03: memev ready --timeout N exits non-zero and names the apps that did not join', { timeout: 60000 }, async () => {
  setup();
  open('cursor', 'ready-d1');
  const { code, out } = await ready(['--timeout', '1']).done;
  assert.notEqual(code, 0);
  assert.match(out, /Cursor joined at/);
  const missing = out.slice(out.indexOf('Not joined after 1 s:'));
  assert.match(missing, /^Not joined after 1 s: Claude Code\./);
  assert.doesNotMatch(missing, /Cursor/);
});

test('MEM-010 AC04: memev help lists memev ready', () => {
  sb = sandbox();
  assert.match(sb.run(['help']).out, /memev ready \[--timeout S\]/);
});
