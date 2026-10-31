// SPDX-License-Identifier: Apache-2.0
// Every request Memev makes to another computer goes through fetchOut, which honours the usual proxy settings:
// HTTPS_PROXY for https, HTTP_PROXY for http (either case), NO_PROXY for the hosts that go direct. Node's own fetch
// ignores them all, and its built-in support needs a start-up flag. The daemon on this computer is always reached
// directly (the CLI's api() in cli/common.mjs talks to it with node:http). With no proxy for a URL this is plain fetch,
// so nothing changes for anyone who does not set one.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { Readable } from 'node:stream';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const REDIRECT = new Set([301, 302, 303, 307, 308]);
// what fetch drops on a redirect: the credentials on a hop to another origin, the body headers once a POST becomes a GET
const CREDENTIALS = ['authorization', 'cookie', 'proxy-authorization'];
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];
const env1 = (env, name) => env[name.toLowerCase()] || env[name] || '';

/** The proxy for a URL, or null when it goes direct: loopback, a NO_PROXY match, or no proxy set. */
export function proxyFor(url, env = process.env) {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOOPBACK.has(host)) return null;
  const raw = u.protocol === 'https:' ? env1(env, 'HTTPS_PROXY') : u.protocol === 'http:' ? env1(env, 'HTTP_PROXY') : '';
  if (!raw) return null;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  for (const entry of env1(env, 'NO_PROXY').toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (entry === '*') return null;
    const m = /^\[?([^\]]*?)\]?(?::(\d+))?$/.exec(entry); // host, [v6 host], host:port
    if (m[2] && m[2] !== port) continue;
    const h = m[1].replace(/^\*?\./, '');
    if (host === h || host.endsWith(`.${h}`)) return null;
  }
  const proxy = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  if (proxy.protocol !== 'http:') throw new Error(`proxy ${proxy.protocol}// is not supported: set ${u.protocol === 'https:' ? 'HTTPS_PROXY' : 'HTTP_PROXY'} to an http:// proxy`);
  return proxy;
}

/** fetch, through the proxy the environment names for this URL. Same arguments and the same Response. */
export async function fetchOut(url, opts = {}, env = process.env) {
  const proxy = proxyFor(String(url), env);
  if (!proxy) return globalThis.fetch(url, opts);
  return viaProxy(new URL(String(url)), opts, proxy, env, 0);
}

function viaProxy(u, opts, proxy, env, hops) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = Object.fromEntries(new Headers(opts.headers || {}));
  const auth = proxy.username ? { 'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {};
  const body = opts.body == null ? null : typeof opts.body === 'string' || opts.body instanceof Uint8Array ? opts.body : String(opts.body);
  if (body !== null && !('content-length' in headers)) headers['content-length'] = String(Buffer.byteLength(body));
  const port = Number(proxy.port || 80);
  return new Promise((resolve, reject) => {
    const signal = opts.signal; const live = [];
    const fail = (e) => { for (const x of live) x.destroy(); reject(e); };
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
    signal?.addEventListener('abort', () => fail(signal.reason ?? new DOMException('This operation was aborted', 'AbortError')), { once: true });
    const answer = (res) => {
      const status = res.statusCode;
      if (REDIRECT.has(status) && res.headers.location && (opts.redirect ?? 'follow') === 'follow') {
        res.resume();
        if (hops >= 5) return fail(new Error('too many redirects'));
        const next = new URL(res.headers.location, u);
        const get = status === 303 || ((status === 301 || status === 302) && method === 'POST');
        const h2 = new Headers(opts.headers || {});
        for (const k of [...(next.origin !== u.origin ? CREDENTIALS : []), ...(get ? BODY_HEADERS : [])]) h2.delete(k);
        // the next hop may need another proxy, or none (NO_PROXY), so it is decided again
        const p2 = proxyFor(next.href, env); const o2 = { ...opts, headers: h2, ...(get ? { method: 'GET', body: undefined } : {}) };
        return resolve(p2 ? viaProxy(next, o2, p2, env, hops + 1) : globalThis.fetch(next.href, o2));
      }
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) h.append(k, x);
      const empty = method === 'HEAD' || status === 204 || status === 304;
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status, statusText: res.statusMessage, headers: h }));
    };
    const send = (req) => { live.push(req); req.on('error', fail); if (body !== null) req.write(body); req.end(); };
    if (u.protocol === 'http:') {
      // plain http: the request line names the whole URL and the proxy forwards it
      return send(http.request({ host: proxy.hostname, port, method, path: u.href, headers: { host: u.host, ...auth, ...headers } }, answer));
    }
    // https: a CONNECT tunnel through the proxy, then TLS to the server itself, so the proxy sees only the host name
    const target = `${u.hostname}:${u.port || 443}`;
    const connect = http.request({ host: proxy.hostname, port, method: 'CONNECT', path: target, headers: { host: target, ...auth } });
    live.push(connect);
    connect.on('error', fail);
    connect.on('connect', (res, socket) => {
      live.push(socket); socket.on('error', fail);
      if (res.statusCode !== 200) return fail(new Error(`the proxy refused the connection to ${target}: ${res.statusCode} ${res.statusMessage || ''}`.trim()));
      const secure = tls.connect({ socket, servername: u.hostname.replace(/^\[|\]$/g, ''), ALPNProtocols: ['http/1.1'] });
      live.push(secure); secure.on('error', fail); // a failed handshake rejects the request instead of throwing
      // no agent: with one (even agent: false) Node opens its own connection, looking the host up, and ignores this one
      send(https.request(u, { method, port: u.port || 443, headers: { host: u.host, ...headers }, createConnection: () => secure }, answer));
    });
    connect.end();
  });
}
