// SPDX-License-Identifier: Apache-2.0
// The relay client: a stable address for this vault through a relay (docs/RELAY.md). Off by default.
//
// The vault keeps one outbound connection to the relay. Its name is made from its own key, so it is the same
// after every restart. When someone connects to that name the relay hands the connection to the vault over a
// second outbound connection, and the TLS session ends here, in this process, with this vault's own certificate.
// The relay therefore forwards bytes it cannot read: a token in a request never reaches it in the clear.
// What comes out of the TLS session is passed to the daemon as a remote request, never as a local one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { readJson, writePrivateJson, now } from '../engine/util.mjs';
import { loadLicense } from '../engine/license.mjs';
import { config, saveConfig, out } from './common.mjs';

// The name and the two signed messages are defined by the protocol (docs/RELAY.md). The development relay holds
// its own copy of these three lines so that it imports nothing of the vault; a test keeps the two equal.
const CONTEXT = 'memev-relay-v1';
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** The vault's stable name: the first 32 characters of base32(sha256(public key)). Whoever holds the key owns the name. */
export function idOf(spkiDer) {
  const h = crypto.createHash('sha256').update(spkiDer).digest();
  let bits = 0, value = 0, outp = '';
  for (const b of h) { value = (value << 8) | b; bits += 8; while (bits >= 5 && outp.length < 32) { outp += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } if (outp.length >= 32) break; }
  return outp;
}
export const controlMessage = (id, nonce) => Buffer.from(`${CONTEXT} control ${id} ${nonce}`);
export const acceptMessage = (id, sid) => Buffer.from(`${CONTEXT} accept ${id} ${sid}`);
const STATE = '.memev';
export const identityFile = (root) => path.join(root, STATE, 'relay.json');
export const relayStateFile = (root) => path.join(root, STATE, 'relay-state.json');
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'tailscale-user-login', 'x-original-forwarded-for', 'true-client-ip'];
const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

// ---- a certificate made here, with no tool and no library: a self-signed X.509 for the vault's relay name
const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const der = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const oid = (a) => { const bytes = [a[0] * 40 + a[1]]; for (const n of a.slice(2)) { const s = []; let v = n; s.unshift(v & 127); v >>= 7; while (v) { s.unshift((v & 127) | 128); v >>= 7; } bytes.push(...s); } return der(0x06, Buffer.from(bytes)); };
const utc = (d) => der(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));
const name = (cn) => der(0x30, der(0x31, der(0x30, oid([2, 5, 4, 3]), der(0x0c, Buffer.from(cn)))));
const pem = (label, buf) => `-----BEGIN ${label}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

/** A self-signed certificate for the given DNS names, signed with the key (ECDSA P-256). Valid for ten years. */
export function selfSignedCert({ privateKeyPem, names, at = Date.now(), days = 3650 }) {
  const priv = crypto.createPrivateKey(privateKeyPem);
  const spki = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  const sigAlg = der(0x30, oid([1, 2, 840, 10045, 4, 3, 2]));
  const serial = crypto.randomBytes(9); serial[0] &= 0x7f; serial[0] |= 0x01;
  const san = der(0x30, oid([2, 5, 29, 17]), der(0x04, der(0x30, ...names.map((n) => der(0x82, Buffer.from(n))))));
  const eku = der(0x30, oid([2, 5, 29, 37]), der(0x04, der(0x30, oid([1, 3, 6, 1, 5, 5, 7, 3, 1]))));
  const bc = der(0x30, oid([2, 5, 29, 19]), der(0x01, Buffer.from([0xff])), der(0x04, der(0x30)));
  const tbs = der(0x30,
    der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), sigAlg, name('memev vault'),
    der(0x30, utc(new Date(at - 86400e3)), utc(new Date(at + days * 86400e3))), name('memev vault'), spki,
    der(0xa3, der(0x30, san, eku, bc)));
  const sig = crypto.sign('sha256', tbs, { key: priv, dsaEncoding: 'der' });
  return pem('CERTIFICATE', der(0x30, tbs, sigAlg, der(0x03, Buffer.concat([Buffer.from([0]), sig]))));
}

/** The vault's relay identity: a key made once, so the name never changes, and a certificate for that name. */
export function ensureIdentity(root, { domain } = {}) {
  const f = identityFile(root);
  let idn = readJson(f, null);
  if (!idn?.key) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    idn = { v: 1, id: idOf(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })), key: keyPem, created: now() };
  }
  if (domain && idn.cert_for !== domain) { idn.cert = selfSignedCert({ privateKeyPem: idn.key, names: [`${idn.id}.${domain}`] }); idn.cert_for = domain; }
  writePrivateJson(f, idn);
  return idn;
}
export const publicKeyOf = (keyPem) => crypto.createPublicKey(keyPem).export({ type: 'spki', format: 'der' });
export const relayAddress = (id, domain) => `https://${id}.${domain}`;
const sign = (keyPem, msg) => crypto.sign('sha256', msg, crypto.createPrivateKey(keyPem)).toString('base64');

/** `relay://host:port` (a relay in front of nothing else), the form the setting takes. */
export function parseRelayUrl(url) {
  const m = /^relay:\/\/([A-Za-z0-9.-]+|\[[0-9a-f:]+\]):(\d{1,5})$/.exec(String(url || '').trim());
  if (!m) throw new Error('the relay address looks like relay://host:port');
  return { host: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]) };
}

const lineReader = (sock, onLine, onRest) => {
  let buf = Buffer.alloc(0); let live = true;
  const h = (c) => {
    buf = Buffer.concat([buf, c]);
    for (let nl; live && (nl = buf.indexOf(10)) >= 0;) { const l = buf.subarray(0, nl).toString('utf8'); buf = buf.subarray(nl + 1); let m = null; try { m = JSON.parse(l); } catch { sock.destroy(); return; } if (onLine(m) === 'stop') { live = false; sock.removeListener('data', h); sock.pause(); if (buf.length) sock.unshift(buf); onRest?.(); return; } }
    if (buf.length > 8192) sock.destroy();
  };
  sock.on('data', h);
};

/**
 * Keep this vault reachable at its relay address. { root, port (the daemon), url (relay://host:port), domain }.
 * Returns { id, address, ready (resolves with the address once the relay accepted us), stop() }. It reconnects
 * with a growing pause when the relay goes away, and takes the same name back each time.
 */
export function startRelayClient({ root, port, url, domain, log = () => {}, onState = () => {}, pingMs = 20000 }) {
  const target = parseRelayUrl(url);
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error('the relay needs a domain: the name its vault addresses are made under');
  const idn = ensureIdentity(root, { domain });
  const address = relayAddress(idn.id, domain);
  const pub = publicKeyOf(idn.key).toString('base64');
  const ctx = tls.createSecureContext({ key: idn.key, cert: idn.cert, minVersion: 'TLSv1.2' });
  let stopped = false, control = null, backoff = 500, timer = null, ping = null;
  const sessions = new Set();
  let readyResolve; const ready = new Promise((r) => { readyResolve = r; });
  const state = (s, extra = {}) => { onState({ id: idn.id, address, state: s, ...extra }); };

  // the daemon is reached from loopback, so every request out of a session carries a proxy header: it is remote, whatever Host it names
  const proxy = http.createServer((req, res) => {
    const peer = String(req.socket._peer || '').replace(/[^0-9a-f:.]/gi, '').slice(0, 45);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.includes(k) && !PROXY_HEADERS.includes(k)) headers[k] = v;
    headers['x-forwarded-for'] = peer || 'relay'; headers['x-forwarded-host'] = String(req.headers.host || '').slice(0, 253); headers['x-forwarded-proto'] = 'https';
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (r) => {
      const h = { ...r.headers }; for (const k of HOP) delete h[k];
      res.writeHead(r.statusCode, h); r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"vault_unreachable"}'); });
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  proxy.on('clientError', (_e, s) => { s.destroy(); });

  function session(sid, peer) {
    if (sessions.size >= 64) return;
    const sock = net.connect(target.port, target.host); sessions.add(sock);
    sock.on('error', () => {}); sock.on('close', () => sessions.delete(sock));
    sock.setNoDelay(true);
    sock.write(`${JSON.stringify({ t: 'accept', id: idn.id, sid, sig: sign(idn.key, acceptMessage(idn.id, sid)) })}\n`);
    lineReader(sock, (m) => { if (m.t !== 'ok') { sock.destroy(); return 'stop'; } return 'stop'; }, () => {
      if (sock.destroyed) return;
      const t = new tls.TLSSocket(sock, { isServer: true, secureContext: ctx });
      t._peer = peer; t.on('error', () => t.destroy());
      sock.on('close', () => t.destroy());
      proxy.emit('connection', t);
    });
  }

  function connect() {
    if (stopped) return;
    const sock = net.connect(target.port, target.host); control = sock;
    sock.on('error', (e) => log(`relay: ${e.message}`)); sock.setNoDelay(true);
    let up = false;
    sock.on('connect', () => sock.write(`${JSON.stringify({ t: 'hello', v: 1, pub })}\n`));
    const onMsg = (m) => {
      if (m.t === 'challenge') { sock.write(`${JSON.stringify({ t: 'auth', sig: sign(idn.key, controlMessage(idn.id, m.nonce)) })}\n`); return; }
      if (m.t === 'ready') { up = true; backoff = 500; state('up'); readyResolve(address); clearInterval(ping); ping = setInterval(() => { if (!sock.destroyed) sock.write('{"t":"ping"}\n'); }, pingMs); return; }
      if (m.t === 'open') { if (/^[0-9a-f]{32}$/.test(String(m.sid))) session(m.sid, m.peer); return; }
      if (m.t === 'error') { log(`relay refused: ${m.error}`); state(`refused: ${m.error}`); }
    };
    lineReader(sock, (m) => { onMsg(m); });
    sock.on('close', () => {
      clearInterval(ping); if (control === sock) control = null;
      if (stopped) return;
      state(up ? 'reconnecting' : `cannot reach the relay (retrying)`);
      timer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000);
    });
  }
  state('connecting');
  connect();
  return {
    id: idn.id, address, ready,
    stop() { stopped = true; clearTimeout(timer); clearInterval(ping); control?.destroy(); for (const s of sessions) s.destroy(); proxy.close(); state('off'); },
  };
}

/** The id a relay address names: its first label. */
export const idFromAddress = (address) => new URL(address).hostname.split('.')[0];

/**
 * One request to a vault through a relay, for a computer or app that has no public certificate to rely on: the
 * name is made from the vault's key, so the certificate it presents must match the name, and that is checked
 * instead of a certificate authority. `relay` is { host, port } of the relay to dial. Resolves { status, headers, text, json }.
 */
export function relayFetch(address, { relay, path: p = '/', method = 'GET', headers = {}, body = null, timeoutMs = 10000 } = {}) {
  const u = new URL(address); const id = u.hostname.split('.')[0];
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: relay.host, port: relay.port, servername: u.hostname, rejectUnauthorized: false, minVersion: 'TLSv1.2' });
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => fail(new Error('relay request timed out')));
    sock.once('error', fail);
    sock.once('secureConnect', () => {
      let ok = false;
      try { const c = new crypto.X509Certificate(sock.getPeerCertificate().raw); ok = idOf(c.publicKey.export({ type: 'spki', format: 'der' })) === id; } catch { /* no certificate */ }
      if (!ok) return fail(new Error('the vault behind this address did not prove it holds the key the address is made from'));
      const text = body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({ method, path: p, headers: { host: u.host, ...(text !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {}), ...headers }, createConnection: () => sock }, (res) => {
        let t = ''; res.setEncoding('utf8'); res.on('data', (d) => { t += d; });
        res.on('end', () => { sock.destroy(); let json = null; try { json = JSON.parse(t); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text: t, json }); });
      });
      req.on('error', fail);
      req.end(text);
    });
  });
}

// ---- the setting and the daemon side
export const relaySetting = (root) => ({ enabled: false, url: null, domain: null, default_url: null, default_domain: null, ...(config(root).remote?.relay || {}) });
/** A Personal licence that is currently valid. The free tier and every other tier are not. */
export const personalActive = (license) => license?.state === 'valid' && license.tier === 'personal';
export function setRelay(root, patch) { const c = config(root); c.remote = { ...c.remote, relay: { ...relaySetting(root), ...patch } }; saveConfig(root, c); return c.remote.relay; }
export const relayState = (root) => readJson(relayStateFile(root), null);

/** The daemon: hold the relay connection while the setting is on. Called by tunnel.mjs. */
export function superviseRelay(vault, { root, port, env = process.env }) {
  let cur = null;
  const write = (s) => writePrivateJson(relayStateFile(root), { ...s, updated: now() });
  const start = () => {
    const rs = vault.config.remote?.relay;
    if (!rs?.enabled || env.MEMEV_NO_TUNNEL) { write({ enabled: false, state: 'off' }); return; }
    try { cur = startRelayClient({ root, port, url: rs.url, domain: rs.domain, log: (m) => console.error(`[memev relay] ${m}`), onState: (s) => write({ enabled: true, ...s }) }); }
    catch (e) { console.error(`[memev relay] ${e.message}`); write({ enabled: true, state: `error: ${e.message}` }); }
  };
  const halt = () => { cur?.stop(); cur = null; };
  start();
  return { stop: halt, reload() { halt(); start(); } };
}

/** `memev cloud relay on --url relay://host:port --domain NAME | off | status | address` */
export async function command(pos, flags, { root, env = process.env, license = null }) {
  const sub = pos[0] || 'status';
  const s = relaySetting(root);
  if (sub === 'on') {
    let url = String(flags.url && flags.url !== true ? flags.url : s.url || ''); let domain = String(flags.domain && flags.domain !== true ? flags.domain : s.domain || '');
    // No address is built in. A valid Personal licence uses the address already stored in config.
    if (!url && personalActive(license || loadLicense({ env }))) { url = String(s.default_url || ''); if (!domain) domain = String(s.default_domain || ''); }
    if (!url) throw new Error('memev cloud relay on --url relay://host:port --domain NAME (no relay is built in)');
    parseRelayUrl(url);
    if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error('memev cloud relay on needs --domain: the name its addresses are made under');
    setRelay(root, { enabled: true, url, domain });
    const idn = ensureIdentity(root, { domain });
    out.ok(`relay on: this vault's address through it is ${relayAddress(idn.id, domain)} (the same after every restart).`);
    if (config(root).remote?.enabled === false) out.warn('remote access is off, so the vault would refuse what arrives through the relay (memev cloud on)');
    return 0;
  }
  if (sub === 'off') { setRelay(root, { enabled: false }); out.ok('relay off; the vault no longer connects to it. Its address is kept for next time.'); return 0; }
  if (sub === 'address') {
    if (!s.domain) { out.bad('no relay is set up (memev cloud relay on --url relay://host:port --domain NAME)'); return 1; }
    console.log(relayAddress(ensureIdentity(root, { domain: s.domain }).id, s.domain)); return 0;
  }
  if (sub === 'status') {
    if (!s.enabled) { console.log('Relay: off (memev cloud relay on --url relay://host:port --domain NAME)'); return 0; }
    const st = relayState(root);
    console.log(`Relay: on · ${st?.state || 'not started'} · ${s.url}`);
    if (st?.address) console.log(`  Address: ${st.address}`);
    return 0;
  }
  throw new Error('memev cloud relay on|off|status|address');
}
