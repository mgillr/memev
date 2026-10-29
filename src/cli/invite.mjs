// SPDX-License-Identifier: Apache-2.0
// `memev invite` mints a one-time enrolment secret and prints a code, a link and a QR code.
// The secret is stored only as a hash. Redeeming the code enrolls one computer.
import path from 'node:path';
import { readJson } from '../engine/util.mjs';
import { mintInvite } from '../engine/devices.mjs';
import { isVault } from '../engine/vault.mjs';
import { qrText } from '../../vendor/qr.mjs';

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

export async function command(_cmd, _pos, flags, { root }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const ttl = flags.ttl ? Number(flags.ttl) : 15 * 60;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('--ttl is a number of seconds');
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
  const minted = mintInvite(root, { address, ttlSec: ttl });
  console.log(`code: ${minted.code}`);
  console.log(`link: ${minted.link}`);
  console.log(qrText(minted.link));
  return 0;
}
