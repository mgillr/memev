// SPDX-License-Identifier: Apache-2.0
// Offline licence files. A licence is a small signed JSON file the customer drops in; it is checked
// here with Ed25519 and never with the network. It names no person, machine or vault. Without one a
// vault is the free tier: this computer, with everything, and no other computer can be added. A
// licence sets how many computers may use the vault (entitlements.seatPolicy).
//
//   { "v": 1, "lid": "lic_…", "tier": "team", "services": [], "seats": 5,
//     "connectors": 25, "iat": "2026-11-01", "exp": "2027-11-15" | null, "grace_days": 14,
//     "kid": "memev-2026-10", "sig": "ed25519:<base64>" }
//
// The signature covers every field except `sig`, serialised as JSON with sorted keys.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './util.mjs';

/**
 * Public keys that may sign licences, by key id. The private half is held by the vendor, outside
 * this repository, and signs licences with scripts/license/issue.mjs.
 */
export const LICENSE_KEYS = {
  'memev-2026-10': 'MCowBQYDK2VwAyEALBLRg3jHHn5jy7zhSkuLm5nSFsun1qp8X7tGedNQIbw=',
};

/** The tier ids a licence may carry. personal_more and corporate are the ids new licences use;
 * personal, team, office and enterprise are the ids older licences carry, and they still verify. */
export const TIER_NAMES = ['personal', 'personal_more', 'team', 'office', 'business', 'enterprise', 'corporate', 'founder'];

/** The id new licences use for a tier: the older ids read as their newer one, the rest as themselves. */
export const canonicalTier = (id) => ({ personal: 'personal_more', team: 'business', office: 'business', enterprise: 'corporate' }[id] || id);
const DAY = 86400e3;
const SKEW_MS = DAY; // a licence issued "tomorrow" by a clock a little ahead still verifies

export const licenseFile = (env = process.env) => path.join(configDir(env), 'license.json');

/** The services a paid licence carries unless the issuer names others. `merge` is the paid engine: the
 * merge boundary calls the engine only for a licence that lists it (src/engine/merge.mjs, engineAllowed). */
export const ISSUED_SERVICES = Object.freeze(['sync', 'backup', 'relay', 'merge']);

/** The services to put in a licence being issued: the list named with --services, or ISSUED_SERVICES.
 * Both issuing scripts call this, so a licence made without --services always carries merge. */
export function issuedServices(named = null) {
  if (named === null || named === undefined || named === true) return [...ISSUED_SERVICES];
  return String(named).split(',').map((s) => s.trim()).filter(Boolean);
}

/** The only fields a licence may carry. Anything else (a name, an e-mail, a machine) is identity and is refused. */
export const LICENSE_FIELDS = ['v', 'lid', 'tier', 'services', 'seats', 'connectors', 'iat', 'exp', 'grace_days', 'kid', 'sig'];

/** Names of the fields in a licence object that a licence is not allowed to carry. */
export const extraFields = (l) => (l && typeof l === 'object' && !Array.isArray(l) ? Object.keys(l).filter((k) => !LICENSE_FIELDS.includes(k)) : []);

/** Canonical bytes: JSON with keys sorted at every level, without `sig`. */
export function canonical(obj) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  const { sig, ...rest } = obj; void sig;
  return Buffer.from(JSON.stringify(sort(rest)), 'utf8');
}

function shapeErrors(l) {
  const e = [];
  if (!l || typeof l !== 'object' || Array.isArray(l)) return ['not a JSON object'];
  if (l.v !== 1) e.push('unsupported version');
  if (typeof l.lid !== 'string' || !/^lic_[A-Za-z0-9_-]{4,64}$/.test(l.lid)) e.push('bad lid');
  if (!TIER_NAMES.includes(l.tier)) e.push('unknown tier');
  if (!Array.isArray(l.services) || l.services.some((s) => typeof s !== 'string')) e.push('services must be a list');
  if (!Number.isInteger(l.seats) || l.seats < 1 || l.seats > 100000) e.push('seats must be a positive integer');
  if (l.connectors !== undefined && (!Number.isInteger(l.connectors) || l.connectors < 0)) e.push('connectors must be a whole number');
  if (Number.isNaN(Date.parse(l.iat))) e.push('bad iat');
  if (l.exp !== null && Number.isNaN(Date.parse(l.exp))) e.push('bad exp');
  if (l.grace_days !== undefined && (!Number.isInteger(l.grace_days) || l.grace_days < 0 || l.grace_days > 365)) e.push('bad grace_days');
  if (typeof l.sig !== 'string' || !l.sig.startsWith('ed25519:')) e.push('missing ed25519 signature');
  return e;
}

/**
 * Verify a licence object. Returns { state, reason, ...fields }:
 *   valid | grace (expired, inside grace_days) | expired | not_yet_valid | invalid
 * `keys` defaults to the embedded LICENSE_KEYS; tests pass their own.
 */
export function verifyLicense(l, { keys = LICENSE_KEYS, now = Date.now() } = {}) {
  const errs = shapeErrors(l);
  if (errs.length) return { state: 'invalid', reason: errs.join('; ') };
  const candidates = l.kid ? (keys[l.kid] ? [keys[l.kid]] : []) : Object.values(keys);
  if (!candidates.length) return { state: 'invalid', reason: `unknown signing key ${l.kid}` };
  const sig = Buffer.from(l.sig.slice('ed25519:'.length), 'base64');
  const data = canonical(l);
  const ok = candidates.some((k) => { try { return crypto.verify(null, data, crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig); } catch { return false; } });
  if (!ok) return { state: 'invalid', reason: 'signature does not verify' };
  const fields = { lid: l.lid, tier: l.tier, services: l.services, seats: l.seats, connectors: l.connectors ?? null, iat: l.iat, exp: l.exp, grace_days: l.grace_days ?? 14 };
  if (Date.parse(l.iat) - SKEW_MS > now) return { state: 'not_yet_valid', reason: `issued for ${l.iat}`, ...fields };
  if (l.exp === null) return { state: 'valid', reason: 'perpetual', days_left: null, ...fields };
  const end = Date.parse(l.exp), graceEnd = end + fields.grace_days * DAY;
  if (now <= end) return { state: 'valid', reason: `valid until ${l.exp}`, days_left: Math.ceil((end - now) / DAY), ...fields };
  if (now <= graceEnd) return { state: 'grace', reason: `expired ${l.exp}; grace until ${new Date(graceEnd).toISOString().slice(0, 10)}`, days_left: Math.ceil((graceEnd - now) / DAY), ...fields };
  return { state: 'expired', reason: `expired ${l.exp}`, days_left: 0, ...fields };
}

/** Read and verify the installed licence. No licence is the normal case: state "none", free tier. */
export function loadLicense({ env = process.env, file = licenseFile(env), keys, now } = {}) {
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return { state: 'none', reason: 'no licence installed (the free tier needs none)' }; }
  let l; try { l = JSON.parse(raw); } catch { return { state: 'invalid', reason: 'not JSON' }; }
  return verifyLicense(l, { keys, now });
}

/** Sign a licence. For the development key script and tests only: the client never holds a signing key. */
export function signLicense(fields, privateKeyPem, kid = undefined) {
  const l = { ...fields, ...(kid ? { kid } : {}) }; delete l.sig;
  const sig = crypto.sign(null, canonical(l), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return { ...l, sig: `ed25519:${sig}` };
}
