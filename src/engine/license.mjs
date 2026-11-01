// SPDX-License-Identifier: Apache-2.0
// Offline licence files. A licence is a small signed JSON file the customer drops in; it is checked
// here with Ed25519 and never with the network. It names no person, machine or vault. Without one a
// vault is the free tier: this computer, with everything, and no other computer can be added. A
// licence sets how many computers may use the vault (entitlements.seatPolicy).
//
//   { "v": 1, "lid": "lic_…", "tier": "business", "services": ["merge"], "seats": 5,
//     "connectors": 25, "iat": "2026-11-01", "exp": "2026-11-15", "grace_days": 7,
//     "trial": true, "trial_ext": true, "org": "org_…",
//     "kid": "memev-2026-10", "sig": "ed25519:<base64>" }
//
// The signature covers every field except `sig`, serialised as JSON with sorted keys. A licence may
// carry only the fields above, and the check refuses any other key, whoever added it. trial, trial_ext
// and org are the non-identity fields beyond the base set: trial and trial_ext are true or false, and
// org is an opaque id (org_ and 4 to 64 letters, digits, _ or -) that names no person, machine or
// vault. A trial must carry org, so the one trial per organisation rule has something to count.
// The same check runs in verifyLicense, so install, activate, loadLicense and every reader apply it.
//
// The answer to a key activation may also be a wrapper around the licence. Its keys are not licence
// fields, and the relay object in it is the one part that is unsigned:
//
//   { "license": { …the licence above… },
//     "relay": { "default_url": "relay://host:port", "default_domain": "name.example" } }
//
// verifyLicense also takes `floor`, the latest time this vault recorded, and judges expiry and grace
// at the later of now and floor, so winding the clock back does not revive a lapsed licence.
// loadLicense keeps that floor in license-clock.json ({ "floor": <ms> }) in the configuration
// directory, raising it to now on each check and never lowering it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { configDir, writePrivate } from './util.mjs';

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

/** The only fields a licence may carry. Anything else (a name, an e-mail, a machine) is identity and is refused. */
export const LICENSE_FIELDS = ['v', 'lid', 'tier', 'services', 'seats', 'connectors', 'iat', 'exp', 'grace_days', 'kid', 'sig', 'trial', 'org', 'trial_ext'];

/** An organisation id is opaque: no e-mail address, host name or prototype member name can match it. */
const ORG_ID = /^org_[A-Za-z0-9_-]{4,64}$/;

/** Where loadLicense keeps the latest time this vault recorded (see verifyLicense's `floor`). */
export const clockFile = (env = process.env) => path.join(configDir(env), 'license-clock.json');

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
  const extra = extraFields(l);
  if (extra.length) e.push(`the licence carries more than a licence may (${extra.join(', ')})`);
  if (l.v !== 1) e.push('unsupported version');
  if (typeof l.lid !== 'string' || !/^lic_[A-Za-z0-9_-]{4,64}$/.test(l.lid)) e.push('bad lid');
  if (!TIER_NAMES.includes(l.tier)) e.push('unknown tier');
  if (!Array.isArray(l.services) || l.services.some((s) => typeof s !== 'string')) e.push('services must be a list');
  if (!Number.isInteger(l.seats) || l.seats < 1 || l.seats > 100000) e.push('seats must be a positive integer');
  if (l.connectors !== undefined && (!Number.isInteger(l.connectors) || l.connectors < 0)) e.push('connectors must be a whole number');
  if (Number.isNaN(Date.parse(l.iat))) e.push('bad iat');
  if (l.exp !== null && Number.isNaN(Date.parse(l.exp))) e.push('bad exp');
  if (l.grace_days !== undefined && (!Number.isInteger(l.grace_days) || l.grace_days < 0 || l.grace_days > 365)) e.push('bad grace_days');
  if (l.trial !== undefined && typeof l.trial !== 'boolean') e.push('trial must be true or false');
  if (l.trial_ext !== undefined && typeof l.trial_ext !== 'boolean') e.push('trial_ext must be true or false');
  if (l.org !== undefined && (typeof l.org !== 'string' || !ORG_ID.test(l.org))) e.push('org must be an opaque id such as org_acme0001 (org_ and 4 to 64 letters, digits, _ or -)');
  if (l.trial === true && l.org === undefined) e.push('a trial licence must carry org');
  if (typeof l.sig !== 'string' || !l.sig.startsWith('ed25519:')) e.push('missing ed25519 signature');
  return e;
}

/**
 * Verify a licence object. Returns { state, reason, ...fields }:
 *   valid | grace (expired, inside grace_days) | expired | not_yet_valid | invalid
 * `keys` defaults to the embedded LICENSE_KEYS; tests pass their own. `floor` is the latest time this
 * vault recorded: expiry and grace are judged at the later of now and floor.
 */
export function verifyLicense(l, { keys = LICENSE_KEYS, now = Date.now(), floor = null } = {}) {
  const errs = shapeErrors(l);
  if (errs.length) return { state: 'invalid', reason: errs.join('; ') };
  const candidates = l.kid ? (keys[l.kid] ? [keys[l.kid]] : []) : Object.values(keys);
  if (!candidates.length) return { state: 'invalid', reason: `unknown signing key ${l.kid}` };
  const sig = Buffer.from(l.sig.slice('ed25519:'.length), 'base64');
  const data = canonical(l);
  const ok = candidates.some((k) => { try { return crypto.verify(null, data, crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig); } catch { return false; } });
  if (!ok) return { state: 'invalid', reason: 'signature does not verify' };
  const fields = { lid: l.lid, tier: l.tier, services: l.services, seats: l.seats, connectors: l.connectors ?? null, iat: l.iat, exp: l.exp, grace_days: l.grace_days ?? 14 };
  for (const k of ['trial', 'org', 'trial_ext']) if (l[k] !== undefined) fields[k] = l[k];
  const at = Number.isFinite(floor) && floor > now ? floor : now;
  if (Date.parse(l.iat) - SKEW_MS > now) return { state: 'not_yet_valid', reason: `issued for ${l.iat}`, ...fields };
  if (l.exp === null) return { state: 'valid', reason: 'perpetual', days_left: null, ...fields };
  const end = Date.parse(l.exp), graceEnd = end + fields.grace_days * DAY;
  if (at <= end) return { state: 'valid', reason: `valid until ${l.exp}`, days_left: Math.ceil((end - at) / DAY), ...fields };
  if (at <= graceEnd) return { state: 'grace', reason: `expired ${l.exp}; grace until ${new Date(graceEnd).toISOString().slice(0, 10)}`, days_left: Math.ceil((graceEnd - at) / DAY), ...fields };
  return { state: 'expired', reason: `expired ${l.exp}`, days_left: 0, ...fields };
}

/** Read and verify the installed licence. No licence is the normal case: state "none", free tier. */
export function loadLicense({ env = process.env, file = licenseFile(env), keys, now } = {}) {
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return { state: 'none', reason: 'no licence installed (the free tier needs none)' }; }
  let l; try { l = JSON.parse(raw); } catch { return { state: 'invalid', reason: 'not JSON' }; }
  const t = Number.isFinite(now) ? now : Date.now();
  const floor = recordClock(clockFile(env), t);
  return verifyLicense(l, { keys, now: t, floor });
}

/** Raise the recorded clock to `now` and return the floor to judge this check by (the latest time
 *  recorded, which is never lowered). A clock file that cannot be read or written leaves the floor at now. */
function recordClock(file, now) {
  let prev = null;
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && Number.isFinite(j.floor)) prev = j.floor; } catch { /* no record yet */ }
  const floor = prev !== null && prev > now ? prev : now;
  if (prev === null || floor > prev) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writePrivate(file, `${JSON.stringify({ floor })}\n`); } catch { /* a read-only configuration directory: the floor is still applied this time */ }
  }
  return floor;
}

/** Sign a licence. For the development key script and tests only: the client never holds a signing key. */
export function signLicense(fields, privateKeyPem, kid = undefined) {
  const l = { ...fields, ...(kid ? { kid } : {}) }; delete l.sig;
  const sig = crypto.sign(null, canonical(l), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return { ...l, sig: `ed25519:${sig}` };
}
