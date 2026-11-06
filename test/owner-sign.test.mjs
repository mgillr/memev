// The owner's signing route refuses, and signs nothing, on each of these. The case that signs needs a real terminal, so it
// is run by hand through a pseudo-terminal and is not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = path.join(repo, 'scripts', 'sign', 'owner-key-preload.mjs');
const TOOL = path.join(repo, 'scripts', 'sign', 'owner-sign.mjs');
const SPEC = 'contracts/seed-readiness/specs/SR-0.04-receipts-match-signatures.json';
const RECORD = 'contracts/seed-readiness/redteam/SR-0.04.json';
const skip = process.platform === 'win32' ? 'the terminal route is not on Windows yet' : false;

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-sign-'));
  const dir = path.join(home, '.config', 'memev-owner');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'not-a-real-passphrase' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });
  const key = path.join(dir, 'owner-ed25519.pem');
  fs.writeFileSync(key, privateKey, { mode: 0o600 });
  const view = path.join(dir, 'view');
  fs.writeFileSync(view, '', { mode: 0o600 });
  const kid = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  return { home, dir, key, view, kid };
}

function run(s, { preload = true, kid = s.kid } = {}) {
  const env = { ...process.env, HOME: s.home };
  if (kid) env.MEMEV_OWNER_KEY_ID = kid; else delete env.MEMEV_OWNER_KEY_ID;
  const argv = [...(preload ? ['--import', PRELOAD] : []), TOOL, '--code', repo, '--vault', path.join(s.home, 'v'), '--keydir', s.view,
    '--spec', SPEC, '--record', RECORD, '--review', 'test', '--base', '0'.repeat(40), '--out', path.join(s.home, 'log.jsonl'), '--go', 'test'];
  // detached puts the child in a new session with no controlling terminal, so /dev/tty cannot open
  const r = spawnSync(process.execPath, argv, { env, encoding: 'utf8', detached: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}

function signedNothing(s) {
  assert.equal(fs.existsSync(path.join(s.home, 'log.jsonl')), false, 'the signing log was written');
  assert.equal(fs.existsSync(path.join(s.home, 'v', 'contracts', 'signed')), false, 'a signed folder was made');
  assert.equal(fs.statSync(s.view).isFile() && fs.statSync(s.view).size, 0, 'the view is no longer an empty file');
}

test('no terminal: refused', { skip }, () => {
  const s = setup(); const r = run(s);
  assert.equal(r.rc, 2, r.out); assert.match(r.out, /needs your own Terminal/); signedNothing(s);
});

test('the command names no key id: refused before any passphrase', { skip }, () => {
  const s = setup(); const r = run(s, { kid: null });
  assert.equal(r.rc, 2, r.out); assert.match(r.out, /must name your key id/); signedNothing(s);
});

test('a folder at the view path could hold a plaintext key: refused', { skip }, () => {
  const s = setup(); fs.rmSync(s.view); fs.mkdirSync(s.view); const r = run(s);
  assert.equal(r.rc, 2, r.out); assert.match(r.out, /must be an empty file/);
  assert.equal(fs.readdirSync(s.view).length, 0, 'a file appeared in the folder');
});

test('a view file that is not empty: refused', { skip }, () => {
  const s = setup(); fs.writeFileSync(s.view, 'x'); const r = run(s);
  assert.equal(r.rc, 2, r.out); assert.match(r.out, /must be an empty file/);
});

test('a key file others can read: refused', { skip }, () => {
  const s = setup(); fs.chmodSync(s.key, 0o644); const r = run(s);
  assert.equal(r.rc, 2, r.out); assert.match(r.out, /can be read by others/); signedNothing(s);
});

test('a key file that is not encrypted: refused', { skip }, () => {
  const s = setup();
  const { privateKey } = crypto.generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  fs.writeFileSync(s.key, privateKey); const r = run(s);
  assert.equal(r.rc, 2, r.out); assert.match(r.out, /not encrypted/); signedNothing(s);
});

test('the tool with no preload and no key id: refused', { skip }, () => {
  const s = setup(); const r = run(s, { preload: false, kid: null });
  assert.equal(r.rc, 2, r.out); assert.match(r.out, /only under the owner key preload/); signedNothing(s);
});

test('the tool with the preload left off and a key id set: it fails and makes no key', { skip }, () => {
  const s = setup(); const r = run(s, { preload: false });
  assert.notEqual(r.rc, 0, r.out);
  assert.equal(fs.statSync(s.view).isFile(), true, 'the view became a folder');
  assert.equal(fs.statSync(s.view).size, 0);
  assert.doesNotMatch(r.out, /^Signed /m);
  assert.equal(fs.existsSync(path.join(s.home, 'log.jsonl')), false);
});

test('the owner key listed in contracts/keys is the Ed25519 key its file name says', { skip }, () => {
  const pub = crypto.createPublicKey(fs.readFileSync(path.join(repo, 'contracts', 'keys', 'c874b62bbaec444b.pub')));
  assert.equal(pub.asymmetricKeyType, 'ed25519');
  assert.equal(crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16), 'c874b62bbaec444b');
});
