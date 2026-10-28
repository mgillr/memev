import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server/http.mjs';
import { newVault, cleanup } from './helpers/tmp.mjs';

let v, server, base;
before(async () => {
  ({ v } = newVault());
  server = createServer(v);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); v.close(); cleanup(); });

const form = (obj) => new URLSearchParams(obj).toString();
const formPost = (url, obj, headers = {}) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(obj) });
// a caller that reaches the vault through the tunnel, not from the vault's own machine
const viaTunnel = { 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '198.51.100.7' };
// a second remote address, so a rate-limit burst does not touch the other tests' bucket
const burstIp = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' };

const register = (name, redirectUri = `${base}/callback`) => fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [redirectUri] }) }).then((r) => r.json());
const pkce = () => { const verifier = crypto.randomBytes(32).toString('base64url'); const challenge = crypto.createHash('sha256').update(verifier).digest('base64url'); return { verifier, challenge }; };

/** Start the authorize and hold the code: returns the code, the verifier and the consent URL. */
async function hold(clientId, redirectUri = `${base}/callback`, headers = {}) {
  const { verifier, challenge } = pkce();
  const auth = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`, { redirect: 'manual', headers });
  assert.equal(auth.status, 302);
  const consentUrl = new URL(auth.headers.get('location'), base);
  return { code: consentUrl.searchParams.get('code'), verifier, consentUrl };
}

/** The local consent page for a code: the response, its html and the one-time consent value. */
async function consentPage(code) {
  const page = await fetch(`${base}/oauth/consent?code=${encodeURIComponent(code)}`);
  const html = await page.text();
  const consent = /name="consent" value="([^"]*)"/.exec(html)?.[1] || '';
  return { page, html, consent };
}

/** Register a client, walk authorize -> consent page -> approve, and exchange the code. */
async function flow(name = 'Test App', redirectUri = `${base}/callback`) {
  const reg = await register(name, redirectUri);
  const { code, verifier } = await hold(reg.client_id, redirectUri);
  const { page, html, consent } = await consentPage(code);
  const redir = await formPost(`${base}/oauth/consent`, { code, state: 's1', decision: 'approve', consent });
  assert.equal(redir.status, 302);
  const loc = new URL(redir.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, redirectUri);
  assert.equal(loc.searchParams.get('state'), 's1');
  const tok = await (await formPost(`${base}/oauth/token`, { grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier })).json();
  return { reg, page, html, tok };
}

const mcp = (token, method = 'tools/list', headers = {}) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) });

test('MEM-058 AC01: the authorization server and protected resource metadata are served', async () => {
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.issuer, base);
  assert.equal(as.authorization_endpoint, `${base}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${base}/oauth/token`);
  assert.equal(as.registration_endpoint, `${base}/oauth/register`);
  assert.equal(as.revocation_endpoint, `${base}/oauth/revoke`);
  assert.deepEqual(as.response_types_supported, ['code']);
  assert.ok(as.code_challenge_methods_supported.includes('S256'));
  const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(pr.resource, `${base}/mcp`);
  assert.deepEqual(pr.authorization_servers, [base]);
  assert.ok(pr.bearer_methods_supported.includes('header'));
});

test('MEM-058 AC02: a DCR client completes authorization code with PKCE after consent and calls /mcp with a bearer token', async () => {
  const { reg, page, html, tok } = await flow();
  assert.ok(reg.client_id);
  assert.equal(reg.client_name, 'Test App');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(html, /Test App/);
  assert.ok(tok.access_token && tok.refresh_token && tok.expires_in > 0);
  assert.equal(tok.token_type, 'Bearer');
  const r = await mcp(tok.access_token);
  assert.equal(r.status, 200);
  assert.ok((await r.json()).result.tools.length > 0);
  // the consent page is what approves: a code exchanged without it is refused
  const bad = await formPost(`${base}/oauth/token`, { grant_type: 'authorization_code', code: 'nope', redirect_uri: `${base}/callback`, client_id: reg.client_id, code_verifier: 'x' });
  assert.equal(bad.status, 400);
});

test('MEM-058 AC02: a non-local consent POST is refused and mints no token', async () => {
  const reg = await register('Phish App');
  const { code, verifier } = await hold(reg.client_id);
  // the approve form is posted over the tunnel: it is refused
  const denied = await formPost(`${base}/oauth/consent`, { code, state: 's1', decision: 'approve' }, viaTunnel);
  assert.equal(denied.status, 403);
  // the code was never approved, so it cannot be exchanged for a token
  const bad = await formPost(`${base}/oauth/token`, { grant_type: 'authorization_code', code, redirect_uri: `${base}/callback`, client_id: reg.client_id, code_verifier: verifier });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).access_token, undefined);
});

test('MEM-058 AC02: a local consent POST with the right code but no consent value mints no token', async () => {
  const reg = await register('No Value App');
  const { code, verifier } = await hold(reg.client_id);
  // the form is posted from the vault machine, but the one-time value is missing
  const denied = await formPost(`${base}/oauth/consent`, { code, state: 's1', decision: 'approve' });
  assert.equal(denied.status, 400);
  // the code was not approved, so it cannot be exchanged
  const bad = await formPost(`${base}/oauth/token`, { grant_type: 'authorization_code', code, redirect_uri: `${base}/callback`, client_id: reg.client_id, code_verifier: verifier });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).access_token, undefined);
});

test('MEM-058 AC02: a local consent POST from a foreign origin is refused', async () => {
  const reg = await register('Foreign Origin App');
  const { code, verifier } = await hold(reg.client_id);
  const { consent } = await consentPage(code);
  // a page on another origin posts the form (it even carries the right value): refused by origin
  const denied = await formPost(`${base}/oauth/consent`, { code, state: 's1', decision: 'approve', consent }, { origin: 'https://evil.example' });
  assert.equal(denied.status, 403);
  // not approved, so no token
  const bad = await formPost(`${base}/oauth/token`, { grant_type: 'authorization_code', code, redirect_uri: `${base}/callback`, client_id: reg.client_id, code_verifier: verifier });
  assert.equal(bad.status, 400);
});

test('MEM-058 AC02: remote OAuth routes obey the remote-off switch, the rate limiter and the audit log', async () => {
  // remote access switched off: the OAuth routes are refused like every other route
  v.config.remote.enabled = false;
  const off = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...viaTunnel }, body: JSON.stringify({ client_name: 'Off App', redirect_uris: [`${base}/callback`] }) });
  assert.equal(off.status, 403);
  assert.equal((await off.json()).error, 'remote_off');
  v.config.remote.enabled = true;
  // a burst from one remote address is rate limited
  let limited = 0;
  for (let i = 0; i < 140; i++) {
    const r = await fetch(`${base}/oauth/authorize`, { headers: burstIp });
    if (r.status === 429) limited++;
  }
  assert.ok(limited > 0, 'the burst is rate limited');
  // a remote OAuth call is written to the audit log
  await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...viaTunnel }, body: JSON.stringify({ client_name: 'Audit App', redirect_uris: [`${base}/callback`] }) });
  const log = fs.readFileSync(path.join(v.state, 'access.jsonl'), 'utf8').trim().split('\n');
  assert.ok(log.some((l) => l.includes('/oauth/register')), 'remote OAuth access is audited');
});

test('MEM-058 AC02: expired consent codes are dropped on write and registered clients are capped', async () => {
  const file = path.join(v.state, 'oauth.json');
  // a code past its five-minute life is dropped the next time the store writes
  const reg = await register('GC App');
  const { code } = await hold(reg.client_id);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.codes[code].created = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(data));
  // any write (a new registration) runs the garbage collection
  await register('GC Trigger');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.codes[code], undefined, 'the expired code is gone');
  // open registration cannot grow the client list without limit
  for (let i = 0; i < 60; i++) await register(`Cap App ${i}`);
  const capped = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.keys(capped.clients).length, 50, 'clients are capped at fifty');
});

test('MEM-058 AC02: a remote authorize redirects to the local consent link on the vault machine', async () => {
  const reg = await register('Remote Authorize App');
  const { consentUrl } = await hold(reg.client_id, `${base}/callback`, viaTunnel);
  // the browser is sent to the vault machine, not left on the tunnel host
  assert.equal(consentUrl.protocol, 'http:');
  assert.equal(consentUrl.hostname, '127.0.0.1');
  assert.equal(consentUrl.pathname, '/oauth/consent');
  assert.ok(consentUrl.searchParams.get('code'));
  // and a remote hit on the consent page is told to open that link
  const denied = await fetch(`${base}/oauth/consent?code=${consentUrl.searchParams.get('code')}`, { headers: viaTunnel });
  assert.equal(denied.status, 403);
  assert.match(await denied.text(), /127\.0\.0\.1/);
});

test('MEM-058 AC02: the consent page shows where the code goes', async () => {
  const reg = await register('Redirect Host App');
  const { code } = await hold(reg.client_id, `${base}/callback`);
  const { html } = await consentPage(code);
  // the redirect host is named on the page, so the owner sees where the code goes
  assert.match(html, /The code goes to/);
  assert.match(html, /127\.0\.0\.1/);
});

test('MEM-058 AC02: two OAuth apps take different bus seats from their client names', async () => {
  // the apps reach the vault through the tunnel, so each is seen as its own cloud connector
  const a = await flow('ChatGPT');
  await mcp(a.tok.access_token, 'tools/list', viaTunnel);
  const b = await flow('Claude Desktop');
  await mcp(b.tok.access_token, 'tools/list', viaTunnel);
  const labels = v.devices.list().filter((d) => d.kind === 'cloud-connector').map((d) => d.label);
  assert.ok(labels.includes('chatgpt'), 'the chatgpt seat');
  assert.ok(labels.includes('claude-desktop'), 'the claude-desktop seat');
});

test('MEM-058 AC03: refresh works and revocation makes the token fail', async () => {
  const { reg, tok } = await flow('Refresh App');
  const refreshed = await (await formPost(`${base}/oauth/token`, { grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: tok.refresh_token })).json();
  assert.ok(refreshed.access_token && refreshed.access_token !== tok.access_token);
  assert.equal((await mcp(refreshed.access_token)).status, 200);
  // the old refresh token is rotated out
  const reuse = await formPost(`${base}/oauth/token`, { grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: tok.refresh_token });
  assert.equal(reuse.status, 400);
  const rev = await formPost(`${base}/oauth/revoke`, { token: refreshed.access_token, token_type_hint: 'access_token' });
  assert.equal(rev.status, 200);
  assert.equal((await mcp(refreshed.access_token)).status, 401);
  // revoking the refresh token also kills its access token
  const t2 = await flow('Revoke App');
  await formPost(`${base}/oauth/revoke`, { token: t2.tok.refresh_token, token_type_hint: 'refresh_token' });
  assert.equal((await mcp(t2.tok.access_token)).status, 401);
});

test('MEM-058 AC04: the connector URL token still works', async () => {
  const { token: tok } = v.devices.enroll(v.tokens, { kind: 'cloud-connector', label: 'url app' });
  const r = await fetch(`${base}/c/${tok}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).result.tools.length > 0);
});
