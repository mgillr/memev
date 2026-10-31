// A person vouches for an agent role: memev agentid binds the role to the person, verifies a
// stored binding, and sets one up. Binding and setup are part of Business and Corporate;
// verification is free on every tier.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cleanup } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { command } from '../src/cli/agentid.mjs';
import { exists } from '../src/engine/util.mjs';

after(() => cleanup());

const business = () => ({ state: 'valid', tier: 'business', seats: 3, exp: '2027-01-01' });
const personal = () => ({ state: 'valid', tier: 'personal', seats: 1, exp: '2027-01-01' });
const noLicence = () => ({ state: 'none', reason: 'no licence' });

// A real, unencrypted SSH key, made with the ssh-keygen that is on PATH while the test runs.
function makeSshKey(base, name) {
  const keyPath = path.join(base, name);
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', name, '-q', '-f', keyPath], { stdio: 'ignore' });
  return keyPath;
}

// Run an in-process command and capture what it prints, returning the exit code and the output.
async function capture(fn) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  let code;
  try {
    code = await fn();
  } finally {
    console.log = origLog;
  }
  return { code, out: logs.join('\n') };
}

// Run fn with an empty PATH, so ssh-keygen cannot be found, and restore PATH when it is done.
async function withEmptyPath(fn) {
  const orig = process.env.PATH;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-nopath-'));
  process.env.PATH = empty;
  try {
    return await fn();
  } finally {
    process.env.PATH = orig;
    fs.rmSync(empty, { recursive: true, force: true });
  }
}

const agentsDir = (root) => path.join(root, '.memev', 'keys', 'agents');
const trustDir = (root) => path.join(root, '.memev', 'keys', 'trust');

test('MEM-146 AC01: setup binds a role, verify checks it, and a wrong principal is invalid', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const key = makeSshKey(sb.home, 'principal');
    // setup makes the role key, binds it, and writes the receiver-side trust files
    let r = await capture(() => command('agentid', ['setup', 'worker'], { principal: 'alice', 'ssh-key': key, json: true }, { root: sb.root, env: sb.env, license: business() }));
    assert.equal(r.code, 0, r.out);
    const setup = JSON.parse(r.out);
    assert.equal(setup.ok, true);
    assert.equal(setup.role, 'worker');
    assert.equal(setup.principal, 'alice');
    assert.ok(exists(setup.public_key), 'the role public key is written');
    assert.ok(exists(setup.signature), 'the signature is written');
    assert.ok(exists(setup.allowed_signers), 'the allowed signers file is written');
    // verify with the right principal: the binding holds
    r = await capture(() => command('agentid', ['verify', 'worker'], { principal: 'alice', 'allowed-signers': setup.allowed_signers, json: true }, { root: sb.root, env: sb.env, license: business() }));
    assert.equal(r.code, 0, r.out);
    const bound = JSON.parse(r.out);
    assert.equal(bound.ok, true);
    assert.equal(bound.status, 'bound');
    // verify with the wrong principal: the signature is there but does not verify
    r = await capture(() => command('agentid', ['verify', 'worker'], { principal: 'mallory', 'allowed-signers': setup.allowed_signers, json: true }, { root: sb.root, env: sb.env, license: business() }));
    assert.equal(r.code, 1, r.out);
    const wrong = JSON.parse(r.out);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.status, 'invalid');
  } finally { sb.stop(); }
});

test('MEM-146 AC02: bind and setup refuse on a tier below Business, and verify stays free', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const key = makeSshKey(sb.home, 'principal');
    // bind and setup refuse in one line on Personal and on a no-licence vault, and write nothing
    for (const lic of [personal(), noLicence()]) {
      let r = await capture(() => command('agentid', ['bind', 'worker'], { principal: 'alice', 'ssh-key': key, json: true }, { root: sb.root, env: sb.env, license: lic }));
      assert.equal(r.code, 1, r.out);
      const j = JSON.parse(r.out);
      assert.equal(j.ok, false);
      assert.match(j.error, /Business and Corporate/);
      assert.match(j.error, /memev upgrade/);
      assert.ok(!exists(agentsDir(sb.root)), 'nothing is written on refusal');
      r = await capture(() => command('agentid', ['setup', 'worker'], { principal: 'alice', 'ssh-key': key, json: true }, { root: sb.root, env: sb.env, license: lic }));
      assert.equal(r.code, 1, r.out);
      assert.match(JSON.parse(r.out).error, /memev upgrade/);
      assert.ok(!exists(agentsDir(sb.root)) && !exists(trustDir(sb.root)), 'nothing is written on refusal');
    }
    // verify is free on Personal: it runs and reports the absent binding, with no refusal
    const r = await capture(() => command('agentid', ['verify', 'worker'], { principal: 'alice', 'allowed-signers': path.join(sb.home, 'none'), json: true }, { root: sb.root, env: sb.env, license: personal() }));
    assert.equal(r.code, 1, r.out);
    assert.equal(JSON.parse(r.out).status, 'unbound');
    assert.doesNotMatch(r.out, /Business and Corporate/);
  } finally { sb.stop(); }
});

test('MEM-146 AC03: with no ssh-keygen, bind and setup say OpenSSH is needed, write nothing, and --help still prints', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // a real key, made while ssh-keygen is on PATH, so the only thing missing is the binary itself
    const key = makeSshKey(sb.home, 'principal');
    const bind = await withEmptyPath(() => capture(() => command('agentid', ['bind', 'worker'], { principal: 'alice', 'ssh-key': key }, { root: sb.root, env: sb.env, license: business() })));
    assert.equal(bind.code, 1, bind.out);
    assert.match(bind.out, /OpenSSH 8\.0/);
    assert.ok(!exists(agentsDir(sb.root)), 'nothing is written');
    const setup = await withEmptyPath(() => capture(() => command('agentid', ['setup', 'worker'], { principal: 'alice', 'ssh-key': key, json: true }, { root: sb.root, env: sb.env, license: business() })));
    assert.equal(setup.code, 1, setup.out);
    const j = JSON.parse(setup.out);
    assert.equal(j.ok, false);
    assert.match(j.error, /OpenSSH 8\.0/);
    assert.ok(!exists(agentsDir(sb.root)) && !exists(trustDir(sb.root)), 'nothing is written');
    // --help still prints, with no ssh-keygen on PATH
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-nopath-help-'));
    try {
      const help = sb.run(['agentid', '--help'], { extraEnv: { PATH: empty } });
      assert.equal(help.code, 0, help.out + help.err);
      assert.match(help.out, /agentid/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  } finally { sb.stop(); }
});
