// SPDX-License-Identifier: Apache-2.0
// The device registry: every computer and client that uses this vault, each with its own
// credential. It replaces the single shared tunnel key: a remote client is known by its own token
// (and optionally its own Ed25519 key), can be revoked or rotated alone, and is counted.
//
// REPORT ONLY. The registry classifies and counts; it never refuses a request. Seat counts and
// "this token is used from two places" are shown by `memev devices` and `memev doctor`, nothing more.
// The registry lives in .memev/devices.json on this machine and is never sent anywhere.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writePrivateJson, randomToken, now, sha256 } from './util.mjs';


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
    if (!this.data.devices[host.id]) { this.data.devices[host.id] = { id: host.id, kind: 'host', label: os.hostname().split('.')[0].slice(0, 40) || 'this computer', status: 'active', created: now(), first_seen: now(), last_seen: now(), token_id: null, pubkey: null, flags: [] }; this.save(); }
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

  /** Enroll a device: it gets its own token (remote ones are scoped like cloud tokens). */
  enroll(tokens, { kind, label, pubkey = null, ttlDays = 365 }) {
    if (pubkey) publicKeyFrom(pubkey); // throws if it is not an Ed25519 public key
    const remote = kind !== 'local-client';
    const t = tokens.issue({ agent: String(label || kind).slice(0, 40), scopes: ['read', 'write'], paths: remote ? ['memory/**', 'work/**', 'contracts/**'] : ['**'], ttlDays, remote, note: `device ${kind}` });
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
    if (!id) { // a token made outside the registry (memev token issue): register it now
      if (!identity) return null;
      id = this._add({ kind: local ? 'local-client' : 'remote-computer', label: identity.agent, tokenId, inferred: true }).id;
    }
    const d = this.data.devices[id]; const t = now();
    d.first_seen ||= t; d.last_seen = t;
    const cls = this.classify({ local, connectorUrl, userAgent, device: d });
    d.last_class = cls;
    if (d.inferred && !local && cls !== d.kind) { d.kind = cls; }
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
// The signature covers the method, the path and a timestamp (five minutes either way), so a copied
// configuration file is useless without the device's private key.
export const proofPayload = ({ method, path: p, ts }) => Buffer.from(`memev-device-v1\n${method}\n${p}\n${ts}`, 'utf8');
export function signRequest(privateKeyPem, { method, path: p }) {
  const ts = String(Date.now());
  return { 'x-memev-ts': ts, 'x-memev-sig': crypto.sign(null, proofPayload({ method, path: p, ts }), crypto.createPrivateKey(privateKeyPem)).toString('base64') };
}
export function verifyProof(pubkey, { method, path: p, ts, sig }, { at = Date.now(), skewMs = 5 * 60e3 } = {}) {
  if (!ts || !sig) return { ok: false, reason: 'no signature' };
  if (Math.abs(at - Number(ts)) > skewMs) return { ok: false, reason: 'signature timestamp too far from now' };
  try { return crypto.verify(null, proofPayload({ method, path: p, ts }), publicKeyFrom(pubkey), Buffer.from(String(sig), 'base64')) ? { ok: true } : { ok: false, reason: 'bad signature' }; } catch (e) { return { ok: false, reason: e.message }; }
}
export function deviceKeygen() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}
