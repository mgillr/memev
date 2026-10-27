// SPDX-License-Identifier: Apache-2.0
// Capability tokens: mv_<id>_<secret>. Only a SHA-256 of the secret is stored; the token is shown once.
// Scopes: read, write, admin. Paths: globs the token may touch. Expiry: ttl days (0 = never).
import fs from 'node:fs';
import path from 'node:path';
import { sha256, randomToken, readJson, writePrivateJson, timingSafeEqualHex, now, globMatch } from './util.mjs';

export const TOKEN_RE = /^mv_([0-9a-f]{8})_([0-9a-f]{32,})$/;

export class TokenStore {
  constructor(file) { this.file = file; this.data = readJson(file, null) || { version: 1, tokens: {} }; this.mtime = this._mtime(); }
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
    const expires = ttlDays > 0 ? new Date(Date.now() + ttlDays * 86400e3).toISOString() : null;
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
    if (rec.expires && Date.parse(rec.expires) < Date.now()) return null;
    return { id: rec.id, agent: rec.agent, scopes: rec.scopes, paths: rec.paths, remote: !!rec.remote, expires: rec.expires };
  }

  touch(id) { const r = this.data.tokens[id]; if (r) { r.last_used = now(); } }
  revoke(id) { this.fresh(); const r = this.data.tokens[id]; if (!r) return false; r.revoked = true; r.revoked_at = now(); this.save(); return true; }

  /** A new secret for the same id, scopes and paths; the old secret stops working at once. */
  rotate(id, { ttlDays } = {}) {
    this.fresh();
    const r = this.data.tokens[id];
    if (!r || r.revoked) throw new Error(`no active token ${id}`);
    const secret = randomToken(20);
    r.hash = sha256(secret); r.rotated = now();
    if (ttlDays !== undefined) r.expires = ttlDays > 0 ? new Date(Date.now() + ttlDays * 86400e3).toISOString() : null;
    this.save();
    return { id, token: `mv_${id}_${secret}`, expires: r.expires };
  }

  list() { return Object.values(this.data.tokens).map(({ hash, ...r }) => (void hash, r)); }
}

export function allowed(identity, scope, p = null) {
  if (!identity) return false;
  if (!identity.scopes.includes(scope) && !identity.scopes.includes('admin')) return false;
  if (p === null) return true;
  return identity.paths.some((g) => globMatch(g, p));
}

export const tokensPath = (root) => path.join(root, '.memev', 'tokens.json');
