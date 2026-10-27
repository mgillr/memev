#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Issue a licence file signed with the vendor key. Only whoever holds that private key can run this
// usefully; everyone else can read it to see exactly what a licence contains. memev checks the
// signature offline against the public key in src/engine/license.mjs and never calls home.
//
//   node scripts/license/issue.mjs --key /path/outside/repo/memev-license-ed25519.pem \
//        --tier team --seats 12 [--exp 2027-11-15|none] [--grace 14] [--iat 2026-11-01] \
//        [--services sync,backup,relay] [--connectors N] [--lid lic_…] [--out FILE]
//
// The key must live outside this repository (the script refuses a path inside it), and it is never
// printed. The free tier needs no licence, so the script does not issue one for it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { signLicense, verifyLicense, LICENSE_KEYS, TIER_NAMES } from '../../src/engine/license.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const inside = (p) => { const r = path.relative(REPO, path.resolve(p)); return !r.startsWith('..') && !path.isAbsolute(r); };
const fail = (m, code = 2) => { console.error(m); process.exit(code); };
const day = /^\d{4}-\d{2}-\d{2}$/;

if (argv.includes('--help') || !argv.length) fail('usage: issue.mjs --key FILE --tier personal|team|office|business|enterprise|founder --seats N [--exp DATE|none] [--grace DAYS] [--out FILE]');
const keyFile = arg('key'); if (!keyFile) fail('--key is required');
if (inside(keyFile)) fail(`refusing to read a private key from inside the repository (${path.resolve(keyFile)}); keep it outside`);
const st = fs.statSync(keyFile);
if (process.platform !== 'win32' && (st.mode & 0o077)) fail(`the key file is readable by others (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it first`);
let pub;
const pem = fs.readFileSync(keyFile, 'utf8');
try { pub = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64'); } catch { fail('the key file is not an Ed25519 private key'); }
const kid = Object.keys(LICENSE_KEYS).find((k) => LICENSE_KEYS[k] === pub);
if (!kid) fail('this key is not the vendor key built into memev (src/engine/license.mjs); a licence signed with it would be rejected');

const tier = String(arg('tier', ''));
if (tier === 'free') fail('the free tier needs no licence');
if (!TIER_NAMES.includes(tier)) fail(`--tier must be one of ${TIER_NAMES.filter((t) => t !== 'free').join(', ')}`);
const seats = Number(arg('seats'));
if (!Number.isInteger(seats) || seats < 1) fail('--seats must be a whole number of computers, 1 or more (the vault computer counts as one)');
const exp = arg('exp', null); const iat = arg('iat', new Date().toISOString().slice(0, 10));
if (exp && exp !== 'none' && !day.test(exp)) fail('--exp must be YYYY-MM-DD or none');
if (!day.test(iat)) fail('--iat must be YYYY-MM-DD');
const fields = {
  v: 1, lid: arg('lid', `lic_${crypto.randomBytes(6).toString('hex')}`), tier,
  services: String(arg('services', 'sync,backup,relay')).split(',').filter(Boolean), seats,
  ...(arg('connectors') ? { connectors: Number(arg('connectors')) } : {}),
  iat, exp: !exp || exp === 'none' ? null : exp, grace_days: Number(arg('grace', 14)),
};
const lic = signLicense(fields, pem, kid);
const check = verifyLicense(lic);
if (check.state === 'invalid') fail(`self-check failed: ${check.reason}`, 1);
const text = `${JSON.stringify(lic, null, 2)}\n`;
const outFile = arg('out');
if (outFile) {
  if (inside(outFile)) fail('refusing to write a customer licence inside the repository; pick a path outside it');
  fs.writeFileSync(outFile, text, { flag: 'wx' });
  console.error(`wrote ${lic.lid} (${tier}, ${seats} computer${seats === 1 ? '' : 's'}, ${check.state}) to ${path.resolve(outFile)}`);
} else process.stdout.write(text);
