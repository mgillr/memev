#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Issue a licence file signed with the vendor key. Only whoever holds that private key can run this
// usefully; everyone else can read it to see exactly what a licence contains. memev checks the
// signature offline against the public key in src/engine/license.mjs and never calls home.
//
//   node scripts/license/issue.mjs --key /path/outside/repo/memev-license-ed25519.pem \
//        --tier personal_more --seats 12 [--exp 2027-11-15|none] [--grace 14] [--iat 2026-11-01] \
//        [--services sync,backup,relay] [--connectors N] [--lid lic_…] [--out FILE]
//
// A Business trial, or a Corporate pilot (the sales-assisted path):
//   node scripts/license/issue.mjs --key FILE --trial --seats 10 --org org_<id> [--tier corporate] [--out FILE]
// The one self-serve extension, refused a second time for the same org by the local ledger:
//   node scripts/license/issue.mjs --key FILE --trial --extension --seats 10 --org org_<id> [--ledger FILE] [--out FILE]
//
// The key must live outside this repository (the script refuses a path inside it), and it is never
// printed. Personal needs no licence, so the script does not issue one for it. A trial is for the
// business or corporate tier only, runs for the fixed trial length, and carries the merge service.
// The size is never a default here: the caller passes the configured trial cap, or the order-form
// number for a pilot, as --seats.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { signLicense, verifyLicense, LICENSE_KEYS, TIER_NAMES, canonicalTier } from '../../src/engine/license.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const inside = (p) => { const r = path.relative(REPO, path.resolve(p)); return !r.startsWith('..') && !path.isAbsolute(r); };
const fail = (m, code = 2) => { console.error(m); process.exit(code); };
const day = /^\d{4}-\d{2}-\d{2}$/;
const has = (k) => argv.includes(`--${k}`);
// The trial term and its one extension, in days (the same numbers test/helpers/trial-constants.mjs holds).
const TRIAL_DAYS = 14;
const TRIAL_EXT_DAYS = 14;
// The org id the schema accepts (src/engine/license.mjs): opaque, so it names no person, machine or vault.
const ORG = /^org_[A-Za-z0-9_-]{4,64}$/;
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const ledgerPath = () => arg('ledger', path.join(os.tmpdir(), 'memev-extensions.json'));

if (argv.includes('--help') || !argv.length) fail('usage: issue.mjs --key FILE --tier personal_more|business|corporate|founder --seats N [--exp DATE|none] [--grace DAYS] [--out FILE] | issue.mjs --key FILE --trial [--extension] --seats N --org org_<id> [--tier corporate] [--ledger FILE] [--out FILE]');
const isTrial = has('trial');
const isExtension = has('extension');
if (isExtension && !isTrial) fail('--extension needs --trial (it extends a trial)');
if (isTrial && has('days')) fail('the trial length is fixed; do not pass --days');
let tier = String(arg('tier', isTrial ? 'business' : ''));
if (tier === 'free') fail('Personal needs no licence');
if (!TIER_NAMES.includes(tier)) fail('--tier must be one of personal_more, business, corporate or founder (the older ids personal, team, office and enterprise are still accepted)');
if (isTrial) {
  tier = canonicalTier(tier);
  if (tier !== 'business' && tier !== 'corporate') fail('--trial is for the business or corporate tier only; the Personal tiers have no trial');
}
const keyFile = arg('key'); if (!keyFile) fail('--key is required');
const org = isTrial ? arg('org') : null;
if (isTrial && (!org || !ORG.test(org))) fail('--org is required for a trial and must look like org_<id> (4 to 64 letters, digits, _ or -); it names no person, machine or vault');
const seats = Number(arg('seats'));
if (!Number.isInteger(seats) || seats < 1) fail('--seats must be a whole number of computers, 1 or more (the vault computer counts as one)');
const exp = arg('exp', null); const iat = arg('iat', new Date().toISOString().slice(0, 10));
if (isTrial && exp) fail('--trial sets the expiry to the trial length; do not pass --exp');
if (!isTrial && exp && exp !== 'none' && !day.test(exp)) fail('--exp must be YYYY-MM-DD or none');
if (!day.test(iat)) fail('--iat must be YYYY-MM-DD');
const grace = Number(arg('grace', isTrial ? 7 : 14));
if (isTrial && (!Number.isInteger(grace) || grace < 0)) fail('--grace must be a whole number of days, 0 or more');
// A trial gets at most one extension. The issuer is the authority for that; the local ledger is a
// second check, so a second extension for the same org is refused before the key is even read.
const readLedger = () => { try { return JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')); } catch { return {}; } };
if (isExtension && Object.hasOwn(readLedger(), org)) fail(`an extension for ${org} has already been issued (ledger ${path.resolve(ledgerPath())}); a trial gets at most one extension`);
if (inside(keyFile)) fail(`refusing to read a private key from inside the repository (${path.resolve(keyFile)}); keep it outside`);
const st = fs.statSync(keyFile);
if (process.platform !== 'win32' && (st.mode & 0o077)) fail(`the key file is readable by others (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it first`);
let pub;
const pem = fs.readFileSync(keyFile, 'utf8');
try { pub = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64'); } catch { fail('the key file is not an Ed25519 private key'); }
const kid = Object.keys(LICENSE_KEYS).find((k) => LICENSE_KEYS[k] === pub);
if (!kid) fail('this key is not the vendor key built into memev (src/engine/license.mjs); a licence signed with it would be rejected');

let services = String(arg('services', isTrial ? 'merge' : 'sync,backup,relay')).split(',').map((x) => x.trim()).filter(Boolean);
if (isTrial && !services.includes('merge')) services = ['merge', ...services];
const fields = {
  v: 1, lid: arg('lid', `lic_${crypto.randomBytes(6).toString('hex')}`), tier,
  services, seats,
  ...(arg('connectors') ? { connectors: Number(arg('connectors')) } : {}),
  iat, exp: isTrial ? addDays(iat, isExtension ? TRIAL_EXT_DAYS : TRIAL_DAYS) : (!exp || exp === 'none' ? null : exp), grace_days: grace,
  ...(isTrial ? { trial: true, ...(isExtension ? { trial_ext: true } : {}), org } : {}),
};
const lic = signLicense(fields, pem, kid);
const check = verifyLicense(lic);
if (check.state === 'invalid') fail(`self-check failed: ${check.reason}`, 1);
if (isExtension) {
  // the ledger is written only once the licence has verified, so a refused request leaves no record
  const ledgerFile = ledgerPath();
  let ledger = readLedger();
  ledger[org] = { lid: fields.lid, iat, exp: fields.exp };
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
}
const newer = canonicalTier(tier);
if (newer !== tier) console.error(`new licences for this tier use the id ${newer}`);
const text = `${JSON.stringify(lic, null, 2)}\n`;
const outFile = arg('out');
if (outFile) {
  if (inside(outFile)) fail('refusing to write a customer licence inside the repository; pick a path outside it');
  fs.writeFileSync(outFile, text, { flag: 'wx' });
  console.error(`wrote ${lic.lid} (${tier}, ${seats} computer${seats === 1 ? '' : 's'}, ${check.state}) to ${path.resolve(outFile)}`);
} else process.stdout.write(text);
