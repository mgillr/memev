// Outbound requests honour HTTPS_PROXY, HTTP_PROXY and NO_PROXY. A local proxy stands in for a company one: it
// records what it is asked for and answers itself, and direct requests are caught before they leave, so nothing here
// reaches the internet or needs a name to resolve.
import { test, after } from 'node:test';
import https from 'node:https';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { fetchOut, proxyFor } from '../src/engine/net.mjs';
import { cloudflaredPath, CLOUDFLARED } from '../src/cli/tunnel.mjs';

after(() => cleanup());

// a proxy that records each request: it answers plain http itself, and a CONNECT either opens a tunnel to `tunnelTo`
// or is refused
async function proxy({ tunnelTo = null } = {}) {
  const seen = []; const tunnels = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url.endsWith('/moved')) { res.writeHead(302, { location: '/here' }); return res.end(); }
    if (req.url.endsWith('/away')) { res.writeHead(302, { location: 'http://elsewhere.invalid/landing' }); return res.end(); }
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => { res.writeHead(200, { 'x-proxy-auth': req.headers['proxy-authorization'] || '', 'x-sent': sent(req.headers) }); res.end(`via proxy ${req.url}${body ? ` ${body}` : ''}`); });
  });
  server.on('connect', (req, socket) => {
    seen.push(`CONNECT ${req.url}`);
    if (!tunnelTo) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    const up = net.connect(tunnelTo, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.pipe(socket); socket.pipe(up); });
    tunnels.push(up, socket);
    for (const [a, b] of [[up, socket], [socket, up]]) { a.on('error', () => b.destroy()); a.on('close', () => b.destroy()); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => { for (const x of tunnels) x.destroy(); server.closeAllConnections(); server.close(r); }) };
}
// the request headers a redirect hop must drop or keep, as the server received them
const sent = (h) => JSON.stringify(Object.fromEntries(['authorization', 'cookie', 'proxy-authorization', 'content-type', 'x-keep'].filter((k) => k in h).map((k) => [k, h[k]])));
// requests that go direct are answered here instead of leaving the machine; `headers` gets the headers each one carried
async function catchingDirect(fn, headers = []) {
  const real = globalThis.fetch; const direct = [];
  globalThis.fetch = async (u, o = {}) => { direct.push(String(u)); headers.push(Object.fromEntries(new Headers(o.headers))); return new Response('direct'); };
  try { await fn(); } finally { globalThis.fetch = real; }
  return direct;
}

test('MEM-080 AC01: With HTTPS_PROXY pointing at a local test proxy, the tunnel download request goes through the proxy', async () => {
  const key = `${process.platform}-${process.arch}`;
  assert.ok(CLOUDFLARED.sha256[key], `a pinned cloudflared for ${key}`);
  const p = await proxy();
  const home = tmpdir('proxy-home-');
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), HTTPS_PROXY: p.url };
  const savedPath = process.env.PATH; process.env.PATH = path.dirname(process.execPath); // no cloudflared on PATH, so it downloads
  try {
    const direct = await catchingDirect(() => assert.rejects(cloudflaredPath(env), /the proxy refused the connection to github\.com:443: 403/));
    assert.deepEqual(direct, [], 'nothing went direct');
    assert.deepEqual(p.seen, ['CONNECT github.com:443'], 'the download asked the proxy for a tunnel to github.com');
  } finally { process.env.PATH = savedPath; await p.close(); }
});

test('MEM-080 AC02: NO_PROXY hosts bypass the proxy', async () => {
  const p = await proxy();
  const env = { HTTP_PROXY: p.url, HTTPS_PROXY: p.url, NO_PROXY: 'internal.example.invalid, .corp.example.invalid,example.invalid:8080' };
  try {
    const direct = await catchingDirect(async () => {
      assert.equal(await (await fetchOut('http://example.invalid/a', {}, env)).text(), 'via proxy http://example.invalid/a');
      for (const u of ['http://internal.example.invalid/b', 'https://a.corp.example.invalid/c', 'http://example.invalid:8080/d', 'http://127.0.0.1:7787/healthz']) {
        assert.equal(await (await fetchOut(u, {}, env)).text(), 'direct', u);
      }
    });
    assert.deepEqual(direct, ['http://internal.example.invalid/b', 'https://a.corp.example.invalid/c', 'http://example.invalid:8080/d', 'http://127.0.0.1:7787/healthz']);
    assert.deepEqual(p.seen, ['GET http://example.invalid/a'], 'the proxy saw only the host not listed in NO_PROXY');
  } finally { await p.close(); }
});

test('which proxy a URL takes: scheme, letter case, NO_PROXY forms and loopback', () => {
  const P = 'http://proxy.example.invalid:3128';
  assert.equal(proxyFor('https://github.com/x', { HTTPS_PROXY: P })?.host, 'proxy.example.invalid:3128');
  assert.equal(proxyFor('https://github.com/x', { https_proxy: P })?.host, 'proxy.example.invalid:3128', 'lower-case names count');
  assert.equal(proxyFor('https://github.com/x', { HTTP_PROXY: P }), null, 'https uses HTTPS_PROXY only');
  assert.equal(proxyFor('http://a.example.invalid/x', { HTTP_PROXY: 'proxy.example.invalid:3128' })?.protocol, 'http:', 'a bare host:port is an http proxy');
  for (const [no, url, bypass] of [['*', 'https://github.com/', true], ['GitHub.com', 'https://github.com/', true], ['*.github.com', 'https://api.github.com/', true],
    ['github.com', 'https://api.github.com/', true], ['github.com', 'https://notgithub.com/', false], ['github.com:8443', 'https://github.com/', false], ['', 'https://github.com/', false]]) {
    assert.equal(proxyFor(url, { HTTPS_PROXY: P, NO_PROXY: no }) === null, bypass, `NO_PROXY=${no} ${url}`);
  }
  for (const u of ['http://localhost:7787/', 'http://127.0.0.1/', 'http://[::1]:7787/']) assert.equal(proxyFor(u, { HTTP_PROXY: P }), null, u);
  assert.throws(() => proxyFor('https://github.com/', { HTTPS_PROXY: 'socks5://127.0.0.1:1080' }), /not supported: set HTTPS_PROXY to an http:\/\/ proxy/);
});

test('through the proxy: credentials, a body, redirects, and TLS to the server itself inside the tunnel', async () => {
  const p = await proxy();
  try {
    const env = { HTTP_PROXY: p.url.replace('http://', 'http://me:s%40cret@') };
    const r = await fetchOut('http://example.invalid/post', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }, env);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'via proxy http://example.invalid/post {"a":1}');
    assert.equal(r.headers.get('x-proxy-auth'), `Basic ${Buffer.from('me:s@cret').toString('base64')}`);
    assert.equal(await (await fetchOut('http://example.invalid/moved', {}, env)).text(), 'via proxy http://example.invalid/here', 'the redirect is followed');
    const manual = await fetchOut('http://example.invalid/moved', { redirect: 'manual' }, env);
    assert.equal(manual.status, 302);
  } finally { await p.close(); }
  // https: the proxy only opens a tunnel; the TLS handshake inside it is for the server, by name
  let hello = Buffer.alloc(0);
  const server = net.createServer((s) => s.on('data', (d) => { hello = Buffer.concat([hello, d]); s.destroy(); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const t = await proxy({ tunnelTo: { host: '127.0.0.1', port: server.address().port } });
  try {
    // the server hung up mid-handshake: the request fails on TLS, never on looking the name up here
    await assert.rejects(fetchOut('https://example.invalid/secure', {}, { HTTPS_PROXY: t.url }), (e) => !/ENOTFOUND|getaddrinfo/.test(`${e.code} ${e.message} ${e.cause?.code}`));
    assert.deepEqual(t.seen, ['CONNECT example.invalid:443'], 'the proxy saw the host name and nothing of the request');
    assert.equal(hello[0], 0x16, 'a TLS handshake came through the tunnel');
    assert.ok(hello.includes(Buffer.from('example.invalid')), 'for the server name');
    assert.equal(hello.includes(Buffer.from('/secure')), false, 'the path stays inside TLS');
  } finally { await t.close(); await new Promise((r) => server.close(r)); }
});

test('a redirect to another origin drops the credentials and a POST turned GET drops its body headers, as fetch does', async () => {
  const p = await proxy();
  const env = { HTTP_PROXY: p.url };
  const headers = { Authorization: 'Bearer t0', Cookie: 'c=1', 'x-keep': 'k' };
  const got = async (r) => { await r.text(); return JSON.parse(r.headers.get('x-sent')); };
  try {
    assert.deepEqual(await got(await fetchOut('http://example.invalid/moved', { headers }, env)), { authorization: 'Bearer t0', cookie: 'c=1', 'x-keep': 'k' }, 'the same origin keeps them');
    const away = await fetchOut('http://example.invalid/away', { headers }, env);
    assert.deepEqual(await got(away), { 'x-keep': 'k' }, 'another origin gets no credentials');
    const post = await fetchOut('http://example.invalid/moved', { method: 'POST', body: 'x=1', headers: { ...headers, 'content-type': 'text/plain' } }, env);
    assert.deepEqual(await got(post), { authorization: 'Bearer t0', cookie: 'c=1', 'x-keep': 'k' }, 'the GET after a 302 carries no body headers');
    assert.deepEqual(p.seen, ['GET http://example.invalid/moved', 'GET http://example.invalid/here', 'GET http://example.invalid/away', 'GET http://elsewhere.invalid/landing', 'POST http://example.invalid/moved', 'GET http://example.invalid/here']);
    // a next hop that goes direct (NO_PROXY) is plain fetch, which sees it as a first request, so it is cleaned here too
    const carried = [];
    const direct = await catchingDirect(() => fetchOut('http://example.invalid/away', { headers: { ...headers, 'Proxy-Authorization': 'Basic x' } }, { ...env, NO_PROXY: 'elsewhere.invalid' }), carried);
    assert.deepEqual(direct, ['http://elsewhere.invalid/landing']);
    assert.deepEqual(carried, [{ 'x-keep': 'k' }]);
  } finally { await p.close(); }
});

test('https through the proxy end to end: the response, the Host header, a redirect, and certificate checks stay on', async (t) => {
  // a throwaway certificate made now, so no key is ever committed; without openssl there is nothing to serve TLS with
  const dir = tmpdir('proxy-tls-');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=example.invalid'], { encoding: 'utf8' });
  if (made.error || made.status !== 0) return t.skip('openssl is not available here');
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    if (req.url === '/go') { res.writeHead(302, { location: '/final' }); return res.end(); }
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: req.url, method: req.method, body, host: req.headers.host })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const p = await proxy({ tunnelTo: { host: '127.0.0.1', port: server.address().port } });
  const env = { HTTPS_PROXY: p.url };
  try {
    // the certificate is checked through the tunnel as it would be direct: a self-signed one is refused
    await assert.rejects(fetchOut('https://example.invalid/x', {}, env), (e) => /self.signed|certificate/i.test(`${e.code} ${e.message}`));
    const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // this test's own server only
    try {
      const r = await fetchOut('https://example.invalid/hello', { method: 'POST', body: 'x=1' }, env);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { path: '/hello', method: 'POST', body: 'x=1', host: 'example.invalid' });
      assert.deepEqual(await (await fetchOut('https://example.invalid/go', {}, env)).json(), { path: '/final', method: 'GET', body: '', host: 'example.invalid' });
    } finally { if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved; }
    // one tunnel per request: the refused certificate, /hello, /go and the /final it redirects to
    assert.deepEqual(p.seen, Array(4).fill('CONNECT example.invalid:443'));
  } finally { await p.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});
