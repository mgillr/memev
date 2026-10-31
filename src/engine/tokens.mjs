// SPDX-License-Identifier: Apache-2.0
// Capability tokens: mv_<id>_<secret>. Only a SHA-256 of the secret is stored; the token is shown once.
// Scopes: read, write, admin. Paths: globs the token may touch. Expiry: ttl days (0 = never).
import fs from 'node:fs';
import path from 'node:path';
import { sha256, randomToken, readJson, writePrivateJson, timingSafeEqualHex, now, globMatch } from './util.mjs';

export const TOKEN_RE = /^mv_([0-9a-f]{8})_([0-9a-f]{32,})$/;

// How many days before an expiry the warnings start (doctor, memev status and the resume card).
export const EXPIRY_WARNING_DAYS = 14;

/** One warning line for a credential that will expire: who it is, when, and how to renew or revoke it. */
export function expiryWarningLine(t, { at = Date.now() } = {}) {
  const daysLeft = Math.max(0, Math.ceil((Date.parse(t.expires) - at) / 86400e3));
  return `${t.agent} ${t.remote ? 'connector' : 'client'} credential expires in ${daysLeft === 1 ? '1 day' : `${daysLeft} days`} (${t.expires.slice(0, 10)}); renew with memev token rotate ${t.id} or revoke it with memev token revoke ${t.id}`;
}

/** One warning line for a credential that is already past its expiry: it stops working now. */
export function expiredWarningLine(t) {
  return `${t.agent} ${t.remote ? 'connector' : 'client'} credential expired on ${t.expires.slice(0, 10)}; renew with memev token rotate ${t.id} or revoke it with memev token revoke ${t.id}`;
}

export class TokenStore {
  constructor(file, { clock = () => Date.now() } = {}) { this.file = file; this._clock = clock; this.data = readJson(file, null) || { version: 1, tokens: {} }; this.mtime = this._mtime(); }
  _mtime() { try { const s = fs.statSync(this.file); return `${s.ino}:${s.mtimeMs}:${s.size}`; } catch { return ''; } }
  save() { writePrivateJson(this.file, this.data); this.mtime = this._mtime(); }
  reload() { this.data = readJson(this.file, null) || this.data; this.mtime = this._mtime(); }
  /** Another process (the CLI) may have minted or revoked a token: pick that up before answering. */
  fresh() { if (this._mtime() !== this.mtime) this.reload(); }

  issue({ agent, scopes = ['read', 'write'], paths = ['**'], ttlDays = 180, note = '', remote = false } = {}) {
    if (!agent) throw new Error('a token needs an agent name');
    this.fresh();
    for (const s of scopes) if (!['read', 'write', 'admin'].includes(s)) throw new Error(`unknown scope: ${s}`);
    const id = randomToken(4), secret = randomToken(20);
    const expires = ttlDays > 0 ? new Date(this._clock() + ttlDays * 86400e3).toISOString() : null;
    this.data.tokens[id] = { id, agent, scopes, paths, hash: sha256(secret), created: now(), expires, revoked: false, note, remote, last_used: null };
    this.save();
    return { id, token: `mv_${id}_${secret}`, expires };
  }

  /** Returns the identity for a valid token, or null. */
  verify(token) {
    const m = TOKEN_RE.exec(String(token || '').trim());
    if (!m) return null;
    this.fresh();
    const rec = this.data.tokens[m[1]];
    if (!rec || rec.revoked) return null;
    if (!timingSafeEqualHex(rec.hash, sha256(m[2]))) return null;
    if (rec.expires && Date.parse(rec.expires) < this._clock()) return null;
    return { id: rec.id, agent: rec.agent, scopes: rec.scopes, paths: rec.paths, remote: !!rec.remote, expires: rec.expires, note: rec.note || '' };
  }

  touch(id) { const r = this.data.tokens[id]; if (r) { r.last_used = now(); } }
  /** A token that holds the admin scope, is not revoked and has not expired. */
  _liveAdmin(r) { return !!r && !r.revoked && (r.scopes || []).includes('admin') && !(r.expires && Date.parse(r.expires) < this._clock()); }
  /** True when this token is the vault's only live admin token, so revoking it would leave no credential for the admin routes. */
  lastAdmin(id) { const r = this.data.tokens[id]; return this._liveAdmin(r) && !Object.values(this.data.tokens).some((x) => x.id !== id && this._liveAdmin(x)); }
  revoke(id) {
    this.fresh(); const r = this.data.tokens[id]; if (!r) return false;
    // the last live admin token is never revoked: nothing on the command line mints another, so every admin route would be
    // refused for good (issue 282)
    if (this.lastAdmin(id)) throw new Error(`${id} is this vault's only admin token; revoking it would lock every admin route. Issue another admin token first (memev token issue <name> --scopes read,write,admin), then revoke this one`);
    r.revoked = true; r.revoked_at = now(); this.save(); return true;
  }

  /** A new secret for the same id, scopes and paths; the old secret stops working at once. */
  rotate(id, { ttlDays } = {}) {
    this.fresh();
    const r = this.data.tokens[id];
    if (!r || r.revoked) throw new Error(`no active token ${id}`);
    const secret = randomToken(20);
    r.hash = sha256(secret); r.rotated = now();
    if (ttlDays !== undefined) r.expires = ttlDays > 0 ? new Date(this._clock() + ttlDays * 86400e3).toISOString() : null;
    this.save();
    return { id, token: `mv_${id}_${secret}`, expires: r.expires };
  }

  list() { return Object.values(this.data.tokens).map(({ hash, ...r }) => (void hash, r)); }

  /** Active tokens that are already past their expiry: they stop working now, and would do so without notice. */
  expired({ at = this._clock() } = {}) {
    this.fresh();
    return Object.values(this.data.tokens)
      .filter((t) => !t.revoked && t.expires && Date.parse(t.expires) <= at)
      .map(({ hash, ...r }) => (void hash, r))
      .sort((a, b) => Date.parse(a.expires) - Date.parse(b.expires));
  }

  /** Active tokens whose expiry falls within `days` days: the ones that would otherwise stop working without notice. */
  expiringWithin(days, { at = this._clock() } = {}) {
    this.fresh();
    const limit = at + days * 86400e3;
    return Object.values(this.data.tokens)
      .filter((t) => !t.revoked && t.expires && Date.parse(t.expires) > at && Date.parse(t.expires) <= limit)
      .map(({ hash, ...r }) => (void hash, r))
      .sort((a, b) => Date.parse(a.expires) - Date.parse(b.expires));
  }
}

export function allowed(identity, scope, p = null) {
  if (!identity) return false;
  if (!identity.scopes.includes(scope) && !identity.scopes.includes('admin')) return false;
  if (p === null) return true;
  return identity.paths.some((g) => globMatch(g, p));
}

export const tokensPath = (root) => path.join(root, '.memev', 'tokens.json');
