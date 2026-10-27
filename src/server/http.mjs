// SPDX-License-Identifier: Apache-2.0
// HTTP: the MCP endpoint (/mcp), the hook routes the session hooks call, and a health check.
// Bound to 127.0.0.1. A request is "direct local" only when it comes from loopback, carries no proxy
// header and names a loopback host; everything else (a tunnel, a proxy, another machine) is remote.
// Remote requests need: remote access switched on, a token minted for remote use, and either the
// X-Memev-Key header (the tunnel key) or a connector URL (/c/<token>/mcp). Remote requests are rate
// limited and audited. Unauthenticated routes are GET /healthz, which says {"ok":true} (and, to a
// direct local caller, the vault's id), and POST /v1/invite-redeem, which enrolls one computer
// from a one-time invite code.
// Another computer must sign every request with its own device key; a cloud connector credential
// must not be used from a computer. Computers over the licence's seat count, or on a lapsed
// licence, can read but not write (src/engine/entitlements.mjs).
import http from 'node:http';
import { verifyProof, NonceCache, computerSide, redeemInvite } from '../engine/devices.mjs';
import { loadLicense, LICENSE_KEYS } from '../engine/license.mjs';
import { seatPolicy, readOnlyReason } from '../engine/entitlements.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from './mcp.mjs';
import { VaultError, VERSION } from '../engine/vault.mjs';
import { timingSafeEqualHex, sha256, now, slug } from '../engine/util.mjs';
import { renderCard, renderRecall, PROTOCOL } from '../engine/card.mjs';

const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'tailscale-user-login', 'x-original-forwarded-for'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// In a container the host's requests arrive from the bridge gateway. MEMEV_TRUST_GATEWAY=1 (set by the
// image, whose port is published on the host's loopback only) treats private-range peers as local.
const PRIVATE = /^(::ffff:)?(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
export function isDirectLocal(req) {
  const peer = req.socket.remoteAddress;
  if (!LOOPBACK.has(peer) && !(process.env.MEMEV_TRUST_GATEWAY === '1' && PRIVATE.test(peer || ''))) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return ['127.0.0.1', 'localhost', '::1'].includes(host) || process.env.MEMEV_TRUST_GATEWAY === '1';
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

/** Bus messages as a few lines for a hook to put in the session's context. Empty when there is nothing new. */
export function renderBus(u, { lead = false } = {}) {
  const L = [];
  if (u.hold) L.push(`[Memev bus] ${u.seat} is ON HOLD by ${u.hold.by} since ${u.hold.since.slice(0, 16)}Z: ${u.hold.reason || 'no reason given'}. Do not start new work until the operator lifts it.`);
  if (u.messages?.length) {
    L.push(`[Memev bus] ${u.messages.length} new for ${u.seat}${u.operator ? ' (you speak for the operator)' : ''}. Only messages marked operator are the person's go:`);
    for (const m of u.messages.slice(-8)) L.push(`  #${m.seq} ${m.type} from ${m.from}${m.operator ? ' [operator]' : ''}${m.to !== 'all' ? ` to ${m.to}` : ''}${m.ref ? ` re ${m.ref}` : ''} (id ${m.id}): ${String(m.body).slice(0, 300)}`);
    if (u.messages.some((m) => m.type === 'task')) L.push('  For a task: claim it with bus_send (type claim, ref = its id) before starting, then restate it.');
  }
  if (lead && u.lead_needed) L.push(`[Memev bus] ${u.lead_needed}`);
  return L.join('\n');
}

export function createServer(vault, { tunnelKey = () => null, licenseKeys = LICENSE_KEYS, env = process.env } = {}) {
  const limiter = new Buckets(vault.config.remote?.rate_per_min || 120);
  const nonces = new NonceCache();
  // the licence file is read again at most every few seconds, so an install takes effect at once
  let lic = null; let licAt = 0;
  const policy = () => { if (Date.now() - licAt > 3000) { lic = loadLicense({ env, keys: licenseKeys }); licAt = Date.now(); } return seatPolicy({ license: lic, devices: vault.devices.list() }); };
  const audit = path.join(vault.state, 'access.jsonl');
  const server = http.createServer(async (req, res) => {
    const send = (code, body, headers = {}) => { if (res.headersSent) return; const s = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(s); };
    const url = new URL(req.url, 'http://localhost');
    const local = isDirectLocal(req);
    let raw = null; const getBody = async () => (raw ??= await readBody(req));
    try {
      // a local caller also gets the vault's id, so the CLI can tell this vault's daemon from another one on the same port
      if (req.method === 'GET' && url.pathname === '/healthz') return send(200, local ? { ok: true, name: 'memev', version: VERSION, vault_id: vault.config?.vault_id ?? null } : { ok: true });
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
      if (req.method === 'POST' && route === '/v1/invite-redeem') {
        let body; try { body = JSON.parse((await getBody()) || '{}'); } catch { return send(400, { error: 'bad_json', error_description: 'the body is not json' }); }
        try {
          const r = redeemInvite(vault.root, { code: body.code, pubkey: body.pubkey, label: body.label, tokens: vault.tokens, policy: policy() });
          return send(200, { device_id: r.device.id, token: r.token });
        } catch (e) {
          const expired = /expired/i.test(e.message);
          return send(expired ? 410 : 409, { error: expired ? 'expired' : 'refused', error_description: e.message });
        }
      }
      const identity = vault.tokens.verify(token);
      if (!identity) return send(401, { error: 'unauthorized', error_description: 'a valid bearer token is required' }, { 'www-authenticate': 'Bearer' });
      if (!local) {
        if (!identity.remote) return send(403, { error: 'local_token', error_description: 'this token is for this machine only; for a cloud AI app use the connector URL from memev cloud url, and add another computer with memev devices enroll' });
        // Each remote client has its own credential (its token, registered as a device). The old
        // shared tunnel key is no longer needed; apps set up before still send it, and a wrong one
        // is still refused so a half-changed configuration fails loudly instead of silently.
        const sent = req.headers['x-memev-key']; const key = tunnelKey();
        if (sent !== undefined && !(key && timingSafeEqualHex(String(sent), key))) return send(401, { error: 'tunnel_key', error_description: 'the X-Memev-Key header does not match; it is no longer needed, so remove it' });
      }
      vault.tokens.touch(identity.id);
      vault.devices.fresh();
      let dev = vault.devices.get(vault.devices.byToken.get(identity.id) || '');
      let proof = null;
      if (!local && dev?.kind === 'remote-computer') {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) await getBody();
        proof = dev.pubkey ? verifyProof(dev.pubkey, { method: req.method, path: url.pathname, ts: req.headers['x-memev-ts'], nonce: req.headers['x-memev-nonce'], sig: req.headers['x-memev-sig'], body: raw || '' }) : { ok: false, reason: 'this computer was added without a device key' };
        if (proof.ok && !nonces.use(`${dev.id}:${req.headers['x-memev-nonce']}`)) proof = { ok: false, reason: 'this signed request was already used' };
      }
      // which device this is, what kind of client, and whether its credential looks shared
      let seen = null;
      try {
        seen = vault.devices.observe({ tokenId: identity.id, identity, local, ip: req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress, userAgent: req.headers['user-agent'], connectorUrl: !!cm, proof });
        if (!local && seen) fs.appendFile(audit, `${JSON.stringify({ ts: now(), device: seen.device, class: seen.class, route: route.slice(0, 64) })}\n`, () => {});
      } catch {}
      dev ||= seen ? vault.devices.get(seen.device) : null;
      if (!local && dev?.kind === 'remote-computer') {
        if (!proof) proof = { ok: false, reason: 'this computer was added without a device key' };
        if (!proof.ok) return send(401, { error: 'device_key', error_description: `Refused: ${proof.reason}. A computer's connection details only work on the computer that holds its device key. To add this computer, run memev devices keygen on it and enroll it on the vault: memev devices enroll --kind remote-computer --pubkey <key>.` });
        const why = readOnlyReason(policy(), dev);
        if (why) identity.read_only = why;
      }
      if (!local && dev?.kind === 'cloud-connector' && computerSide({ userAgent: req.headers['user-agent'], memevClient: req.headers['x-memev-client'] })) {
        return send(403, { error: 'connector_on_computer', error_description: 'This connector URL is for a cloud AI app. To use this vault from another computer, enroll that computer with its own device key: memev devices keygen there, then memev devices enroll --kind remote-computer --pubkey <key> on the vault.' });
      }
      const client = String(req.headers['x-memev-client'] || identity.agent).slice(0, 40);
      const session = req.headers['x-memev-session'] ? String(req.headers['x-memev-session']).slice(0, 64) : null;
      const ctx = { identity, client, session, local, device: dev, cli: local && client === 'cli' };

      if (route === '/mcp') {
        if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' }, { allow: 'POST' });
        let msg; try { msg = JSON.parse(await getBody()); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
        if (Array.isArray(msg)) { const out = (await Promise.all(msg.map((m) => handle(vault, m, ctx)))).filter(Boolean); return out.length ? send(200, out) : send(202, ''); }
        const out = await handle(vault, msg, ctx);
        return out ? send(200, out) : send(202, '');
      }
      // hook routes: what the session hooks call (local, Claude Code and friends)
      if (req.method === 'POST' && route.startsWith('/v1/')) {
        const body = JSON.parse((await getBody()) || '{}');
        if (route === '/v1/session-start') { const card = vault.sessionStart(identity, { ...body, client }); return send(200, { card, text: renderCard(card), protocol: PROTOCOL }); }
        if (route === '/v1/recall') { const own = body.session ? `-${slug(String(body.session), 16)}.md` : null; const hits = vault.recall(identity, { ...body, client, limit: body.limit || 4 }).filter((h) => h.score >= (vault.config.recall?.min_score ?? 1) && !(own && h.path.startsWith('work/sessions/') && h.path.endsWith(own))); return send(200, { hits, text: renderRecall(hits, { maxChars: vault.config.recall?.max_chars || 1500 }) }); }
        if (route === '/v1/checkpoint') return send(200, vault.checkpoint(identity, { ...body, client }));
        if (route === '/v1/journal') return send(200, vault.journal(identity, { ...body, client }));
        if (route === '/v1/contract-gate') return send(200, { open: vault.contractGate(body.session) });
        if (route === '/v1/remember') return send(200, vault.remember(identity, { ...body, client }));
        if (route === '/v1/bus-pulse') { const u = vault.bus.unread(ctx, { peek: !!body.peek }); return send(200, { ...u, text: renderBus(u, { lead: !!body.lead }) }); }
        if (route === '/v1/bus-register') { if (local) vault._seedBus(); const reg = []; for (const cl of [].concat(body.clients || [])) { try { reg.push(vault.bus.resolve({ ...ctx, client: String(cl).slice(0, 40), cli: false }).seat); } catch {} } if (local && body.operator && !vault.bus.operator()) try { vault.bus.setOperator(body.operator); } catch {} vault.commits.flush(); return send(200, { seats: reg, operator: vault.bus.operator() }); }
        if (route === '/v1/bus-operator' && ctx.cli) { const seat = body.seat ? vault.bus.seatFor(body.seat) || body.seat : null; const op = vault.bus.setOperator(seat, { by: body.by || 'terminal' }); vault.commits.flush(); return send(200, { operator: op }); }
        if (route === '/v1/reload' && local && identity.scopes.includes('admin')) { vault.emit('reload'); return send(200, { ok: true }); }
      }
      if (req.method === 'GET' && route === '/v1/status') return send(200, vault.status());
      const nm = /^\/v1\/notes\/(.+)$/.exec(route);
      if (nm) {
        const p = decodeURIComponent(nm[1]);
        if (req.method === 'GET') return send(200, vault.get(identity, p));
        const body = JSON.parse((await getBody()) || '{}');
        if (req.method === 'PUT') return send(200, vault.write(identity, { path: p, body: body.body, client }));
        if (req.method === 'PATCH') return send(200, vault.append(identity, { path: p, text: body.text, client }));
        if (req.method === 'DELETE') return send(200, vault.delete(identity, { path: p, client }));
      }
      return send(404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof VaultError || e.name === 'BusError') return send({ forbidden: 403, not_found: 404, immutable: 409, conflict: 409, secret: 422, too_large: 413 }[e.code] || 400, { error: e.code, error_description: e.message });
      return send(500, { error: 'internal', error_description: e.message });
    }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  return server;
}
