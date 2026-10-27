// SPDX-License-Identifier: Apache-2.0
// A relay for development and tests: it runs on this computer and shows the relay protocol (docs/RELAY.md) end
// to end. It only forwards. A vault keeps one outbound control connection here, proved with its own key; when
// someone connects to the vault's name, the relay reads nothing but the server name in the TLS hello, asks the
// vault for a second connection and then copies bytes between the two. The TLS session ends at the vault, so
// the relay sees ciphertext only: it holds no token, no vault file and no key of the vault.
//
// This module imports nothing but node:net and node:crypto on purpose.
import net from 'node:net';
import crypto from 'node:crypto';

const CONTEXT = 'memev-relay-v1';
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const MAX_LINE = 4096;

/** The vault's stable name: the first 32 characters of base32(sha256(public key)). Whoever holds the key owns the name. */
export function idOf(spkiDer) {
  const h = crypto.createHash('sha256').update(spkiDer).digest();
  let bits = 0, value = 0, out = '';
  for (const b of h) { value = (value << 8) | b; bits += 8; while (bits >= 5 && out.length < 32) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } if (out.length >= 32) break; }
  return out;
}
/** What the vault signs: to open the control connection, and to answer one inbound connection. */
export const controlMessage = (id, nonce) => Buffer.from(`${CONTEXT} control ${id} ${nonce}`);
export const acceptMessage = (id, sid) => Buffer.from(`${CONTEXT} accept ${id} ${sid}`);

/**
 * The server name in a TLS ClientHello: a string, null when there is none or it is not a hello, or undefined when
 * more bytes are needed.
 */
export function serverName(buf) {
  if (buf.length < 5) return undefined;
  if (buf[0] !== 0x16) return null;
  const recLen = buf.readUInt16BE(3);
  if (recLen > 16384 || recLen < 42) return null;
  if (buf.length < 5 + recLen) return undefined;
  const r = buf.subarray(5, 5 + recLen);
  try {
    if (r[0] !== 1) return null;
    let p = 4 + 2 + 32; // handshake header, version, random
    p += 1 + r[p];
    p += 2 + r.readUInt16BE(p);
    p += 1 + r[p];
    let end = p + 2 + r.readUInt16BE(p); p += 2;
    if (end > r.length) return null;
    while (p + 4 <= end) {
      const type = r.readUInt16BE(p), len = r.readUInt16BE(p + 2); p += 4;
      if (type === 0) {
        const list = r.subarray(p, p + len);
        if (list.length < 5 || list[2] !== 0) return null;
        const n = list.readUInt16BE(3);
        const name = list.subarray(5, 5 + n).toString('latin1').toLowerCase();
        return /^[a-z0-9.-]{1,253}$/.test(name) ? name : null;
      }
      p += len;
    }
  } catch { return null; }
  return null;
}

/**
 * createRelay({ host, port, tap, maxPending, pendingMs, suffix })
 *   tap(event): called with every chunk the relay handles, { dir, id, bytes }, so a test can prove what it saw.
 *   suffix: the domain names are expected under (the id is the first label); any when omitted.
 */
export function createRelay({ host = '127.0.0.1', port = 0, tap = null, maxPending = 32, pendingMs = 10000, suffix = null } = {}) {
  const vaults = new Map();   // id -> { sock, pub }
  const pending = new Map();  // sid -> { id, sock, chunks, timer }
  const socks = new Set();
  const see = (dir, id, bytes) => { if (tap) tap({ dir, id: id || null, bytes: Buffer.from(bytes) }); };
  const stats = { inbound: 0, forwarded: 0, refused: 0 };

  const server = net.createServer((sock) => {
    socks.add(sock); sock.on('close', () => socks.delete(sock)); sock.on('error', () => {});
    sock.setNoDelay(true);
    const t = setTimeout(() => sock.destroy(), 5000); // a connection that has not said what it is
    let buf = Buffer.alloc(0);
    const first = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf[0] === 0x16) { // TLS: someone reaching a vault by name
        const name = serverName(buf);
        if (name === undefined) { if (buf.length > 20000) sock.destroy(); return; }
        sock.removeListener('data', first); clearTimeout(t);
        inbound(sock, buf, name);
      } else if (buf.length && buf[0] === 0x7b) { // a JSON line: a vault, on its control or answering a connection
        const nl = buf.indexOf(10);
        if (nl < 0) { if (buf.length > MAX_LINE) sock.destroy(); return; }
        sock.removeListener('data', first); clearTimeout(t);
        see('control-in', null, buf.subarray(0, nl));
        let msg; try { msg = JSON.parse(buf.subarray(0, nl).toString('utf8')); } catch { sock.destroy(); return; }
        const rest = buf.subarray(nl + 1);
        if (msg.t === 'hello') control(sock, msg, rest); else if (msg.t === 'accept') accept(sock, msg, rest); else sock.destroy();
      } else sock.destroy();
    };
    sock.on('data', first);
  });

  function send(sock, obj) { const line = `${JSON.stringify(obj)}\n`; see('control-out', obj.id || null, line); if (!sock.destroyed) sock.write(line); }

  function inbound(sock, hello, name) {
    stats.inbound++;
    const label = name ? name.split('.')[0] : null;
    const ok = name && (!suffix || name === `${label}.${suffix}`);
    const v = ok ? vaults.get(label) : null;
    if (!v || [...pending.values()].filter((p) => p.id === label).length >= maxPending) { stats.refused++; sock.destroy(); return; }
    const sid = crypto.randomBytes(16).toString('hex');
    const p = { id: label, sock, chunks: [hello], timer: setTimeout(() => { pending.delete(sid); sock.destroy(); }, pendingMs) };
    pending.set(sid, p);
    sock.on('data', (c) => { if (pending.get(sid) === p) { p.chunks.push(c); see('in', label, c); } });
    sock.on('close', () => { clearTimeout(p.timer); pending.delete(sid); });
    see('in', label, hello);
    send(v.sock, { t: 'open', sid, peer: String(sock.remoteAddress || '').replace(/^::ffff:/, '') });
  }

  function control(sock, msg, rest) {
    let pub, id;
    try { pub = Buffer.from(String(msg.pub), 'base64'); crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' }); id = idOf(pub); } catch { sock.destroy(); return; }
    if (msg.v !== 1) { send(sock, { t: 'error', error: 'unsupported version' }); sock.destroy(); return; }
    const nonce = crypto.randomBytes(24).toString('base64');
    send(sock, { t: 'challenge', nonce });
    let buf = Buffer.from(rest);
    const t = setTimeout(() => sock.destroy(), 5000);
    let authed = false;
    const lines = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (let nl; (nl = buf.indexOf(10)) >= 0;) {
        const line = buf.subarray(0, nl); buf = buf.subarray(nl + 1);
        see('control-in', id, line);
        let m; try { m = JSON.parse(line.toString('utf8')); } catch { sock.destroy(); return; }
        if (!authed) {
          let good = false;
          try { good = m.t === 'auth' && crypto.verify('sha256', controlMessage(id, nonce), crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' }), Buffer.from(String(m.sig), 'base64')); } catch { /* bad signature */ }
          if (!good) { send(sock, { t: 'error', error: 'the signature does not match the key' }); sock.destroy(); return; }
          authed = true; clearTimeout(t);
          const old = vaults.get(id); // a vault that restarted takes its name back
          vaults.set(id, { sock, pub });
          if (old && old.sock !== sock) old.sock.destroy();
          send(sock, { t: 'ready', id });
        } else if (m.t === 'ping') send(sock, { t: 'pong' });
      }
      if (buf.length > MAX_LINE) sock.destroy();
    };
    sock.on('data', lines);
    sock.on('close', () => { clearTimeout(t); if (vaults.get(id)?.sock === sock) vaults.delete(id); });
    if (buf.length) { const keep = buf; buf = Buffer.alloc(0); lines(keep); }
  }

  function accept(sock, msg, rest) {
    const p = pending.get(String(msg.sid));
    const v = p && vaults.get(p.id);
    let good = false;
    try { good = v && msg.id === p.id && crypto.verify('sha256', acceptMessage(p.id, msg.sid), crypto.createPublicKey({ key: v.pub, format: 'der', type: 'spki' }), Buffer.from(String(msg.sig), 'base64')); } catch { /* bad signature */ }
    if (!good) { sock.destroy(); return; }
    pending.delete(msg.sid); clearTimeout(p.timer);
    stats.forwarded++;
    send(sock, { t: 'ok' });
    const a = p.sock, b = sock;
    a.removeAllListeners('data'); a.removeAllListeners('close');
    for (const c of p.chunks) b.write(c);
    if (rest.length) { see('out', p.id, rest); a.write(rest); }
    a.on('data', (c) => see('in', p.id, c));
    b.on('data', (c) => see('out', p.id, c));
    a.pipe(b); b.pipe(a);
    const end = () => { a.destroy(); b.destroy(); };
    a.on('close', end); b.on('close', end);
    a.on('error', end); b.on('error', end);
  }

  return {
    stats,
    vaults: () => [...vaults.keys()],
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); }); }),
    get port() { return server.address()?.port; },
    close: () => new Promise((resolve) => { for (const s of socks) s.destroy(); for (const p of pending.values()) clearTimeout(p.timer); server.close(() => resolve()); }),
  };
}
