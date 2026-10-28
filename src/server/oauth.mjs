// SPDX-License-Identifier: Apache-2.0
// OAuth 2.1 for cloud AI apps: dynamic client registration, authorization code with PKCE,
// a consent page served by this server, refresh and revocation. The connector URL token
// (/c/<token>/mcp) stays as the fallback for apps that cannot do OAuth.
// State lives in .memev/oauth.json, next to tokens.json; only opaque tokens are stored.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { readJson, writePrivateJson, randomToken, now } from '../engine/util.mjs';

const ACCESS_TTL_S = 3600;
const REFRESH_TTL_DAYS = 30;
const CODE_TTL_S = 300;
const SCOPES = ['read', 'write'];
// open registration must not grow oauth.json without limit: the oldest clients are dropped first
export const MAX_CLIENTS = 50;
// the same note paths a cloud connector token gets (src/engine/devices.mjs)
const PATHS = ['memory/**', 'work/**', 'contracts/**', 'bus/**'];

export class OAuthError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const s256 = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');
// the seat name an OAuth app takes on the bus: its registered client name, normalised (ChatGPT -> chatgpt)
export const agentName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';

export class OAuthStore {
  constructor(file) { this.file = file; this.data = readJson(file, null) || { version: 1, clients: {}, codes: {}, access: {}, refresh: {} }; this.mtime = this._mtime(); }
  _mtime() { try { const s = fs.statSync(this.file); return `${s.ino}:${s.mtimeMs}:${s.size}`; } catch { return ''; } }
  /** Expired consent codes are dropped on every write, so the file does not keep them. */
  _gc() {
    const t = Date.now();
    for (const r of Object.values(this.data.codes)) if (t - Date.parse(r.created) > CODE_TTL_S * 1000) delete this.data.codes[r.code];
  }
  save() { this._gc(); writePrivateJson(this.file, this.data); this.mtime = this._mtime(); }
  /** Another process may have registered or revoked: pick that up before answering. */
  fresh() { if (this._mtime() !== this.mtime) { this.data = readJson(this.file, null) || this.data; this.mtime = this._mtime(); } }

  /** Dynamic client registration: a public client that authenticates with PKCE only. */
  register({ client_name, redirect_uris, scope } = {}) {
    this.fresh();
    const uris = [...new Set([].concat(redirect_uris || []).map(String).filter(Boolean))];
    if (!uris.length) throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required');
    for (const u of uris) { const x = new URL(u); if (!['http:', 'https:'].includes(x.protocol)) throw new OAuthError('invalid_redirect_uri', 'redirect URIs must be http or https'); }
    const wanted = (typeof scope === 'string' ? scope.split(/\s+/) : []).filter((s) => SCOPES.includes(s));
    const id = `oc_${randomToken(12)}`;
    this.data.clients[id] = { id, name: String(client_name || 'Unnamed client').slice(0, 60), redirect_uris: uris, scopes: wanted.length ? wanted : ['read', 'write'], created: now() };
    const oldest = Object.values(this.data.clients).sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    for (const c of oldest.slice(0, Math.max(0, oldest.length - MAX_CLIENTS))) this._dropClient(c.id);
    this.save();
    const c = this.data.clients[id];
    return { client_id: c.id, client_name: c.name, redirect_uris: c.redirect_uris, scope: c.scopes.join(' '), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }

  client(id) { this.fresh(); return this.data.clients[String(id || '')] || null; }

  /** A dropped client loses its codes and its token pairs at once. */
  _dropClient(id) {
    delete this.data.clients[id];
    for (const [code, r] of Object.entries(this.data.codes)) if (r.client_id === id) delete this.data.codes[code];
    for (const [tok, r] of Object.entries(this.data.access)) if (r.client_id === id) { delete this.data.access[tok]; if (this.data.refresh[r.refresh]) delete this.data.refresh[r.refresh]; }
    for (const [tok, r] of Object.entries(this.data.refresh)) if (r.client_id === id) delete this.data.refresh[tok];
  }

  /** Start the authorization: validate the request and hold the code until the consent page approves it. */
  authorize({ client_id, redirect_uri, code_challenge, code_challenge_method, scope, state }) {
    const c = this.client(client_id);
    if (!c) throw new OAuthError('unauthorized_client', 'unknown client_id', 401);
    if (!c.redirect_uris.includes(String(redirect_uri))) throw new OAuthError('invalid_redirect_uri', 'redirect_uri was not registered for this client');
    if (!code_challenge || code_challenge_method !== 'S256') throw new OAuthError('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method S256');
    const scopes = (scope ? String(scope).split(/\s+/) : c.scopes).filter((s) => SCOPES.includes(s));
    if (!scopes.length) throw new OAuthError('invalid_scope', 'no supported scope was requested');
    const code = randomToken(24);
    // a one-time value the consent page must send back: knowing the code alone is not enough to approve
    this.data.codes[code] = { code, consent: randomToken(16), client_id: c.id, redirect_uri: String(redirect_uri), challenge: code_challenge, scopes, state: String(state || ''), created: now(), approved: false };
    this.save();
    return { code, client: c, scopes };
  }

  /** The consent page's record for a code, or null when unknown or expired. */
  pending(code) {
    this.fresh();
    const r = this.data.codes[String(code || '')];
    if (!r) return null;
    if (Date.now() - Date.parse(r.created) > CODE_TTL_S * 1000) { delete this.data.codes[r.code]; this.save(); return null; }
    return r;
  }

  /** The consent page's answer: approve or deny the held code. The page's one-time value must come back. */
  consent(code, { approve, consent } = {}) {
    const r = this.pending(code);
    if (!r) throw new OAuthError('invalid_grant', 'unknown or expired consent code');
    if (!consent || String(consent) !== r.consent) throw new OAuthError('invalid_request', 'the consent value is missing or does not match the page');
    r.approved = !!approve;
    this.save();
    return r;
  }

  /** Exchange an approved code for tokens, checking PKCE. */
  exchange({ client_id, code, redirect_uri, code_verifier }) {
    const r = this.pending(code);
    if (!r || !r.approved) throw new OAuthError('invalid_grant', 'the code was not approved on the consent page');
    if (r.client_id !== String(client_id)) throw new OAuthError('invalid_grant', 'the code was issued to another client');
    if (r.redirect_uri !== String(redirect_uri)) throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
    if (!code_verifier || s256(code_verifier) !== r.challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed');
    delete this.data.codes[r.code];
    this.save();
    return this._issue(r.client_id, r.scopes);
  }

  /** A refresh token trades for a new pair; the old refresh token stops working at once. */
  refresh({ client_id, refresh_token }) {
    this.fresh();
    const r = this.data.refresh[String(refresh_token || '')];
    if (!r) throw new OAuthError('invalid_grant', 'unknown refresh token');
    if (r.client_id !== String(client_id)) throw new OAuthError('invalid_grant', 'the refresh token was issued to another client');
    if (Date.parse(r.expires) < Date.now()) { this._kill(r); throw new OAuthError('invalid_grant', 'the refresh token expired'); }
    delete this.data.refresh[r.token];
    this.save();
    return this._issue(r.client_id, r.scopes, r.id);
  }

  _issue(client_id, scopes, id = `oa_${randomToken(10)}`) {
    const access = `mvat_${randomToken(24)}`;
    const refresh = `mvrt_${randomToken(24)}`;
    this.data.access[access] = { id, client_id, scopes, expires: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(), created: now(), refresh };
    this.data.refresh[refresh] = { token: refresh, id, client_id, scopes, expires: new Date(Date.now() + REFRESH_TTL_DAYS * 86400e3).toISOString(), access };
    this.save();
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_TTL_S, scope: scopes.join(' ') };
  }

  _kill(r) {
    if (this.data.access[r.access]) delete this.data.access[r.access];
    if (this.data.refresh[r.token]) delete this.data.refresh[r.token];
    this.save();
  }

  /** Revocation: an access token dies with its refresh token, and the other way round. */
  revoke(token) {
    this.fresh();
    const t = String(token || '');
    if (this.data.access[t]) { const a = this.data.access[t]; delete this.data.access[t]; if (this.data.refresh[a.refresh]) delete this.data.refresh[a.refresh]; this.save(); return true; }
    if (this.data.refresh[t]) { this._kill(this.data.refresh[t]); return true; }
    return false;
  }

  /** The identity for a valid access token, or null. */
  verify(token) {
    const t = String(token || '').trim();
    if (!t.startsWith('mvat_')) return null;
    this.fresh();
    const r = this.data.access[t];
    if (!r) return null;
    if (Date.parse(r.expires) < Date.now()) { delete this.data.access[t]; this.save(); return null; }
    const c = this.data.clients[r.client_id];
    return { id: r.id, agent: agentName(c?.name), scopes: r.scopes, paths: PATHS, remote: true, expires: r.expires, note: 'cloud connector (oauth)' };
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The local consent page: who is asking, for what, where the code goes, and the allow/deny form. */
export function consentPage({ client, scopes, code, state, consent, redirectHost }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Consent - Memev</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
h1 { font-size: 1.3rem; }
button { padding: 0.5rem 1.25rem; margin-right: 0.5rem; font-size: 1rem; }
</style>
</head>
<body>
<h1>Allow ${esc(client?.name || 'this client')}?</h1>
<p>${esc(client?.name || 'This client')} wants to access this Memev vault with: <strong>${esc(scopes.join(', '))}</strong>.</p>
<p>The code goes to <strong>${esc(redirectHost || 'the app')}</strong>.</p>
<p>The access token lasts an hour and can be revoked at any time.</p>
<form method="post" action="/oauth/consent">
<input type="hidden" name="code" value="${esc(code)}">
<input type="hidden" name="consent" value="${esc(consent || '')}">
<input type="hidden" name="state" value="${esc(state)}">
<button type="submit" name="decision" value="approve">Allow</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>
</body>
</html>
`;
}
