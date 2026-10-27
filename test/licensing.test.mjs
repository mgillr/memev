// Licensing: offline licence files, the device registry and seat counting. The free tier (this
// computer, everything on it) must behave exactly as before. The seat cap itself is in seats.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { verifyLicense, signLicense, loadLicense, LICENSE_KEYS, canonical } from '../src/engine/license.mjs';
import { can, report, seatPolicy, PAID_FEATURES, CORE_FEATURES, ENFORCEMENT } from '../src/engine/entitlements.mjs';
import { DeviceRegistry, coarseOrigin, deviceKeygen, signRequest, verifyProof } from '../src/engine/devices.mjs';
import * as OP from '../src/engine/oplog.mjs';
const { OpLog, compareRecords, parseHlc } = OP;
import { createServer } from '../src/server/http.mjs';
import { writerCheck } from '../src/cli/sync.mjs';
import { providers, selectProvider } from '../src/services/providers.mjs';
after(cleanup);

const kp = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; };
const base = { v: 1, lid: 'lic_test0001', tier: 'personal', services: ['sync', 'backup', 'relay'], seats: 4, connectors: 10, iat: '2026-11-01', exp: '2027-11-15', grace_days: 14 };
const DAY = 86400e3;

test('entitlements: core features are free, computers are capped, connectors are only reported', () => {
  for (const f of CORE_FEATURES) assert.equal(can(f), true, f);
  for (const f of PAID_FEATURES) assert.equal(can(f), false, f);
  assert.throws(() => can('nonsense'));
  assert.equal(ENFORCEMENT, 'computers');
  const r = report({ license: null, seats: { computers: 1, connectors: 7, local_clients: 12 } });
  assert.equal(r.blocked, false); assert.equal(r.effective_tier, 'free'); assert.equal(r.seats_licensed, 1);
  assert.equal(r.notes.length, 1); assert.match(r.notes[0], /reported, not limited/);
  const r2 = report({ license: { state: 'valid', tier: 'personal', seats: 4, connectors: 10 }, seats: { computers: 3, connectors: 2, local_clients: 1 } });
  assert.equal(r2.effective_tier, 'personal'); assert.equal(r2.seats_licensed, 4); assert.equal(r2.can_enroll, true); assert.deepEqual(r2.notes, []);
});

test('licence: offline Ed25519 verification, expiry, grace, skew, tampering and unknown keys', () => {
  const k = kp(); const keys = { t1: k.pub };
  const lic = signLicense(base, k.pem, 't1');
  const at = (d) => ({ keys, now: Date.parse(d) });
  assert.equal(verifyLicense(lic, at('2027-01-01')).state, 'valid');
  assert.equal(verifyLicense(lic, at('2027-01-01')).seats, 4);
  assert.equal(verifyLicense(lic, at('2027-11-20')).state, 'grace');
  assert.equal(verifyLicense(lic, at('2027-12-31')).state, 'expired');
  assert.equal(verifyLicense(lic, at('2026-10-31T12:00:00Z')).state, 'valid', 'a day of clock skew is tolerated');
  assert.equal(verifyLicense(lic, at('2026-10-20')).state, 'not_yet_valid');
  assert.equal(verifyLicense({ ...lic, seats: 400 }, at('2027-01-01')).state, 'invalid', 'tampered seats');
  assert.equal(verifyLicense(lic, { keys: { t1: kp().pub }, now: Date.parse('2027-01-01') }).state, 'invalid', 'wrong key');
  assert.equal(verifyLicense({ ...lic, kid: 'nope' }, at('2027-01-01')).state, 'invalid');
  assert.equal(verifyLicense({ ...base, sig: 'x' }, at('2027-01-01')).state, 'invalid');
  const founder = signLicense({ ...base, tier: 'founder', exp: null }, k.pem, 't1');
  assert.equal(verifyLicense(founder, { keys, now: Date.parse('2040-01-01') }).state, 'valid');
  // canonical bytes do not depend on key order
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }).toString(), canonical({ a: { c: 3, d: 2 }, b: 1 }).toString());
  // a licence signed with any other key does not verify against the embedded vendor key
  assert.equal(verifyLicense(lic).state, 'invalid');
  assert.deepEqual(Object.keys(LICENSE_KEYS), ['memev-2026-10']);
  // the loader: no file is the normal free case
  const dir = tmpdir();
  assert.equal(loadLicense({ file: path.join(dir, 'none.json') }).state, 'none');
  fs.writeFileSync(path.join(dir, 'l.json'), JSON.stringify(lic));
  assert.equal(loadLicense({ file: path.join(dir, 'l.json'), keys, now: Date.parse('2027-01-01') }).state, 'valid');
  // no network: the module imports nothing that can reach one
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'license.mjs'), 'utf8');
  assert.doesNotMatch(src, /node:(http|https|net|dns|tls)|fetch\(/);
});

test('dev key script: refuses to write a private key into the repository; signs verifiable licences', () => {
  const r = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'license-dev.mjs'), 'keygen', '--out', path.join(PKG, 'dev-keys')], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /refusing/);
  assert.equal(fs.existsSync(path.join(PKG, 'dev-keys')), false);
  const out = tmpdir();
  const g = JSON.parse(execFileSync(process.execPath, [path.join(PKG, 'scripts', 'license-dev.mjs'), 'keygen', '--out', out], { encoding: 'utf8' }));
  assert.equal((fs.statSync(g.private_key_file).mode & 0o077), 0);
  const lic = JSON.parse(execFileSync(process.execPath, [path.join(PKG, 'scripts', 'license-dev.mjs'), 'sign', '--key', g.private_key_file, '--tier', 'team', '--seats', '6', '--exp', 'none'], { encoding: 'utf8' }));
  assert.equal(verifyLicense(lic, { keys: { [g.kid]: g.public_key } }).state, 'valid');
  assert.match(fs.readFileSync(path.join(PKG, '.gitignore'), 'utf8'), /^\*\.pem$/m);
});

test('devices: enroll, migrate, classify, seats, reuse flag, revoke, rotate, proof of possession', () => {
  const { v } = newVault();
  const reg = v.devices;
  assert.equal(reg.get(v.host.id).kind, 'host');
  const legacy = v.tokens.issue({ agent: 'old-cloud', remote: true, note: 'cloud connector' });
  assert.equal(reg.migrate(v.tokens).find((d) => d.token_id === legacy.id).kind, 'cloud-connector', 'existing tokens become devices');
  const policy = seatPolicy({ license: { state: 'valid', tier: 'team', seats: 10 }, devices: reg.list() });
  const lk = deviceKeygen();
  const laptop = reg.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: lk.publicKey, policy });
  assert.ok(v.tokens.verify(laptop.token).remote);
  // classification
  assert.equal(reg.classify({ local: true }), 'local-client');
  assert.equal(reg.classify({ local: false, userAgent: 'Claude-User (claude.ai)' }), 'cloud-connector');
  assert.equal(reg.classify({ local: false, userAgent: 'node' }), 'remote-computer');
  assert.equal(reg.classify({ local: false, connectorUrl: true, userAgent: 'curl/8' }), 'remote-computer', 'a connector URL pasted into a computer counts as a computer');
  // seats: this computer + one remote computer seen; connectors
  reg.observe({ tokenId: laptop.device.token_id, local: false, ip: '198.51.100.20', userAgent: 'node' });
  reg.observe({ tokenId: legacy.id, local: false, ip: '203.0.113.5', userAgent: 'openai-mcp', connectorUrl: true });
  let s = reg.countSeats();
  assert.equal(s.computers, 2); assert.equal(s.connectors, 1);
  // the same computer credential from a second network within minutes is flagged, never refused
  const r = reg.observe({ tokenId: laptop.device.token_id, local: false, ip: '192.0.2.44', userAgent: 'node' });
  assert.equal(r.class, 'remote-computer');
  assert.ok(reg.get(laptop.device.id).flags.some((f) => f.type === 'reuse'));
  assert.equal(reg.countSeats().flagged.length, 1);
  assert.equal(coarseOrigin('198.51.100.20'), coarseOrigin('198.51.100.99'), 'same /24');
  assert.doesNotMatch(fs.readFileSync(path.join(v.state, 'devices.json'), 'utf8') + JSON.stringify(reg.data), /198\.51|192\.0\.2|203\.0/, 'no address is stored');
  // rotate: new secret, old one dead, reuse flag cleared
  const rot = reg.rotate(v.tokens, laptop.device.id);
  assert.equal(v.tokens.verify(laptop.token), null); assert.ok(v.tokens.verify(rot.token));
  assert.equal(reg.get(laptop.device.id).flags.some((f) => f.type === 'reuse'), false);
  // revoke frees the seat at once
  reg.revoke(v.tokens, laptop.device.id);
  assert.equal(v.tokens.verify(rot.token), null);
  assert.equal(reg.countSeats().computers, 1);
  assert.throws(() => reg.revoke(v.tokens, v.host.id), /host/);
  // seats count only the last 30 days
  const c = reg.enroll(v.tokens, { kind: 'remote-computer', label: 'old box', pubkey: deviceKeygen().publicKey, policy });
  reg.observe({ tokenId: c.device.token_id, local: false, ip: '198.51.100.30', userAgent: 'node' });
  assert.equal(reg.countSeats({ at: Date.now() + 31 * DAY }).computers, 1);
  // proof of possession
  const key = deviceKeygen();
  const signed = reg.enroll(v.tokens, { kind: 'remote-computer', label: 'keyed', pubkey: key.publicKey, policy });
  const h = signRequest(key.privateKeyPem, { method: 'POST', path: '/mcp', body: '{"a":1}' });
  const pr = (o = {}) => ({ method: 'POST', path: '/mcp', ts: h['x-memev-ts'], nonce: h['x-memev-nonce'], sig: h['x-memev-sig'], body: '{"a":1}', ...o });
  assert.equal(verifyProof(key.publicKey, pr()).ok, true);
  assert.equal(verifyProof(key.publicKey, pr({ path: '/v1/recall' })).ok, false, 'another path');
  assert.equal(verifyProof(key.publicKey, pr({ body: '{"a":2}' })).ok, false, 'a changed body');
  assert.equal(verifyProof(deviceKeygen().publicKey, pr()).ok, false, 'another key');
  assert.equal(verifyProof(key.publicKey, pr(), { at: Date.now() + 10 * 60e3 }).ok, false, 'too old');
  reg.observe({ tokenId: signed.device.token_id, local: false, ip: '198.51.100.40', userAgent: 'node' });
  assert.ok(reg.get(signed.device.id).flags.some((f) => f.type === 'unsigned'));
  assert.throws(() => reg.enroll(v.tokens, { kind: 'remote-computer', label: 'bad', pubkey: 'AAAA', policy }));
  assert.throws(() => reg.enroll(v.tokens, { kind: 'remote-computer', label: 'no key', policy }), /device key/);
  v.close();
});

test('HTTP: every request resolves to a device; signed computers are served, unsigned ones are not', async () => {
  const { v } = newVault();
  const server = createServer(v, { tunnelKey: () => null });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const call = (token, ip, extra = {}, ua = 'node') => fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': ua, ...extra }, body }).then((r) => r.status);
  const policy = seatPolicy({ license: { state: 'valid', tier: 'team', seats: 5 }, devices: v.devices.list() });
  const comps = ['a', 'b', 'c'].map((l) => { const k = deviceKeygen(); return { k, ...v.devices.enroll(v.tokens, { kind: 'remote-computer', label: l, pubkey: k.publicKey, policy }) }; });
  const sign = (c) => signRequest(c.k.privateKeyPem, { method: 'POST', path: '/mcp', body });
  for (const [i, c] of comps.entries()) assert.equal(await call(c.token, `198.51.100.${i + 1}`, sign(c)), 200);
  assert.equal(await call(comps[0].token, '192.0.2.9', sign(comps[0])), 200, 'the same computer on another network, with its key');
  assert.equal(await call(comps[0].token, '192.0.2.9'), 401, 'its token without the key');
  assert.equal(await call(comps[0].token, '192.0.2.9', { 'x-memev-ts': String(Date.now()), 'x-memev-nonce': 'ab'.repeat(8), 'x-memev-sig': 'AAAA' }), 401, 'a bad signature');
  const local = v.tokens.issue({ agent: 'claude-code' }).token;
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${local}`, 'content-type': 'application/json' }, body })).status, 200, 'apps on this computer need no key');
  const s = v.devices.countSeats();
  assert.equal(s.computers, 4); assert.equal(s.local_clients >= 1, true);
  assert.equal(v.devices.get(comps[0].device.id).proof, 'ok');
  assert.ok(v.devices.get(comps[0].device.id).flags.some((f) => f.type === 'proof'), 'the refused attempts are recorded');
  server.close(); v.close();
});

test('oplog: device ids and a hybrid logical clock, readable alongside older records', () => {
  const dir = tmpdir();
  // an older log: records written before devices and clocks existed (no dev, no hlc)
  const old = new OpLog(dir, { fsync: false }).open(); old.append({ type: 'put', path: 'a.md', data: { x: 1 } }); old.close();
  const seg = path.join(dir, 'seg-000001.jsonl');
  const stripped = fs.readFileSync(seg, 'utf8').trim().split('\n').map((l) => { const r = JSON.parse(l); delete r.hlc; delete r.dev; delete r.hash; return { ...r, hash: OP.recordHash(r) }; });
  fs.writeFileSync(seg, `${stripped.map((r) => JSON.stringify(r)).join('\n')}\n`);
  fs.rmSync(path.join(dir, 'snapshot.json'), { force: true });
  const log = new OpLog(dir, { fsync: false, deviceId: 'dev_aaaa' }).open();
  const r1 = log.append({ type: 'put', path: 'b.md', data: {} }); const r2 = log.append({ type: 'put', path: 'c.md', data: {} });
  assert.equal(r1.dev, 'dev_aaaa'); assert.ok(parseHlc(r1.hlc)); assert.ok(r2.hlc > r1.hlc, 'clock moves forward');
  assert.deepEqual(log.verify().ok, true, 'old and new records verify together');
  const recs = [...log.iterate()]; assert.equal(recs[0].hlc, undefined); assert.equal(recs.length, 3);
  // the clock never goes back, even if the wall clock does
  const t = log.tick(1); assert.ok(t > r2.hlc);
  log.observeClock('9999999999999.0007'); assert.ok(log.tick() > '9999999999999.0007');
  // deterministic order across devices
  const a = { hlc: '0000000000005.0000', dev: 'dev_b', seq: 1 }, b = { hlc: '0000000000005.0000', dev: 'dev_a', seq: 9 };
  assert.deepEqual([a, b].sort(compareRecords).map((x) => x.dev), ['dev_a', 'dev_b']);
  log.close();
  const again = new OpLog(dir, { fsync: false, deviceId: 'dev_aaaa' }).open();
  assert.ok(again.append({ type: 'put', path: 'd.md', data: {} }).hlc > '9999999999999.0007', 'the clock survives a restart');
  again.close();
});

test('git single-writer: each computer records itself; a second writer gets a warning, never a block', () => {
  const { root, v } = newVault();
  const w1 = writerCheck(v, { root });
  assert.equal(w1.warning, null); assert.equal(w1.writers.length, 1);
  assert.match(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: root, encoding: 'utf8' }), /vault writer/);
  fs.writeFileSync(path.join(root, '.memev-writers', 'dev_other.json'), JSON.stringify({ device: 'dev_other', first: '2026-10-01', last: new Date().toISOString().slice(0, 10) }));
  const w2 = writerCheck(v, { root });
  assert.match(w2.warning, /also push this vault/); assert.match(w2.warning, /Nothing is blocked/);
  fs.writeFileSync(path.join(root, '.memev-writers', 'dev_other.json'), JSON.stringify({ device: 'dev_other', first: '2026-01-01', last: '2026-01-02' }));
  assert.equal(writerCheck(v, { root, at: Date.parse('2026-10-27') }).warning, null, 'a writer gone for 30 days is not counted');
  v.close();
});

test('service providers: free ones are used; hosted ones are listed but never selected', () => {
  const { root, v } = newVault();
  const sync = providers('sync', { root, config: v.config });
  assert.deepEqual(sync.map((p) => p.id), ['git', 'memev-sync']);
  assert.equal(sync.find((p) => p.id === 'memev-sync').ok, false);
  assert.equal(selectProvider('sync', { root, config: v.config }), null, 'no remote yet');
  execFileSync('git', ['remote', 'add', 'origin', path.join(root, '..', 'nowhere.git')], { cwd: root });
  assert.equal(selectProvider('sync', { root, config: { ...v.config, sync: { provider: 'memev-sync' } } }).id, 'git', 'a hosted provider is never chosen');
  assert.equal(selectProvider('remote', { root, config: v.config }).hosted, false);
  assert.deepEqual(providers('backup', { root, config: v.config }).map((p) => p.id), ['git', 'memev-backup']);
  v.close();
});

test('CLI: memev license status and memev devices; the doctor reports seats without failing', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const st = sb.run(['license', 'status']);
    assert.equal(st.code, 0, st.err); assert.match(st.out, /free tier needs none/); assert.match(st.out, /Computers: 1 of 1 enrolled/);
    const nokey = sb.run(['devices', 'enroll', '--kind', 'remote-computer', '--label', 'office-pc']);
    assert.equal(nokey.code, 1); assert.match(nokey.out, /device key/);
    const e = sb.run(['devices', 'enroll', '--kind', 'cloud-connector', '--label', 'chatgpt']);
    assert.equal(e.code, 0, e.err); assert.match(e.out, /mv_[0-9a-f]{8}_/);
    const l = sb.run(['devices']);
    assert.match(l.out, /chatgpt/); assert.match(l.out, /host/); assert.match(l.out, /Computers: 1/);
    const id = /(dev_[0-9a-f]+)\s+cloud-connector/.exec(l.out)[1];
    assert.equal(sb.run(['devices', 'rotate', id]).code, 0);
    assert.equal(sb.run(['devices', 'remove', id]).code, 0);
    assert.match(sb.run(['devices']).out, new RegExp(`x ${id}`));
    const j = JSON.parse(sb.run(['license', 'status', '--json']).out);
    assert.equal(j.blocked, false); assert.equal(j.license.state, 'none');
    const d = JSON.parse(sb.run(['doctor', '--json']).out);
    const c = d.find((x) => x.id === 'license'); assert.equal(c.status, 'ok'); assert.match(c.detail, /free tier/);
    const bad = sb.run(['license', 'install', path.join(PKG, 'package.json')]); assert.equal(bad.code, 1);
  } finally { sb.stop(); }
});
