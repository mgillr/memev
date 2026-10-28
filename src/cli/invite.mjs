// SPDX-License-Identifier: Apache-2.0
// `memev invite` mints a one-time enrolment secret and prints a code, a link and a QR code.
// The secret is stored only as a hash. Redeeming the code enrolls one computer.
// `memev invite --teammate <name>` is the same for a colleague, on the Team plan: their computer
// joins under their name, and their apps' seats read <app>@<name>-<machine> on the bus.
import path from 'node:path';
import { readJson } from '../engine/util.mjs';
import { mintInvite } from '../engine/devices.mjs';
import { isVault } from '../engine/vault.mjs';
import { loadLicense } from '../engine/license.mjs';
import { limitsFor } from '../engine/entitlements.mjs';
import { qrText } from '../../vendor/qr.mjs';

export function vaultAddress(root) {
  const tun = readJson(path.join(root, '.memev', 'tunnel.json'), null);
  if (tun?.url) return String(tun.url).replace(/\/$/, '');
  const cfg = readJson(path.join(root, '.memev', 'config.json'), {});
  return `http://127.0.0.1:${cfg.port || 7787}`;
}

/** Teammate invites need the Team entitlement: a licence that is valid or in grace and includes the team service. */
export const teamEntitled = (lic) => (limitsFor(lic).services || []).includes('team');

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export async function command(_cmd, _pos, flags, { root, env = process.env }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const ttl = flags.ttl ? Number(flags.ttl) : 15 * 60;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('--ttl is a number of seconds');
  if (flags.teammate !== undefined) {
    const name = String(flags.teammate ?? '').trim().toLowerCase();
    if (!NAME_RE.test(name)) throw new Error('--teammate is a short name: letters, digits, dots, dashes or underscores, starting with a letter or digit');
    const lic = loadLicense({ env });
    if (!teamEntitled(lic)) {
      console.log(`Teammate invites are on the Team plan. This vault is on the ${limitsFor(lic).tier} tier; install a Team licence (memev license install <file>) to invite a colleague.`);
      return 0;
    }
    const minted = mintInvite(root, { address: vaultAddress(root), ttlSec: ttl, teammate: name });
    console.log(`teammate: ${name}`);
    console.log(`code: ${minted.code}`);
    console.log(`link: ${minted.link}`);
    console.log(qrText(minted.link));
    return 0;
  }
  const minted = mintInvite(root, { address: vaultAddress(root), ttlSec: ttl });
  console.log(`code: ${minted.code}`);
  console.log(`link: ${minted.link}`);
  console.log(qrText(minted.link));
  return 0;
}
