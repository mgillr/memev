// A CLI that is not the claimed app must not take that app's seat. `memev mcp --client X` resolves
// the seat in order: the claim's own marker, the direct parent's process name when it is a known
// app (a parent named claude is the desktop client), the parent's name for a claude-code claim with
// no CLAUDECODE, and only then the claim. A marker of another app never relabels the seat, it may
// only confirm the claim it names; terminal markers (TERM_PROGRAM, ZED_TERM) never do either.
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, tmpdir } from './helpers/tmp.mjs';
import { sandbox, mcpClient, BIN } from './helpers/cli.mjs';

after(cleanup);

const state = (roster, seat) => roster.seats.find((s) => s.seat === seat)?.state;
// A stand-in for a parent app: a copy of the node binary under the app's process name runs a
// script that launches the real server as its child with the inherited environment. Renaming
// through /proc/self/comm is Linux only, so the named copy of the binary works on every platform.
const STANDIN = `
const { spawn } = require('child_process');
const child = spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit' });
child.on('close', (code) => process.exit(code == null ? 1 : code));
`;
// A copy of the node binary named after the parent app, so the server's parent has that process name.
const namedNode = (dir, name) => { const p = path.join(dir, name); fs.copyFileSync(process.execPath, p); fs.chmodSync(p, 0o755); return p; };

test('MEM-048 AC01: memev mcp --client claude-code under a parent that is not Claude Code does not mark the claude-code seat live', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // no marker of the claimed client in the environment, and the parent (this test process) is
    // not a known app, so the server seats under the parent's name, not the claim
    const c = mcpClient(sb, 'claude-code', { command: process.execPath, args: [BIN, 'mcp', '--client', 'claude-code'], env: {} });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.notEqual(u.seat, 'claude-code@host', 'the claimed seat is not used');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, u.seat), 'live');
    assert.notEqual(state(r, 'claude-code@host'), 'live', 'the claude-code seat must not be live');
    let parentName = null;
    try { parentName = fs.readFileSync(`/proc/${process.pid}/comm`, 'utf8').trim(); } catch {}
    if (parentName) assert.equal(u.seat, `${parentName}@host`, 'seats under the parent process name');
  } finally { sb.stop(); }
});

test('MEM-048 AC02: under a real Claude Code parent marker the claude-code seat is used as before', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // the desktop client sets CLAUDECODE=1 in the children it launches, so the server seats as claude-code
    const c = mcpClient(sb, 'claude-code', { command: process.execPath, args: [BIN, 'mcp', '--client', 'claude-code'], env: { CLAUDECODE: '1' } });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'claude-code@host');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'claude-code@host'), 'live');
  } finally { sb.stop(); }
});

test('MEM-048: a claimed codex keeps codex when its own marker and an inherited CLAUDECODE are both set', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // Codex launched the server (CODEX_CLI) under a desktop-client ancestor (CLAUDECODE); the claim stands
    const c = mcpClient(sb, 'codex', { command: process.execPath, args: [BIN, 'mcp', '--client', 'codex'], env: { CODEX_CLI: '1', CLAUDECODE: '1' } });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'codex@host', 'the claim\'s own marker stands over an ancestor\'s marker');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'codex@host'), 'live');
    assert.notEqual(state(r, 'claude-code@host'), 'live');
  } finally { sb.stop(); }
});

test('MEM-048: a claimed gemini-cli keeps gemini-cli when GEMINI_CLI and CLAUDECODE are both set', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const c = mcpClient(sb, 'gemini-cli', { command: process.execPath, args: [BIN, 'mcp', '--client', 'gemini-cli'], env: { GEMINI_CLI: '1', CLAUDECODE: '1' } });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'gemini-cli@host', 'the claim\'s own marker stands over an ancestor\'s marker');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'gemini-cli@host'), 'live');
    assert.notEqual(state(r, 'claude-code@host'), 'live');
  } finally { sb.stop(); }
});

test('MEM-048: a claimed codex with an inherited CLAUDECODE and a node parent keeps codex', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // CLAUDECODE is inherited from a desktop-client ancestor, but the claim's own marker is absent
    // and the parent (this test process) is not a known app, so the claim stands
    const c = mcpClient(sb, 'codex', { command: process.execPath, args: [BIN, 'mcp', '--client', 'codex'], env: { CLAUDECODE: '1' } });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'codex@host', 'an inherited marker of another app never relabels the seat');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'codex@host'), 'live');
    assert.notEqual(state(r, 'claude-code@host'), 'live');
  } finally { sb.stop(); }
});

test('MEM-048: gemini-cli, codex and windsurf under a node parent with no own marker keep their claim', async () => {
  for (const client of ['gemini-cli', 'codex', 'windsurf']) {
    const sb = sandbox();
    try {
      const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
      assert.equal(init.code, 0, init.err + init.out);
      // no own marker in the environment, and the parent (this test process) is not a known app
      const c = mcpClient(sb, client, { command: process.execPath, args: [BIN, 'mcp', '--client', client], env: {} });
      const u = (await c.tool('bus_unread', {})).structuredContent;
      await c.close();
      assert.equal(u.seat, `${client}@host`, `${client} keeps its claim under an unknown parent`);
      const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
      assert.equal(state(r, `${client}@host`), 'live');
    } finally { sb.stop(); }
  }
});

test('MEM-048: a claimed claude-code under a parent named claude with CLAUDECODE missing seats as claude-code', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // the parent process is named claude (the desktop client) and CLAUDECODE is missing
    const c = mcpClient(sb, 'claude-code', { command: namedNode(tmpdir('parent-'), 'claude'), args: ['-e', STANDIN, BIN, 'mcp', '--client', 'claude-code'], env: {} });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'claude-code@host', 'a parent named claude is the desktop client');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'claude-code@host'), 'live');
  } finally { sb.stop(); }
});

test('MEM-048: a claimed codex keeps codex when TERM_PROGRAM is vscode', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // a terminal marker must not relabel the seat at all
    const c = mcpClient(sb, 'codex', { command: process.execPath, args: [BIN, 'mcp', '--client', 'codex'], env: { CODEX_CLI: '1', TERM_PROGRAM: 'vscode' } });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'codex@host', 'a terminal marker does not relabel the seat');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'codex@host'), 'live');
    assert.notEqual(state(r, 'vscode@host'), 'live');
  } finally { sb.stop(); }
});

test('MEM-048: a claimed codex keeps codex when ZED_TERM is set', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const c = mcpClient(sb, 'codex', { command: process.execPath, args: [BIN, 'mcp', '--client', 'codex'], env: { CODEX_CLI: '1', ZED_TERM: '1' } });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'codex@host', 'a terminal marker does not relabel the seat');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'codex@host'), 'live');
    assert.notEqual(state(r, 'zed@host'), 'live');
  } finally { sb.stop(); }
});
