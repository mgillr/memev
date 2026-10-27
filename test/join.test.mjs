// memev join <code> enrols this computer. The older keygen and token path still works.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { signLicense, loadLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { mintInvite } from '../src/engine/devices.mjs';
import { createServer } from '../src/server/http.mjs';
import { join, deviceKeyFile, remoteFile } from '../src/cli/remote.mjs';
import { writePrivate } from '../src/engine/util.mjs';

after(() => cleanup());

const BIN = path.join(PKG, 'bin', 'memev.mjs');
const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);
const fakeClaude = (home) => { fs.mkdirSync(path.join(home, '.claude'), { recursive: true }); fs.writeFileSync(path.join(home, '.claude.json'), '{}\n'); };

function host() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keys = { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const { root, v } = newVault();
  const confDir = tmpdir('join-host-conf-');
  fs.writeFileSync(path.join(confDir, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_join0024', tier: 'team', services: ['sync'], seats: 3, iat: day(-1), exp: day(300), grace_days: 14 }, pem, 'test-vendor')));
  const env = { MEMEV_CONFIG_DIR: confDir };
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: keys, env });
  return { v, keys, env, server, root };
}

function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

function laptopEnv() {
  const home = tmpdir('join-laptop-');
  fakeClaude(home);
  return { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), PATH: process.env.PATH, MEMEV_NO_SERVICE: '1', MEMEV_NO_TUNNEL: '1', MEMEV_NO_BACKGROUND: '1' };
}

function cliJoin(env, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, 'join', ...args], { env });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { p.kill(); resolve({ code: 1, out, err: `${err}\ntimeout` }); }, 20000);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

test('MEM-024 AC01: Against a test host, memev join <code> ends with the laptop enrolled and its apps seated on the host bus', async () => {
  const h = host();
  const port = await listen(h.server);
  try {
    const minted = mintInvite(h.root, { address: `http://127.0.0.1:${port}`, ttlSec: 600 });
    const env = laptopEnv();
    const r = await cliJoin(env, [minted.code]);
    assert.equal(r.code, 0, r.err + r.out);
    h.v.devices.fresh();
    const computers = h.v.devices.list().filter((d) => d.kind === 'remote-computer' && d.status === 'active');
    assert.equal(computers.length, 1);
    const saved = JSON.parse(fs.readFileSync(remoteFile(env), 'utf8'));
    assert.equal(saved.url, `http://127.0.0.1:${port}`);
    assert.ok(saved.token);
    const seat = h.v.bus.roster().seats.find((s) => s.seat.startsWith('claude-code@') && !s.seat.endsWith('@host'));
    assert.ok(seat, r.out);
    assert.equal(seat.device, computers[0].id);
  } finally { h.server.close(); h.v.close(); }
});

test('MEM-024 AC02: join with a bad or used code exits non-zero without writing a credential', async () => {
  const badEnv = laptopEnv();
  const bad = await cliJoin(badEnv, ['not-a-code']);
  assert.notEqual(bad.code, 0);
  assert.equal(fs.existsSync(remoteFile(badEnv)), false);
  assert.equal(fs.existsSync(deviceKeyFile(badEnv)), false);

  const h = host();
  const port = await listen(h.server);
  try {
    const minted = mintInvite(h.root, { address: `http://127.0.0.1:${port}`, ttlSec: 600 });
    const first = await cliJoin(laptopEnv(), [minted.code]);
    assert.equal(first.code, 0, first.err + first.out);
    const secondEnv = laptopEnv();
    const second = await cliJoin(secondEnv, [minted.code]);
    assert.notEqual(second.code, 0);
    assert.equal(fs.existsSync(remoteFile(secondEnv)), false);
    assert.equal(fs.existsSync(deviceKeyFile(secondEnv)), false);
  } finally { h.server.close(); h.v.close(); }
});

test('MEM-024 AC03: The old keygen/enroll path still works', async () => {
  const h = host();
  const port = await listen(h.server);
  try {
    const home = tmpdir('join-old-');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude.json'), '{}\n');
    const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), PATH: process.env.PATH };
    const k = deviceKeygen();
    fs.mkdirSync(path.dirname(deviceKeyFile(env)), { recursive: true });
    writePrivate(deviceKeyFile(env), k.privateKeyPem);
    const enrolled = h.v.devices.enroll(h.v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: k.publicKey, policy: seatPolicy({ license: loadLicense({ env: h.env, keys: h.keys }), devices: h.v.devices.list() }) });
    const code = await join([`http://127.0.0.1:${port}`], { token: enrolled.token }, { env });
    assert.equal(code, 0);
    const seat = h.v.bus.roster().seats.find((s) => s.seat === 'claude-code@laptop');
    assert.equal(seat?.device, enrolled.device.id);
    assert.ok(fs.existsSync(remoteFile(env)));
  } finally { h.server.close(); h.v.close(); }
});
