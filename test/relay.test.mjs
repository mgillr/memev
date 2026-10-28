// The relay: a stable address for a vault. The relay client, the protocol and the development relay.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { initVault, Vault } from '../src/engine/vault.mjs';
import { signLicense, loadLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { deviceKeygen, signRequest } from '../src/engine/devices.mjs';
import { createServer } from '../src/server/http.mjs';
import * as client from '../src/cli/relay.mjs';
import { createRelay, idOf as devIdOf, controlMessage as devControl, acceptMessage as devAccept } from '../src/server/relay-dev.mjs';
after(cleanup);

const ID = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };
const DOMAIN = 'relay.test';
const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);
const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
const MEMORY = 'The heron nests beside the old weir and the weir light is green';
const rpc = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

/** A vault with its daemon-side HTTP server, a joined computer and a cloud connector, and a way to restart it all. */
async function rig() {
  const root = path.join(tmpdir(), 'vault'); const keyDir = path.join(root, '..', 'keys');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const conf = tmpdir('relay-conf-');
  fs.writeFileSync(path.join(conf, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_relay029', tier: 'team', services: ['relay'], seats: 3, iat: day(-10), exp: day(300), grace_days: 14 }, vendor.pem, 'test-vendor')));
  const env = { MEMEV_CONFIG_DIR: conf };
  const r = { root, env, v: null, server: null, port: 0, link: null };
  const open = async () => {
    r.v = new Vault(root, { commitDelayMs: 10, fsync: false, keyDir }).open();
    r.server = createServer(r.v, { tunnelKey: () => null, licenseKeys: vendor.keys, env });
    await new Promise((res) => r.server.listen(0, '127.0.0.1', res));
    r.port = r.server.address().port;
  };
  r.stopVault = async () => { r.link?.stop(); r.link = null; await new Promise((res) => { r.server.closeAllConnections?.(); r.server.close(res); }); r.v.close(); };
  await open();
  r.v.remember(ID, { text: MEMORY, kind: 'fact' });
  const policy = () => seatPolicy({ license: loadLicense({ env, keys: vendor.keys }), devices: r.v.devices.list() });
  const key = deviceKeygen();
  r.computer = r.v.devices.enroll(r.v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: key.publicKey, policy: policy() });
  r.connector = r.v.devices.enroll(r.v.tokens, { kind: 'cloud-connector', label: 'cloud app' });
  r.localToken = r.v.tokens.issue({ agent: 'local-app' }).token;
  r.deviceKey = key.privateKeyPem;
  r.restart = async () => { await r.stopVault(); await open(); };
  r.connect = async (relayPort) => { r.link = client.startRelayClient({ root, port: r.port, url: `relay://127.0.0.1:${relayPort}`, domain: DOMAIN }); await r.link.ready; return r.link.address; };
  r.close = async () => { await r.stopVault(); };
  return r;
}
const recall = { query: 'where does the heron nest' };
// a cloud AI app: the connector URL carries its credential
const asConnector = (r, address, relay) => client.relayFetch(address, { relay, method: 'POST', path: `/c/${r.connector.token}/mcp`, headers: { 'user-agent': 'cloud-ai-app' }, body: rpc('memev_recall', recall) });
// another computer: its token, and every request signed with its own device key
const asComputer = (r, address, relay, p = '/mcp', body = rpc('memev_recall', recall)) => {
  const text = JSON.stringify(body);
  return client.relayFetch(address, { relay, method: 'POST', path: p, headers: { authorization: `Bearer ${r.computer.token}`, 'user-agent': 'memev-remote', ...signRequest(r.deviceKey, { method: 'POST', path: p, body: text }) }, body: text });
};
const answers = (res) => res.status === 200 && JSON.stringify(res.json).includes('weir');

test('MEM-029 AC01: through the local dev relay, a joined computer and a cloud connector reach the vault at the same address after the vault restarts', async () => {
  const relay = createRelay(); const rp = await relay.listen(); const at = { host: '127.0.0.1', port: rp };
  const r = await rig();
  try {
    const address = await r.connect(rp);
    assert.match(address, /^https:\/\/[a-z2-7]{32}\.relay\.test$/);
    const port1 = r.port;
    for (const [who, call] of [['cloud connector', asConnector], ['joined computer', asComputer]]) {
      const res = await call(r, address, at); assert.equal(res.status, 200, `${who}: ${res.text}`); assert.ok(answers(res), `${who} recalled the memory`);
    }
    // the vault goes down and comes back, on another port, and connects again
    await r.restart();
    assert.notEqual(r.port, port1, 'the daemon is on another port');
    assert.equal((await asConnector(r, address, at).catch((e) => ({ status: 0, text: e.message }))).status === 200, false, 'while it is down, the name leads nowhere');
    const again = await r.connect(rp);
    assert.equal(again, address, 'the same address');
    for (const [who, call] of [['cloud connector', asConnector], ['joined computer', asComputer]]) {
      const res = await call(r, again, at); assert.equal(res.status, 200, `${who}: ${res.text}`); assert.ok(answers(res), `${who} recalled the memory after the restart`);
    }
    assert.deepEqual(relay.vaults(), [address.slice('https://'.length).split('.')[0]]);
    // a second vault gets its own name
    const other = await rig(); try { assert.notEqual(await other.connect(rp), address); } finally { await other.close(); }
  } finally { await r.close(); await relay.close(); }
});

test('MEM-029 AC02: the relay only forwards: vault tokens are never readable by the relay process', async () => {
  // the relay is a program of its own: it loads nothing of the vault
  const src = fs.readFileSync(path.join(PKG, 'src', 'server', 'relay-dev.mjs'), 'utf8');
  assert.deepEqual([...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort(), ['node:crypto', 'node:net']);
  // everything the relay handles is recorded here: both directions, the control lines, the hello
  const seen = []; const relay = createRelay({ tap: (e) => seen.push(e) }); const rp = await relay.listen(); const at = { host: '127.0.0.1', port: rp };
  const r = await rig();
  try {
    const address = await r.connect(rp);
    const a = await asConnector(r, address, at); const b = await asComputer(r, address, at);
    assert.ok(answers(a) && answers(b), 'the requests worked, through the relay');
    const wire = Buffer.concat(seen.filter((e) => ['in', 'out'].includes(e.dir)).map((e) => e.bytes));
    assert.ok(wire.length > 1000, 'the relay carried real traffic');
    const control = seen.filter((e) => e.dir.startsWith('control')).map((e) => e.bytes.toString('utf8')).join('\n');
    const idn = JSON.parse(fs.readFileSync(client.identityFile(r.root), 'utf8'));
    const secrets = [r.connector.token, r.computer.token, r.localToken, r.connector.token.slice(3, 30), r.computer.token.slice(3, 30), MEMORY, 'weir', 'heron', 'Bearer', 'authorization', 'x-memev-sig', 'x-memev-nonce', 'memev_recall', '/mcp', '/c/', 'jsonrpc', 'cloud-ai-app', 'HTTP/1.1', 'PRIVATE KEY', idn.key.split('\n')[1], r.deviceKey.split('\n')[1]];
    for (const x of secrets) {
      assert.equal(wire.includes(Buffer.from(x)), false, `the relay saw ${x.slice(0, 12)} on the wire`);
      assert.equal(control.includes(x), false, `the relay saw ${x.slice(0, 12)} on its control line`);
    }
    // the only things on its control line are the public key, a nonce, a signature, session ids and addresses
    const kinds = new Set(control.split('\n').filter(Boolean).map((l) => JSON.parse(l).t)); for (const k of kinds) assert.ok(['hello', 'challenge', 'auth', 'ready', 'open', 'accept', 'ok', 'ping', 'pong'].includes(k), k);
    // the SNI is the one thing in the clear: the vault's name, never a token
    assert.ok(wire.includes(Buffer.from(address.slice('https://'.length))));
    // and a stand-in that is not the vault cannot be reached under its name: the client insists on the key the name is made from
    const fake = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const impostor = tls.createServer({ key: fake, cert: client.selfSignedCert({ privateKeyPem: fake, names: [`${idn.id}.${DOMAIN}`] }) }, (c) => c.end('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nhi'));
    impostor.on('tlsClientError', () => {});
    await new Promise((res) => impostor.listen(0, '127.0.0.1', res));
    try { await assert.rejects(client.relayFetch(address, { relay: { host: '127.0.0.1', port: impostor.address().port } }), /did not prove it holds the key/); } finally { impostor.close(); }
  } finally { await r.close(); await relay.close(); }
});

test('MEM-029: what comes through the relay is a remote request, whatever it claims to be', async () => {
  const relay = createRelay(); const rp = await relay.listen(); const at = { host: '127.0.0.1', port: rp };
  const r = await rig();
  try {
    const address = await r.connect(rp);
    const direct = await fetch(`http://127.0.0.1:${r.port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${r.localToken}` }, body: JSON.stringify(rpc('memev_recall', recall)) });
    assert.equal(direct.status, 200, 'a local token works directly on this computer');
    const spoof = (h) => client.relayFetch(address, { relay: at, method: 'POST', path: '/mcp', headers: { authorization: `Bearer ${r.localToken}`, ...h }, body: rpc('memev_recall', recall) });
    for (const h of [{}, { host: '127.0.0.1' }, { host: 'localhost' }, { host: `127.0.0.1:${r.port}` }, { 'x-forwarded-for': '' }]) {
      const res = await spoof(h);
      assert.equal(res.status, 403, JSON.stringify(h)); assert.equal(res.json?.error, 'local_token');
    }
    // the vault tells a caller that is not local nothing but "ok" on its health route
    const health = await client.relayFetch(address, { relay: at, path: '/healthz', headers: { host: 'localhost' } });
    assert.deepEqual(health.json, { ok: true });
    // remote access switched off on the vault is honoured through the relay too
    const c = JSON.parse(fs.readFileSync(path.join(r.root, '.memev', 'config.json'), 'utf8'));
    r.v.config.remote = { ...c.remote, enabled: false };
    assert.equal((await asConnector(r, address, at)).json?.error, 'remote_off');
  } finally { await r.close(); await relay.close(); }
});

test('MEM-029: the name is made from the key, the certificate matches it, and the protocol refuses what is not signed', async () => {
  // one definition of the name and of the signed messages in the client and in the relay
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const spki = publicKey.export({ type: 'spki', format: 'der' });
  assert.equal(client.idOf(spki), devIdOf(spki)); assert.match(client.idOf(spki), /^[a-z2-7]{32}$/);
  assert.deepEqual(client.controlMessage('a', 'n'), devControl('a', 'n')); assert.deepEqual(client.acceptMessage('a', 's'), devAccept('a', 's'));
  // the identity is made once and kept
  const root = path.join(tmpdir(), 'vault'); fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  const one = client.ensureIdentity(root, { domain: DOMAIN }); const two = client.ensureIdentity(root, { domain: DOMAIN });
  assert.equal(one.id, two.id); assert.equal(one.cert, two.cert);
  assert.equal(one.id, client.idOf(client.publicKeyOf(one.key)));
  assert.equal(fs.statSync(client.identityFile(root)).mode & 0o777, 0o600);
  const moved = client.ensureIdentity(root, { domain: 'other.test' }); assert.equal(moved.id, one.id, 'a new domain keeps the name'); assert.notEqual(moved.cert, one.cert);
  // the certificate is a real one for that name, signed by its own key
  const x = new crypto.X509Certificate(one.cert);
  assert.equal(x.checkHost(`${one.id}.${DOMAIN}`), `${one.id}.${DOMAIN}`); assert.equal(x.checkHost(`other.${DOMAIN}`), undefined);
  assert.equal(x.verify(x.publicKey), true); assert.ok(Date.parse(x.validTo) > Date.now() + 86400e3 * 3000);
  await new Promise((resolve, reject) => {
    const s = tls.createServer({ key: one.key, cert: one.cert }, (c) => c.end('hi'));
    s.listen(0, '127.0.0.1', () => {
      const c = tls.connect({ host: '127.0.0.1', port: s.address().port, servername: `${one.id}.${DOMAIN}`, ca: one.cert }, () => { assert.equal(c.authorized, true); c.destroy(); s.close(); resolve(); });
      c.on('error', reject);
    });
  });
  // the relay: a hello that does not sign the challenge never holds a name, and an unknown name leads nowhere
  const relay = createRelay(); const rp = await relay.listen();
  try {
    const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const sock = net.connect(rp, '127.0.0.1'); const got = [];
    sock.on('data', (d) => got.push(...d.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    sock.write(`${JSON.stringify({ t: 'hello', v: 1, pub: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') })}\n`);
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(got[0].t, 'challenge');
    const forged = crypto.sign('sha256', Buffer.from('not the challenge'), key.privateKey).toString('base64');
    sock.write(`${JSON.stringify({ t: 'auth', sig: forged })}\n`);
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(got.at(-1).t, 'error'); assert.deepEqual(relay.vaults(), []);
    const lost = await client.relayFetch(`https://${'a'.repeat(32)}.${DOMAIN}`, { relay: { host: '127.0.0.1', port: rp }, timeoutMs: 1500 }).catch((e) => e);
    assert.ok(lost instanceof Error, 'an unknown name is closed');
    // an accept for a session that does not exist is dropped
    const s2 = net.connect(rp, '127.0.0.1'); let closed = false; s2.on('close', () => { closed = true; });
    s2.write(`${JSON.stringify({ t: 'accept', id: 'x', sid: 'y', sig: 'z' })}\n`);
    await new Promise((res) => setTimeout(res, 150)); assert.equal(closed, true);
  } finally { await relay.close(); }
});

test('MEM-029: the relay is off until the setting says otherwise, and nothing connects while it is off', async () => {
  // a listener that counts connections stands in for a relay
  let conns = 0; const dummy = net.createServer((s) => { conns++; s.destroy(); }); await new Promise((r) => dummy.listen(0, '127.0.0.1', r));
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--no-connect', '--local-only']).code, 0);
    const st = sb.run(['cloud', 'relay', 'status']); assert.equal(st.code, 0); assert.match(st.out, /Relay: off/);
    assert.equal(client.relaySetting(sb.root).enabled, false);
    // the daemon's supervisor with the setting off never dials
    const sup = client.superviseRelay({ config: { remote: { enabled: true } } }, { root: sb.root, port: 1, env: sb.env }); sup.reload();
    await new Promise((r) => setTimeout(r, 200)); sup.stop();
    assert.equal(conns, 0);
    assert.equal(client.relayState(sb.root).state, 'off');
    // on needs a relay address and a domain: none is built in
    assert.equal(sb.run(['cloud', 'relay', 'on']).code, 1);
    assert.equal(sb.run(['cloud', 'relay', 'on', '--url', 'https://relay.example.invalid', '--domain', DOMAIN]).code, 1);
    assert.equal(sb.run(['cloud', 'relay', 'on', '--url', `relay://127.0.0.1:${dummy.address().port}`]).code, 1);
    const on = sb.run(['cloud', 'relay', 'on', '--url', `relay://127.0.0.1:${dummy.address().port}`, '--domain', DOMAIN]);
    assert.equal(on.code, 0, on.out + on.err); assert.match(on.out, /https:\/\/[a-z2-7]{32}\.relay\.test/);
    const addr = sb.run(['cloud', 'relay', 'address']).out.trim(); assert.match(on.out, new RegExp(addr.replace(/\./g, '\\.')));
    assert.equal(client.relaySetting(sb.root).enabled, true);
    assert.equal(sb.run(['cloud', 'relay', 'off']).code, 0); assert.equal(client.relaySetting(sb.root).enabled, false);
    assert.equal(sb.run(['cloud', 'relay', 'address']).out.trim(), addr, 'the address is kept');
  } finally { sb.stop(); dummy.close(); }
});

test('MEM-030-FU: a Personal licence in grace still uses the configured relay address', async () => {
  assert.equal(client.personalActive({ state: 'grace', tier: 'personal' }), true);
  assert.equal(client.personalActive({ state: 'expired', tier: 'personal' }), false);
  const sb = sandbox();
  const url = 'relay://127.0.0.1:9';
  try {
    assert.equal(sb.run(['init', '--no-connect', '--local-only']).code, 0);
    client.setRelay(sb.root, { default_url: url, default_domain: DOMAIN });
    assert.equal(await client.command(['on'], {}, { root: sb.root, env: sb.env, license: { state: 'grace', tier: 'personal' } }), 0);
    assert.equal(client.relaySetting(sb.root).url, url);
    assert.equal(client.relaySetting(sb.root).enabled, true);
  } finally { sb.stop(); }
});

test('MEM-030 AC02: The default relay URL is read from config and the client uses it when Personal is active', async () => {
  const sb = sandbox();
  const url = 'relay://127.0.0.1:9';
  try {
    assert.equal(sb.run(['init', '--no-connect', '--local-only']).code, 0);
    client.setRelay(sb.root, { default_url: url, default_domain: DOMAIN });
    await assert.rejects(() => client.command(['on'], {}, { root: sb.root, env: sb.env, license: { state: 'none', tier: null } }), /no relay is built in/);
    await assert.rejects(() => client.command(['on'], {}, { root: sb.root, env: sb.env, license: { state: 'valid', tier: 'team' } }), /no relay is built in/);
    assert.equal(await client.command(['on'], {}, { root: sb.root, env: sb.env, license: { state: 'valid', tier: 'personal' } }), 0);
    const saved = client.relaySetting(sb.root);
    assert.equal(saved.url, url);
    assert.equal(saved.domain, DOMAIN);
    assert.equal(saved.enabled, true);
    const sup = client.superviseRelay({ config: { remote: { enabled: true, relay: saved } } }, { root: sb.root, port: 1, env: { ...sb.env, MEMEV_NO_TUNNEL: '1' } });
    sup.stop();
    assert.equal(client.relaySetting(sb.root).url, url);
  } finally { sb.stop(); }
});
