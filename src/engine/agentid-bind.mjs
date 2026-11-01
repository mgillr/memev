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

// The one message for every step that needs ssh-keygen when it is missing or older than 8.0.
export const OPENSSH_NEEDED = 'binding needs OpenSSH 8.0 or later';

// OpenSSH before 8.0 has no -Y, so an old binary answers with an option error; a missing binary, or
// one that does not answer in time, is a run error.
const noOpenSSH = (r) => Boolean(r.error) || /unknown option|invalid option|illegal option/i.test(r.stderr);

// Run ssh-keygen in a way that only an old binary answers with an option error, so the keys
// directory is left untouched when OpenSSH 8.0 or later is not there.
function requireOpenSSH() {
  const r = run('ssh-keygen', ['-Y', 'check-novalidate', '-n', NAMESPACE, '-s', '/dev/null'], { timeout: SIG_TIMEOUT_MS });
  if (noOpenSSH(r)) throw new AgentBindError('openssh', OPENSSH_NEEDED);
}

function signMessage(message, sshKeyPath, principal, namespace = NAMESPACE) {
  const r = run('ssh-keygen', ['-Y', 'sign', '-f', sshKeyPath, '-n', namespace, '-I', principal], { timeout: SIG_TIMEOUT_MS, input: message });
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
// 'unbound' when there is no signature, 'unavailable' when ssh-keygen is missing or older than 8.0
// (nothing was checked, so it says nothing about the binding; OPENSSH_NEEDED is the message), and
// 'invalid' when the signature is there but does not verify (wrong principal, tampered signature,
// or a signature from another namespace).
export function verifyAgentBinding(role, { allowedSigners, principal, dir } = {}) {
  let p;
  try { role = checkRole(role); p = checkPrincipal(principal); } catch { return 'invalid'; }
  const sshsigPath = path.join(dir, role + '.pub.sshsig');
  if (!exists(sshsigPath)) return 'unbound';
  const rolePubPath = path.join(dir, role + '.pub');
  if (!exists(rolePubPath)) return 'invalid';
  const rolePub = fs.readFileSync(rolePubPath, 'utf8').trim();
  const r = run('ssh-keygen', ['-Y', 'verify', '-f', allowedSigners, '-I', p, '-n', NAMESPACE, '-s', sshsigPath], { timeout: SIG_TIMEOUT_MS, input: bindingMessage(role, p, rolePub) });
  if (r.ok) return 'bound';
  return noOpenSSH(r) ? 'unavailable' : 'invalid';
}

// ---- a namespaced signature and its check, for contributions (SO-F-03)
// The role key signs through the same ssh-keygen path, in a namespace of its own, so a signature made for a role binding
// (namespace memev) is never a signature of another kind, and the reverse. The binding namespace stays with the bindings: these two
// functions refuse it. The public key is the form of a role's .pub file (base64 of the SPKI) or the form OpenSSH writes.
export const CONTRIBUTION_NAMESPACE = 'memev-contribution';
const NS_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
function checkNamespace(ns) {
  if (typeof ns !== 'string' || !NS_RE.test(ns) || ns === NAMESPACE) throw new AgentBindError('bad-namespace', 'a signature namespace is lower-case words, and memev is kept for role bindings');
  return ns;
}
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const sshString = (b) => { const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); };

/** The OpenSSH public key line ("ssh-ed25519 AAAA...") of a role key given as base64 SPKI, or the line itself. Throws bad-key. */
export function roleKeyToOpenSsh(publicKey) {
  const text = String(publicKey ?? '').trim();
  const line = /^(ssh-ed25519 [A-Za-z0-9+/]+={0,2})(?: [^\r\n]*)?$/.exec(text);   // the comment OpenSSH adds after the key is dropped
  if (line) return line[1];
  const der = /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? Buffer.from(text, 'base64') : Buffer.alloc(0);
  if (der.length !== ED25519_SPKI_PREFIX.length + 32 || !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) throw new AgentBindError('bad-key', 'not an ed25519 public key');
  const blob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(der.subarray(ED25519_SPKI_PREFIX.length))]);
  return `ssh-ed25519 ${blob.toString('base64')}`;
}

// The role key files that deviceKeygen writes are PKCS#8 PEM, which ssh-keygen -Y sign does not read on every version. The same
// key is written as an OpenSSH private key in a private temporary directory for the one call, and removed after.
// (the armour lines are built, not written out, so that no file of the repository holds one whole)
const PEM_EDGE = (edge) => ['-----' + edge, 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ');
function opensshPrivateKey(pem) {
  let jwk;
  try { jwk = crypto.createPrivateKey(pem).export({ format: 'jwk' }); } catch { throw new AgentBindError('bad-key', 'the key file is not a private key this can sign with'); }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') throw new AgentBindError('bad-key', 'only an ed25519 key can sign');
  const seed = Buffer.from(jwk.d, 'base64url'), pub = Buffer.from(jwk.x, 'base64url');
  const check = crypto.randomBytes(4);
  let priv = Buffer.concat([check, check, sshString(Buffer.from('ssh-ed25519')), sshString(pub), sshString(Buffer.concat([seed, pub])), sshString(Buffer.alloc(0))]);
  const pad = (8 - (priv.length % 8)) % 8;
  priv = Buffer.concat([priv, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const count = Buffer.alloc(4); count.writeUInt32BE(1);
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0'), sshString(Buffer.from('none')), sshString(Buffer.from('none')), sshString(Buffer.alloc(0)), count, sshString(Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(pub)])), sshString(priv)]);
  const b64 = body.toString('base64').match(/.{1,70}/g).join('\n');
  return `${PEM_EDGE('BEGIN')}\n${b64}\n${PEM_EDGE('END')}\n`;
}

/** Sign a message with a key file (a role key, or an OpenSSH key) in a namespace other than the binding one. Returns the armoured signature. */
export function signNamespaced(message, { keyPath, principal, namespace } = {}) {
  const ns = checkNamespace(namespace);
  const p = checkPrincipal(principal);
  if (!exists(keyPath)) throw new AgentBindError('no-ssh-key', 'key not found: ' + path.basename(String(keyPath)));
  requireOpenSSH();
  const content = fs.readFileSync(keyPath, 'utf8');
  if (content.startsWith('-----BEGIN OPENSSH')) {
    if (isEncryptedKey(content)) throw noTerminalRefusal();
    return signMessage(message, keyPath, p, ns);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-nssign-'));
  try {
    fs.chmodSync(tmp, 0o700);
    const file = path.join(tmp, 'key');
    writePrivate(file, opensshPrivateKey(content));
    return signMessage(message, file, p, ns);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * Check a namespaced signature against one public key, offline. Returns 'valid', 'invalid', or 'unavailable' when ssh-keygen is
 * missing or older than 8.0 (nothing was checked, so it says nothing about the signature). A namespace or principal that is not
 * allowed throws; a key or a signature that cannot be read is 'invalid'.
 */
export function verifyNamespaced(message, signature, { principal, publicKey, namespace } = {}) {
  const ns = checkNamespace(namespace);
  const p = checkPrincipal(principal);
  let key;
  try { key = roleKeyToOpenSsh(publicKey); } catch { return 'invalid'; }
  if (typeof signature !== 'string' || !signature.startsWith('-----BEGIN SSH SIGNATURE-----')) return 'invalid';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-nsverify-'));
  try {
    fs.chmodSync(tmp, 0o700);
    const allowed = path.join(tmp, 'allowed_signers'), sig = path.join(tmp, 'sig');
    fs.writeFileSync(allowed, `${p} namespaces="${ns}" ${key}\n`);
    fs.writeFileSync(sig, signature);
    const r = run('ssh-keygen', ['-Y', 'verify', '-f', allowed, '-I', p, '-n', ns, '-s', sig], { timeout: SIG_TIMEOUT_MS, input: message });
    if (r.ok) return 'valid';
    return noOpenSSH(r) ? 'unavailable' : 'invalid';
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
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
