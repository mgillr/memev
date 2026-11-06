// The owner's signing route refuses, and signs nothing, on each of these. They run the two programs in a small git repository
// of their own, since the route insists on a clean clone. The case that signs needs a real terminal and a SIGNABLE spec, so it
// is run by hand through a pseudo-terminal and is not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = process.platform === 'win32' ? 'the terminal route is not on Windows yet' : false;
const SPEC = 'contracts/spec.json'; const RECORD = 'contracts/record.json';

function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'owner-sign-')));
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
  const code = path.join(home, 'clone');
  fs.mkdirSync(path.join(code, 'scripts', 'sign'), { recursive: true });
  fs.mkdirSync(path.join(code, 'contracts'));
  for (const f of ['owner-key-preload.mjs', 'owner-sign.mjs']) fs.copyFileSync(path.join(repo, 'scripts', 'sign', f), path.join(code, 'scripts', 'sign', f));
  fs.writeFileSync(path.join(code, SPEC), '{"title":"t"}\n'); fs.writeFileSync(path.join(code, RECORD), '{}\n');
  const git = (...a) => execFileSync('/usr/bin/git', ['-C', code, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'one');
  const sha = git('rev-parse', 'HEAD');
  return { home, key, view, kid, code, git, sha, out: path.join(home, 'log.jsonl'), vault: path.join(home, 'v') };
}

function flags(s, change = {}) {
  const f = { code: s.code, commit: s.sha, vault: s.vault, spec: SPEC, record: RECORD, signable: 'a'.repeat(64), review: 'test', base: s.sha, out: s.out, go: 'test', ...change };
  return Object.entries(f).filter(([, v]) => v !== null).flatMap(([k, v]) => [`--${k}`, v]);
}

function run(s, { preload = true, kid = s.kid, argv = flags(s), tool = path.join(s.code, 'scripts', 'sign', 'owner-sign.mjs') } = {}) {
  const env = { ...process.env, HOME: s.home };
  if (kid) env.MEMEV_OWNER_KEY_ID = kid; else delete env.MEMEV_OWNER_KEY_ID;
  const pre = preload ? ['--import', path.join(s.code, 'scripts', 'sign', 'owner-key-preload.mjs')] : [];
  // detached puts the child in a new session with no controlling terminal, so /dev/tty cannot open
  const r = spawnSync(process.execPath, [...pre, tool, ...argv], { env, encoding: 'utf8', detached: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}

function refused(s, r, words) {
  assert.equal(r.rc, 2, r.out);
  assert.match(r.out, words);
  assert.match(r.out, /Nothing was signed/);
  assert.doesNotMatch(r.out, /Passphrase/, 'it asked for the passphrase');
  assert.equal(fs.existsSync(s.out), false, 'the signing log was written');
  assert.equal(fs.existsSync(s.vault), false, 'a vault was made');
  assert.equal(fs.readdirSync(path.dirname(s.key)).some((f) => /contract-ed25519/.test(f)), false, 'a key was made');
}

test('every check passes but there is no terminal: refused', { skip }, () => {
  const s = setup(); refused(s, run(s), /needs your own Terminal/);
});

test('a flag given twice: refused, so the screen and the signature cannot differ', { skip }, () => {
  const s = setup();
  refused(s, run(s, { argv: [...flags(s), '--spec', 'other.json'] }), /--spec is given twice/);
  refused(s, run(s, { argv: [...flags(s), '--base', s.sha] }), /--base is given twice/);
});

test('an unknown flag, a flag with no value, a missing flag: refused', { skip }, () => {
  const s = setup();
  refused(s, run(s, { argv: [...flags(s), '--keydir', s.home] }), /--keydir is not a flag/);
  refused(s, run(s, { argv: [...flags(s), '--version'] }), /--version has no value/);
  refused(s, run(s, { argv: flags(s, { commit: null }) }), /must name --commit/);
});

test('the command names no key id: refused', { skip }, () => {
  const s = setup(); refused(s, run(s, { kid: null }), /must name your key id/);
});

test('a folder at the view path could hold a plaintext key: refused', { skip }, () => {
  const s = setup(); fs.rmSync(s.view); fs.mkdirSync(s.view);
  refused(s, run(s), /must be an empty file/);
  assert.equal(fs.readdirSync(s.view).length, 0, 'a file appeared in the folder');
});

test('a view file that is not empty: refused', { skip }, () => {
  const s = setup(); fs.writeFileSync(s.view, 'x'); refused(s, run(s), /must be an empty file/);
});

test('a key file others can read: refused', { skip }, () => {
  const s = setup(); fs.chmodSync(s.key, 0o644); refused(s, run(s), /can be read by others/);
});

test('a key file that is not encrypted: refused', { skip }, () => {
  const s = setup();
  const { privateKey } = crypto.generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  fs.writeFileSync(s.key, privateKey); refused(s, run(s), /not encrypted/);
});

test('any other script under the preload: refused before it could reach the key', { skip }, () => {
  const s = setup(); const other = path.join(s.home, 'other.mjs'); fs.writeFileSync(other, 'console.log("ran");\n');
  const r = run(s, { tool: other }); refused(s, r, /only to the clone's/); assert.doesNotMatch(r.out, /ran/);
});

test('a clone at another commit, or with changes: refused', { skip }, () => {
  const s = setup();
  refused(s, run(s, { argv: flags(s, { commit: '0'.repeat(40) }) }), /the clone is at/);
  fs.writeFileSync(path.join(s.code, SPEC), '{"title":"changed"}\n');
  refused(s, run(s), /the clone has changes/);
});

test('a base that is no commit, or not behind HEAD: refused', { skip }, () => {
  const s = setup();
  refused(s, run(s, { argv: flags(s, { base: 'd'.repeat(40) }) }), /is not a commit behind/);
  const first = s.sha;
  s.git('checkout', '-qb', 'side'); s.git('commit', '-q', '--allow-empty', '-m', 'side'); const side = s.git('rev-parse', 'HEAD');
  s.git('checkout', '-q', first);
  refused(s, run(s, { argv: flags(s, { commit: first, base: side }) }), /is not a commit behind/);
});

test('the tool with no preload stops before it opens a vault, with or without a key id', { skip }, () => {
  const s = setup();
  refused(s, run(s, { preload: false }), /only under the owner key preload/);
  refused(s, run(s, { preload: false, kid: null }), /only under the owner key preload/);
  fs.rmSync(s.view);
  refused(s, run(s, { preload: false }), /only under the owner key preload/);
  assert.equal(fs.existsSync(s.view), false, 'something was made at the view path');
});

test('the owner key listed in contracts/keys is the Ed25519 key its file name says', { skip }, () => {
  const pub = crypto.createPublicKey(fs.readFileSync(path.join(repo, 'contracts', 'keys', 'c874b62bbaec444b.pub')));
  assert.equal(pub.asymmetricKeyType, 'ed25519');
  assert.equal(crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16), 'c874b62bbaec444b');
});
