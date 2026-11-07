// SPDX-License-Identifier: Apache-2.0
// A computer signs each request with a one-time nonce. What was used must stay used across a restart, the store must not
// grow past the window a signature is good for, and a damaged store must neither stop the server nor reopen old requests.
import { test, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { freePort } from './helpers/cli.mjs';
import { initVault, Vault } from '../src/engine/vault.mjs';
import { readJson, writeJson } from '../src/engine/util.mjs';
import { createServer } from '../src/server/http.mjs';
import { deviceKeygen, signRequest, proofPayload } from '../src/engine/devices.mjs';

const kids = new Set();
const rigs = [];
after(() => { for (const k of kids) k.kill('SIGKILL'); cleanup(); });
afterEach(async () => { mock.timers.reset(); for (const r of rigs.splice(0)) await r.close(); });

const BODY = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const T0 = Date.UTC(2026, 10, 6, 12);
const PERMISSIVE = { can_enroll: true };

function newRoot() {
  const root = path.join(tmpdir('nonce-persist-'), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const cfgFile = path.join(root, '.memev', 'config.json');
  writeJson(cfgFile, { ...readJson(cfgFile, {}), remote: { enabled: true, rate_per_min: 120 } }, 0o600);
  return root;
}

/** A vault with one enrolled computer, its server, and a way to restart both in this process. */
async function rig() {
  const root = newRoot();
  const r = { root, store: path.join(root, '.memev', 'nonces.json'), up: false };
  r.open = async () => {
    r.v = new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys') }).open();
    r.server = createServer(r.v, { tunnelKey: () => null });
    await new Promise((res) => r.server.listen(0, '127.0.0.1', res));
    r.url = `http://127.0.0.1:${r.server.address().port}`;
    r.up = true;
  };
  r.close = async () => { if (!r.up) return; r.up = false; await new Promise((res) => { r.server.closeAllConnections?.(); r.server.close(res); }); r.v.close(); };
  r.restart = async () => { await r.close(); await r.open(); };
  await r.open();
  r.key = deviceKeygen();
  r.dev = r.v.devices.enroll(r.v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: r.key.publicKey, policy: PERMISSIVE });
  rigs.push(r);
  return r;
}

const signed = (token, key) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...signRequest(key, { method: 'POST', path: '/mcp', body: BODY }) });
const sign = (r) => signed(r.dev.token, r.key.privateKeyPem);
const post = async (url, headers) => { const res = await fetch(`${url}/mcp`, { method: 'POST', headers, body: BODY }); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: res.status, text, json }; };

const refusedAsUsed = (res, what) => {
  assert.equal(res.status, 401, what);
  assert.equal(res.json.error, 'device_key', what);
  assert.match(res.json.error_description, /already used/, what);
};

test('T4-c03: a nonce used before a server restart is refused after it', async () => {
  const r = await rig();
  const headers = sign(r);
  const unsent = sign(r);
  const first = await post(r.url, headers);
  await r.restart();
  const replay = await post(r.url, headers);
  assert.equal(replay.status, 401, 'replayed after restart');
  assert.equal(first.status, 200, 'the first use was served');
  refusedAsUsed(replay, 'replayed after restart');
  // the refusal comes from the remembered nonce and not from a blanket cut-off at start
  assert.equal((await post(r.url, unsent)).status, 200, 'signed before the restart and never sent');
  assert.equal((await post(r.url, sign(r))).status, 200, 'signed after the restart');
});

/** The real daemon on this rig's vault, as its own process: start it, and kill it with no warning. */
function daemonOn(r) {
  const conf = tmpdir('nonce-persist-conf-'); const port = freePort();
  const env = { ...process.env, HOME: conf, MEMEV_CONFIG_DIR: conf, MEMEV_NO_TUNNEL: '1', MEMEV_NO_SERVICE: '1' };
  const url = `http://127.0.0.1:${port}`;
  const start = async (withinMs = 30000) => {
    const child = spawn(process.execPath, [path.join(PKG, 'src', 'server', 'main.mjs'), '--root', r.root, '--port', String(port)], { env, stdio: 'ignore' });
    kids.add(child); child.once('exit', () => kids.delete(child));
    const until = Date.now() + withinMs;
    for (;;) {
      try { if ((await fetch(`${url}/healthz`)).ok) return child; } catch { /* not up yet */ }
      assert.ok(Date.now() < until, `the daemon answered /healthz within ${withinMs} ms`);
      await new Promise((res) => setTimeout(res, 50));
    }
  };
  const kill = async (child) => { const gone = new Promise((res) => child.once('exit', res)); child.kill('SIGKILL'); await gone; };
  return { url, start, kill };
}

test('killed daemon restart', async () => {
  const r = await rig();
  await r.close();
  const { url, start, kill } = daemonOn(r);
  // the signal goes in the same tick the response headers arrive, so what is on disk then is all there is
  const sendThenKill = (headers, child) => new Promise((resolve, reject) => {
    const gone = new Promise((res) => child.once('exit', res));
    const req = http.request(`${url}/mcp`, { method: 'POST', headers }, (res) => { const status = res.statusCode; child.kill('SIGKILL'); res.resume(); res.on('error', () => {}); gone.then(() => resolve(status)); });
    req.on('error', reject); req.end(BODY);
  });

  let child = await start();
  const headers = sign(r);
  assert.equal(await sendThenKill(headers, child), 200);
  child = await start();
  try {
    refusedAsUsed(await post(url, headers), 'replayed after a killed daemon came back');
    assert.equal((await post(url, sign(r))).status, 200, 'a fresh request is served');
  } finally { await kill(child); }
});

const halve = (f) => fs.writeFileSync(f, fs.readFileSync(f).subarray(0, Math.floor(fs.statSync(f).size / 2)));
const word = (w) => (f) => fs.writeFileSync(f, w);
const canLockOut = process.platform !== 'win32' && process.getuid?.() !== 0;
const lockOut = (f) => fs.chmodSync(f, 0o000);

/** Use a request on the real daemon, kill it, damage the store, and start again. The replay and a fresh request are the caller's. */
async function damagedDaemon(damage) {
  const r = await rig();
  await r.close();
  const d = daemonOn(r);
  let child = await d.start();
  const old = sign(r);
  assert.equal((await post(d.url, old)).status, 200, 'the first use');
  await d.kill(child);
  damage(r.store);
  child = await d.start(6000);
  return { r, d, old, child };
}

test('damaged store', async () => {
  for (const damage of [halve, word('not json')]) {
    const { r, d, old, child } = await damagedDaemon(damage);
    try {
      assert.equal((await post(d.url, old)).status, 401, 'the replay');
      assert.equal((await post(d.url, sign(r))).status, 200, 'a fresh request');
    } finally { await d.kill(child); }
  }
});

test('unreadable or malformed store', async () => {
  for (const damage of [word('null'), word('42'), ...(canLockOut ? [lockOut] : [])]) {
    const { r, d, old, child } = await damagedDaemon(damage);
    try {
      const replay = await post(d.url, old);
      assert.equal(replay.status, 401, 'the replay');
      assert.notEqual(replay.json.error, 'unauthorized');
      assert.equal((await post(d.url, sign(r))).status, 200, 'a fresh request');
    } finally { await d.kill(child); }
  }
});

test('damage is not forgotten', async () => {
  for (const damage of [halve, word('not json'), word('null'), ...(canLockOut ? [lockOut] : [])]) {
    const { r, d, old, child } = await damagedDaemon(damage);
    assert.equal((await post(d.url, sign(r))).status, 200, 'a fresh request after the damage');
    await d.kill(child);
    const again = await d.start();
    try {
      const replay = await post(d.url, old);
      assert.equal(replay.status, 401, 'the replay, one more restart on');
      assert.equal(replay.json.error, 'device_key');
      assert.equal((await post(d.url, sign(r))).status, 200, 'and a fresh one');
    } finally { await d.kill(again); }
  }
});

test('bounded by the window: the store is pruned while the server runs, by the age of what was signed', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const r = await rig();
  const first = sign(r);
  assert.equal((await post(r.url, first)).status, 200);
  for (let i = 0; i < 99; i++) assert.equal((await post(r.url, sign(r))).status, 200);
  const size = fs.statSync(r.store).size;
  assert.match(fs.readFileSync(r.store, 'utf8'), new RegExp(first['x-memev-nonce']));

  mock.timers.setTime(T0 + 11 * 60e3);
  const fresh = sign(r);
  assert.equal((await post(r.url, fresh)).status, 200);
  const now = fs.readFileSync(r.store, 'utf8');
  assert.ok(now.length < size / 10, `the store went from ${size} to ${now.length} bytes with no restart`);
  assert.doesNotMatch(now, new RegExp(first['x-memev-nonce']));
  assert.match(now, new RegExp(fresh['x-memev-nonce']));
});

test('an entry lasts as long as its signature could be accepted, and a clock that steps back drops nothing', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const r = await rig();
  // signed for the far end of the window: only the nonce can refuse it once the clock has moved on
  mock.timers.setTime(T0 + 290e3);
  const ahead = sign(r);
  mock.timers.setTime(T0);
  assert.equal((await post(r.url, ahead)).status, 200);
  mock.timers.setTime(T0 + 400e3);
  assert.equal((await post(r.url, sign(r))).status, 200);
  await r.restart();
  refusedAsUsed(await post(r.url, ahead), 'still inside the window, 400 s on');
  mock.timers.setTime(T0 - 200e3);
  await r.restart();
  mock.timers.setTime(T0 + 400e3);
  refusedAsUsed(await post(r.url, ahead), 'after the clock stepped back and forward');
});

for (const [label, damage] of [
  ['torn in half', (f) => fs.writeFileSync(f, fs.readFileSync(f).subarray(0, Math.floor(fs.statSync(f).size / 2)))],
  ['not json', (f) => fs.writeFileSync(f, 'not json')],
  ['null', (f) => fs.writeFileSync(f, 'null')],
  ['an array', (f) => fs.writeFileSync(f, '[]')],
  ['an empty object', (f) => fs.writeFileSync(f, '{}')],
  ['nulls in place of values', (f) => { const o = JSON.parse(fs.readFileSync(f, 'utf8')); for (const k of Object.keys(o)) o[k] = null; fs.writeFileSync(f, JSON.stringify(o)); }],
  ['a bad entry', (f) => { const o = JSON.parse(fs.readFileSync(f, 'utf8')); o.nonces.x = 'soon'; fs.writeFileSync(f, JSON.stringify(o)); }],
  ['unreadable', (f) => fs.chmodSync(f, 0o000)],
]) {
  test(`a store that is ${label} neither stops the server nor reopens an old request`, { skip: label === 'unreadable' && (process.platform === 'win32' || process.getuid?.() === 0) }, async (t) => {
    const said = []; t.mock.method(console, 'error', (...a) => said.push(a.join(' ')));
    const r = await rig();
    const old = sign(r);
    assert.equal((await post(r.url, old)).status, 200);
    await r.close();
    damage(r.store);
    await r.open();
    assert.match(said.join('\n'), new RegExp(r.store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the damage is said, naming the file');
    assert.equal(fs.readdirSync(path.dirname(r.store)).filter((f) => f.startsWith('nonces.json.damaged-')).length, 1, 'the damaged file is kept aside');
    refusedAsUsed(await post(r.url, old), 'signed before the damage was found');
    assert.equal((await post(r.url, sign(r))).status, 200, 'a fresh request is served');
    // and the damage is not forgotten at the next start: the old request is still inside its window
    await r.restart();
    refusedAsUsed(await post(r.url, old), 'after one more restart');
  });
}

test('after the window has passed, a damaged store leaves nothing behind that refuses', async (t) => {
  t.mock.method(console, 'error', () => {});
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const r = await rig();
  assert.equal((await post(r.url, sign(r))).status, 200);
  await r.close();
  fs.writeFileSync(r.store, 'not json');
  await r.open();
  // signed before the damage was found, and sent while the window holds: refused
  mock.timers.setTime(T0 - 1000);
  const before = sign(r);
  mock.timers.setTime(T0 + 1000);
  refusedAsUsed(await post(r.url, before), 'older than the damage');
  mock.timers.setTime(T0 + 301e3);
  assert.equal((await post(r.url, sign(r))).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(r.store, 'utf8')).not_before, null, 'the mark is gone once no request that old could be accepted');
});

// A known limit, pinned so that a change to it is seen. The store that remembered this nonce is gone, and all that is left
// to judge the replay by is its signed time, which a clock running ahead puts after the moment the damage was found. It stays
// accepted because SR-1.03 signs that a fresh request is served right after damage: a signed time inside the skew cannot be
// told from a fresh one, so refusing this would refuse every signed request for up to 5 minutes, and that needs a change to SR-1.03.
test('known limit: signed ahead of the clock within the skew, used, store torn, restart: the replay is accepted', async (t) => {
  t.mock.method(console, 'error', () => {});
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const r = await rig();
  mock.timers.setTime(T0 + 240e3);
  const ahead = sign(r);
  mock.timers.setTime(T0);
  const first = await post(r.url, ahead);
  mock.timers.setTime(T0 + 10e3);
  await r.close();
  fs.writeFileSync(r.store, fs.readFileSync(r.store).subarray(0, 15));
  await r.open();
  const replay = await post(r.url, ahead);
  assert.equal(replay.status, 200, `the replay after the store was torn: ${replay.text}`);
  assert.equal(first.status, 200);
  refusedAsUsed(await post(r.url, ahead), 'accepted that once: from here it is remembered again');
});

test('a not_before past the clock by more than the skew is damage, so it cannot refuse for good', async (t) => {
  const said = []; t.mock.method(console, 'error', (...a) => said.push(a.join(' ')));
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const r = await rig();
  assert.equal((await post(r.url, sign(r))).status, 200);
  const write = (notBefore) => fs.writeFileSync(r.store, JSON.stringify({ v: 1, not_before: notBefore, nonces: {} }));
  const aside = () => fs.readdirSync(path.dirname(r.store)).filter((f) => f.startsWith('nonces.json.damaged-')).length;
  await r.close();
  write(1e300);
  await r.open();
  const after = await post(r.url, sign(r));
  assert.equal(after.status, 200, `a mark far in the future must not refuse: ${after.text}`);
  assert.match(said.join('\n'), /damaged/);
  assert.equal(aside(), 1);

  // inside the skew it is a clock that differs a little, and no damage
  await r.close();
  said.length = 0;
  const at = Date.now();
  write(at + 300e3);
  await r.open();
  assert.equal(said.length, 0, said.join('\n'));
  assert.equal(JSON.parse(fs.readFileSync(r.store, 'utf8')).not_before, at + 300e3);

  // a good mark, and then the clock steps back a long way: found once, and the mark becomes the time of the step back
  mock.timers.setTime(at - 3600e3);
  assert.equal((await post(r.url, sign(r))).status, 200, 'served after the step back');
  assert.equal(aside(), 2);
  assert.equal(JSON.parse(fs.readFileSync(r.store, 'utf8')).not_before, at - 3600e3);
  assert.equal((await post(r.url, sign(r))).status, 200);
  assert.equal(aside(), 2, 'and it was found once');
});

test('a nonce outside its form is refused before it can reach the store, whatever its signature', async () => {
  const r = await rig();
  assert.equal((await post(r.url, sign(r))).status, 200);
  const size = fs.statSync(r.store).size;
  const bodyHash = crypto.createHash('sha256').update(BODY).digest('hex');
  for (const nonce of ['a'.repeat(65), 'a'.repeat(4096), 'A'.repeat(32), 'not hex at all, and long enough']) {
    const ts = String(Date.now());
    const sig = crypto.sign(null, proofPayload({ method: 'POST', path: '/mcp', ts, nonce, bodyHash }), crypto.createPrivateKey(r.key.privateKeyPem)).toString('base64');
    const res = await post(r.url, { authorization: `Bearer ${r.dev.token}`, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', 'x-memev-ts': ts, 'x-memev-nonce': nonce, 'x-memev-sig': sig });
    assert.equal(res.status, 401, `a nonce of ${nonce.length} characters`);
    assert.match(res.json.error_description, /bad nonce/);
  }
  assert.equal(fs.statSync(r.store).size, size, 'nothing was written for any of them');
});

test('a write fault is a 5xx that names no path, and what it was refused for stays used', { skip: process.platform === 'win32' }, async (t) => {
  t.mock.method(console, 'error', () => {});
  const r = await rig();
  assert.equal((await post(r.url, sign(r))).status, 200);
  fs.rmSync(r.store); fs.mkdirSync(r.store); // the rename onto it now fails, whoever is running
  const during = sign(r);
  const fault = await post(r.url, during);
  assert.ok(fault.status >= 500 && fault.status < 600, `${fault.status} ${fault.text}`);
  assert.ok(!fault.text.includes(r.root) && !fault.text.includes('.memev'), fault.text);
  refusedAsUsed(await post(r.url, during), 'the same request while the fault stands');
  fs.rmSync(r.store, { recursive: true });
  const next = sign(r);
  assert.equal((await post(r.url, next)).status, 200, 'served once the fault is gone');
  await r.restart();
  refusedAsUsed(await post(r.url, during), 'the request from during the fault, after a restart');
  refusedAsUsed(await post(r.url, next), 'and the one after it');
});

test('the store is private on every write', { skip: process.platform === 'win32' }, async () => {
  const r = await rig();
  assert.equal((await post(r.url, sign(r))).status, 200);
  assert.equal(fs.statSync(r.store).mode & 0o077, 0);
  fs.chmodSync(r.store, 0o644);
  assert.equal((await post(r.url, sign(r))).status, 200);
  assert.equal(fs.statSync(r.store).mode & 0o077, 0);
});

test('a request that does not prove itself records nothing', async () => {
  const r = await rig();
  const nonce = crypto.randomBytes(12).toString('hex');
  const ts = String(Date.now());
  const bad = { authorization: `Bearer ${r.dev.token}`, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', 'x-memev-ts': ts, 'x-memev-nonce': nonce, 'x-memev-sig': crypto.randomBytes(64).toString('base64') };
  assert.equal((await post(r.url, bad)).status, 401);
  assert.equal(fs.existsSync(r.store), false, 'no store yet');
  const bodyHash = crypto.createHash('sha256').update(BODY).digest('hex');
  const sig = crypto.sign(null, proofPayload({ method: 'POST', path: '/mcp', ts, nonce, bodyHash }), crypto.createPrivateKey(r.key.privateKeyPem)).toString('base64');
  assert.equal((await post(r.url, { ...bad, 'x-memev-sig': sig })).status, 200, 'the nonce is still free for the real request');
});

test('same key on two records shares one window, and a rotated token does not reopen it', async () => {
  const r = await rig();
  const other = r.v.devices.enroll(r.v.tokens, { kind: 'remote-computer', label: 'copy', pubkey: r.key.publicKey, policy: PERMISSIVE });
  const a = sign(r);
  assert.equal((await post(r.url, a)).status, 200);
  refusedAsUsed(await post(r.url, { ...a, authorization: `Bearer ${other.token}` }), 'the same signature under the other record');
  const rotated = r.v.devices.rotate(r.v.tokens, r.dev.device.id);
  await r.restart();
  refusedAsUsed(await post(r.url, { ...a, authorization: `Bearer ${rotated.token}` }), 'the same signature under a new token');
  const body = fs.readFileSync(r.store, 'utf8');
  assert.ok(!body.includes(r.dev.token.slice(12)) && !body.includes(rotated.token.slice(12)), 'the store holds no token');
});

test('two servers on one vault keep each other\'s nonces', async () => {
  const r = await rig();
  const second = createServer(r.v, { tunnelKey: () => null });
  await new Promise((res) => second.listen(0, '127.0.0.1', res));
  try {
    const url2 = `http://127.0.0.1:${second.address().port}`;
    const [a, b, c] = [sign(r), sign(r), sign(r)];
    assert.equal((await post(r.url, a)).status, 200);
    assert.equal((await post(url2, b)).status, 200);
    assert.equal((await post(r.url, c)).status, 200);
    refusedAsUsed(await post(url2, a), 'A at the other server');
    await r.restart();
    for (const h of [a, b, c]) refusedAsUsed(await post(r.url, h), 'after a restart');
  } finally { await new Promise((res) => { second.closeAllConnections?.(); second.close(res); }); }
});
