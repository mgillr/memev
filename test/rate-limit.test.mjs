// SPDX-License-Identifier: Apache-2.0
// The rate limiter holds one bucket per caller, and a caller is whoever a remote request says it is, so its size must
// have a bound. Filling it must not free a caller who has already used up its limit. The loop bounds and the bound in
// these tests are literals: read from the source, a cap of Infinity would pass them.
import { test, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { freePort } from './helpers/cli.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { readJson, writeJson } from '../src/engine/util.mjs';
import { createServer } from '../src/server/http.mjs';

const T0 = Date.UTC(2026, 10, 6, 12);
const open = [];
after(cleanup);
afterEach(async () => {
  mock.timers.reset();
  for (const { server, v } of open.splice(0)) {
    if (server.listening) await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
    v.close();
  }
});

/** A server with the clock frozen before it is built, so no refill can rescue a bucket and nothing fires on its own. */
function frozen(rate, apis = ['Date'], options = {}) {
  const { v } = newVault();
  v.config.remote = { ...v.config.remote, rate_per_min: rate };
  mock.timers.enable({ apis, now: T0 });
  const server = createServer(v, options);
  open.push({ server, v });
  return server;
}

test('T4-c05: after more distinct callers than the bucket limit, the rate buckets held are at most the limit, and a caller over its own limit is still refused', async () => {
  const server = frozen(5, ['Date'], { activeTunnel: () => 'cloudflare' });
  assert.ok(server.rateLimiter, 'createServer exposes the limiter it builds');
  const limiter = server.rateLimiter;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hit = async (ip) => (await fetch(`http://127.0.0.1:${server.address().port}/healthz/x`, { headers: { 'x-forwarded-for': ip, 'cf-connecting-ip': ip } })).status;

  // a caller uses up its own limit, through the real path
  const over = '203.0.113.50';
  for (let i = 0; i < 5; i++) assert.equal(await hit(over), 401, `request ${i + 1} is inside the limit`);
  assert.equal(await hit(over), 429, 'the sixth is over it');

  // more callers than the limit come and go, and each is let in
  for (let i = 0; i < 11000; i++) {
    assert.equal(limiter.take(`ip:flood-${i}`), true, `caller ${i} is new and is admitted`);
    assert.ok(limiter.size <= 10000, `after caller ${i} the limiter holds ${limiter.size}`);
  }
  assert.ok(limiter.size > 0);

  assert.equal(await hit(over), 429, 'the caller over its limit is still refused after the flood');
  assert.equal(await hit('203.0.113.51'), 401, 'and a caller not seen before is still served');
  assert.ok(limiter.size <= 10000, `the limiter holds ${limiter.size} after the requests`);
});

test('T1-c01: after 50,000 distinct keys the map holds at most 10,000 entries', () => {
  const limiter = frozen(120).rateLimiter;
  assert.ok(limiter, 'createServer exposes the limiter it builds');
  for (let i = 0; i < 50000; i++) limiter.take(`ip:${i}`);
  assert.ok(limiter.size <= 10000, `the limiter holds ${limiter.size}`);
  assert.ok(limiter.has('ip:49999'), 'the newest is held');
});

test('T1-c05: the limiter createServer builds stays at its bound with 11,000 distinct address keys', () => {
  const limiter = frozen(120).rateLimiter;
  assert.ok(limiter, 'createServer exposes the limiter it builds');
  for (let i = 0; i < 11000; i++) limiter.take(`ip:${i}`);
  assert.ok(limiter.size <= 10000, `the limiter holds ${limiter.size}`);
});

test('T1-c06: an exhausted key stays refused across a sweep, and a bucket idle for two minutes is dropped', (t) => {
  const limiter = frozen(6, ['Date', 'setTimeout', 'setInterval']).rateLimiter;
  assert.ok(limiter, 'createServer exposes the limiter it builds');
  for (let i = 0; i < 6; i++) assert.equal(limiter.take('ip:A'), true);
  assert.equal(limiter.take('ip:A'), false);
  mock.timers.tick(1000);
  limiter.take('ip:fresh');
  // one second at six a minute gives back 0.1 of a token
  assert.equal(limiter.take('ip:A'), false, 'A is still refused');

  limiter.take('ip:B');
  assert.ok(limiter.has('ip:B'));
  mock.timers.tick(120001);
  limiter.take('ip:another');
  assert.equal(limiter.has('ip:B'), false, 'B has not been touched for two minutes');
  assert.equal(limiter.has('ip:A'), false, 'nor has A, which by then has refilled in full, so dropping it gives it nothing');
  assert.ok(limiter.has('ip:another'));
});

test('T1-c10: the entry count holds at the bound after every take, with no timer able to help', () => {
  const limiter = frozen(120, ['Date', 'setTimeout', 'setInterval']).rateLimiter;
  assert.ok(limiter, 'createServer exposes the limiter it builds');
  for (let i = 0; i < 50000; i++) {
    limiter.take(`ip:${i}`);
    if (limiter.size > 10000) assert.fail(`after key ${i} the limiter holds ${limiter.size}`);
  }
});

test('cap holds when every bucket is exhausted', () => {
  const limiter = frozen(2).rateLimiter;
  for (let i = 0; i < 10500; i++) {
    assert.equal(limiter.take(`ip:${i}`), true, `key ${i} is admitted`);
    limiter.take(`ip:${i}`);
    assert.equal(limiter.take(`ip:${i}`), false, `key ${i} is used up`);
    if (limiter.size > 10000) assert.fail(`after key ${i} the limiter holds ${limiter.size}`);
  }
  for (const k of ['ip:never-1', 'ip:never-2']) { assert.equal(limiter.take(k), true); assert.ok(limiter.size <= 10000); }
});

test('busy key not reset at two minutes', () => {
  const limiter = frozen(6, ['Date', 'setTimeout', 'setInterval']).rateLimiter;
  let allowed = 0;
  for (let i = 0; i < 180; i++) { if (limiter.take('ip:A')) allowed++; mock.timers.tick(1000); }
  assert.ok(allowed <= 24, `${allowed} of 180 were allowed`);
});

test('busy key survives the sweep', () => {
  const limiter = frozen(6, ['Date', 'setTimeout', 'setInterval']).rateLimiter;
  for (let i = 0; i < 180; i++) { limiter.take('ip:A'); mock.timers.tick(1000); }
  assert.ok(limiter.has('ip:A'));
});

// one socket, and each request says it is someone else
const rotate = async (server, headersOf, n = 6) => {
  if (!server.listening) await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const out = [];
  for (let i = 0; i < n; i++) out.push((await fetch(`http://127.0.0.1:${server.address().port}/healthz/x`, { headers: headersOf(i) })).status);
  return out;
};
const OVER = [401, 401, 401, 401, 401, 429];
const xff = (i) => `198.51.100.${i + 1}`;
const cf = (i) => `203.0.113.${i + 1}`;
for (const [label, tunnel, headersOf] of [
  ['x-forwarded-for, no tunnel', null, (i) => ({ 'x-forwarded-for': xff(i) })],
  ['cf-connecting-ip, no tunnel', null, (i) => ({ 'x-forwarded-for': '198.51.100.1', 'cf-connecting-ip': cf(i) })],
  ['both, no tunnel', null, (i) => ({ 'x-forwarded-for': xff(i), 'cf-connecting-ip': cf(i) })],
  ['x-forwarded-for, tailscale', 'tailscale', (i) => ({ 'x-forwarded-for': xff(i) })],
  ['cf-connecting-ip, tailscale, which does not overwrite it', 'tailscale', (i) => ({ 'x-forwarded-for': '198.51.100.1', 'cf-connecting-ip': cf(i) })],
  ['x-forwarded-for, Cloudflare, under one cf-connecting-ip', 'cloudflare', (i) => ({ 'x-forwarded-for': xff(i), 'cf-connecting-ip': '203.0.113.1' })],
]) {
  test(`a caller rotating a header is still refused: ${label}`, async () => {
    const server = frozen(5, ['Date'], { activeTunnel: () => tunnel });
    assert.deepEqual(await rotate(server, headersOf), OVER);
  });
}

test('cf-connecting-ip tells callers apart only from a Cloudflare tunnel, on the loopback peer', async () => {
  const server = frozen(5, ['Date'], { activeTunnel: () => 'cloudflare' });
  assert.deepEqual(await rotate(server, (i) => ({ 'cf-connecting-ip': cf(i) })), [401, 401, 401, 401, 401, 401], 'Cloudflare overwrites it, so these are six callers');
  const { callerAddress } = await import('../src/server/http.mjs');
  const req = (peer) => ({ socket: { remoteAddress: peer }, headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.9' } });
  assert.equal(callerAddress(req('127.0.0.1'), 'cloudflare'), '203.0.113.9');
  assert.equal(callerAddress(req('::ffff:127.0.0.1'), 'quick'), '203.0.113.9');
  assert.equal(callerAddress(req('192.0.2.5'), 'cloudflare'), '192.0.2.5', 'a peer that is not loopback reached this server without the tunnel');
  assert.equal(callerAddress(req('127.0.0.1'), 'tailscale'), '127.0.0.1');
  assert.equal(callerAddress(req('127.0.0.1'), null), '127.0.0.1');
  assert.equal(callerAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }, 'cloudflare'), '127.0.0.1', 'no header');
});

test('daemon keys by the running tunnel', { skip: process.platform === 'win32' }, async () => {
  const home = tmpdir('rate-limit-daemon-'); const bin = path.join(home, 'bin'); fs.mkdirSync(bin);
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  script('tailscale', `case "$1 $2" in\n  "status --json") echo '{"BackendState":"Running","Self":{"DNSName":"v.example.ts.net."}}' ;;\n  "serve status") echo '{}' ;;\nesac\nexit 0`);
  script('cloudflared', 'echo https://ab-cd.trycloudflare.com >&2\nexec sleep 300');
  const run = async (name, remote, requests) => {
    const root = path.join(home, name);
    initVault(root, { template: path.join(PKG, 'templates', 'vault') });
    const cfgFile = path.join(root, '.memev', 'config.json');
    writeJson(cfgFile, { ...readJson(cfgFile, {}), remote }, 0o600);
    const port = freePort();
    const { MEMEV_NO_TUNNEL: _off, ...env } = process.env;
    const child = spawn(process.execPath, [path.join(PKG, 'src', 'server', 'main.mjs'), '--root', root, '--port', String(port)], {
      stdio: 'ignore',
      env: { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: home, MEMEV_CONFIG_DIR: path.join(home, 'conf'), MEMEV_NO_DOWNLOAD: '1', MEMEV_NO_SERVICE: '1' },
    });
    const gone = new Promise((res) => child.once('exit', res));
    try {
      const until = Date.now() + 30000;
      for (;;) {
        const st = readJson(path.join(root, '.memev', 'tunnel.json'), null);
        if (st?.provider === remote.provider.replace('auto', 'tailscale') && st.state === 'up') break;
        assert.ok(Date.now() < until, `the tunnel came up: ${JSON.stringify(st)}`);
        await new Promise((res) => setTimeout(res, 100));
      }
      const hit = async (ip) => (await fetch(`http://127.0.0.1:${port}/healthz/x`, { headers: { 'cf-connecting-ip': ip } })).status;
      await requests(hit);
    } finally { child.kill('SIGTERM'); await gone; }
  };
  await run('funnel', { enabled: true, provider: 'auto', funnelConsent: true, rate_per_min: 5, cloudflare: { name: 'n', hostname: 'h' } }, async (hit) => {
    const seen = []; for (let i = 0; i < 6; i++) seen.push(await hit(cf(i)));
    assert.deepEqual(seen, OVER, 'through a funnel the header is the caller\'s to choose');
  });
  await run('quick', { enabled: true, provider: 'quick', rate_per_min: 5 }, async (hit) => {
    const seen = []; for (let i = 0; i < 6; i++) seen.push(await hit('203.0.113.1'));
    assert.deepEqual(seen, OVER, 'through Cloudflare one caller is one caller');
    assert.equal(await hit('203.0.113.2'), 401, 'and another is another');
  });
});
