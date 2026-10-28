// A joined computer follows a signed address record in the git backup, and ignores a bad signature.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers/cli.mjs';
import { cleanup, PKG, tmpdir } from './helpers/tmp.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { git } from '../src/engine/git.mjs';
import { addressKeypair, deviceKeygen, mintInvite, decodeInvite } from '../src/engine/devices.mjs';
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

// A vault whose git backup is a bare repository, so the invite records the backup as that remote's
// address, the way it does for a real computer (git remote get-url origin), not as a checkout.
function vaultWithBareBackup() {
  const sb = sandbox();
  initVault(sb.root, { template: path.join(PKG, 'templates', 'vault') });
  const bare = path.join(tmpdir(), 'backup.git');
  assert.ok(git(sb.root, ['init', '-q', '--bare', bare]).ok, 'bare backup');
  assert.ok(git(sb.root, ['remote', 'add', 'origin', bare]).ok, 'origin');
  return { sb, bare, pubkey: addressKeypair(sb.root).publicKey };
}
// Write the signed address record and push it to the backup, as the vault's sync does. The bare
// repository's HEAD then names the vault's branch, as a hosted repository's default branch would.
const pushRecord = (sb, url) => {
  publishAddressRecord(sb.root, url);
  const ok = git(sb.root, ['push', '-q', 'origin', 'HEAD']).ok;
  const branch = git(sb.root, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const bare = git(sb.root, ['remote', 'get-url', 'origin']).out;
  git(bare, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  return ok;
};

test('MEM-027 AC01: A joined computer whose host moved prints the clear line from the session-start hook', async () => {
  const { sb, pubkey } = vaultWithBareBackup();
  const oldUrl = await closedUrl();
  assert.ok(pushRecord(sb, oldUrl));
  const backup = decodeInvite(mintInvite(sb.root, { address: oldUrl }).code).backup;
  const m = sandbox(); // the member computer: no vault of its own
  joined(m.env, { url: oldUrl, backup, pubkey });
  const r = m.hook('session-start', { session_id: 's1', cwd: m.home, source: 'startup' });
  assert.equal(r.code, 0, r.out + r.err);
  const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /vault address changed/);
  assert.match(ctx, /memev join --refresh/);
});

test('MEM-027 AC01: With no signed address record, the hook names a new invite and not join --refresh', async () => {
  const m = sandbox();
  joined(m.env, { url: await closedUrl(), backup: null, pubkey: null });
  const r = m.hook('session-start', { session_id: 's1', cwd: m.home, source: 'startup' });
  assert.equal(r.code, 0, r.out + r.err);
  const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /memev invite/);
  assert.match(ctx, /memev join <code>/);
  assert.doesNotMatch(ctx, /join --refresh/);
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

test('MEM-027 AC02: memev join --refresh fetches the signed record from a backup recorded as an invite records it', async () => {
  const { sb, bare, pubkey } = vaultWithBareBackup();
  const oldUrl = await closedUrl();
  assert.ok(pushRecord(sb, oldUrl));
  const backup = decodeInvite(mintInvite(sb.root, { address: oldUrl }).code).backup;
  assert.equal(backup, bare, 'the invite records the backup as the remote address, not a checkout');
  const m = sandbox();
  joined(m.env, { url: oldUrl, backup, pubkey });
  const moved = await listen();
  try {
    assert.ok(pushRecord(sb, moved.url), 'the vault pushes its new address to the backup');
    const r = await m.runAsync(['join', '--refresh']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /vault address updated to/);
    assert.equal(JSON.parse(fs.readFileSync(remoteFile(m.env), 'utf8')).url, moved.url);
    assert.ok(moved.hits.includes('/mcp'), 'the check reached the new address');
  } finally {
    moved.server.close();
  }
});

test('MEM-027 AC02: A record in the backup signed by another key is not used', async () => {
  const { sb, bare } = vaultWithBareBackup();
  const otherVault = sandbox();
  initVault(otherVault.root, { template: path.join(PKG, 'templates', 'vault') });
  const oldUrl = await closedUrl();
  assert.ok(pushRecord(sb, 'http://127.0.0.1:9'));
  const m = sandbox();
  joined(m.env, { url: oldUrl, backup: bare, pubkey: addressKeypair(otherVault.root).publicKey });
  const r = await m.runAsync(['join', '--refresh']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /not signed by this vault's key/);
  assert.equal(JSON.parse(fs.readFileSync(remoteFile(m.env), 'utf8')).url, oldUrl, 'nothing changed');
});

test('MEM-027 AC02: With no signed address record, join --refresh names a new invite and never itself', async () => {
  const m = sandbox();
  joined(m.env, { url: await closedUrl(), backup: null, pubkey: null });
  const r = await m.runAsync(['join', '--refresh']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /memev invite/);
  assert.match(r.out, /memev join <code>/);
  assert.doesNotMatch(r.out + r.err, /join --refresh/);
});

test('MEM-027 AC02: A backup this computer cannot read is reported, with the way to recover', async () => {
  const { sb, pubkey } = vaultWithBareBackup();
  void sb;
  const m = sandbox();
  joined(m.env, { url: await closedUrl(), backup: path.join(tmpdir(), 'no-such-backup.git'), pubkey });
  const r = await m.runAsync(['join', '--refresh']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /could not read the address record from the backup/);
  assert.match(r.out, /memev invite/);
});

test('MEM-027: A first join to an address that does not answer says no answer, with no moved advice', async () => {
  const m = sandbox();
  const keyPath = deviceKeyFile(m.env);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  writePrivate(keyPath, deviceKeygen().privateKeyPem);
  const url = await closedUrl();
  const r = await m.runAsync(['join', url, '--token', 'mv_addr0027_abcdefghijklmnopqrstuvwxyz01', '--no-connect']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.ok(r.out.includes(`no answer at ${url}`), r.out);
  assert.doesNotMatch(r.out + r.err, /join --refresh|address changed/);
});
