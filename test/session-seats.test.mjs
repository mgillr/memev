// Session seats: each live session of one app on one computer is its own bus seat. The first keeps the plain seat
// (my-app@host), each further live one takes the first free sub-seat (/2, /3 ...), a resume keeps its seat, and a seat
// comes free when its session has been gone longer than the roster's live window. The hooks and the MCP server of one
// session agree on it through the processes they share (src/cli/session-link.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { fileOf } from '../src/engine/bus.mjs';
import { createServer } from '../src/server/http.mjs';
import { ancestors, procTable, readLink, writeLink } from '../src/cli/session-link.mjs';
import { pidFile, runTurn, agentSeats, saveRunner, command as runnerCommand } from '../src/cli/runner.mjs';
after(cleanup);

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60e3;
const ID = { id: 'cc', agent: 'claude-code', scopes: ['read', 'write'], paths: ['**'] };
const app = (busSession, client = 'claude-code') => ({ identity: { ...ID, agent: client }, client, local: true, busSession });
const term = { identity: { id: 'cli', agent: 'cli', scopes: ['read', 'write', 'admin'], paths: ['**'] }, client: 'cli', local: true, cli: true };
const seatOf = (v, s) => v.bus.unread(app(s)).seat;
const seatFiles = (root) => fs.readdirSync(path.join(root, 'bus', 'seats')).sort();

test('two sessions of one app on one computer get two seats; a resume keeps its seat', () => {
  const { v } = newVault();
  try {
    assert.equal(seatOf(v, 'sess-a'), 'claude-code@host');
    assert.equal(seatOf(v, 'sess-b'), 'claude-code@host/2');
    assert.equal(seatOf(v, 'sess-c'), 'claude-code@host/3');
    // a resume or compaction of the same session id
    assert.equal(seatOf(v, 'sess-b'), 'claude-code@host/2');
    assert.equal(seatOf(v, 'sess-a'), 'claude-code@host');
    // another app has its own seats
    assert.equal(v.bus.unread(app('sess-x', 'codex')).seat, 'codex@host');
    const roster = v.bus.roster().seats.filter((r) => r.client === 'claude-code');
    assert.deepEqual(roster.map((r) => [r.seat, r.state]), [['claude-code@host', 'live'], ['claude-code@host/2', 'live'], ['claude-code@host/3', 'live']]);
    // the sub-seat's files use '+' for '/', as fileOf names them
    assert.ok(fs.existsSync(path.join(v.root, 'bus', 'pulse', `${fileOf('claude-code@host/2')}.json`)));
  } finally { v.close(); }
});

test('a stale session frees its sub-seat for the next session; the roster rule decides stale', () => {
  const { v } = newVault();
  try {
    seatOf(v, 'a'); seatOf(v, 'b');
    // b's last heartbeat is older than the live window
    v.bus.pulse(app('b'), { at: Date.now() - (v.bus.liveMin + 2) * MIN });
    assert.equal(v.bus.roster().seats.find((r) => r.seat === 'claude-code@host/2').state, 'stale');
    assert.equal(seatOf(v, 'c'), 'claude-code@host/2');
    // b comes back after its seat was taken: it gets a free one
    assert.equal(seatOf(v, 'b'), 'claude-code@host/3');
    // inside the window a seat is not reused
    v.bus.pulse(app('c'), { at: Date.now() - (v.bus.liveMin - 2) * MIN });
    assert.equal(seatOf(v, 'd'), 'claude-code@host/4');
    // the plain seat is freed the same way
    v.bus.pulse(app('a'), { at: Date.now() - (v.bus.liveMin + 2) * MIN });
    assert.equal(seatOf(v, 'e'), 'claude-code@host');
  } finally { v.close(); }
});

test('unread, read cursors and acks are per seat; to:all reaches every session seat', () => {
  const { v } = newVault();
  try {
    seatOf(v, 'a'); seatOf(v, 'b');
    v.bus.send(term, { to: 'claude-code@host', type: 'status', body: 'for the plain seat' });
    v.bus.send(term, { to: 'claude-code@host/2', type: 'status', body: 'for the second session' });
    v.bus.send(term, { to: 'all', type: 'status', body: 'for everyone' });
    const bodies = (s) => v.bus.unread(app(s), { peek: true }).messages.map((m) => m.body).filter((b) => b.startsWith('for '));
    assert.deepEqual(bodies('a'), ['for the plain seat', 'for everyone']);
    assert.deepEqual(bodies('b'), ['for the second session', 'for everyone']);
    // a reading the bus does not mark anything read for b
    v.bus.unread(app('a'));
    assert.deepEqual(bodies('a'), []);
    assert.deepEqual(bodies('b'), ['for the second session', 'for everyone']);
    // a comms check to all is acked by each seat for itself
    const check = v.bus.send(term, { to: 'all', type: 'status', body: 'check', check: true });
    assert.deepEqual(v.bus.unread(app('a')).acked, [check.id]);
    assert.deepEqual(v.bus.unread(app('b')).acked, [check.id]);
    const ackers = v.bus.all().filter((m) => m.type === 'ack' && m.ref === check.id).map((m) => m.from).sort();
    assert.deepEqual(ackers, ['claude-code@host', 'claude-code@host/2']);
  } finally { v.close(); }
});

test('a session posts only as its own seat: never as the plain seat or another session\'s sub-seat', () => {
  const { v } = newVault();
  try {
    seatOf(v, 'a'); seatOf(v, 'b'); seatOf(v, 'c');
    assert.throws(() => v.bus.send(app('b'), { to: 'all', type: 'status', body: 'x', seat: 'claude-code@host' }), /another session's seat/);
    assert.throws(() => v.bus.send(app('b'), { to: 'all', type: 'status', body: 'x', seat: 'claude-code@host/3' }), /another session's seat/);
    assert.throws(() => v.bus.send(app('a'), { to: 'all', type: 'status', body: 'x', seat: 'claude-code@host/2' }), /another session's seat/);
    assert.throws(() => v.bus.send(app('a'), { to: 'all', type: 'status', body: 'x', seat: 'claude-code@host/new' }), /another session's seat/);
    assert.equal(v.bus.send(app('b'), { to: 'all', type: 'status', body: 'mine', seat: 'claude-code@host/2' }).from, 'claude-code@host/2');
    assert.equal(v.bus.send(app('b'), { to: 'all', type: 'status', body: 'mine' }).from, 'claude-code@host/2');
    // the lead can address a sub-seat, and a task to it is claimable by that session only
    const task = v.bus.send(term, { to: 'claude-code@host/2', type: 'task', body: 'do it' });
    assert.throws(() => v.bus.send(app('a'), { to: 'operator', type: 'claim', ref: task.id }), /assigned to claude-code@host\/2/);
    assert.equal(v.bus.send(app('b'), { to: 'operator', type: 'claim', ref: task.id }).from, 'claude-code@host/2');
  } finally { v.close(); }
});

test('a vault used by one session at a time is unchanged: the plain seat, no sub-seat', () => {
  const { v, root } = newVault();
  try {
    // an app that names no session, as before session seats
    assert.equal(v.bus.unread(app(null)).seat, 'claude-code@host');
    const before = seatFiles(root);
    // a live heartbeat from before session seats carries no session: the first session takes that seat, not /2
    assert.equal(v.bus._pulse('claude-code@host').session, null);
    assert.equal(seatOf(v, 'first'), 'claude-code@host');
    assert.deepEqual(seatFiles(root), before);
    // one session after another, each after the last one ended, keeps the plain seat
    v.bus.pulse(app('first'), { at: Date.now() - (v.bus.liveMin + 1) * MIN });
    assert.equal(seatOf(v, 'second'), 'claude-code@host');
    assert.deepEqual(seatFiles(root), before);
    assert.ok(!seatFiles(root).some((f) => f.includes('+')));
  } finally { v.close(); }
});

test('a sub-seat can be renamed; its session keeps it under the new name', () => {
  const { v } = newVault();
  try {
    seatOf(v, 'a'); seatOf(v, 'b');
    v.bus.renameSeat('claude-code@host/2', 'claude-code@host/review');
    assert.equal(seatOf(v, 'b'), 'claude-code@host/review');
    assert.ok(v.bus.roster().seats.some((r) => r.seat === 'claude-code@host/review' && r.state === 'live'));
    assert.equal(v.bus.send(term, { to: 'claude-code@host/review', type: 'status', body: 'hi' }).to, 'claude-code@host/review');
    // the next session does not take the renamed seat while it is live
    assert.equal(seatOf(v, 'c'), 'claude-code@host/3');
  } finally { v.close(); }
});

test('a seat a runner holds is skipped by new sessions; a pinned session (seat:<name>) posts as that seat', () => {
  const { v, root } = newVault();
  try {
    seatOf(v, 'a');
    saveRunner(root, { 'claude-code@host/2': { enabled: true, max_runs_per_day: 1, cmd: 'echo' } });
    assert.equal(seatOf(v, 'b'), 'claude-code@host/3');
    assert.equal(seatOf(v, 'b'), 'claude-code@host/3'); // a resume past the runner's seat keeps it
    assert.equal(seatOf(v, 'seat:claude-code@host/2'), 'claude-code@host/2');
    assert.equal(v.bus.send(app('seat:claude-code@host/2'), { to: 'all', type: 'status', body: 'run' }).from, 'claude-code@host/2');
    // never another app's seat
    v.bus.unread(app('x', 'codex'));
    assert.throws(() => v.bus.unread(app('seat:codex@host')), /not a seat of claude-code/);
  } finally { v.close(); }
});

// ---- through the server: the hook route and the MCP endpoint
async function served() {
  const { v, root } = newVault();
  const server = createServer(v, { tunnelKey: () => null, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = v.tokens.issue({ agent: 'claude-code' }).token;
  const post = async (route, body, headers = {}) => (await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) })).json();
  return { v, root, post, close: () => { server.close(); v.close(); } };
}

test('the hook route keys the seat on the session, and an MCP call with the linked session posts as it', async () => {
  const s = await served();
  try {
    assert.equal((await s.post('/v1/bus-pulse', { session: 'one' })).seat, 'claude-code@host');
    assert.equal((await s.post('/v1/bus-pulse', { session: 'two' })).seat, 'claude-code@host/2');
    assert.equal((await s.post('/v1/bus-pulse', { session: 'two', seat: 'claude-code@host/2' })).seat, 'claude-code@host/2');
    const call = (headers) => s.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bus_send', arguments: { to: 'all', type: 'status', body: 'hello' } } }, headers);
    assert.equal((await call({ 'x-memev-bus-session': 'two' })).result.structuredContent.from, 'claude-code@host/2');
    // a new session in the same app process (a /clear) names the one it replaced and takes its seat; without that it is a new session
    assert.equal((await s.post('/v1/bus-pulse', { session: 'two-cleared', prev_session: 'two' })).seat, 'claude-code@host/2');
    assert.equal((await s.post('/v1/bus-pulse', { session: 'three' })).seat, 'claude-code@host/3');
    assert.equal((await call({ 'x-memev-bus-session': 'two-cleared' })).result.structuredContent.from, 'claude-code@host/2');
    // without the link the MCP server posts as the app's plain seat, as before
    assert.equal((await call({})).result.structuredContent.from, 'claude-code@host');
  } finally { s.close(); }
});

// ---- the link between a session's hook and its MCP server
test('the session link: nearest recorded process first, start time checked, app checked', () => {
  const dir = tmpdir('link-');
  const table = new Map([[10, { ppid: 9, started: 'T10' }], [9, { ppid: 8, started: 'T9' }], [8, { ppid: 7, started: 'T8' }], [7, { ppid: 1, started: 'T7' }], [20, { ppid: 8, started: 'T20' }], [30, { ppid: 9, started: 'T30' }]]);
  // the hook is pid 30 under the app (9); the MCP server is pid 10 under the same app
  assert.deepEqual(ancestors(30, table).map((a) => a.pid), [9, 8, 7]);
  writeLink(dir, ancestors(30, table), { session: 'S1', seat: 'claude-code@host/2', client: 'claude-code' });
  assert.equal(readLink(dir, ancestors(10, table), 'claude-code').session, 'S1');
  assert.equal(readLink(dir, ancestors(10, table), 'codex'), null);
  // a second app process (20, under 8) whose own hook wrote nothing yet finds nothing nearer than 8; once its hook runs, its own wins
  const t2 = new Map([...table, [21, { ppid: 20, started: 'T21' }], [22, { ppid: 20, started: 'T22' }]]);
  writeLink(dir, ancestors(22, t2), { session: 'S2', seat: 'claude-code@host/3', client: 'claude-code' });
  assert.equal(readLink(dir, ancestors(21, t2), 'claude-code').session, 'S2');
  assert.equal(readLink(dir, ancestors(10, table), 'claude-code').session, 'S1');
  // the app's pid was reused by a new process: its start time differs, so the old record is not taken
  const reused = new Map([...table, [9, { ppid: 8, started: 'LATER' }]]);
  assert.notEqual(readLink(dir, ancestors(10, reused), 'claude-code')?.session, 'S1');
  // the real process table reads, where there is one
  const real = procTable();
  if (real) assert.ok(ancestors(process.pid, real).length >= 1);
});

// a stub daemon that records each request with its headers
function stub(seat) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      calls.push({ route: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/v1/bus-pulse') res.end(JSON.stringify({ seat, text: '' }));
      else if (req.url === '/v1/session-start') res.end(JSON.stringify({ text: 'CARD' }));
      else if (req.url === '/mcp') res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [] } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, calls })));
}
function fakeVault(port) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-sessseat-'));
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memev', 'config.json'), JSON.stringify({ port }));
  fs.writeFileSync(path.join(root, '.memev', 'daemon.json'), JSON.stringify({ pid: process.pid, port }));
  return root;
}
const memev = (args, root, input, extraEnv = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(REPO, 'bin', 'memev.mjs'), ...args], { env: { PATH: process.env.PATH, HOME: root, MEMEV_ROOT: root, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => p.kill('SIGKILL'), 15000);
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  p.stdin.end(input);
});

test('the session-start hook keeps the seat, passes it on each bus call, and links the MCP server of the same app process', { skip: process.platform === 'win32' ? 'no process table on Windows' : false }, async () => {
  const st = await stub('claude-code@host/2');
  const root = fakeVault(st.port);
  try {
    // this test process stands for the app: it spawns the hook and the MCP server, as the app does
    const r = await memev(['hook', 'session-start', '--client', 'claude-code'], root, JSON.stringify({ session_id: 'sess-2', source: 'startup' }));
    assert.equal(r.code, 0);
    const pulse = st.calls.find((c) => c.route === '/v1/bus-pulse');
    assert.equal(pulse.body.bus_session, 'sess-2');
    assert.match(r.out, /This session's bus seat is claude-code@host\/2/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.memev', 'hooks', 'sess-2.json'), 'utf8')).seat, 'claude-code@host/2');
    await memev(['hook', 'prompt', '--client', 'claude-code'], root, JSON.stringify({ session_id: 'sess-2', prompt: 'ok' }));
    // a second session started by the same app process (here: this test process) names the first
    await memev(['hook', 'session-start', '--client', 'claude-code'], root, JSON.stringify({ session_id: 'sess-3', source: 'clear' }));
    assert.equal(st.calls.filter((c) => c.route === '/v1/bus-pulse').at(-1).body.prev_session, 'sess-2');
    await memev(['hook', 'session-start', '--client', 'claude-code'], root, JSON.stringify({ session_id: 'sess-2', source: 'resume' }));
    const again = st.calls.filter((c) => c.route === '/v1/bus-pulse').at(-1);
    assert.equal(again.body.seat, 'claude-code@host/2');
    assert.equal(again.body.bus_session, 'sess-2');
    // the MCP server finds the session through the shared parent and sends it with a tool call
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bus_unread', arguments: {} } });
    await memev(['mcp', '--client', 'claude-code'], root, `${line}\n`, { CLAUDECODE: '1' });
    const mcp = st.calls.find((c) => c.route === '/mcp');
    assert.equal(mcp.headers['x-memev-bus-session'], 'sess-2');
    // a runner's headless turn is pinned to the runner's seat
    await memev(['hook', 'prompt', '--client', 'claude-code'], root, JSON.stringify({ session_id: 'sess-9', prompt: 'ok' }), { MEMEV_SEAT: 'claude-code@host/4' });
    assert.equal(st.calls.filter((c) => c.route === '/v1/bus-pulse').at(-1).body.bus_session, 'seat:claude-code@host/4');
  } finally { st.server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- background runners on sub-seats
test('runners on sub-seats: their own pid files, the turn pinned to the seat, and --agents N taking /2 onwards', async () => {
  assert.equal(path.basename(pidFile('/v', 'claude-code@host/2')), 'runner-claude-code@host+2.pid');
  const plain = 'claude-code@host'; // the plain seat's pid file keeps its name
  assert.equal(path.basename(pidFile('/v', plain)), `runner-${plain}.pid`);
  assert.notEqual(pidFile('/v', 'claude-code@host/2'), pidFile('/v', 'claude-code@host/3'));
  // the headless turn gets MEMEV_SEAT, which its hooks turn into the pinned session
  const out = path.join(tmpdir('turn-'), 'env.txt');
  await runTurn({ cmd: `${process.execPath} -e require("fs").writeFileSync(process.argv[1],process.env.MEMEV_SEAT||"") ${out}`, body: '', cwd: os.tmpdir(), seat: 'claude-code@host/3' });
  assert.equal(fs.readFileSync(out, 'utf8'), 'claude-code@host/3');

  const { v, root } = newVault();
  try {
    seatOf(v, 'a'); seatOf(v, 'b'); // a live session holds /2
    assert.deepEqual(agentSeats(v.bus, 'claude-code', 3).map((r) => r.seat), ['claude-code@host/3', 'claude-code@host/4', 'claude-code@host/5']);
    v.bus.pulse(app('b'), { at: Date.now() - (v.bus.liveMin + 2) * MIN });
  } finally { v.close(); }
  const log = console.log; console.log = () => {};
  try { await runnerCommand('runner', ['on', 'claude-code'], { agents: '3', 'max-runs-per-day': '2' }, { root, env: {} }); } finally { console.log = log; }
  const state = JSON.parse(fs.readFileSync(path.join(root, '.memev', 'runner.json'), 'utf8'));
  assert.deepEqual(Object.keys(state).sort(), ['claude-code@host/2', 'claude-code@host/3', 'claude-code@host/4']);
  for (const e of Object.values(state)) { assert.equal(e.max_runs_per_day, 2); assert.equal(e.cmd, 'claude -p'); assert.deepEqual(e.ran, []); }
  // a second time takes the same seats, keeping each one's state, even while a turn of one of them is live
  { const { Vault } = await import('../src/engine/vault.mjs'); const v2 = new Vault(root, { git: false }).open(); try { v2.bus.unread(app('seat:claude-code@host/2')); } finally { v2.close(); } }
  console.log = () => {};
  try { await runnerCommand('runner', ['on', 'claude-code'], { agents: '3', 'max-runs-per-day': '2' }, { root, env: {} }); } finally { console.log = log; }
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, '.memev', 'runner.json'), 'utf8'))).sort(), Object.keys(state).sort());
});
