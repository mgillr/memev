#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// DEVELOPMENT ONLY: make a throwaway signing key pair and sign test licences with it. memev only
// trusts the vendor key in src/engine/license.mjs, so these licences cannot be installed; they are
// for tests that pass their own key set. Real licences come from scripts/license/issue.mjs.
// The private key is written outside this repository (it refuses a path inside it) and .gitignore
// excludes *.pem as a second guard.
//
//   node scripts/license-dev.mjs keygen [--out DIR]
//   node scripts/license-dev.mjs sign --key DIR/license-ed25519.pem --tier personal_more --seats 4 \
//        [--connectors 10] [--services sync,backup,relay,merge] [--exp 2027-11-15|none] [--grace 14] [--kid ID]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signLicense, verifyLicense, issuedServices } from '../src/engine/license.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2); const cmd = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
const inside = (p) => { const r = path.relative(REPO, path.resolve(p)); return !r.startsWith('..') && !path.isAbsolute(r); };

if (cmd === 'keygen') {
  const dir = path.resolve(arg('out', path.join(os.homedir(), '.config', 'memev-dev', 'license-keys')));
  if (inside(dir)) { console.error(`refusing to write a private key inside the repository (${dir})`); process.exit(2); }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const kid = `dev-${crypto.createHash('sha256').update(pub).digest('hex').slice(0, 8)}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, `${kid}.pem`);
  fs.writeFileSync(f, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ kid, public_key: pub, private_key_file: f, note: 'development key: add the public key to a test key set, never to LICENSE_KEYS in a release' }, null, 2));
} else if (cmd === 'sign') {
  const keyFile = arg('key'); if (!keyFile) { console.error('--key is required'); process.exit(2); }
  const pem = fs.readFileSync(keyFile, 'utf8');
  const exp = arg('exp', null);
  const fields = { v: 1, lid: arg('lid', `lic_${crypto.randomBytes(6).toString('hex')}`), tier: arg('tier', 'personal_more'), services: issuedServices(arg('services')), seats: Number(arg('seats', 4)), connectors: Number(arg('connectors', 10)), iat: arg('iat', new Date().toISOString().slice(0, 10)), exp: !exp || exp === 'none' ? null : exp, grace_days: Number(arg('grace', 14)) };
  const pub = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');
  const kid = arg('kid', `dev-${crypto.createHash('sha256').update(pub).digest('hex').slice(0, 8)}`);
  const lic = signLicense(fields, pem, kid);
  const check = verifyLicense(lic, { keys: { [kid]: pub } });
  if (!['valid', 'grace', 'expired', 'not_yet_valid'].includes(check.state)) { console.error(`self-check failed: ${check.reason}`); process.exit(1); }
  console.log(JSON.stringify(lic, null, 2));
} else {
  console.error('usage: license-dev.mjs keygen [--out DIR] | sign --key FILE --tier personal_more|business|corporate|founder --seats N [--exp DATE|none]');
  process.exit(2);
}
