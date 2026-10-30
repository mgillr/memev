// MEM-145: human binding of agent roles with OpenSSH signatures.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PKG, tmpdir, cleanup } from './helpers/tmp.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import {
  bindingMessage,
  canAskOnTerminal,
  bindAgentRole,
  verifyAgentBinding,
  setupAgentRole,
  AgentBindError,
} from '../src/engine/agentid-bind.mjs';

after(cleanup);

function makeSshKey(base, name, passphrase = '') {
  const keyPath = path.join(base, name);
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', passphrase, '-C', name, '-q', '-f', keyPath], { stdio: 'ignore' });
  return keyPath;
}

function makeRolePair(agentsDir, role) {
  const { privateKeyPem, publicKey } = deviceKeygen();
  fs.writeFileSync(path.join(agentsDir, role), privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(path.join(agentsDir, role + '.pub'), publicKey + '\n', { mode: 0o644 });
}

function snapshotDir(dir) {
  const files = {};
  if (!fs.existsSync(dir)) return files;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else files[path.relative(dir, p)] = fs.readFileSync(p);
    }
  };
  walk(dir);
  return files;
}

// The armored signature decodes to "SSHSIG", a version, a key-blob length, the key blob (key type,
// key), then the namespace. The namespace is the third string after the header.
function sshsigNamespace(armored) {
  const b64 = armored.split(/\r?\n/).filter((l) => l && !l.startsWith('----')).join('');
  const buf = Buffer.from(b64, 'base64');
  let off = 14;
  const readStr = () => { const len = buf.readUInt32BE(off); off += 4; const s = buf.subarray(off, off + len).toString('latin1'); off += len; return s; };
  readStr(); readStr();
  return readStr();
}

function newAgents() {
  const base = tmpdir();
  const agentsDir = path.join(base, '.memev', 'keys', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  return { base, agentsDir };
}

test('MEM-145 AC01: a person binds a role and it verifies; a wrong principal, a tampered signature and a missing signature do not', () => {
  const { base, agentsDir } = newAgents();
  const sshKeyPath = makeSshKey(base, 'person');
  const role = 'writer';
  makeRolePair(agentsDir, role);
  const principal = 'alice';
  bindAgentRole(role, { sshKeyPath, principal, dir: agentsDir });
  const sshsigPath = path.join(agentsDir, role + '.pub.sshsig');
  const principalPath = path.join(agentsDir, role + '.pub.principal');
  assert.ok(fs.existsSync(sshsigPath), 'the signature is stored beside the role public key');
  assert.ok(fs.existsSync(principalPath), 'the principal is stored beside the role public key');
  assert.equal(fs.readFileSync(principalPath, 'utf8').trim(), principal);
  const allowedSigners = path.join(base, 'allowed_signers');
  const personPub = fs.readFileSync(sshKeyPath + '.pub', 'utf8').trim();
  fs.writeFileSync(allowedSigners, principal + ' ' + personPub + '\n');
  assert.equal(verifyAgentBinding(role, { allowedSigners, principal, dir: agentsDir }), 'bound');
  assert.equal(verifyAgentBinding(role, { allowedSigners, principal: 'bob', dir: agentsDir }), 'invalid', 'a wrong principal is invalid');
  const lines = fs.readFileSync(sshsigPath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 10 && !lines[i].startsWith('----')) { lines[i] = (lines[i][0] === 'A' ? 'B' : 'A') + lines[i].slice(1); break; }
  }
  fs.writeFileSync(sshsigPath, lines.join('\n'));
  assert.equal(verifyAgentBinding(role, { allowedSigners, principal, dir: agentsDir }), 'invalid', 'a tampered signature is invalid');
  const role2 = 'reader';
  fs.writeFileSync(path.join(agentsDir, role2 + '.pub'), 'readerpub\n', { mode: 0o644 });
  assert.equal(verifyAgentBinding(role2, { allowedSigners, principal, dir: agentsDir }), 'unbound', 'a role with no signature is unbound');
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'agentid-bind.mjs'), 'utf8');
  assert.ok(!/from 'node:(net|http|https|dgram|tls)'/ .test(src), 'the round trip imports no network module');
});

test('MEM-145 AC02: the signature carries the namespace memev and a signature made in another namespace is invalid', () => {
  const { base, agentsDir } = newAgents();
  const sshKeyPath = makeSshKey(base, 'person');
  const role = 'writer';
  makeRolePair(agentsDir, role);
  const principal = 'alice';
  bindAgentRole(role, { sshKeyPath, principal, dir: agentsDir });
  const sshsigPath = path.join(agentsDir, role + '.pub.sshsig');
  const armored = fs.readFileSync(sshsigPath, 'utf8');
  const rolePub = fs.readFileSync(path.join(agentsDir, role + '.pub'), 'utf8').trim();
  execFileSync('ssh-keygen', ['-Y', 'check-novalidate', '-n', 'memev', '-s', sshsigPath], { input: bindingMessage(rolePub), encoding: 'utf8', stdio: 'pipe' });
  assert.throws(() => execFileSync('ssh-keygen', ['-Y', 'check-novalidate', '-n', 'other', '-s', sshsigPath], { input: bindingMessage(rolePub), encoding: 'utf8', stdio: 'pipe' }), 'it fails check-novalidate in any other namespace');
  assert.equal(sshsigNamespace(armored), 'memev', 'the armored signature carries the namespace memev');
  const foreign = execFileSync('ssh-keygen', ['-Y', 'sign', '-f', sshKeyPath, '-n', 'other', '-I', principal], { input: bindingMessage(rolePub), encoding: 'utf8' });
  const role2 = 'foreign';
  fs.writeFileSync(path.join(agentsDir, role2 + '.pub'), rolePub + '\n', { mode: 0o644 });
  fs.writeFileSync(path.join(agentsDir, role2 + '.pub.sshsig'), foreign);
  const allowedSigners = path.join(base, 'allowed_signers');
  const personPub = fs.readFileSync(sshKeyPath + '.pub', 'utf8').trim();
  fs.writeFileSync(allowedSigners, principal + ' ' + personPub + '\n');
  assert.equal(verifyAgentBinding(role2, { allowedSigners, principal, dir: agentsDir }), 'invalid', 'a foreign-namespace signature over the same message is invalid');
});

test('MEM-145 AC03: with no ssh-keygen and with a pre-8.0 stand-in, bind and setup fail with one message and the keys directory is untouched', () => {
  const { base, agentsDir } = newAgents();
  const sshKeyPath = makeSshKey(base, 'person');
  const role = 'writer';
  makeRolePair(agentsDir, role);
  const principal = 'alice';
  const trustDir = path.join(base, 'trust');
  fs.mkdirSync(trustDir, { recursive: true });
  const before = snapshotDir(agentsDir);
  const runWith = (pathVal, fn) => {
    const old = process.env.PATH;
    try { process.env.PATH = pathVal; return fn(); } finally { process.env.PATH = old; }
  };
  const want = (e) => e instanceof AgentBindError && e.code === 'openssh' && /OpenSSH 8\.0/.test(e.message);
  const emptyDir = tmpdir('memev-empty-');
  assert.throws(() => runWith(emptyDir, () => bindAgentRole(role, { sshKeyPath, principal, dir: agentsDir })), want, 'bind fails with no ssh-keygen');
  assert.throws(() => runWith(emptyDir, () => setupAgentRole(role, { principal, sshKeyPath, trustDir, dir: agentsDir })), want, 'setup fails with no ssh-keygen');
  assert.deepEqual(snapshotDir(agentsDir), before, 'the keys directory is untouched with no ssh-keygen');
  const standDir = tmpdir('memev-stand-');
  fs.writeFileSync(path.join(standDir, 'ssh-keygen'), '#!/bin/sh\necho "unknown option -- Y" >&2\nexit 255\n', { mode: 0o755 });
  assert.throws(() => runWith(standDir, () => bindAgentRole(role, { sshKeyPath, principal, dir: agentsDir })), want, 'bind fails with a pre-8.0 stand-in');
  assert.throws(() => runWith(standDir, () => setupAgentRole(role, { principal, sshKeyPath, trustDir, dir: agentsDir })), want, 'setup fails with a pre-8.0 stand-in');
  assert.deepEqual(snapshotDir(agentsDir), before, 'the keys directory is untouched with a pre-8.0 stand-in');
});

test('MEM-145 AC04: setupAgentRole is one rollback-safe step that keeps a matching binding and refuses a different one', () => {
  const want = (e) => e instanceof AgentBindError && e.code === 'conflict';
  // A trust directory made read-only after the checks leaves no partial artifact.
  {
    const { base, agentsDir } = newAgents();
    const sshKeyPath = makeSshKey(base, 'person');
    const trustDir = path.join(base, 'trust');
    fs.mkdirSync(trustDir, { recursive: true });
    fs.chmodSync(trustDir, 0o500);
    const beforeAgents = snapshotDir(agentsDir);
    const beforeTrust = snapshotDir(trustDir);
    try {
      assert.throws(() => setupAgentRole('writer', { principal: 'alice', sshKeyPath, trustDir, dir: agentsDir }), AgentBindError, 'a read-only trust directory fails the step');
      assert.deepEqual(snapshotDir(agentsDir), beforeAgents, 'no new key file, signature or principal');
      assert.deepEqual(snapshotDir(trustDir), beforeTrust, 'no new allowed_signers line');
    } finally {
      fs.chmodSync(trustDir, 0o700);
    }
  }
  // A destination that already holds another key's binding is refused and never replaced.
  {
    const { base, agentsDir } = newAgents();
    const keyA = makeSshKey(base, 'personA');
    const keyB = makeSshKey(base, 'personB');
    makeRolePair(agentsDir, 'writer');
    bindAgentRole('writer', { sshKeyPath: keyA, principal: 'alice', dir: agentsDir });
    const trustDir = path.join(base, 'trust');
    fs.mkdirSync(trustDir, { recursive: true });
    const beforeAgents = snapshotDir(agentsDir);
    const beforeTrust = snapshotDir(trustDir);
    assert.throws(() => setupAgentRole('writer', { principal: 'alice', sshKeyPath: keyB, trustDir, dir: agentsDir }), want, 'a different key is refused');
    assert.deepEqual(snapshotDir(agentsDir), beforeAgents, 'the existing binding is never replaced by another key');
    assert.deepEqual(snapshotDir(trustDir), beforeTrust, 'no allowed_signers line for the refused key');
    assert.throws(() => setupAgentRole('writer', { principal: 'bob', sshKeyPath: keyA, trustDir, dir: agentsDir }), want, 'a different principal is refused');
    assert.deepEqual(snapshotDir(agentsDir), beforeAgents, 'the existing binding is never replaced by another principal');
  }
  // An existing binding to the same principal and SSH key is kept.
  {
    const { base, agentsDir } = newAgents();
    const keyA = makeSshKey(base, 'personA');
    makeRolePair(agentsDir, 'writer');
    const trustDir = path.join(base, 'trust');
    fs.mkdirSync(trustDir, { recursive: true });
    assert.equal(setupAgentRole('writer', { principal: 'alice', sshKeyPath: keyA, trustDir, dir: agentsDir }).created, true, 'the first setup creates the binding');
    const beforeAgents = snapshotDir(agentsDir);
    const beforeTrust = snapshotDir(trustDir);
    assert.equal(setupAgentRole('writer', { principal: 'alice', sshKeyPath: keyA, trustDir, dir: agentsDir }).created, false, 'a matching binding is kept');
    assert.deepEqual(snapshotDir(agentsDir), beforeAgents, 'the kept binding is unchanged');
    assert.deepEqual(snapshotDir(trustDir), beforeTrust, 'the trust file is unchanged for a kept binding');
  }
});

test('MEM-145 AC05: the module spawns ssh-keygen only through run and records the donor commit and licence without naming the product', () => {
  const modPath = path.join(PKG, 'src', 'engine', 'agentid-bind.mjs');
  assert.ok(fs.existsSync(modPath), 'the module exists');
  const src = fs.readFileSync(modPath, 'utf8');
  assert.ok(!/child_process/.test(src), 'no direct child_process import');
  assert.ok(/from '\.\/util\.mjs'/.test(src), 'ssh-keygen is reached through run in ./util.mjs');
  assert.ok(src.includes('129f7ad6ff85817908eb3cd395214c4e08f2477f'), 'the header records the donor commit sha');
  assert.ok(/Apache-2\.0/.test(src), 'the header records the donor licence');
});

test('MEM-145 AC06: canAskOnTerminal answers per platform and a protected key with no terminal is refused up front', () => {
  assert.equal(canAskOnTerminal({ platform: 'linux', stdinIsTTY: true }), true, 'a terminal on stdin');
  assert.equal(canAskOnTerminal({ platform: 'linux', stdinIsTTY: false, openTty: () => {} }), true, 'elsewhere a controlling terminal can be opened');
  assert.equal(canAskOnTerminal({ platform: 'linux', stdinIsTTY: false, openTty: () => { throw new Error('no tty'); } }), false, 'elsewhere with no controlling terminal');
  assert.equal(canAskOnTerminal({ platform: 'linux', stdinIsTTY: false }), false, 'elsewhere with no way to open a terminal');
  assert.equal(canAskOnTerminal({ platform: 'win32', stdinIsTTY: true }), true, 'on Windows a console on stdin');
  assert.equal(canAskOnTerminal({ platform: 'win32', stdinIsTTY: false }), false, 'on Windows without a console');
  assert.equal(canAskOnTerminal({ platform: 'win32', stdinIsTTY: false, openTty: () => {} }), false, 'on Windows a controlling terminal does not count');
  const { base, agentsDir } = newAgents();
  const sshKeyPath = makeSshKey(base, 'protected', 'secret');
  makeRolePair(agentsDir, 'writer');
  assert.throws(
    () => bindAgentRole('writer', { sshKeyPath, principal: 'alice', dir: agentsDir, terminal: { platform: 'linux', stdinIsTTY: false, openTty: null } }),
    (e) => e instanceof AgentBindError && e.code === 'no-terminal' && /ssh-agent|unencrypted/.test(e.message),
    'a passphrase-protected key with no terminal is refused up front'
  );
});
