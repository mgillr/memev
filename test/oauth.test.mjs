import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const formPost = (url, obj) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(obj) });

/** Register a client, walk authorize -> consent page -> approve, and exchange the code. */
async function flow(name = 'Test App') {
  const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [`${base}/callback`] }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const auth = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: `${base}/callback`, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`, { redirect: 'manual' });
  assert.equal(auth.status, 302);
  const consentUrl = new URL(auth.headers.get('location'), base);
  assert.equal(consentUrl.pathname, '/oauth/consent');
  const page = await fetch(`${base}${consentUrl.pathname}${consentUrl.search}`);
  const redir = await formPost(`${base}/oauth/consent`, { code: consentUrl.searchParams.get('code'), state: 's1', decision: 'approve' });
  assert.equal(redir.status, 302);
  const loc = new URL(redir.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, `${base}/callback`);
  assert.equal(loc.searchParams.get('state'), 's1');
  const tok = await (await formPost(`${base}/oauth/token`, { grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: `${base}/callback`, client_id: reg.client_id, code_verifier: verifier })).json();
  return { reg, page, tok };
}

const mcp = (token, method = 'tools/list') => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) });

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
  const { reg, page, tok } = await flow();
  assert.ok(reg.client_id);
  assert.equal(reg.client_name, 'Test App');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Test App/);
  assert.ok(tok.access_token && tok.refresh_token && tok.expires_in > 0);
  assert.equal(tok.token_type, 'Bearer');
  const r = await mcp(tok.access_token);
  assert.equal(r.status, 200);
  assert.ok((await r.json()).result.tools.length > 0);
  // the consent page is what approves: a code exchanged without it is refused
  const bad = await formPost(`${base}/oauth/token`, { grant_type: 'authorization_code', code: 'nope', redirect_uri: `${base}/callback`, client_id: reg.client_id, code_verifier: 'x' });
  assert.equal(bad.status, 400);
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
