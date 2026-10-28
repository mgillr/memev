// A CLI that is not the claimed app must not take that app's seat. `memev mcp --client X` resolves
// the real parent in order: the claim's own marker, the direct parent's process name when it is a
// known app, a marker of another app, and only then a parent that can be named but not placed.
// Markers are inherited by every descendant, so they name an ancestor, not the parent; terminal
// markers (TERM_PROGRAM, ZED_TERM) never relabel the seat at all.
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from './helpers/tmp.mjs';
import { sandbox, mcpClient, BIN } from './helpers/cli.mjs';

after(cleanup);

const state = (roster, seat) => roster.seats.find((s) => s.seat === seat)?.state;

test('MEM-048 AC01: memev mcp --client claude-code under a parent that is not Claude Code does not mark the claude-code seat live', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // the parent is another app (Codex sets CODEX_CLI in its children), not Claude Code
    const c = mcpClient(sb, 'claude-code', { command: process.execPath, args: [BIN, 'mcp', '--client', 'claude-code'], env: { CODEX_CLI: '1' } });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'codex@host', 'the server seats as the real parent, not the claimed client');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'codex@host'), 'live');
    assert.notEqual(state(r, 'claude-code@host'), 'live', 'the claude-code seat must not be live');
  } finally { sb.stop(); }
});

test('MEM-048 AC02: under a real Claude Code parent marker the claude-code seat is used as before', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // Claude Code sets CLAUDECODE=1 in the children it launches, so the server seats as claude-code
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
    // Codex launched the server (CODEX_CLI) under a Claude Code ancestor (CLAUDECODE); the claim stands
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

test('MEM-048: a claimed claude-code with no marker and an unknown parent seats as the parent name, not claude-code', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // no app marker in the environment, and the parent (this test process) is not a known app
    const c = mcpClient(sb, 'claude-code', { command: process.execPath, args: [BIN, 'mcp', '--client', 'claude-code'], env: {} });
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.notEqual(u.seat, 'claude-code@host', 'the claim must not be used');
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, u.seat), 'live');
    assert.notEqual(state(r, 'claude-code@host'), 'live');
    let parentName = null;
    try { parentName = fs.readFileSync(`/proc/${process.pid}/comm`, 'utf8').trim(); } catch {}
    if (parentName) assert.equal(u.seat, `${parentName}@host`, 'seats under the parent process name');
  } finally { sb.stop(); }
});
