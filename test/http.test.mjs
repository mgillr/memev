import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server/http.mjs';
import { newVault, cleanup } from './helpers/tmp.mjs';

let v, server, base, local, remoteTok, readTok, key;
before(async () => {
  ({ v } = newVault());
  key = 'k'.repeat(32);
  server = createServer(v, { tunnelKey: () => key });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  local = v.tokens.issue({ agent: 'local' }).token;
  remoteTok = v.tokens.issue({ agent: 'cloud', remote: true, paths: ['memory/**', 'work/**'] }).token;
  readTok = v.tokens.issue({ agent: 'reader', scopes: ['read'] }).token;
});
after(() => { server.close(); v.close(); cleanup(); });

const rpc = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
async function call(url, { token, body, headers = {}, method = 'POST' } = {}) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const viaTunnel = { 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '198.51.100.7' };

test('only /healthz is open, and remotely it says nothing but ok', async () => {
  assert.deepEqual((await call('/healthz', { method: 'GET', headers: viaTunnel })).json, { ok: true });
  assert.equal((await call('/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 401);
  assert.equal((await call('/v1/status', { method: 'GET' })).status, 401);
});

test('MCP: initialize carries the operating protocol; tools are listed; a read token cannot write', async () => {
  const init = await call('/mcp', { token: local, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
  assert.match(init.json.result.instructions, /memev_checkpoint/);
  const list = await call('/mcp', { token: local, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  for (const t of ['memev_session_start', 'memev_recall', 'memev_remember', 'memev_checkpoint', 'memev_claim', 'memev_explain', 'memev_provenance']) assert.ok(list.json.result.tools.some((x) => x.name === t), t);
  const w = await call('/mcp', { token: readTok, body: rpc('memev_remember', { text: 'nope' }) });
  assert.equal(w.json.result.isError, true);
  assert.match(w.json.result.content[0].text, /forbidden/);
});

test('remote: needs a remote token plus the tunnel key (or the connector URL), and obeys the off switch', async () => {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await call('/mcp', { token: local, body, headers: { ...viaTunnel, 'x-memev-key': key } })).status, 403, 'local token over the tunnel');
  assert.equal((await call('/mcp', { token: remoteTok, body, headers: viaTunnel })).status, 401, 'no tunnel key');
  assert.equal((await call('/mcp', { token: remoteTok, body, headers: { ...viaTunnel, 'x-memev-key': key } })).status, 200);
  assert.equal((await call(`/c/${remoteTok}/mcp`, { body, headers: viaTunnel })).status, 200, 'connector URL');
  const denied = await call(`/c/${remoteTok}/mcp`, { body: rpc('memev_get', { path: 'memory/north-star.md' }), headers: viaTunnel });
  assert.equal(denied.json.result.isError, undefined);
  v.config.remote.enabled = false;
  assert.equal((await call(`/c/${remoteTok}/mcp`, { body, headers: viaTunnel })).status, 403);
  v.config.remote.enabled = true;
  assert.ok(fs.readFileSync(path.join(v.state, 'access.jsonl'), 'utf8').length > 0, 'remote access is audited');
});

test('remote requests are rate limited', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' };
  let limited = 0;
  for (let i = 0; i < 140; i++) if ((await call('/healthz/x', { method: 'GET', headers })).status === 429) limited++;
  assert.ok(limited > 0);
});

test('hook routes return the resume card and per-prompt recall text', async () => {
  await call('/v1/remember', { token: local, body: { text: 'Invoices are numbered per calendar year', kind: 'decision', project: 'billing' } });
  await call('/v1/checkpoint', { token: local, body: { project: 'billing', task: 'yearly numbering', done: ['migration'], doing: 'backfill', next: ['report'] } });
  const card = await call('/v1/session-start', { token: local, body: { project: 'billing' } });
  assert.match(card.json.text, /In progress: backfill/);
  assert.match(card.json.text, /do not redo\): migration/);
  const r = await call('/v1/recall', { token: local, body: { query: 'how are invoices numbered' } });
  assert.match(r.json.text, /calendar year/);
});
