// SPDX-License-Identifier: Apache-2.0
// The device registry: every computer and client that uses this vault, each with its own
// credential. It replaces the single shared tunnel key: a remote client is known by its own token
// (and optionally its own Ed25519 key), can be revoked or rotated alone, and is counted.
//
// Another computer joins with its own Ed25519 key, made on that computer; the private half never
// leaves it. Enrolment is capped by the licence (entitlements.seatPolicy) and every request from
// that computer must be signed with its key (src/server/http.mjs), so copying its connection
// details to a second machine does not work. Cloud connectors and local apps are counted, not
// capped. The registry lives in .memev/devices.json on this machine and is never sent anywhere.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writePrivate, writePrivateJson, exists, randomToken, now, sha256 } from './util.mjs';
import { git } from './git.mjs';
import { seatPolicy } from './entitlements.mjs';

/** Refused enrolment: the message is meant for the person running the command. */
export class SeatError extends Error { constructor(m) { super(m); this.code = 'seats'; } }


export const KINDS = ['host', 'local-client', 'cloud-connector', 'remote-computer'];
const ACTIVE_DAYS = 30;
const REUSE_WINDOW_MS = 10 * 60e3;

/** This machine's id for this vault, created once in .memev/device.json (not in git, not shared). */
export function hostDevice(root) {
  const f = path.join(root, '.memev', 'device.json');
  let d = readJson(f, null);
  if (!d?.id) { d = { id: `dev_${randomToken(8)}`, created: now(), platform: `${process.platform}-${process.arch}` }; writePrivateJson(f, d); }
  return d;
}

/** A coarse, hashed network origin: the /24 (IPv4) or /48 (IPv6), hashed so no address is stored. */
export function coarseOrigin(ip) {
  const a = String(ip || '').replace(/^::ffff:/, '');
  if (!a) return null;
  const net = a.includes(':') ? a.split(':').slice(0, 3).join(':') : a.split('.').slice(0, 3).join('.');
  return sha256(`memev-origin:${net}`).slice(0, 12);
}

// Cloud AI products call connectors from their own servers; their requests name the product.
// A heuristic: a connector token used by something else is reported as a remote computer.
const CLOUD_UA = /\b(claude|anthropic|openai|chatgpt|gpt-?actions|gemini|google|xai|x\.ai|perplexity|mistral|le ?chat|copilot)\b/i;

export class DeviceRegistry {
  constructor(file) { this.file = file; this.data = readJson(file, null) || { version: 1, devices: {} }; this.dirty = false; this.byToken = new Map(); this._reindex(); this.mtime = this._mtime(); }
  _mtime() { try { const s = fs.statSync(this.file); return `${s.ino}:${s.mtimeMs}:${s.size}`; } catch { return ''; } }
  /** The CLI may have enrolled, renamed or revoked a device: take its version of the file. */
  fresh() { if (this._mtime() !== this.mtime) { this.data = readJson(this.file, null) || this.data; this._reindex(); this.mtime = this._mtime(); } }
  _reindex() { this.byToken.clear(); for (const d of Object.values(this.data.devices)) if (d.token_id && d.status === 'active') this.byToken.set(d.token_id, d.id); }
  save() { writePrivateJson(this.file, this.data); this.dirty = false; this.mtime = this._mtime(); }
  /** Write pending observations, unless the CLI changed the file meanwhile: its change wins. */
  saveSoon() { if (!this.dirty) return; if (this._mtime() !== this.mtime) { this.fresh(); this.dirty = false; return; } this.save(); }

  ensureHost(host) {
    if (!this.data.devices[host.id]) { this.data.devices[host.id] = { id: host.id, kind: 'host', label: process.env.MEMEV_MACHINE_NAME || os.hostname().split('.')[0].slice(0, 40) || 'this computer', status: 'active', created: now(), first_seen: now(), last_seen: now(), token_id: null, pubkey: null, flags: [] }; this.save(); }
    this.hostId = host.id;
    return this.data.devices[host.id];
  }

  _add({ kind, label, tokenId = null, pubkey = null, inferred = false }) {
    if (!KINDS.includes(kind) || kind === 'host') throw new Error(`kind must be one of ${KINDS.filter((k) => k !== 'host').join(', ')}`);
    const id = `dev_${randomToken(8)}`;
    this.data.devices[id] = { id, kind, label: String(label || kind).slice(0, 60), status: 'active', created: now(), first_seen: null, last_seen: null, token_id: tokenId, pubkey, flags: [], ...(inferred ? { inferred: true } : {}), origins: [] };
    if (tokenId) this.byToken.set(tokenId, id);
    this.dirty = true;
    return this.data.devices[id];
  }

  /**
   * Enroll a device: it gets its own token (remote ones are scoped like cloud tokens). Another
   * computer needs its device public key and a free seat under `policy` (the free tier when none is
   * given: no other computer).
   */
  enroll(tokens, { kind, label, pubkey = null, ttlDays = 365, policy = null }) {
    if (pubkey) publicKeyFrom(pubkey); // throws if it is not an Ed25519 public key
    if (kind === 'remote-computer') {
      if (!pubkey) throw new SeatError('A computer joins with its own device key. Run `memev devices keygen` on that computer, then `memev devices enroll --kind remote-computer --pubkey <key>` here.');
      const p = policy || seatPolicy({ devices: this.list() });
      if (!p.can_enroll) throw new SeatError(p.reason);
    }
    const remote = kind !== 'local-client';
    const t = tokens.issue({ agent: String(label || kind).slice(0, 40), scopes: ['read', 'write'], paths: remote ? ['memory/**', 'work/**', 'contracts/**', 'bus/**'] : ['**'], ttlDays, remote, note: `device ${kind}` });
    const d = this._add({ kind, label, tokenId: t.id, pubkey });
    this.save();
    return { device: d, token: t.token };
  }

  get(idOrLabel) { return this.data.devices[idOrLabel] || Object.values(this.data.devices).find((d) => d.label === idOrLabel) || null; }
  list() { return Object.values(this.data.devices).map(({ origins, ...d }) => ({ ...d, origins_seen: (origins || []).length })); }

  revoke(tokens, id) {
    const d = this.get(id); if (!d) throw new Error(`no device ${id}`);
    if (d.kind === 'host') throw new Error('this computer is the host; it cannot be revoked');
    if (d.token_id) tokens.revoke(d.token_id);
    d.status = 'revoked'; d.revoked = now(); this.byToken.delete(d.token_id); this.save();
    return d;
  }

  /** Remove a device: its credential stops working at once and its seat is free. */
  remove(tokens, id) { return this.revoke(tokens, id); }

  rotate(tokens, id) {
    const d = this.get(id); if (!d || d.status !== 'active' || !d.token_id) throw new Error(`no active device ${id} with a token`);
    const t = tokens.rotate(d.token_id); d.rotated = now(); d.flags = d.flags.filter((f) => f.type !== 'reuse'); this.save();
    return { device: d, token: t.token };
  }

  rename(id, label) { const d = this.get(id); if (!d) throw new Error(`no device ${id}`); d.label = String(label).slice(0, 60); this.save(); return d; }

  /**
   * Existing installs: every active token that is not yet a device becomes one. Local tokens are
   * local clients; remote tokens made for a cloud app are connectors; other remote tokens are
   * remote computers until their traffic says otherwise.
   */
  migrate(tokens) {
    const added = [];
    for (const t of tokens.list()) {
      if (t.revoked || this.byToken.has(t.id) || (t.expires && Date.parse(t.expires) < Date.now())) continue;
      if (Object.values(this.data.devices).some((d) => d.token_id === t.id)) continue;
      const kind = !t.remote ? 'local-client' : /cloud connector|device cloud-connector/.test(t.note || '') ? 'cloud-connector' : 'remote-computer';
      added.push(this._add({ kind, label: t.agent, tokenId: t.id, inferred: true }));
    }
    if (!this.data.migrated) this.data.migrated = now();
    if (added.length || this.dirty) this.save();
    return added;
  }

  /** What kind of client made this request (local client, cloud connector or remote computer). */
  classify({ local, connectorUrl = false, userAgent = '', device = null }) {
    if (local) return 'local-client';
    const cloudish = CLOUD_UA.test(String(userAgent || ''));
    if (device?.kind === 'cloud-connector' || connectorUrl) return cloudish || !userAgent ? 'cloud-connector' : 'remote-computer';
    return cloudish ? 'cloud-connector' : 'remote-computer';
  }

  /**
   * Record a request: when and roughly from where a device was seen, its class, and report flags.
   * Never throws for the caller and never says no.
   */
  observe({ tokenId, identity = null, local, ip = null, userAgent = '', connectorUrl = false, proof = null }) {
    this.fresh();
    let id = this.byToken.get(tokenId);
    if (!id) { // a token made outside the registry (memev token issue, memev cloud url): register it now
      if (!identity) return null;
      const kind = local ? 'local-client' : /cloud connector/.test(identity.note || '') ? 'cloud-connector' : 'remote-computer';
      id = this._add({ kind, label: identity.agent, tokenId, inferred: true }).id;
    }
    const d = this.data.devices[id]; const t = now();
    d.first_seen ||= t; d.last_seen = t;
    const cls = this.classify({ local, connectorUrl, userAgent, device: d });
    d.last_class = cls;
    // a token issued by hand that a cloud AI app uses is a connector; the other way round only flags
    if (d.inferred && !local && d.kind === 'remote-computer' && cls === 'cloud-connector') d.kind = cls;
    if (d.kind === 'cloud-connector' && cls === 'remote-computer') this._flag(d, 'connector-used-by-computer', 'a connector credential was used by something that is not a cloud AI app; it is counted as a computer');
    if (proof) { if (proof.ok) d.proof = 'ok'; else this._flag(d, 'proof', proof.reason); }
    else if (d.pubkey && !local) this._flag(d, 'unsigned', 'this device has a key but sent an unsigned request');
    if (!local) {
      const o = coarseOrigin(ip); const ms = Date.now();
      d.origins = (d.origins || []).filter((x) => ms - Date.parse(x.at) < 24 * 3600e3);
      const recentOther = d.origins.find((x) => x.o !== o && ms - Date.parse(x.at) < REUSE_WINDOW_MS);
      // two networks within minutes for one computer's credential: probably copied to a second machine
      if (o && recentOther && cls === 'remote-computer') this._flag(d, 'reuse', 'the same credential was used from two networks within 10 minutes; enroll each computer separately (memev devices enroll) or rotate it');
      const cur = d.origins.find((x) => x.o === o); if (cur) cur.at = t; else if (o) d.origins.push({ o, at: t });
      if (d.origins.length > 8) d.origins = d.origins.slice(-8);
    }
    this.dirty = true;
    return { device: d.id, kind: d.kind, class: cls };
  }

  _flag(d, type, detail) { const f = d.flags.find((x) => x.type === type); if (f) { f.last = now(); f.count = (f.count || 1) + 1; } else d.flags.push({ type, detail, first: now(), last: now(), count: 1 }); }

  /** Computers enrolled now: this one plus every active remote computer (what the seat cap counts). */
  enrolledComputers() { return 1 + Object.values(this.data.devices).filter((d) => d.kind === 'remote-computer' && d.status === 'active').length; }

  /** Computers (this one plus active remote computers), connectors and local clients seen recently. */
  countSeats({ activeDays = ACTIVE_DAYS, at = Date.now() } = {}) {
    const recent = (d) => d.status === 'active' && d.last_seen && at - Date.parse(d.last_seen) <= activeDays * 86400e3;
    const all = Object.values(this.data.devices);
    return {
      computers: 1 + all.filter((d) => d.kind === 'remote-computer' && recent(d)).length,
      connectors: all.filter((d) => d.kind === 'cloud-connector' && recent(d)).length,
      local_clients: all.filter((d) => d.kind === 'local-client' && recent(d)).length,
      flagged: all.filter((d) => d.status === 'active' && d.flags?.length).map((d) => ({ id: d.id, label: d.label, flags: d.flags.map((f) => f.type) })),
      active_days: activeDays,
    };
  }
}

// ---- proof of possession: a device with its own Ed25519 key signs each request
export function publicKeyFrom(pub) {
  const k = String(pub).includes('BEGIN') ? crypto.createPublicKey(pub) : crypto.createPublicKey({ key: Buffer.from(String(pub), 'base64'), format: 'der', type: 'spki' });
  if (k.asymmetricKeyType !== 'ed25519') throw new Error('device keys are Ed25519');
  return k;
}
// Each request from another computer is signed with its key. The signature covers the method, the
// path, a timestamp (five minutes either way), a one-time nonce and a hash of the body, so a copied
// configuration is useless without the device's private key and a captured request can't be
// replayed or changed.
export const proofPayload = ({ method, path: p, ts, nonce, bodyHash }) => Buffer.from(`memev-device-v2\n${method}\n${p}\n${ts}\n${nonce}\n${bodyHash}`, 'utf8');
const bodySha = (body) => crypto.createHash('sha256').update(body ? Buffer.from(body) : Buffer.alloc(0)).digest('hex');
export function signRequest(privateKeyPem, { method, path: p, body = '' }) {
  const ts = String(Date.now()); const nonce = crypto.randomBytes(12).toString('hex');
  const sig = crypto.sign(null, proofPayload({ method, path: p, ts, nonce, bodyHash: bodySha(body) }), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return { 'x-memev-ts': ts, 'x-memev-nonce': nonce, 'x-memev-sig': sig };
}
export function verifyProof(pubkey, { method, path: p, ts, nonce, sig, body = '' }, { at = Date.now(), skewMs = 5 * 60e3 } = {}) {
  if (!ts || !sig || !nonce) return { ok: false, reason: 'no device signature' };
  if (!/^[0-9a-f]{16,64}$/.test(String(nonce))) return { ok: false, reason: 'bad nonce' };
  if (!(Math.abs(at - Number(ts)) <= skewMs)) return { ok: false, reason: 'signature timestamp too far from now' };
  try { return crypto.verify(null, proofPayload({ method, path: p, ts, nonce, bodyHash: bodySha(body) }), publicKeyFrom(pubkey), Buffer.from(String(sig), 'base64')) ? { ok: true } : { ok: false, reason: 'bad signature' }; } catch (e) { return { ok: false, reason: e.message }; }
}
/** Nonces seen in the last few minutes, so a signed request can be used once. */
export class NonceCache {
  constructor(ttlMs = 10 * 60e3) { this.ttl = ttlMs; this.m = new Map(); }
  use(nonce, at = Date.now()) {
    if (this.m.size > 50000) for (const [k, t] of this.m) if (at - t > this.ttl) this.m.delete(k);
    if (this.m.has(nonce) && at - this.m.get(nonce) <= this.ttl) return false;
    this.m.set(nonce, at); return true;
  }
}
// AI apps and tools that run on a computer. A cloud connector credential used by one of these was
// copied onto a computer, which must enroll with its own key instead.
const COMPUTER_UA = /\b(claude-code|claude-cli|cursor|codex|gemini-cli|windsurf|zed|vscode|visual studio code|curl|wget|memev)\b/i;
export const computerSide = ({ userAgent = '', memevClient = null } = {}) => !!memevClient || COMPUTER_UA.test(String(userAgent || ''));
export function deviceKeygen() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

// ---- one-time invites: a code carries the vault address and a secret that is stored only as a hash
const invitePath = (root) => path.join(root, '.memev', 'invites.json');
export const inviteHash = (secret) => sha256(String(secret));

/**
 * The backup value in an invite is handed to git fetch as the remote, so it must be a remote git
 * can name: a URL (https, http, ssh, git, file), a [user@]host:path remote, or an absolute local
 * path. Anything else is refused, including anything that starts with a dash (which git would read
 * as an option) and a <transport>::<address> value (which runs a git remote helper).
 */
export function assertBackupRemote(value) {
  const v = String(value ?? '');
  const bad = () => { throw new Error('the invite backup is not a valid git remote (a URL, a user@host:path remote, or an absolute local path)'); };
  if (!v || /[\x00-\x1f\x7f]/.test(v) || v.startsWith('-')) bad();
  if (/^[A-Za-z0-9+.-]+::/.test(v)) bad();
  if (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v)) return v;
  let m;
  if ((m = /^(https?|ssh|git|git\+ssh|ssh\+git|file):\/\/(?:([^@/\s]*)@)?([^/:?#\s]*)(?::(\d+))?(?:[/?]|$)/.exec(v))) {
    if (!m[3] && m[1] !== 'file') bad();
    if (m[3].startsWith('-') || (m[2] || '').startsWith('-')) bad();
    return v;
  }
  if ((m = /^(?:([^@/:\s]+)@)?([^/:\s]+):(.+)$/.exec(v))) {
    if (m[2].startsWith('-') || (m[1] || '').startsWith('-')) bad();
    // "scheme:value" without a slash (e.g. "http:bad") is not a remote git can name
    if (!m[1] && /^(?:https?|ssh|git|git\+ssh|ssh\+git|file|ftps?)$/i.test(m[2])) bad();
    return v;
  }
  bad();
}

export function encodeInvite({ address, secret, pubkey = undefined, backup = undefined }) {
  const o = { a: address, s: secret };
  if (pubkey) o.k = pubkey;
  if (backup) o.b = backup;
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
}
export function decodeInvite(code) {
  let o;
  try { o = JSON.parse(Buffer.from(String(code), 'base64url').toString('utf8')); } catch { throw new Error('bad invite code'); }
  if (!o || typeof o.a !== 'string' || typeof o.s !== 'string' || !o.a || !o.s) throw new Error('bad invite code');
  const backup = typeof o.b === 'string' && o.b ? assertBackupRemote(o.b) : null;
  return { address: o.a, secret: o.s, pubkey: typeof o.k === 'string' && o.k ? o.k : null, backup };
}

function loadInvites(root) { return readJson(invitePath(root), null) || { version: 1, invites: {} }; }

/** Mint a one-time secret. The file keeps the hash, the expiry and the address, never the secret. */
export function mintInvite(root, { address, ttlSec = 15 * 60, at = Date.now() } = {}) {
  if (!address) throw new Error('an invite needs the vault address');
  const secret = crypto.randomBytes(16).toString('base64url');
  const expires = new Date(at + ttlSec * 1000).toISOString();
  const id = `inv_${randomToken(4)}`;
  const data = loadInvites(root);
  data.invites[id] = { id, hash: inviteHash(secret), expires, address, used: false };
  writePrivateJson(invitePath(root), data);
  const origin = git(root, ['remote', 'get-url', 'origin']);
  const code = encodeInvite({ address, secret, pubkey: addressKeypair(root).publicKey, backup: origin.ok ? origin.out : null });
  return { id, code, secret, expires, address, link: `${String(address).replace(/\/$/, '')}/i/${code}` };
}

/**
 * Redeem a code once. A second try is refused. An invite past its expiry is refused with a message
 * that says it expired. On success one remote computer is enrolled.
 */
export function redeemInvite(root, { code, pubkey, label, tokens, policy, at = Date.now() }) {
  const { address, secret } = decodeInvite(code);
  const data = loadInvites(root);
  const row = Object.values(data.invites).find((i) => i.hash === inviteHash(secret) && i.address === address);
  if (!row) throw new Error('unknown invite');
  if (Date.parse(row.expires) <= at) throw new Error('this invite expired');
  if (row.used) throw new Error('this invite was already used');
  const reg = new DeviceRegistry(path.join(root, '.memev', 'devices.json'));
  const enrolled = reg.enroll(tokens, { kind: 'remote-computer', label: label || 'invited computer', pubkey, policy });
  row.used = true;
  row.device = enrolled.device.id;
  writePrivateJson(invitePath(root), data);
  return { device: enrolled.device, token: enrolled.token };
}

const addressKeyFile = (root) => path.join(root, '.memev', 'address-ed25519.pem');

/** This vault's key for address records. The private half stays in .memev and is not committed. */
export function addressKeypair(root) {
  const f = addressKeyFile(root);
  if (!exists(f)) {
    const k = deviceKeygen();
    writePrivate(f, k.privateKeyPem);
    return k;
  }
  const privateKeyPem = fs.readFileSync(f, 'utf8');
  const publicKey = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' }).toString('base64');
  return { privateKeyPem, publicKey };
}

function sortJson(v) {
  return Array.isArray(v) ? v.map(sortJson) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortJson(v[k])])) : v;
}

/** Bytes covered by an address-record signature. The signature field itself is left out. */
export function addressBytes(rec) {
  const { sig, ...rest } = rec || {};
  void sig;
  return Buffer.from(JSON.stringify(sortJson(rest)), 'utf8');
}

/** A signed note of where this vault can be reached. */
export function signAddressRecord(root, url) {
  if (!url || typeof url !== 'string') throw new Error('an address record needs a url');
  const key = addressKeypair(root);
  const cfg = readJson(path.join(root, '.memev', 'config.json'), {});
  const rec = { v: 1, url, vault_id: cfg.vault_id || null, at: now(), pubkey: key.publicKey };
  const sig = crypto.sign(null, addressBytes(rec), crypto.createPrivateKey(key.privateKeyPem)).toString('base64');
  return { ...rec, sig: `ed25519:${sig}` };
}

/**
 * True only when the public key saved at join verifies the record.
 * A bad signature, or a record signed by any other key, is false.
 */
export function verifyAddressRecord(rec, pinnedPubkey) {
  if (!pinnedPubkey || !rec || rec.v !== 1 || typeof rec.url !== 'string' || !/^https?:\/\//.test(rec.url)) return false;
  if (typeof rec.sig !== 'string' || !rec.sig.startsWith('ed25519:')) return false;
  if (rec.pubkey && rec.pubkey !== pinnedPubkey) return false;
  try {
    const sig = Buffer.from(rec.sig.slice('ed25519:'.length), 'base64');
    return crypto.verify(null, addressBytes(rec), publicKeyFrom(pinnedPubkey), sig);
  } catch { return false; }
}
