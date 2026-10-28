// SPDX-License-Identifier: Apache-2.0
// `memev invite` mints a one-time enrolment secret and prints a code, a link and a QR code.
// The secret is stored only as a hash. Redeeming the code enrolls one computer.
//
// The first invite of a vault with no licence also asks the licence endpoint for the vault's one
// Personal trial: the endpoint signs it, the client verifies it offline before installing it, and
// the vault records it, so a second invite asks for nothing. When the trial ends, the usual grace
// then read-only rules apply.
import path from 'node:path';
import { readJson, writePrivate, writePrivateJson } from '../engine/util.mjs';
import { mintInvite } from '../engine/devices.mjs';
import { isVault } from '../engine/vault.mjs';
import { loadLicense, verifyLicense, licenseFile, extraFields, LICENSE_KEYS } from '../engine/license.mjs';
import { TRIAL_DAYS, TIERS } from '../engine/entitlements.mjs';
import { licenseEndpoint } from './licensing.mjs';
import { fetchOut } from '../engine/net.mjs';
import { qrText } from '../../vendor/qr.mjs';

const DAY = 86400e3;
const MAX_TRIAL_BYTES = 64 * 1024;
const trialRecord = (root) => path.join(root, '.memev', 'trial.json');

const explain = (status, body) => {
  let j = null; try { j = JSON.parse(body); } catch { /* plain text */ }
  const why = (j && (j.error_description || j.reason || j.message || (typeof j.error === 'string' ? j.error : ''))) || String(body || '').trim().slice(0, 200);
  return why || `the licence server answered ${status}`;
};

/**
 * The vault's one trial. On the first invite of a vault with no licence, the licence endpoint is
 * asked for it: one call, the word "trial" and nothing else. The answer must be a signed personal
 * licence that ends within TRIAL_DAYS of being issued; it is verified offline here and only then
 * installed, and the vault records it. A second invite, or a vault that has any licence, issues
 * nothing. `keys`, `fetchImpl` and `now` are for tests.
 */
export async function issueTrial({ root, env = process.env, flags = {}, keys = LICENSE_KEYS, fetchImpl = (u, o) => fetchOut(u, o, env), now = Date.now(), timeoutMs = 15000 }) {
  const lic = loadLicense({ env, keys, now });
  if (lic.state !== 'none') return { issued: false, reason: 'a licence is already installed, so no trial is issued' };
  const rec = readJson(trialRecord(root), null);
  if (rec && rec.lid) return { issued: false, reason: 'this vault has already had its trial' };
  const endpoint = licenseEndpoint({ flags, env });
  if (!endpoint) return { issued: false, reason: 'no licence server is set: pass --server <https url> or set MEMEV_LICENSE_URL' };
  let res, body;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ purpose: 'trial' }), signal: AbortSignal.timeout(timeoutMs) });
    body = await res.text();
  } catch (e) { return { issued: false, reason: `could not reach the licence server (${e.cause?.code || e.name || 'network error'})` }; }
  if (body.length > MAX_TRIAL_BYTES) return { issued: false, reason: 'the licence server sent an answer that is too large' };
  if (!res.ok) return { issued: false, reason: `the licence server refused the trial: ${explain(res.status, body)}` };
  let l; try { l = JSON.parse(body); } catch { return { issued: false, reason: 'the licence server did not send a licence file' }; }
  if (l && typeof l === 'object' && !Array.isArray(l) && l.license && typeof l.license === 'object' && !l.lid) l = l.license;
  const extra = extraFields(l);
  if (extra.length) return { issued: false, reason: `the licence carries more than a licence may (${extra.join(', ')}); not installed` };
  const v = verifyLicense(l, { keys, now });
  if (v.state !== 'valid') return { issued: false, reason: `the trial does not install: ${v.reason}` };
  if (v.tier !== 'personal') return { issued: false, reason: 'the trial is not a personal licence' };
  if (l.exp === null) return { issued: false, reason: 'the trial has no end date' };
  if (Date.parse(l.exp) - Date.parse(l.iat) > TRIAL_DAYS * DAY) return { issued: false, reason: `the trial is longer than ${TRIAL_DAYS} days` };
  if (v.seats > TIERS.personal.computers) return { issued: false, reason: `the trial covers more than ${TIERS.personal.computers} computers` };
  const file = licenseFile(env);
  writePrivate(file, `${JSON.stringify(l, null, 2)}\n`);
  writePrivateJson(trialRecord(root), { lid: l.lid, iat: l.iat, exp: l.exp, days: TRIAL_DAYS, at: new Date(now).toISOString() });
  return { issued: true, license: l, state: v.state, file };
}

export function vaultAddress(root) {
  const tun = readJson(path.join(root, '.memev', 'tunnel.json'), null);
  if (tun?.url) return String(tun.url).replace(/\/$/, '');
  const cfg = readJson(path.join(root, '.memev', 'config.json'), {});
  return `http://127.0.0.1:${cfg.port || 7787}`;
}

export async function command(_cmd, _pos, flags, { root, env = process.env }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const ttl = flags.ttl ? Number(flags.ttl) : 15 * 60;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('--ttl is a number of seconds');
  const trial = await issueTrial({ root, env, flags });
  if (trial.issued) console.log(`This vault's one ${TRIAL_DAYS}-day Personal trial was issued and installed in ${trial.file}; it is checked on this computer, with no network.`);
  const minted = mintInvite(root, { address: vaultAddress(root), ttlSec: ttl });
  console.log(`code: ${minted.code}`);
  console.log(`link: ${minted.link}`);
  console.log(qrText(minted.link));
  return 0;
}
