// SPDX-License-Identifier: Apache-2.0
// `memev invite` mints a one-time enrolment secret and prints a code, a link and a QR code.
// The secret is stored only as a hash. Redeeming the code enrolls one computer.
// On a vault that cannot add a computer, it says so first, in the tier-aware copy of MEM-062,
// and offers the upgrade or the trial; with no trial left it prints no code at all.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../engine/util.mjs';
import { mintInvite } from '../engine/devices.mjs';
import { isVault } from '../engine/vault.mjs';
import { qrText } from '../../vendor/qr.mjs';
import { seatPolicy } from '../engine/entitlements.mjs';
import { loadLicense } from '../engine/license.mjs';
import { registry } from './licensing.mjs';

export function vaultAddress(root) {
  const tun = readJson(path.join(root, '.memev', 'tunnel.json'), null);
  if (tun?.url) return String(tun.url).replace(/\/$/, '');
  const cfg = readJson(path.join(root, '.memev', 'config.json'), {});
  return `http://127.0.0.1:${cfg.port || 7787}`;
}

/** The record a started trial leaves in the vault; while it is absent a trial may still be started. */
const trialRecord = (root) => path.join(root, '.memev', 'trial.json');

/** A trial is available while the vault is on the free tier and has not started one. */
export function trialAvailable(root, license) {
  if (!license || license.state !== 'none') return false;
  return !fs.existsSync(trialRecord(root));
}

export async function command(_cmd, _pos, flags, { root, env, license = null }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const ttl = flags.ttl ? Number(flags.ttl) : 15 * 60;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('--ttl is a number of seconds');
  const lic = license || loadLicense({ env });
  const { reg } = registry(root);
  const policy = seatPolicy({ license: lic, devices: reg.list() });
  if (!policy.can_enroll) {
    // The vault cannot add a computer: say so, in the tier-aware copy, before anything else.
    console.log(policy.reason);
    if (!trialAvailable(root, lic)) {
      // Free with no trial left, or a licence that covers no more computers: no code.
      return 1;
    }
  }
  const minted = mintInvite(root, { address: vaultAddress(root), ttlSec: ttl });
  console.log(`code: ${minted.code}`);
  console.log(`link: ${minted.link}`);
  console.log(qrText(minted.link));
  return 0;
}
