// The owner's signing route refuses, and signs nothing, on each of these. They run the two programs in a small git repository
// of their own, since the route insists on a clean clone, with a stub in place of the red-team gate that answers from a file.
// Not here: the case that signs, which needs a real terminal, the real gate and the real engine, so it is run by hand through
// a pseudo-terminal; and the message after a failed signature, which needs the engine to fail part way.
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
const SIGNABLE = 'a'.repeat(64);
const STUB = `import fs from 'node:fs';\nimport path from 'node:path';\nexport const evaluate = ({ cwd }) => JSON.parse(fs.readFileSync(path.join(cwd, 'gate-answer.json'), 'utf8'));\n`;

function setup({ gate = {}, title = 't', files = {}, request = undefined } = {}) {
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
  const add = (rel, text) => { fs.mkdirSync(path.dirname(path.join(code, rel)), { recursive: true }); fs.writeFileSync(path.join(code, rel), text); };
  for (const f of ['owner-key-preload.mjs', 'owner-sign.mjs']) add(`scripts/sign/${f}`, fs.readFileSync(path.join(repo, 'scripts', 'sign', f)));
  add('src/engine/redteam-gate.mjs', STUB);
  add('gate-answer.json', JSON.stringify({ status: 'SIGNABLE', signable_sha256: SIGNABLE, record: RECORD, reasons: [], ...gate }));
  add(SPEC, JSON.stringify({ title, tasks: [], ...(request === undefined ? {} : { request }) })); add(RECORD, '{}\n');
  for (const [rel, text] of Object.entries(files)) add(rel, text);
  const git = (...a) => execFileSync('/usr/bin/git', ['-C', code, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'one');
  const vault = path.join(home, 'v');
  fs.mkdirSync(path.join(vault, '.memev'), { recursive: true });
  return { home, key, view, kid, code, git, sha: git('rev-parse', 'HEAD'), out: path.join(home, 'log.jsonl'), vault };
}

function flags(s, change = {}) {
  const f = { code: s.code, commit: s.sha, vault: s.vault, spec: SPEC, record: RECORD, signable: SIGNABLE, review: 'test', base: s.sha, out: s.out, go: 'test', ...change };
  return Object.entries(f).filter(([, v]) => v !== null).flatMap(([k, v]) => [`--${k}`, v]);
}

function run(s, { preload = true, kid = s.kid, argv = flags(s), tool = path.join(s.code, 'scripts', 'sign', 'owner-sign.mjs'), env: extra = {}, before = [] } = {}) {
  const env = { ...process.env, HOME: s.home, ...extra };
  for (const k of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_TEST_CONTEXT']) if (!(k in extra)) delete env[k];
  if (kid) env.MEMEV_OWNER_KEY_ID = kid; else delete env.MEMEV_OWNER_KEY_ID;
  const pre = preload ? ['--import', path.join(s.code, 'scripts', 'sign', 'owner-key-preload.mjs')] : [];
  // detached puts the child in a new session with no controlling terminal, so /dev/tty cannot open
  const r = spawnSync(process.execPath, [...before, ...pre, tool, ...argv], { env, encoding: 'utf8', detached: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}

function refused(s, r, words) {
  assert.equal(r.rc, 2, r.out);
  assert.match(r.out, words);
  assert.match(r.out, /Nothing was signed/);
  assert.doesNotMatch(r.out, /Passphrase/, 'it asked for the passphrase');
  assert.equal(fs.existsSync(s.out), false, 'the signing log was written');
  assert.deepEqual(fs.readdirSync(s.vault), ['.memev'], 'the vault was changed');
  assert.deepEqual(fs.readdirSync(path.join(s.vault, '.memev')), [], 'the vault was opened');
  assert.equal(fs.readdirSync(path.dirname(s.key)).some((f) => /contract-ed25519/.test(f)), false, 'a key was made');
}

test('every check passes but there is no terminal: it shows nothing and refuses', { skip }, () => {
  const s = setup(); const r = run(s);
  refused(s, r, /needs your own Terminal/);
  assert.doesNotMatch(r.out, /You are signing/);
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

test('another program loaded beside the key: refused', { skip }, () => {
  const s = setup(); const evil = path.join(s.home, 'evil.mjs');
  fs.writeFileSync(evil, 'console.log("evil loaded");\n');
  for (const r of [
    run(s, { before: ['--import', evil] }),
    run(s, { env: { NODE_OPTIONS: `--import ${evil}` } }),
    run(s, { env: { NODE_PATH: s.home } }),
    run(s, { before: ['--no-warnings'] }),
  ]) { assert.equal(r.rc, 2, r.out); assert.match(r.out, /NODE_OPTIONS is set|NODE_PATH is set|this one --import/); assert.match(r.out, /Nothing was signed/); }
  assert.equal(fs.existsSync(s.out), false);
});

test('no view yet: it is made as an empty file before the prompt, and the run goes on to its next check', { skip }, () => {
  const s = setup(); fs.rmSync(s.view); const r = run(s);
  refused(s, r, /needs your own Terminal/);
  assert.equal(fs.lstatSync(s.view).isFile(), true); assert.equal(fs.lstatSync(s.view).size, 0);
  assert.equal(fs.statSync(s.view).mode & 0o077, 0, 'the view can be read by others');
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

test('a changed tool hidden from git by assume-unchanged or skip-worktree: refused', { skip }, () => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const s = setup(); const tool = 'scripts/sign/owner-sign.mjs';
    s.git('update-index', flag, tool);
    fs.appendFileSync(path.join(s.code, tool), 'console.log("changed tool ran");\n');
    const r = run(s); refused(s, r, /hides files from git/); assert.doesNotMatch(r.out, /changed tool ran/);
  }
});

test('GIT_DIR in the shell does not change what the clone checks see', { skip }, () => {
  const s = setup(); const other = setup();
  fs.writeFileSync(path.join(s.code, SPEC), '{"title":"changed"}\n');
  refused(s, run(s, { env: { GIT_DIR: path.join(other.code, '.git'), GIT_WORK_TREE: other.code } }), /the clone has changes/);
});

test('a base that is no commit, or not behind HEAD: refused', { skip }, () => {
  const s = setup();
  refused(s, run(s, { argv: flags(s, { base: 'd'.repeat(40) }) }), /is not a commit behind/);
  const first = s.sha;
  s.git('checkout', '-qb', 'side'); s.git('commit', '-q', '--allow-empty', '-m', 'side'); const side = s.git('rev-parse', 'HEAD');
  s.git('checkout', '-q', first);
  refused(s, run(s, { argv: flags(s, { commit: first, base: side }) }), /is not a commit behind/);
});

test('the gate does not call it signable: refused, with its reason', { skip }, () => {
  const s = setup({ gate: { status: 'NOT SIGNABLE', reasons: ['head_stale_src: test/x'] } });
  refused(s, run(s), /the gate says NOT SIGNABLE: head_stale_src: test\/x/);
});

test('a gate hash or a record other than the command names: refused', { skip }, () => {
  const s = setup();
  refused(s, run(s, { argv: flags(s, { signable: 'b'.repeat(64) }) }), /the gate judged a+, and the command names b+/);
  const t = setup({ gate: { record: 'contracts/other.json' } });
  refused(t, run(t), /red-team record is contracts\/other\.json/);
});

test('a --vault that is not a vault: refused, and nothing is made there', { skip }, () => {
  const s = setup(); const wrong = path.join(s.home, 'typo');
  refused(s, run(s, { argv: flags(s, { vault: wrong }) }), /is not a vault/);
  assert.equal(fs.existsSync(wrong), false);
});

test('the title is already signed in the vault or the clone, with nothing superseded: refused', { skip }, () => {
  const s = setup();
  fs.mkdirSync(path.join(s.vault, 'contracts', 'signed'), { recursive: true });
  fs.writeFileSync(path.join(s.vault, 'contracts', 'signed', 'k-a.json'), JSON.stringify({ title: 't' }));
  const r = run(s); assert.equal(r.rc, 2, r.out); assert.match(r.out, /signing vault already holds/);
  const t = setup({ files: { 'contracts/signed/k-a.json': JSON.stringify({ title: 't' }) } });
  refused(t, run(t), /clone already holds/);
});

test('a wrong --version, or a superseded contract with another title: refused', { skip }, () => {
  const s = setup({ files: { 'contracts/signed/k-a.json': JSON.stringify({ title: 't', version: 2 }), 'contracts/signed/k-b.json': JSON.stringify({ title: 'other' }) } });
  refused(s, run(s, { argv: flags(s, { supersedes: 'k-a', version: '2' }) }), /--version must be 3/);
  refused(s, run(s, { argv: flags(s, { supersedes: 'k-b', version: '2' }) }), /title is not the spec's title/);
  refused(s, run(s, { argv: flags(s, { supersedes: 'k-c', version: '2' }) }), /not in the clone/);
  assert.match(run(s, { argv: flags(s, { supersedes: 'k-a', version: '3' }) }).out, /needs your own Terminal/);
});

test('a log it cannot write: refused, and no log is made by a refusal', { skip }, () => {
  const s = setup();
  refused(s, run(s, { argv: flags(s, { out: path.join(s.home, 'no-such-folder', 'log.jsonl') }) }), /cannot be written/);
  assert.equal(fs.existsSync(path.join(s.home, 'no-such-folder')), false);
});

test('the tool with no preload stops before it opens a vault, with or without a key id', { skip }, () => {
  const s = setup();
  refused(s, run(s, { preload: false }), /only under the owner key preload/);
  refused(s, run(s, { preload: false, kid: null }), /only under the owner key preload/);
  fs.rmSync(s.view);
  refused(s, run(s, { preload: false }), /only under the owner key preload/);
  assert.equal(fs.existsSync(s.view), false, 'something was made at the view path');
});

test('a request a contract cannot hold: refused before the passphrase, at the number the engine holds to', { skip }, async () => {
  const { REQUEST_MAX } = await import(path.join(repo, 'src', 'engine', 'contracts.mjs'));
  const over = setup({ request: 'x'.repeat(REQUEST_MAX + 1) });
  refused(over, run(over), /request is \d+ characters and a contract holds/);
  const fits = setup({ request: 'x'.repeat(REQUEST_MAX) });
  assert.match(run(fits).out, /needs your own Terminal/);
});

test('the owner key listed in contracts/keys is the Ed25519 key its file name says', { skip }, () => {
  const pub = crypto.createPublicKey(fs.readFileSync(path.join(repo, 'contracts', 'keys', 'c874b62bbaec444b.pub')));
  assert.equal(pub.asymmetricKeyType, 'ed25519');
  assert.equal(crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16), 'c874b62bbaec444b');
});
