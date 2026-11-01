// SPDX-License-Identifier: Apache-2.0
// `memev invite` mints a one-time enrolment secret and prints a code, a link and a QR code.
// The secret is stored only as a hash. Redeeming the code enrolls one computer.
// On a vault that cannot add a computer, it says so first, in the tier-aware copy of MEM-062,
// and offers the upgrade or the trial; with no trial left it prints no code at all.
// `memev invite --teammate <name>` is the same for a colleague, on the Team plan: their computer
// joins under their name, and their apps' seats read <app>@<name>-<machine> on the bus.
import path from 'node:path';
import { readJson } from '../engine/util.mjs';
import { mintInvite } from '../engine/devices.mjs';
import { isVault } from '../engine/vault.mjs';
import { loadLicense } from '../engine/license.mjs';
import { limitsFor, seatPolicy } from '../engine/entitlements.mjs';
import { qrText } from '../../vendor/qr.mjs';
import { registry } from './licensing.mjs';

export function tunnelUrl(root) {
  const tun = readJson(path.join(root, '.memev', 'tunnel.json'), null);
  return tun?.url ? String(tun.url).replace(/\/$/, '') : null;
}

export function loopbackAddress(root) {
  const cfg = readJson(path.join(root, '.memev', 'config.json'), {});
  return `http://127.0.0.1:${cfg.port || 7787}`;
}

export function vaultAddress(root) {
  return tunnelUrl(root) || loopbackAddress(root);
}

/** A trial is available while the vault is on the free tier and has not started one. The record a
 *  started trial leaves in the vault is read by readTrialRecord; while it is absent a trial may
 *  still be started. There is no Personal trial: the free core is the trial (owner decision 31 Oct 2026, docs/BUSINESS-TRIAL.md), so no trial is offered here and this reports none. */
export function trialAvailable() {
  return false;
}

/** Teammate invites need the Team entitlement: a licence that is valid or in grace and includes the team service. */
export const teamEntitled = (lic) => (limitsFor(lic).services || []).includes('team');

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export async function command(_cmd, _pos, flags, { root, env = process.env, license = null }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const ttl = flags.ttl ? Number(flags.ttl) : 15 * 60;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('--ttl is a number of seconds');
  const teammate = flags.teammate !== undefined ? String(flags.teammate ?? '').trim().toLowerCase() : null;
  if (teammate !== null && !NAME_RE.test(teammate)) throw new Error('--teammate is a short name: letters, digits, dots, dashes or underscores, starting with a letter or digit');
  const lic = license || loadLicense({ env });
  const { reg } = registry(root);
  const policy = seatPolicy({ license: lic, devices: reg.list() });
  if (!policy.can_enroll) {
    // The vault cannot add a computer: say so, in the tier-aware copy, before anything else.
    console.log(policy.reason);
  }
  const cfg = readJson(path.join(root, '.memev', 'config.json'), {});
  const tunnel = tunnelUrl(root);
  // Without a tunnel, only an explicit --local may mint the loopback address, for a computer that
  // shares this machine (a container or a second user).
  if (!tunnel && !flags.local) {
    if (cfg.remote?.enabled === true) throw new Error('the secure link is on but the tunnel has no address yet; check memev cloud status, or mint for this machine with: memev invite --local');
    throw new Error('the secure link is off, so a second computer cannot reach this vault. Turn it on with: memev cloud on. For a computer that shares this machine (a container or a second user): memev invite --local');
  }
  const address = tunnel || loopbackAddress(root);
  if (!tunnel) console.log('note: this address is loopback; only a computer that shares this machine can use it');
  // a vault that cannot add a computer, with no trial to offer, prints no code: the plan line above is the answer
  if (!policy.can_enroll && !trialAvailable()) return 1;
  // a teammate's computer is a computer like any other: the seat policy and the address rule above come first
  if (teammate !== null) {
    if (!teamEntitled(lic)) {
      console.log(`Teammate invites are on the Team plan. This vault is on the ${limitsFor(lic).tier} tier; install a Team licence (memev license install <file>) to invite a colleague.`);
      return 0;
    }
    const minted = mintInvite(root, { address, ttlSec: ttl, teammate });
    console.log(`teammate: ${teammate}`);
    console.log(`code: ${minted.code}`);
    console.log(`link: ${minted.link}`);
    console.log(qrText(minted.link));
    return 0;
  }
  const minted = mintInvite(root, { address, ttlSec: ttl });
  console.log(`code: ${minted.code}`);
  console.log(`link: ${minted.link}`);
  console.log(qrText(minted.link));
  return 0;
}
