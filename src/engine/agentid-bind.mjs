// SPDX-License-Identifier: Apache-2.0
// Human binding of agent roles: a person vouches for an agent role, verifiably and offline, with the
// OpenSSH standard (ssh-keygen -Y sign and verify, an allowed_signers file). Ported from public
// commit 129f7ad6ff85817908eb3cd395214c4e08f2477f, which is Apache-2.0 licensed. The signature
// namespace is memev. Every ssh-keygen call goes through run() in ./util.mjs with a timeout: no
// shell, and the message goes over stdin, never in the argument list.
// What a binding vouches for: that the person holding the SSH key, under one principal, vouched for
// one role name and that role's public key. The signed message names all three, so a binding does
// not carry over to another role name, another principal or another key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run, writeAtomic, writePrivate, exists } from './util.mjs';
import { deviceKeygen } from './devices.mjs';

export const NAMESPACE = 'memev';
const SIG_TIMEOUT_MS = 10000;

export class AgentBindError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'AgentBindError';
  }
}

// The message a person signs when they bind a role: it names the role, the principal and the role's
// public key, so a signature is only valid for that role under that principal. Copying a bound role's
// files under another role name does not verify. The first line versions the format.
export const BINDING_FORMAT = 'memev-agent-binding v1';
export function bindingMessage(role, principal, publicKey) {
  return `${BINDING_FORMAT}\nrole: ${role}\nprincipal: ${principal}\npublic-key: ${String(publicKey).trim()}\n`;
}

// A principal is one exact allowed_signers entry. It may use letters, digits and . _ @ + -, and it
// never starts with a dash, so it can never be read as an option to ssh-keygen -I.
export function checkPrincipal(p) {
  const s = String(p ?? '');
  if (!s || s.startsWith('-') || !/^[A-Za-z0-9._@+-]+$/.test(s)) {
    throw new AgentBindError('bad-principal', 'a principal may use letters, digits and . _ @ + -, and must not start with a dash');
  }
  return s;
}

// A role is one plain file name in the agents directory: letters, digits and . _ -, never a leading
// dot or dash and never a slash, so its files cannot land outside the directory or read as an option.
export function checkRole(r) {
  const s = String(r ?? '');
  if (!s || s.startsWith('.') || s.startsWith('-') || !/^[A-Za-z0-9._-]+$/.test(s)) {
    throw new AgentBindError('bad-role', 'a role may use letters, digits and . _ -, and must not start with a dot or a dash');
  }
  return s;
}

// Whether a passphrase prompt could actually be answered: a terminal on stdin; on Windows only when
// stdin is a console; elsewhere when a controlling terminal can be opened.
export function canAskOnTerminal({ platform, stdinIsTTY, openTty } = {}) {
  if (platform === 'win32') return !!stdinIsTTY;
  if (stdinIsTTY) return true;
  if (typeof openTty === 'function') {
    try { openTty(); return true; } catch { return false; }
  }
  return false;
}

// True when a private key file is passphrase protected, so a prompt would be needed to use it.
function isEncryptedKey(content) {
  const s = String(content);
  if (s.includes('BEGIN') && /Proc-Type:\s*4,ENCRYPTED/i.test(s)) return true;
  if (s.includes('OPENSSH PRIVATE KEY')) {
    try {
      const b64 = s.split(/\r?\n/).filter((l) => !l.startsWith('-----')).join('');
      const buf = Buffer.from(b64, 'base64');
      if (buf.length < 19 || buf.subarray(0, 14).toString('latin1') !== 'openssh-key-v1') return false;
      const len = buf.readUInt32BE(15);
      if (19 + len > buf.length) return false;
      return buf.subarray(19, 19 + len).toString('latin1') !== 'none';
    } catch { return false; }
  }
  return false;
}

// OpenSSH before 8.0 has no -Y. Run it in a way that only an old binary answers with an option
// error; a missing binary reports its own error. Either way the keys directory is left untouched.
function requireOpenSSH() {
  const r = run('ssh-keygen', ['-Y', 'check-novalidate', '-n', NAMESPACE, '-s', '/dev/null'], { timeout: SIG_TIMEOUT_MS });
  if (r.error || /unknown option|invalid option|illegal option/i.test(r.stderr)) {
    throw new AgentBindError('openssh', 'binding needs OpenSSH 8.0 or later');
  }
}

function signMessage(message, sshKeyPath, principal) {
  const r = run('ssh-keygen', ['-Y', 'sign', '-f', sshKeyPath, '-n', NAMESPACE, '-I', principal], { timeout: SIG_TIMEOUT_MS, input: message });
  if (r.error) throw new AgentBindError('sign-failed', 'could not run ssh-keygen to sign the binding');
  if (!r.ok) throw new AgentBindError('sign-failed', 'could not sign the binding: ' + (r.stderr.trim() || 'ssh-keygen failed'));
  return r.stdout;
}

function sshPublicKey(sshKeyPath) {
  const pubPath = sshKeyPath + '.pub';
  if (exists(pubPath)) return fs.readFileSync(pubPath, 'utf8').trim();
  const r = run('ssh-keygen', ['-y', '-f', sshKeyPath], { timeout: SIG_TIMEOUT_MS });
  if (!r.ok) throw new AgentBindError('no-ssh-key', 'cannot read the public key for ' + path.basename(sshKeyPath));
  return r.stdout.trim();
}

function ensureAgentsDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
}

// Refuse to replace an existing binding. Returns 'none' when there is no binding, 'same' when the
// existing binding is to the same principal and SSH key, and throws on any other binding.
function checkExistingBinding(role, principal, personPub, dir) {
  const sshsigPath = path.join(dir, role + '.pub.sshsig');
  if (!exists(sshsigPath)) return 'none';
  const rolePubPath = path.join(dir, role + '.pub');
  if (!exists(rolePubPath)) throw new AgentBindError('conflict', 'the role public key is missing, so the existing binding cannot be checked');
  const principalPath = path.join(dir, role + '.pub.principal');
  const existingPrincipal = exists(principalPath) ? fs.readFileSync(principalPath, 'utf8').trim() : '';
  if (existingPrincipal !== principal) throw new AgentBindError('conflict', 'this role is already bound to a different principal');
  const rolePub = fs.readFileSync(rolePubPath, 'utf8').trim();
  const message = bindingMessage(role, principal, rolePub);
  const tmpAllowed = path.join(os.tmpdir(), `memev-allowed-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmpAllowed, principal + ' ' + personPub + '\n');
  try {
    const r = run('ssh-keygen', ['-Y', 'verify', '-f', tmpAllowed, '-I', principal, '-n', NAMESPACE, '-s', sshsigPath], { timeout: SIG_TIMEOUT_MS, input: message });
    if (r.ok) return 'same';
    throw new AgentBindError('conflict', 'this role is already bound to a different SSH key');
  } finally {
    try { fs.unlinkSync(tmpAllowed); } catch {}
  }
}

function noTerminalRefusal() {
  return new AgentBindError('no-terminal', 'this SSH key is passphrase-protected and there is no terminal to ask for it; use an unencrypted key or add the key to ssh-agent');
}

// A person signs the role's public key with their own SSH key. The signature and the principal are
// stored beside the role's public key, under the vault's agents directory.
export function bindAgentRole(role, { sshKeyPath, principal, dir, terminal } = {}) {
  role = checkRole(role);
  const p = checkPrincipal(principal);
  if (!exists(sshKeyPath)) throw new AgentBindError('no-ssh-key', 'SSH key not found: ' + path.basename(sshKeyPath));
  requireOpenSSH();
  const canAsk = canAskOnTerminal(terminal ?? defaultTerminal());
  if (isEncryptedKey(fs.readFileSync(sshKeyPath, 'utf8')) && !canAsk) throw noTerminalRefusal();
  ensureAgentsDir(dir);
  const rolePubPath = path.join(dir, role + '.pub');
  if (!exists(rolePubPath)) throw new AgentBindError('no-role-key', 'the role public key is missing: ' + role + '.pub');
  const rolePub = fs.readFileSync(rolePubPath, 'utf8').trim();
  const sig = signMessage(bindingMessage(role, p, rolePub), sshKeyPath, p);
  const sshsigPath = path.join(dir, role + '.pub.sshsig');
  const principalPath = path.join(dir, role + '.pub.principal');
  writeAtomic(sshsigPath, sig, 0o644);
  writeAtomic(principalPath, p + '\n', 0o644);
  return { role, principal: p, sshsig: sshsigPath };
}

// Check a stored binding against an allowed_signers file. Reports 'bound' when it verifies,
// 'unbound' when there is no signature, and 'invalid' when the signature is there but does not
// verify (wrong principal, tampered signature, or a signature from another namespace).
export function verifyAgentBinding(role, { allowedSigners, principal, dir } = {}) {
  let p;
  try { role = checkRole(role); p = checkPrincipal(principal); } catch { return 'invalid'; }
  const sshsigPath = path.join(dir, role + '.pub.sshsig');
  if (!exists(sshsigPath)) return 'unbound';
  const rolePubPath = path.join(dir, role + '.pub');
  if (!exists(rolePubPath)) return 'invalid';
  const rolePub = fs.readFileSync(rolePubPath, 'utf8').trim();
  const r = run('ssh-keygen', ['-Y', 'verify', '-f', allowedSigners, '-I', p, '-n', NAMESPACE, '-s', sshsigPath], { timeout: SIG_TIMEOUT_MS, input: bindingMessage(role, p, rolePub) });
  return r.ok ? 'bound' : 'invalid';
}

// One checked, rollback-safe step: create the role key pair when absent, bind it to the person, and
// record the receiver-side trust line. Every prerequisite is checked before anything is written,
// and a failure mid-way leaves the directory exactly as it was: every file the step wrote gets its
// previous bytes back or is removed, and every directory the step made is removed.
export function setupAgentRole(role, { principal, sshKeyPath, trustDir, dir, terminal } = {}) {
  role = checkRole(role);
  const p = checkPrincipal(principal);
  if (!exists(sshKeyPath)) throw new AgentBindError('no-ssh-key', 'SSH key not found: ' + path.basename(sshKeyPath));
  requireOpenSSH();
  const canAsk = canAskOnTerminal(terminal ?? defaultTerminal());
  if (isEncryptedKey(fs.readFileSync(sshKeyPath, 'utf8')) && !canAsk) throw noTerminalRefusal();
  const personPub = sshPublicKey(sshKeyPath);
  const existing = checkExistingBinding(role, p, personPub, dir);
  if (existing === 'same') return { role, principal: p, created: false };
  const madeDirs = [...missingDirs(dir), ...missingDirs(trustDir)];
  const undo = [];
  const put = (file, data, mode) => {
    const prev = exists(file) ? { bytes: fs.readFileSync(file), mode: fs.statSync(file).mode & 0o777 } : null;
    undo.push({ file, prev });
    if (mode === 0o600) writePrivate(file, data);
    else writeAtomic(file, data, mode);
  };
  try {
    ensureAgentsDir(dir);
    const roleKeyPath = path.join(dir, role);
    const rolePubPath = path.join(dir, role + '.pub');
    if (!exists(roleKeyPath) || !exists(rolePubPath)) {
      const { privateKeyPem, publicKey } = deviceKeygen();
      put(roleKeyPath, privateKeyPem, 0o600);
      put(rolePubPath, publicKey + '\n', 0o644);
    }
    const rolePub = fs.readFileSync(rolePubPath, 'utf8').trim();
    const sig = signMessage(bindingMessage(role, p, rolePub), sshKeyPath, p);
    put(path.join(dir, role + '.pub.sshsig'), sig, 0o644);
    put(path.join(dir, role + '.pub.principal'), p + '\n', 0o644);
    const allowedPath = path.join(trustDir, 'allowed_signers');
    const allowed = exists(allowedPath) ? fs.readFileSync(allowedPath, 'utf8') : '';
    const line = p + ' ' + personPub + '\n';
    if (!allowed.includes(line)) put(allowedPath, allowed + line, 0o644);
    return { role, principal: p, created: true };
  } catch (e) {
    for (const { file, prev } of undo.reverse()) {
      try { if (prev) writeAtomic(file, prev.bytes, prev.mode); else fs.unlinkSync(file); } catch {}
    }
    for (const d of madeDirs) {
      try { fs.rmdirSync(d); } catch {}
    }
    if (e instanceof AgentBindError) throw e;
    throw new AgentBindError('write-failed', 'could not write the binding: ' + (e.message || String(e)));
  }
}

// The directories on the way to dir that do not exist yet, deepest first.
function missingDirs(dir) {
  const out = [];
  for (let d = path.resolve(dir); !exists(d); d = path.dirname(d)) {
    out.push(d);
    if (path.dirname(d) === d) break;
  }
  return out;
}

function defaultTerminal() {
  return { platform: process.platform, stdinIsTTY: !!process.stdin.isTTY, openTty: null };
}
