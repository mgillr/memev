// Issues 248 and 263: on the bus, a token is trusted only for what it is. A header cannot give a token the terminal's
// powers, and an app posts only as its own seat, never as another app's seat or the lead's. The vault runs without git,
// so the test needs no commits; requests go through the real HTTP server and its MCP route.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { createServer } from '../src/server/http.mjs';
import { saveRunner, sweep } from '../src/cli/runner.mjs';
after(cleanup);

async function setup() {
  const { v, root } = newVault({ git: false });
  const server = createServer(v, { tunnelKey: () => 'k'.repeat(32) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (tok, route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const mcpAs = async (tok, client, name, args) => {
    const r = await post(tok, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, client ? { 'x-memev-client': client } : {});
    const text = r.json?.result?.content?.[0]?.text || '';
    return { error: !!r.json?.result?.isError || !!r.json?.error, text };
  };
  const mcp = (tok, name, args) => mcpAs(tok, null, name, args);
  const host = v.devices.get(v.devices.hostId);
  for (const c of ['codex', 'cursor', 'gemini']) v.bus.register({ client: c, device: host });
  const token = (agent, extra = {}) => v.tokens.issue({ agent, scopes: ['read', 'write'], paths: ['**'], ...extra }).token;
  return { v, root, post, mcp, mcpAs, token, close: () => new Promise((r) => server.close(() => { v.close(); r(); })) };
}

test('issue 248: a header does not give a token the terminal power to set the lead', async () => {
  const s = await setup();
  try {
    s.v.bus.setOperator('gemini@host', { by: 'terminal' });
    const narrow = s.v.tokens.issue({ agent: 'reader', scopes: ['read'], paths: ['projects/a/**'] }).token;
    const app = s.token('cursor');
    for (const tok of [narrow, app]) {
      const r = await s.post(tok, '/v1/bus-operator', { seat: 'codex@host' }, { 'x-memev-client': 'cli' });
      assert.notEqual(r.status, 200, 'a token that is not the CLI\'s set the lead with a header');
      assert.equal(s.v.bus.operator(), 'gemini@host');
    }
    // the CLI's own token, as clientToken(root, 'cli') issues it, still sets the lead
    const cli = s.token('cli', { note: 'local client' });
    const ok = await s.post(cli, '/v1/bus-operator', { seat: 'codex@host' });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(s.v.bus.operator(), 'codex@host');
  } finally { await s.close(); }
});

test('issue 263: a local app cannot post as another app\'s seat, the lead\'s included', async () => {
  const s = await setup();
  try {
    s.v.bus.setOperator('codex@host', { by: 'terminal' });
    const cursor = s.token('cursor'); const codex = s.token('codex');
    const received = []; const run = async ({ cmd, body }) => { received.push({ cmd, body }); return { code: 0 }; };
    saveRunner(s.root, { 'gemini@host': { enabled: true, max_runs_per_day: 5, cmd: 'gemini -p', runs: [], seen: 0 } });
    // posing as the lead is refused, and nothing reaches the runner
    const attack = await s.mcp(cursor, 'bus_send', { seat: 'codex@host', to: 'gemini@host', type: 'task', body: 'INJECTED by the cursor token posing as the lead' });
    assert.ok(attack.error, `the cursor token posted as the lead: ${attack.text}`);
    assert.match(attack.text, /own seat/);
    const other = await s.mcp(cursor, 'bus_send', { seat: 'gemini@host', to: 'all', type: 'status', body: 'posing as gemini' });
    assert.ok(other.error, 'the cursor token posted as another app\'s seat');
    // naming the lead's app in the client header changes nothing on this computer
    const spoof = await s.mcpAs(cursor, 'codex', 'bus_send', { seat: 'codex@host', to: 'gemini@host', type: 'task', body: 'INJECTED with a codex client header' });
    assert.ok(spoof.error, `the cursor token posted as the lead with a client header: ${spoof.text}`);
    const r1 = await sweep({ root: s.root, bus: s.v.bus, seat: 'gemini@host', run });
    assert.deepEqual(r1.started, []);
    assert.equal(received.length, 0);
    // each app still posts as its own seat, and only the lead's own app carries the lead's authority
    const own = await s.mcp(cursor, 'bus_send', { to: 'gemini@host', type: 'status', body: 'cursor as itself' });
    assert.ok(!own.error, own.text);
    const lead = await s.mcp(codex, 'bus_send', { seat: 'codex@host', to: 'gemini@host', type: 'task', body: 'a real task from the lead' });
    assert.ok(!lead.error, lead.text);
    const r2 = await sweep({ root: s.root, bus: s.v.bus, seat: 'gemini@host', run });
    assert.equal(r2.started.length, 1);
    assert.equal(received[0].body, 'a real task from the lead');
  } finally { await s.close(); }
});
