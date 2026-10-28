// A joined computer follows a signed address record in the git backup, and ignores a bad signature.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers/cli.mjs';
import { cleanup, PKG } from './helpers/tmp.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { git } from '../src/engine/git.mjs';
import { addressKeypair, deviceKeygen } from '../src/engine/devices.mjs';
import { publishAddressRecord } from '../src/cli/sync.mjs';
import { remoteFetch, remoteFile, deviceKeyFile } from '../src/cli/remote.mjs';
import { writePrivate, writePrivateJson } from '../src/engine/util.mjs';

after(() => cleanup());

function listen() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(new URL(req.url, 'http://127.0.0.1').pathname);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function closedUrl() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise((resolve) => server.close(resolve));
  return url;
}

function joined(env, { url, backup, pubkey }) {
  const keyPath = deviceKeyFile(env);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  writePrivate(keyPath, deviceKeygen().privateKeyPem);
  writePrivateJson(remoteFile(env), {
    url, token: 'mv_addr0026_abcdefghijklmnopqrstuvwxyz01', host_pubkey: pubkey, backup, joined: '2026-10-27T00:00:00.000Z',
  });
}

test('MEM-026 AC01: After the host address changes, a joined computer with access to the backup switches to the new address on its next call', async () => {
  const sb = sandbox();
  initVault(sb.root, { template: path.join(PKG, 'templates', 'vault') });
  const pubkey = addressKeypair(sb.root).publicKey;
  const oldUrl = await closedUrl();
  const first = publishAddressRecord(sb.root, oldUrl);
  assert.equal(first.committed, true, 'the first address is in the git backup');
  const moved = await listen();
  try {
    const second = publishAddressRecord(sb.root, moved.url);
    assert.equal(second.committed, true, 'the new address is in the git backup');
    assert.equal(git(sb.root, ['cat-file', '-e', 'HEAD:address.json']).ok, true);
    joined(sb.env, { url: oldUrl, backup: sb.root, pubkey });
    const remote = JSON.parse(fs.readFileSync(remoteFile(sb.env), 'utf8'));
    const r = await remoteFetch(remote, 'mcp', { env: sb.env, timeoutMs: 2000 });
    assert.equal(r.ok, true, r.text);
    assert.ok(moved.hits.includes('/mcp'), `next call reached the new address: ${moved.hits.join(',')}`);
    assert.equal(JSON.parse(fs.readFileSync(remoteFile(sb.env), 'utf8')).url, moved.url);
  } finally {
    moved.server.close();
  }
});

test('MEM-026 AC02: An address record with a bad signature is ignored', async () => {
  const sb = sandbox();
  initVault(sb.root, { template: path.join(PKG, 'templates', 'vault') });
  const pubkey = addressKeypair(sb.root).publicKey;
  const oldUrl = await closedUrl();
  publishAddressRecord(sb.root, oldUrl);
  const moved = await listen();
  try {
    publishAddressRecord(sb.root, moved.url);
    const file = path.join(sb.root, 'address.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec.sig = `ed25519:${'AA'.repeat(32)}`;
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    joined(sb.env, { url: oldUrl, backup: sb.root, pubkey });
    const remote = JSON.parse(fs.readFileSync(remoteFile(sb.env), 'utf8'));
    await assert.rejects(() => remoteFetch(remote, 'mcp', { env: sb.env, timeoutMs: 2000 }));
    assert.equal(moved.hits.length, 0, 'a bad signature was not followed');
    assert.equal(JSON.parse(fs.readFileSync(remoteFile(sb.env), 'utf8')).url, oldUrl);
  } finally {
    moved.server.close();
  }
});

test('MEM-027 AC01: A joined computer whose host moved prints the clear line from the session-start hook', async () => {
  const sb = sandbox();
  // the host moved and this computer has no backup to re-discover from: the saved address is dead
  joined(sb.env, { url: await closedUrl(), backup: null, pubkey: null });
  const r = sb.hook('session-start', { session_id: 's1', cwd: sb.home, source: 'startup' });
  assert.equal(r.code, 0, r.out + r.err);
  const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /vault address changed/);
  assert.match(ctx, /memev join --refresh/);
});

test('MEM-027 AC02: memev join --refresh updates the stored address and the next call succeeds', async () => {
  const sb = sandbox();
  initVault(sb.root, { template: path.join(PKG, 'templates', 'vault') });
  const pubkey = addressKeypair(sb.root).publicKey;
  const oldUrl = await closedUrl();
  publishAddressRecord(sb.root, oldUrl);
  const moved = await listen();
  try {
    publishAddressRecord(sb.root, moved.url);
    joined(sb.env, { url: oldUrl, backup: sb.root, pubkey });
    const r = await sb.runAsync(['join', '--refresh']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /vault address updated to/);
    assert.equal(JSON.parse(fs.readFileSync(remoteFile(sb.env), 'utf8')).url, moved.url);
    const remote = JSON.parse(fs.readFileSync(remoteFile(sb.env), 'utf8'));
    const call = await remoteFetch(remote, 'mcp', { env: sb.env, timeoutMs: 2000 });
    assert.equal(call.ok, true, call.text);
    assert.ok(moved.hits.includes('/mcp'), 'the next call reached the new address');
  } finally {
    moved.server.close();
  }
});
