// The port init asks for is held by another program: init moves the vault to the next free port, saves it before it
// edits any app, and the apps it connects find the daemon there.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

// The other program answers /healthz with {"ok":true} and nothing else, the way an unrelated local service might.
const OTHER = "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end('{\"ok\":true}')}).listen(+process.argv[1],'127.0.0.1',()=>process.stdout.write('up\\n'))";

let sb, other, mcp, busy, init, atInit;
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const cfg = () => read(path.join(sb.root, '.memev', 'config.json'));
const daemon = () => { try { return read(path.join(sb.root, '.memev', 'daemon.json')); } catch { return null; } };

before(async () => {
  sb = sandbox({ ports: 2 }); busy = sb.port; // the port after the busy one is reserved too, so init can move to it
  fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(sb.home, '.claude', 'settings.json'), '{}\n');
  other = spawn(process.execPath, ['-e', OTHER, String(busy)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { other.stdout.once('data', resolve); other.once('exit', (c) => reject(new Error(`the other program exited with ${c}`))); });
  init = sb.run(['init', '--port', String(busy)]);
  const clients = {};
  for (const f of [path.join(sb.home, '.claude.json'), path.join(sb.home, '.claude', 'settings.json'), path.join(sb.home, '.claude', 'CLAUDE.md')]) {
    if (fs.existsSync(f)) clients[f] = fs.statSync(f).mtimeMs;
  }
  atInit = { config: fs.statSync(path.join(sb.root, '.memev', 'config.json')).mtimeMs, daemon: daemon(), clients };
});
after(async () => { await mcp?.close(); sb.stop(); other?.kill(); cleanup(); });

test('MEM-005 AC03: The chosen port is written to .memev/config.json before any client config is edited', () => {
  assert.equal(init.code, 0, init.out + init.err);
  const port = cfg().port;
  assert.notEqual(port, busy, 'config.json holds a port other than the busy one');
  const files = Object.entries(atInit.clients);
  assert.ok(files.length >= 2, 'init edited the Claude Code MCP config and hooks');
  for (const [file, mtime] of files) assert.ok(atInit.config <= mtime, `${file} was edited before config.json was last written`);
  // The daemon takes its port from config.json when it starts, so it shows the file held the chosen port by then.
  assert.ok(atInit.daemon, `the daemon was running after init:\n${init.out}`);
  assert.equal(atInit.daemon.port, port, 'the daemon started on the port saved in config.json');
  const started = Date.parse(atInit.daemon.started);
  for (const [file, mtime] of files) assert.ok(started <= mtime, `${file} was edited before the daemon started`);
});

test('MEM-005 AC02: Apps are connected with the port that was finally chosen (MCP entries and hooks reference the saved port)', async () => {
  assert.equal(init.code, 0, init.out + init.err);
  const port = cfg().port;
  assert.notEqual(port, busy);
  assert.ok(init.out.includes(`Port ${busy} is in use by another program; Memev is using ${port}`), init.out);
  assert.equal(init.out.includes(':undefined'), false, init.out);
  // With the daemon stopped and the other program still on the busy port, the hook command and the MCP entry the apps
  // were given must each bring the daemon up on the saved port and reach it there.
  sb.stop();
  const hook = read(path.join(sb.home, '.claude', 'settings.json')).hooks.SessionStart[0].hooks[0].command;
  const h = spawnSync(hook, { shell: true, env: sb.env, input: '{"session_id":"p1","source":"startup"}', encoding: 'utf8', timeout: 30000 });
  assert.equal(h.status, 0, h.stderr);
  assert.match(JSON.parse(h.stdout).hookSpecificOutput.additionalContext, /Memev resume card/);
  assert.equal(daemon()?.port, port, 'the hook brought the daemon up on the saved port');
  sb.stop();
  const entry = Object.values(read(path.join(sb.home, '.claude.json')).mcpServers).find((e) => e.args?.includes('claude-code'));
  assert.ok(entry, 'Claude Code has a Memev MCP entry');
  mcp = mcpClient(sb, 'claude-code', entry);
  await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  const r = await mcp.tool('memev_session_start', { task: 'port check' });
  assert.equal(r.isError ?? false, false, JSON.stringify(r));
  assert.equal(daemon()?.port, port, 'the MCP entry brought the daemon up on the saved port');
});

test("a port held by another vault's daemon: init moves on and leaves that daemon running", () => {
  const a = sandbox({ ports: 2 }), b = sandbox(); // b moves to the port after a's, which a reserved
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  try {
    assert.equal(a.run(['init', '--port', String(a.port), '--local-only', '--no-connect']).code, 0);
    const first = read(path.join(a.root, '.memev', 'daemon.json'));
    const r = b.run(['init', '--port', String(a.port), '--local-only', '--no-connect']);
    assert.equal(r.code, 0, r.out + r.err);
    const port = read(path.join(b.root, '.memev', 'config.json')).port;
    assert.notEqual(port, a.port);
    assert.ok(r.out.includes(`Port ${a.port} is in use by another program; Memev is using ${port}`), r.out);
    assert.equal(read(path.join(b.root, '.memev', 'daemon.json')).port, port, "the second vault's daemon is on the saved port");
    assert.equal(read(path.join(a.root, '.memev', 'daemon.json')).pid, first.pid);
    assert.ok(alive(first.pid), "the first vault's daemon is still running");
  } finally { b.stop(); a.stop(); }
});
