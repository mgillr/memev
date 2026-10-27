// SPDX-License-Identifier: Apache-2.0
// `memev license …` and `memev devices …`. This computer is never limited (CHARTER.md). A licence
// sets how many other computers can be added to the vault; see docs/PRICING.md (draft).
import fs from 'node:fs';
import path from 'node:path';
import { loadLicense, verifyLicense, licenseFile } from '../engine/license.mjs';
import { report, seatPolicy } from '../engine/entitlements.mjs';
import { DeviceRegistry, hostDevice, deviceKeygen } from '../engine/devices.mjs';
import { TokenStore } from '../engine/tokens.mjs';
import { configDir, writePrivate, exists } from '../engine/util.mjs';
import { isVault } from '../engine/vault.mjs';
import { out } from './common.mjs';

export function registry(root) {
  const reg = new DeviceRegistry(path.join(root, '.memev', 'devices.json'));
  const tokens = new TokenStore(path.join(root, '.memev', 'tokens.json'));
  reg.ensureHost(hostDevice(root)); reg.migrate(tokens);
  return { reg, tokens };
}

/** Licence, seats and notes in one object (the doctor check and `memev license status --json`). */
export function licensingStatus({ root, env = process.env, vault = null }) {
  const license = loadLicense({ env });
  const seats = vault?.devices ? vault.devices.countSeats() : isVault(root) ? registry(root).reg.countSeats() : { computers: 1, connectors: 0, local_clients: 0, flagged: [], active_days: 30 };
  const devices = vault?.devices ? vault.devices.list() : isVault(root) ? registry(root).reg.list() : [];
  return { license, ...report({ license, seats, devices }) };
}

export async function command(cmd, pos, flags, { root, env }) {
  const sub = pos[0] || (cmd === 'devices' ? 'list' : 'status');
  if (cmd === 'license') {
    if (sub === 'status') {
      const s = licensingStatus({ root, env });
      if (flags.json) { console.log(JSON.stringify(s, null, 2)); return 0; }
      const l = s.license;
      console.log(l.state === 'none' ? 'Licence: none. The free tier needs none: everything on this computer is free and unlimited.' : `Licence ${l.lid || ''}: ${l.state}${l.tier ? ` · ${l.tier}` : ''}${l.seats ? ` · ${l.seats} computer(s)` : ''}${l.connectors != null ? ` · ${l.connectors} connector(s)` : ''} · ${l.reason}`);
      console.log(`Computers: ${s.computers_enrolled} of ${s.seats_licensed} enrolled${s.can_enroll ? '' : ' (no more can be added)'}. This computer is never limited.`);
      console.log(`Seen in the last ${s.usage.active_days} days: ${s.usage.computers} computer(s), ${s.usage.connectors} cloud connector(s), ${s.usage.local_clients} local client(s). Connectors are counted, not limited.`);
      if (!s.can_enroll && s.computers_enrolled > 1) out.info(s.enroll_refused);
      for (const n of s.notes) out.info(n);
      return 0;
    }
    if (sub === 'install') {
      const src = pos[1]; if (!src) throw new Error('memev license install <file>');
      const l = JSON.parse(fs.readFileSync(src, 'utf8')); const v = verifyLicense(l);
      if (v.state === 'invalid') { out.bad(`not installed: ${v.reason}`); return 1; }
      fs.mkdirSync(configDir(env), { recursive: true }); writePrivate(licenseFile(env), `${JSON.stringify(l, null, 2)}\n`);
      out.ok(`installed licence ${l.lid} (${v.state}) in ${licenseFile(env)}`); return 0;
    }
    if (sub === 'remove') { fs.rmSync(licenseFile(env), { force: true }); out.ok('licence removed; nothing changes for the free tier'); return 0; }
    throw new Error('memev license status [--json] | install <file> | remove');
  }
  // devices
  if (sub === 'keygen') {
    // run on a remote computer: its own key, so a copied configuration is useless without it
    const f = path.join(configDir(env), 'keys', 'device-ed25519.pem');
    if (exists(f) && !flags.force) { out.info(`a device key already exists: ${f} (--force replaces it)`); }
    else { const k = deviceKeygen(); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); writePrivate(f, k.privateKeyPem); fs.writeFileSync(`${f}.pub`, `${k.publicKey}\n`); }
    console.log(`Public key (give it to the vault's host: memev devices enroll --kind remote-computer --pubkey <key>):\n${fs.readFileSync(`${f}.pub`, 'utf8').trim()}`);
    return 0;
  }
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const { reg, tokens } = registry(root);
  if (sub === 'list') {
    const seats = reg.countSeats();
    if (flags.json) { console.log(JSON.stringify({ devices: reg.list(), seats }, null, 2)); return 0; }
    for (const d of reg.list()) console.log(`  ${d.status === 'active' ? (d.kind === 'host' ? '*' : ' ') : 'x'} ${d.id}  ${d.kind.padEnd(16)} ${String(d.label).padEnd(20)} ${d.last_seen ? `seen ${d.last_seen.slice(0, 16)}` : 'not seen yet'}${d.pubkey ? ' · key' : ''}${d.flags?.length ? ` · ${d.flags.map((f) => f.type).join(', ')}` : ''}`);
    console.log(`Computers: ${seats.computers} · cloud connectors: ${seats.connectors} · local clients: ${seats.local_clients} (active in the last ${seats.active_days} days)`);
    for (const f of seats.flagged) out.warn(`${f.label} (${f.id}): ${f.flags.join(', ')}; memev devices rotate ${f.id} if its credential was copied`);
    const s = report({ license: loadLicense({ env }), seats, devices: reg.list() });
    console.log(`Licensed for ${s.seats_licensed} computer(s); ${s.computers_enrolled} enrolled.`);
    for (const n of s.notes) out.info(n);
    return 0;
  }
  if (sub === 'enroll') {
    const kind = String(flags.kind || 'remote-computer');
    const pub = flags['pubkey-file'] ? fs.readFileSync(String(flags['pubkey-file']), 'utf8').trim() : flags.pubkey || null;
    const policy = seatPolicy({ license: loadLicense({ env }), devices: reg.list() });
    let r; try { r = reg.enroll(tokens, { kind, label: flags.label || pos[1] || kind, pubkey: pub, policy }); } catch (e) { if (e.code !== 'seats') throw e; out.bad(e.message); return 1; }
    console.log(`Enrolled ${r.device.label} as ${r.device.id} (${kind}). Its own token (shown once):\n${r.token}`);
    if (kind === 'remote-computer') console.log(`On that computer: memev join <this vault's URL, from memev cloud url> --token <the token above>`);
    return 0;
  }
  if (sub === 'remove' || sub === 'revoke') { const d = reg.remove(tokens, pos[1]); out.ok(`removed ${d.label} (${d.id}); its token no longer works${d.kind === 'remote-computer' ? ' and its seat is free' : ''}`); return 0; }
  if (sub === 'rotate') { const r = reg.rotate(tokens, pos[1]); console.log(`New token for ${r.device.label} (shown once; the old one stopped working):\n${r.token}`); return 0; }
  if (sub === 'rename') { const d = reg.rename(pos[1], pos.slice(2).join(' ')); out.ok(`${d.id} is now "${d.label}"`); return 0; }
  throw new Error('memev devices [list|enroll --kind remote-computer --pubkey KEY|cloud-connector|local-client --label NAME|remove ID|rotate ID|rename ID NAME|keygen]');
}
