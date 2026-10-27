// The comms bus: seats, automatic join, heartbeats, the roster, comms checks and tasks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { signLicense, loadLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { Bus, commsCheckView, commsCredentialFailure } from '../src/engine/bus.mjs';
import { createServer } from '../src/server/http.mjs';
import { remoteFetch, deviceKeyFile } from '../src/cli/remote.mjs';
import { writePrivate } from '../src/engine/util.mjs';
after(cleanup);

const DAY = 86400e3; const MIN = 60e3;
const day = (o) => new Date(Date.now() + o * DAY).toISOString().slice(0, 10);
const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();

async function vaultServer({ seats = 3 } = {}) {
  const { v, root } = newVault();
  const conf = tmpdir('bus-conf-');
  fs.writeFileSync(path.join(conf, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_bus0001', tier: 'team', services: ['sync'], seats, iat: day(-10), exp: day(300), grace_days: 14 }, vendor.pem, 'test-vendor')));
  const env = { MEMEV_CONFIG_DIR: conf };
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: vendor.keys, env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const policy = () => seatPolicy({ license: loadLicense({ env, keys: vendor.keys }), devices: v.devices.list() });
  // an app on the vault's own computer
  const local = (client) => { const token = v.tokens.issue({ agent: client }).token; return (name, args = {}) => mcp(url, { authorization: `Bearer ${token}`, 'x-memev-client': client }, name, args); };
  // another computer, with its own key, through the tunnel
  const computer = (labelName, client) => {
    const cenv = { MEMEV_CONFIG_DIR: tmpdir(`${labelName}-`) }; const k = deviceKeygen();
    fs.mkdirSync(path.dirname(deviceKeyFile(cenv)), { recursive: true }); writePrivate(deviceKeyFile(cenv), k.privateKeyPem);
    const r = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: labelName, pubkey: k.publicKey, policy: policy() });
    const remote = { url, token: r.token };
    const call = async (name, args = {}) => { const res = await remoteFetch(remote, 'mcp', { body: rpc(name, args), env: cenv, headers: { 'x-forwarded-for': '198.51.100.40', 'x-memev-client': client } }); return unwrap(res.json, res.status); };
    call.id = r.device.id; return call;
  };
  return { v, root, url, local, computer, close: () => { server.close(); v.close(); } };
}
const rpc = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
function unwrap(j, status) {
  if (!j?.result) { const e = new Error(j?.error_description || j?.error?.message || `status ${status}`); e.status = status; throw e; }
  if (j.result.isError) { const e = new Error(j.result.content[0].text); e.status = status; throw e; }
  return j.result.structuredContent?.result ?? j.result.structuredContent;
}
async function mcp(url, headers, name, args) {
  const r = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(rpc(name, args)) });
  return unwrap(await r.json().catch(() => null), r.status);
}
const state = (roster, seat) => roster.seats.find((s) => s.seat === seat)?.state;

test('init gives every connected app a seat and --lead picks the lead; each joins and says hello on its first session', async (t) => {
  const sb = sandbox();
  try {
    for (const d of ['.claude', '.cursor']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
    const s = performance.now();
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--lead', 'claude-code@host']);
    t.diagnostic(`memev init with two apps: ${(performance.now() - s).toFixed(0)} ms`);
    assert.equal(init.code, 0, init.err + init.out);
    assert.match(init.out, /Agent comms bus: bus\/ set up and committed in the vault; 2 seat\(s\): claude-code@host, cursor@host/);
    assert.match(init.out, /Lead AI: claude-code@host leads and coordinates the others, chosen by you/);
    let r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(r.operator, 'claude-code@host');
    assert.equal(state(r, 'claude-code@host'), 'never joined'); assert.equal(state(r, 'cursor@host'), 'never joined');
    // Claude Code's session-start hook joins it with no action from anyone
    const h = sb.hook('session-start', { session_id: 'lab-1', cwd: sb.home });
    assert.equal(h.code, 0);
    // Cursor joins on its first MCP call
    const c = mcpClient(sb, 'cursor');
    const u = (await c.tool('bus_unread', {})).structuredContent;
    await c.close();
    assert.equal(u.seat, 'cursor@host');
    assert.ok(u.messages.some((m) => m.type === 'hello' && m.from === 'claude-code@host'), 'cursor sees claude-code\'s hello');
    r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'claude-code@host'), 'live'); assert.equal(state(r, 'cursor@host'), 'live');
    const tail = sb.run(['bus', 'tail']).out;
    assert.match(tail, /hello\s+claude-code@host \[operator\]/); assert.match(tail, /hello\s+cursor@host/);
    // the bus is in the vault, committed to its own git repository and nowhere else
    assert.ok(fs.readdirSync(path.join(sb.root, 'bus', 'log')).length >= 1);
    const doc = sb.run(['doctor']);
    assert.match(doc.out + doc.err, /agent comms bus/);
  } finally { sb.stop(); }
});

test('a second computer joins the bus and is seen; a removed one is refused', async () => {
  const s = await vaultServer();
  try {
    const host = s.local('claude-code');
    await host('bus_unread');
    const laptop = s.computer('laptop', 'cursor');
    const u = await laptop('bus_unread');
    assert.equal(u.seat, 'cursor@laptop');
    assert.ok(u.messages.some((m) => m.from === 'claude-code@host' && m.type === 'hello'));
    const seen = await host('bus_unread');
    assert.ok(seen.messages.some((m) => m.from === 'cursor@laptop' && m.type === 'hello'), 'the host sees the laptop arrive');
    let r = await host('bus_roster');
    const row = r.seats.find((x) => x.seat === 'cursor@laptop');
    assert.equal(row.state, 'live'); assert.equal(row.device_label, 'laptop'); assert.equal(row.device_kind, 'remote-computer');
    // a seat of another computer cannot be borrowed
    await assert.rejects(laptop('bus_send', { type: 'status', body: 'pretending', seat: 'claude-code@host' }), /belongs to another app or computer/);
    s.v.devices.remove(s.v.tokens, laptop.id);
    await assert.rejects(laptop('bus_unread'), (e) => e.status === 401);
    r = await host('bus_roster');
    assert.equal(state(r, 'cursor@laptop'), 'removed');
    assert.throws(() => s.v.bus.send({ identity: { scopes: ['read', 'write'], paths: ['**'] }, client: 'cursor', device: s.v.devices.get(laptop.id) }, { type: 'status', body: 'still here?' }), /removed from the vault/);
  } finally { s.close(); }
});

test('concurrent posts from two computers end up in one order every computer agrees on', async () => {
  const s = await vaultServer();
  try {
    const a = s.computer('pc-a', 'codex'); const b = s.computer('pc-b', 'cursor');
    await Promise.all([a('bus_unread'), b('bus_unread')]);
    await Promise.all([...Array(15)].flatMap((_, i) => [a('bus_send', { type: 'status', body: `a ${i}` }), b('bus_send', { type: 'status', body: `b ${i}` })]));
    const all = s.v.bus.all();
    assert.deepEqual(all.map((m) => m.seq), all.map((_, i) => i + 1), 'dense, unique sequence numbers');
    for (const dev of [a.id, b.id]) { const mine = all.filter((m) => m.device === dev).map((m) => m.dseq); assert.deepEqual(mine, [...mine].sort((x, y) => x - y), 'each computer keeps its own order'); }
    // a fresh reader of the same files, as on another computer after a git pull, agrees exactly
    const again = new Bus({ root: s.root, devices: s.v.devices }).all();
    assert.deepEqual(again.map((m) => m.id), all.map((m) => m.id));
    // a message written offline on a third computer arrives later with an older time: it slots in
    // by time, and it is still delivered as unread
    const host = s.local('claude-code'); await host('bus_unread');
    const early = new Date(Date.parse(all[2].ts) - 1).toISOString();
    fs.appendFileSync(path.join(s.root, 'bus', 'log', 'dev_offline1.jsonl'), `${JSON.stringify({ id: 'offline1-1', dseq: 1, ts: early, device: 'dev_offline1', from: 'zed@pc-c', operator: false, to: 'all', type: 'finding', body: 'written on a plane', ref: null, project: null })}\n`);
    const merged = s.v.bus.all();
    assert.equal(merged.find((m) => m.id === 'offline1-1').seq, 3);
    assert.deepEqual(new Bus({ root: s.root, devices: s.v.devices }).all().map((m) => m.id), merged.map((m) => m.id));
    const u = await host('bus_unread');
    assert.ok(u.messages.some((m) => m.id === 'offline1-1'));
  } finally { s.close(); }
});

test('messages that look like credentials are refused', async () => {
  const s = await vaultServer();
  try {
    const host = s.local('claude-code');
    const fake = `ghp_${'A1b2'.repeat(9)}`;
    await assert.rejects(host('bus_send', { type: 'finding', body: `the deploy token is ${fake}` }), /secret: refused: the message looks like it holds a credential \(GitHub token\)/);
    await assert.rejects(host('bus_send', { type: 'finding', body: `password = ${'x'.repeat(12)}` }), /credential/);
    assert.equal(s.v.bus.all().some((m) => /ghp_|password/.test(m.body)), false);
  } finally { s.close(); }
});

test('project seats and path-limited tokens stay inside their area; another vault has its own bus', async () => {
  const s = await vaultServer();
  try {
    const ops = s.local('claude-code'); await ops('bus_unread');
    s.v.bus.register({ client: 'codex', device: s.v.devices.get(s.v.host.id), project: 'billing' });
    const codex = s.local('codex');
    await ops('bus_send', { type: 'status', body: 'search work is paused', project: 'search' });
    await ops('bus_send', { type: 'status', body: 'billing rollout is next', project: 'billing' });
    const u = await codex('bus_unread');
    assert.ok(u.messages.some((m) => /billing rollout/.test(m.body)));
    assert.equal(u.messages.some((m) => /search work/.test(m.body)), false, 'a billing seat does not see search');
    // a token limited to one department's folders does not reach the bus
    const dept = s.v.tokens.issue({ agent: 'sales-bot', paths: ['dept/sales/**'] }).token;
    await assert.rejects(mcp(s.url, { authorization: `Bearer ${dept}`, 'x-memev-client': 'sales-bot' }, 'bus_tail', {}), /its folders do not include bus\//);
    // a second vault (another organisation) shares nothing
    const other = await vaultServer();
    try { const o = other.local('claude-code'); const t = await o('bus_tail', {}); assert.equal(t.messages.some((m) => /billing|search/.test(m.body)), false); }
    finally { other.close(); }
  } finally { s.close(); }
});

test('roster states: live, stale after missed heartbeats, never joined and removed', async () => {
  const s = await vaultServer();
  try {
    const host = s.v.devices.get(s.v.host.id);
    const ctx = (client) => ({ identity: { scopes: ['read', 'write'], paths: ['**'] }, client, device: host, local: true });
    for (const c of ['claude-code', 'cursor', 'codex']) s.v.bus.register({ client: c, device: host });
    s.v.bus.pulse(ctx('claude-code'));
    s.v.bus.pulse(ctx('cursor'), { at: Date.now() - 40 * MIN });
    const gone = s.computer('old-pc', 'zed'); await gone('bus_unread'); s.v.devices.remove(s.v.tokens, gone.id);
    s.computer('new-pc', 'zed');
    const r = s.v.bus.roster();
    assert.equal(state(r, 'claude-code@host'), 'live');
    assert.equal(state(r, 'cursor@host'), 'stale'); assert.equal(r.seats.find((x) => x.seat === 'cursor@host').minutes_since, 40);
    assert.equal(state(r, 'codex@host'), 'never joined');
    assert.equal(state(r, 'zed@old-pc'), 'removed');
    assert.equal(r.seats.find((x) => x.device_label === 'new-pc').state, 'never joined', 'a licensed computer with no app yet is listed');
    // claude-code stops sending heartbeats: 16 minutes later it is stale too, and the doctor says so
    const later = s.v.bus.roster({ at: Date.now() + 16 * MIN });
    assert.equal(state(later, 'claude-code@host'), 'stale');
    const h = s.v.bus.health({ at: Date.now() + 16 * MIN });
    assert.ok(h.stale.some((x) => x.startsWith('claude-code@host')));
  } finally { s.close(); }
});

test('a comms check reports who answered and why the others did not', async (t) => {
  const s = await vaultServer();
  try {
    const host = s.v.devices.get(s.v.host.id);
    const op = s.local('claude-code'); await op('bus_unread'); s.v.bus.setOperator('claude-code@host');
    const laptop = s.computer('laptop', 'cursor'); await laptop('bus_unread');
    s.v.bus.register({ client: 'codex', device: host });
    s.v.bus.pulse({ identity: { scopes: ['read'], paths: ['**'] }, client: 'codex', device: host }, { at: Date.now() - 60 * MIN });
    // the laptop's app answers on its next turn, here every 300 ms
    let stop = false; const turns = (async () => { while (!stop) { await laptop('bus_unread').catch(() => {}); await new Promise((r) => setTimeout(r, 300)); } })();
    const s0 = performance.now();
    const r = await op('bus_check', { timeout_s: 3 });
    t.diagnostic(`comms check with one live, one offline seat: ${(performance.now() - s0).toFixed(0)} ms`);
    stop = true; await turns;
    assert.deepEqual(r.answered.map((a) => a.seat), ['cursor@laptop']);
    const codex = r.missing.find((m) => m.seat === 'codex@host');
    assert.equal(codex.state, 'stale'); assert.match(codex.reason, /offline: last heartbeat 60 min ago/);
    assert.ok(r.waited_ms < 2500, 'it stops waiting once every live seat answered');
  } finally { s.close(); }
});

test('MEM-031 AC02: a live seat that has not answered is ready, not failed', async () => {
  const s = await vaultServer();
  try {
    const host = s.v.devices.get(s.v.host.id);
    const ctx = (client) => ({ identity: { scopes: ['read', 'write'], paths: ['**'] }, client, device: host, local: true });
    s.v.bus.register({ client: 'cursor', device: host });
    s.v.bus.register({ client: 'codex', device: host });
    s.v.bus.pulse(ctx('cursor'));
    s.v.bus.pulse(ctx('codex'));
    const r = await s.v.bus.check(ctx('codex'), { timeout_s: 0 });
    const view = commsCheckView(r);
    const line = view.lines.find((l) => l.includes('cursor@host'));
    assert.match(line, /\u25cf/);
    assert.match(line, /ready/);
    assert.equal(view.code, 0);
    assert.equal(view.lines.some((l) => l.includes('\u2717')), false);
  } finally { s.close(); }
});

test('MEM-031 AC03: a seat that never started is not opened yet, with the app to open', async () => {
  const s = await vaultServer();
  try {
    const host = s.v.devices.get(s.v.host.id);
    const ctx = { identity: { scopes: ['read', 'write'], paths: ['**'] }, client: 'claude-code', device: host, local: true };
    s.v.bus.register({ client: 'claude-code', device: host });
    s.v.bus.pulse(ctx);
    s.v.bus.register({ client: 'codex', device: host });
    const r = await s.v.bus.check(ctx, { timeout_s: 0 });
    const view = commsCheckView(r);
    const line = view.lines.find((l) => l.includes('codex@host'));
    assert.match(line, /\u25cb/);
    assert.match(line, /not opened yet/);
    assert.match(line, /open codex/);
    assert.equal(view.code, 0);
  } finally { s.close(); }
});

test('MEM-031 AC04: a rejected credential is a cross and the check exits 1', async () => {
  const view = commsCheckView({ check: 'c1', waited_ms: 0, answered: [], missing: [{ seat: 'cursor@host', state: 'rejected', reason: 'credential rejected' }] });
  assert.equal(view.code, 1);
  assert.match(view.lines.join('\n'), /\u2717/);
  assert.match(view.lines.join('\n'), /credential rejected/);
  const refused = commsCredentialFailure(new Error('the vault answered 401'));
  assert.equal(refused.code, 1);
  assert.match(refused.lines[0], /\u2717/);
  assert.equal(commsCredentialFailure(new Error('the daemon is not running')), null);
});

test('one session coordinates: a task from the operator is claimed and restated by another seat; holds work', async () => {
  const s = await vaultServer();
  try {
    const op = s.local('claude-code'); await op('bus_unread'); s.v.bus.setOperator('claude-code@host');
    const laptop = s.computer('laptop', 'cursor'); await laptop('bus_unread');
    const other = s.local('codex'); await other('bus_unread');
    const task = await op('bus_send', { to: 'cursor@laptop', type: 'task', body: 'Run the upload tests and report failures.' });
    assert.equal(task.operator, true);
    const u = await laptop('bus_unread');
    const got = u.messages.find((m) => m.id === task.id);
    assert.equal(got.operator, true, 'marked as the operator\'s go');
    await assert.rejects(other('bus_send', { type: 'claim', ref: task.id }), /assigned to cursor@laptop/);
    await laptop('bus_send', { to: 'operator', type: 'claim', ref: task.id });
    await laptop('bus_send', { to: 'operator', type: 'restate', ref: task.id, body: 'I will run the upload test suite on the laptop and list each failure.' });
    await laptop('bus_send', { to: 'operator', type: 'status', ref: task.id, body: '3 of 40 failing' });
    let tasks = (await op('bus_tasks', {})).tasks;
    assert.equal(tasks[0].claimed_by, 'cursor@laptop'); assert.match(tasks[0].restated, /upload test suite/); assert.equal(tasks[0].status, '3 of 40 failing'); assert.equal(tasks[0].state, 'claimed');
    const roster = await op('bus_roster');
    assert.deepEqual(roster.seats.find((x) => x.seat === 'cursor@laptop').claims, [task.id]);
    // a task from another agent is a request, not the operator's go
    const req = await other('bus_send', { to: 'all', type: 'task', body: 'Someone delete the old fixtures.' });
    assert.equal(req.operator, false);
    // only a claim per task
    await laptop('bus_send', { type: 'claim', ref: req.id });
    await assert.rejects(other('bus_send', { type: 'claim', ref: req.id }), /already claimed by cursor@laptop/);
    await laptop('bus_send', { to: 'operator', type: 'verdict', ref: task.id, body: 'done: 3 failures filed' });
    tasks = (await op('bus_tasks', { open: true })).tasks;
    assert.equal(tasks.some((x) => x.id === task.id), false);
    // the operator holds the laptop; an agent's hold does nothing
    await other('bus_send', { to: 'cursor@laptop', type: 'hold', body: 'stop everything' });
    assert.equal((await laptop('bus_unread')).hold, null);
    await op('bus_send', { to: 'cursor@laptop', type: 'hold', body: 'pause until the release is cut' });
    assert.match((await laptop('bus_unread')).hold.reason, /pause until the release/);
    await op('bus_send', { to: 'cursor@laptop', type: 'hold', release: true, body: 'go ahead' });
    assert.equal((await laptop('bus_unread')).hold, null);
  } finally { s.close(); }
});
