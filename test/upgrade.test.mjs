// SPDX-License-Identifier: Apache-2.0
// `memev upgrade` lists the plans and how to buy, and `memev plan` shows the usage of this vault.
// Neither text ever goes into the AI context, and upgrade makes no network call.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { signLicense, verifyLicense } from '../src/engine/license.mjs';
import { PLANS, TIERS, seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { command } from '../src/cli/upgrade.mjs';
import { renderCard, PROTOCOL, PROTOCOL_POINTER } from '../src/engine/card.mjs';

after(cleanup);

const DAY = 86400e3;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
const capture = async (fn) => { const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' ')); try { await fn(); } finally { console.log = orig; } return lines.join('\n'); };

test('MEM-068 AC01: memev plan prints computers used and allowed and connectors counted', async () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const p = sb.run(['plan']);
    assert.equal(p.code, 0, p.err);
    assert.match(p.out, /Plan: free \(no licence/);
    assert.match(p.out, /Computers: 1 used of 1 allowed/);
    assert.match(p.out, /Cloud connectors: 0 counted/);
  } finally { sb.stop(); }
  // a licensed vault: the allowed count is the licence's seats, and a seen connector is counted
  const { root, v } = newVault();
  const lic = verifyLicense(signLicense({ v: 1, lid: 'lic_plan068', tier: 'personal', services: [], seats: 3, iat: day(-1), exp: day(30) }, vendor.pem, 'test-vendor'), { keys: vendor.keys });
  const k = deviceKeygen();
  v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: k.publicKey, policy: seatPolicy({ license: lic, devices: v.devices.list() }) });
  const c = v.devices.enroll(v.tokens, { kind: 'cloud-connector', label: 'connector' });
  const cd = v.devices.get(c.device.id); cd.last_seen = new Date().toISOString(); v.devices.save();
  const card = renderCard(v.sessionStart(OWNER, { task: 'which plan is this vault on' }));
  v.close();
  const out = await capture(() => command('plan', [], {}, { root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') }, license: lic }));
  assert.match(out, /Plan: personal \(licence lic_plan068: valid\)/);
  assert.match(out, /Computers: 2 used of 3 allowed/);
  assert.match(out, /Cloud connectors: 1 counted/);
  // the AI context (resume card and protocol) never carries the plan usage text
  assert.doesNotMatch(card, /Plan: free|Plan: personal|used of \d+ allowed|counted \(not limited\)/);
  assert.doesNotMatch(PROTOCOL + PROTOCOL_POINTER, /Plan: free|used of \d+ allowed|counted \(not limited\)/);
});

test('MEM-068 AC02: memev upgrade prints Personal as one computer at a time through your own GitHub and the paid difference as several computers at once with automatic merge from a separately licensed engine, prints no trial command, and makes no network call', async () => {
  const src = fs.readFileSync(path.join(PKG, 'src', 'cli', 'upgrade.mjs'), 'utf8');
  assert.doesNotMatch(src, /node:(http|https|net|dns|tls)|fetch\(/);
  const calls = [];
  const realFetch = globalThis.fetch;
  const realConnect = net.Socket.prototype.connect;
  const realRequest = http.request; const realRequestS = https.request;
  globalThis.fetch = async () => { calls.push('fetch'); throw new Error('no network in this test'); };
  net.Socket.prototype.connect = function (...a) { calls.push('connect'); return realConnect.apply(this, a); };
  http.request = () => { calls.push('http.request'); throw new Error('no network in this test'); };
  https.request = () => { calls.push('https.request'); throw new Error('no network in this test'); };
  try {
    const { root, v } = newVault();
    const card = renderCard(v.sessionStart(OWNER, { task: 'how do I upgrade this vault' }));
    v.close();
    const out = await capture(() => command('upgrade', [], {}, { root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') } }));
    assert.match(out, /Plans \(draft/);
    for (const p of PLANS) assert.match(out, new RegExp(`\\b${p.name}\\b`));
    assert.match(out, /1 computer at a time through your own GitHub/);
    assert.match(out, /several computers at once/);
    assert.match(out, /automatic merge from a separately licensed engine/);
    assert.match(out, /memev license activate <key>/);
    assert.doesNotMatch(out, /trial/i);
    // the comms bus and multi-app memory are never shown as the paid difference
    for (const line of out.split('\n')) if (/(comms bus|multi-app memory|one memory)/i.test(line)) assert.doesNotMatch(line, /paid|adds|difference/i);
    // the AI context (resume card and protocol) never carries the plans text
    assert.doesNotMatch(card, /Plans \(draft|several computers at once/);
    assert.doesNotMatch(PROTOCOL + PROTOCOL_POINTER, /Plans \(draft|several computers at once/);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = realFetch;
    net.Socket.prototype.connect = realConnect;
    http.request = realRequest; https.request = realRequestS;
  }
});

test('MEM-068: every computer and connector number the plans show equals the TIERS value', async () => {
  const { root, v } = newVault();
  v.close();
  const out = await capture(() => command('upgrade', [], {}, { root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') } }));
  for (const p of PLANS) {
    const line = out.split('\n').find((l) => l.trim().startsWith(p.name) && l.includes(p.adds));
    assert.ok(line, `plan line for ${p.name}`);
    const tier = TIERS[p.tier];
    const comp = line.match(/(\d+)\s+computers?/);
    const conn = line.match(/(\d+)\s+cloud connectors?/);
    if (comp) assert.equal(Number(comp[1]), tier.computers, `${p.name} computer count`);
    else assert.equal(tier.computers, null, `${p.name} shows a computer count TIERS leaves null`);
    if (conn) assert.equal(Number(conn[1]), tier.connectors, `${p.name} connector count`);
    else assert.equal(tier.connectors, null, `${p.name} shows a connector count TIERS leaves null`);
  }
});

test('MEM-068 AC09: memev upgrade and memev plan output carries no trial string and claims no bus or multi-app memory as paid', async () => {
  const { root, v } = newVault();
  v.close();
  const up = await capture(() => command('upgrade', [], {}, { root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') } }));
  const pl = await capture(() => command('plan', [], {}, { root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') } }));
  // a licensed vault
  const { root: root2, v: v2 } = newVault();
  const lic = verifyLicense(signLicense({ v: 1, lid: 'lic_plan068b', tier: 'personal', services: [], seats: 3, iat: day(-1), exp: day(30) }, vendor.pem, 'test-vendor'), { keys: vendor.keys });
  v2.close();
  const pl2 = await capture(() => command('plan', [], {}, { root: root2, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') }, license: lic }));
  // with a checkout URL, upgrade prints only that URL
  const cfgFile = path.join(root, '.memev', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.checkout = { url: 'https://pay.example/plan068' };
  fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);
  const upUrl = await capture(() => command('upgrade', [], {}, { root, env: { MEMEV_CONFIG_DIR: tmpdir('conf-') } }));
  assert.equal(upUrl, 'https://pay.example/plan068');
  for (const out of [up, pl, pl2, upUrl]) {
    assert.doesNotMatch(out, /trial/i);
    for (const line of out.split('\n')) if (/(comms bus|multi-app memory|one memory)/i.test(line)) assert.doesNotMatch(line, /paid|adds|difference/i);
  }
});
