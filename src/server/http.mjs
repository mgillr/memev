// SPDX-License-Identifier: Apache-2.0
// HTTP: the MCP endpoint (/mcp), the hook routes the session hooks call, and a health check.
// Bound to 127.0.0.1. A request is "direct local" only when it comes from loopback, carries no proxy
// header and names a loopback host; everything else (a tunnel, a proxy, another machine) is remote.
// Remote requests need: remote access switched on, a token minted for remote use, and either the
// X-Memev-Key header (the tunnel key) or a connector URL (/c/<token>/mcp). Remote requests are rate
// limited and audited. The only unauthenticated route is GET /healthz, which says {"ok":true}.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from './mcp.mjs';
import { VaultError, VERSION } from '../engine/vault.mjs';
import { timingSafeEqualHex, sha256, now, slug } from '../engine/util.mjs';
import { renderCard, renderRecall, PROTOCOL } from '../engine/card.mjs';

const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'tailscale-user-login', 'x-original-forwarded-for'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function isDirectLocal(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

class Buckets {
  constructor(perMin) { this.perMin = perMin; this.m = new Map(); }
  take(key) {
    const t = Date.now(); let b = this.m.get(key);
    if (!b) { b = { tokens: this.perMin, at: t }; this.m.set(key, b); }
    b.tokens = Math.min(this.perMin, b.tokens + ((t - b.at) / 60000) * this.perMin); b.at = t;
    if (b.tokens < 1) return false; b.tokens -= 1; return true;
  }
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new VaultError('too_large', 'request body over 2 MB')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createServer(vault, { tunnelKey = () => null } = {}) {
  const limiter = new Buckets(vault.config.remote?.rate_per_min || 120);
  const audit = path.join(vault.state, 'access.jsonl');
  const server = http.createServer(async (req, res) => {
    const send = (code, body, headers = {}) => { if (res.headersSent) return; const s = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(s); };
    const url = new URL(req.url, 'http://localhost');
    const local = isDirectLocal(req);
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') return send(200, local ? { ok: true, name: 'memev', version: VERSION } : { ok: true });
      let token = null; let route = url.pathname;
      const cm = /^\/c\/(mv_[0-9a-f]{8}_[0-9a-f]{32,})(\/.*)$/.exec(url.pathname);
      if (cm) { token = cm[1]; route = cm[2]; }
      else { const a = String(req.headers.authorization || ''); if (a.startsWith('Bearer ')) token = a.slice(7).trim(); }
      if (!local) {
        if (!vault.config.remote?.enabled) return send(403, { error: 'remote_off', error_description: 'remote access is switched off on this vault (memev cloud on)' });
        const ipKey = sha256(String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress)).slice(0, 16);
        if (!limiter.take(`ip:${ipKey}`) || (token && !limiter.take(`t:${token.slice(3, 11)}`))) return send(429, { error: 'rate_limited' }, { 'retry-after': '30' });
        fs.appendFile(audit, `${JSON.stringify({ ts: now(), ip: ipKey, route: route.slice(0, 64), method: req.method, token: token ? token.slice(3, 11) : null })}\n`, () => {});
      }
      const identity = vault.tokens.verify(token);
      if (!identity) return send(401, { error: 'unauthorized', error_description: 'a valid bearer token is required' }, { 'www-authenticate': 'Bearer' });
      if (!local) {
        if (!identity.remote) return send(403, { error: 'local_token', error_description: 'this token is for this machine only; mint a cloud token: memev connect cloud' });
        const key = tunnelKey();
        if (!cm && (!key || !timingSafeEqualHex(String(req.headers['x-memev-key'] || ''), key))) return send(401, { error: 'tunnel_key', error_description: 'send the X-Memev-Key header, or use the connector URL' });
      }
      vault.tokens.touch(identity.id);
      const client = String(req.headers['x-memev-client'] || identity.agent).slice(0, 40);
      const session = req.headers['x-memev-session'] ? String(req.headers['x-memev-session']).slice(0, 64) : null;
      const ctx = { identity, client, session, local };

      if (route === '/mcp') {
        if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' }, { allow: 'POST' });
        let msg; try { msg = JSON.parse(await readBody(req)); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
        if (Array.isArray(msg)) { const out = (await Promise.all(msg.map((m) => handle(vault, m, ctx)))).filter(Boolean); return out.length ? send(200, out) : send(202, ''); }
        const out = await handle(vault, msg, ctx);
        return out ? send(200, out) : send(202, '');
      }
      // hook routes: what the session hooks call (local, Claude Code and friends)
      if (req.method === 'POST' && route.startsWith('/v1/')) {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (route === '/v1/session-start') { const card = vault.sessionStart(identity, { ...body, client }); return send(200, { card, text: renderCard(card), protocol: PROTOCOL }); }
        if (route === '/v1/recall') { const own = body.session ? `-${slug(String(body.session), 16)}.md` : null; const hits = vault.recall(identity, { ...body, client, limit: body.limit || 4 }).filter((h) => h.score >= (vault.config.recall?.min_score ?? 1) && !(own && h.path.startsWith('work/sessions/') && h.path.endsWith(own))); return send(200, { hits, text: renderRecall(hits, { maxChars: vault.config.recall?.max_chars || 1500 }) }); }
        if (route === '/v1/checkpoint') return send(200, vault.checkpoint(identity, { ...body, client }));
        if (route === '/v1/journal') return send(200, vault.journal(identity, { ...body, client }));
        if (route === '/v1/remember') return send(200, vault.remember(identity, { ...body, client }));
        if (route === '/v1/reload' && local && identity.scopes.includes('admin')) { vault.emit('reload'); return send(200, { ok: true }); }
      }
      if (req.method === 'GET' && route === '/v1/status') return send(200, vault.status());
      const nm = /^\/v1\/notes\/(.+)$/.exec(route);
      if (nm) {
        const p = decodeURIComponent(nm[1]);
        if (req.method === 'GET') return send(200, vault.get(identity, p));
        const body = JSON.parse((await readBody(req)) || '{}');
        if (req.method === 'PUT') return send(200, vault.write(identity, { path: p, body: body.body, client }));
        if (req.method === 'PATCH') return send(200, vault.append(identity, { path: p, text: body.text, client }));
        if (req.method === 'DELETE') return send(200, vault.delete(identity, { path: p, client }));
      }
      return send(404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof VaultError) return send({ forbidden: 403, not_found: 404, immutable: 409, secret: 422, too_large: 413 }[e.code] || 400, { error: e.code, error_description: e.message });
      return send(500, { error: 'internal', error_description: e.message });
    }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  return server;
}
