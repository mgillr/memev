// SPDX-License-Identifier: Apache-2.0
// `memev license …` and `memev devices …`. This computer is never limited (CHARTER.md). A licence
// sets how many other computers can be added to the vault; see docs/PRICING.md (draft).
import fs from 'node:fs';
import path from 'node:path';
import { loadLicense, verifyLicense, licenseFile, extraFields, LICENSE_KEYS } from '../engine/license.mjs';
import { report, seatPolicy, tierLabel } from '../engine/entitlements.mjs';
import { DeviceRegistry, hostDevice, deviceKeygen } from '../engine/devices.mjs';
import { TokenStore } from '../engine/tokens.mjs';
import { configDir, writePrivate, exists, readJson, writePrivateJson } from '../engine/util.mjs';
import { isVault } from '../engine/vault.mjs';
import { Bus } from '../engine/bus.mjs';
import { CommitQueue } from '../engine/git.mjs';
import { out } from './common.mjs';
import { applyRelayDefault } from './relay.mjs';
import { fetchOut } from '../engine/net.mjs';

export function registry(root) {
  const reg = new DeviceRegistry(path.join(root, '.memev', 'devices.json'));
  const tokens = new TokenStore(path.join(root, '.memev', 'tokens.json'));
  reg.ensureHost(hostDevice(root)); reg.migrate(tokens);
  return { reg, tokens };
}

/** How many days before expiry the renewal reminder shows (the report's figure). */
export const RENEWAL_REMINDER_DAYS = 14;

/**
 * One reminder line for a licence that expires within the window, or null. Human output only:
 * it is shown by the doctor and `memev license status`, and never goes into the AI context.
 */
export function renewalReminder(license, { days = RENEWAL_REMINDER_DAYS } = {}) {
  if (!license || license.state !== 'valid' || !Number.isInteger(license.days_left) || license.days_left < 0 || license.days_left > days || !license.exp) return null;
  return `The licence expires in ${license.days_left === 1 ? '1 day' : `${license.days_left} days`} (${license.exp}); renew it with memev license activate <key> or memev license install <file>.`;
}

/** One human line for the licence state: no licence reads as the Personal tier, otherwise the state and tier name. */
export function licencePhrase(license) {
  return license.state === 'none' ? 'Personal, no licence needed' : `licence ${license.state}${license.tier ? ` (${tierLabel(license.tier)})` : ''}`;
}

/** Licence, seats and notes in one object (the doctor check and `memev license status --json`). `license` is a test seam for a pre-loaded licence. */
export function licensingStatus({ root, env = process.env, vault = null, license = null }) {
  const lic = license ?? loadLicense({ env });
  const seats = vault?.devices ? vault.devices.countSeats() : isVault(root) ? registry(root).reg.countSeats() : { computers: 1, connectors: 0, local_clients: 0, flagged: [], active_days: 30 };
  const devices = vault?.devices ? vault.devices.list() : isVault(root) ? registry(root).reg.list() : [];
  const s = { license: lic, ...report({ license: lic, seats, devices }) };
  s.renewal = renewalReminder(lic);
  return s;
}

const MAX_LICENSE_BYTES = 64 * 1024;
const loopback = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';

/** The licence endpoint: --server, then MEMEV_LICENSE_URL. There is no built-in address, so nothing is contacted until one is set. */
export function licenseEndpoint({ flags = {}, env = process.env } = {}) {
  const raw = String(flags.server && flags.server !== true ? flags.server : env.MEMEV_LICENSE_URL || '').trim();
  if (!raw) return null;
  let u; try { u = new URL(raw); } catch { throw new Error(`the licence endpoint is not a URL: ${raw}`); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback(u.hostname))) throw new Error('the licence endpoint must be https (plain http is accepted only for this computer)');
  return u.toString();
}

const explain = (status, body) => {
  let j = null; try { j = JSON.parse(body); } catch { /* plain text */ }
  const why = (j && (j.error_description || j.reason || j.message || (typeof j.error === 'string' ? j.error : ''))) || String(body || '').trim().slice(0, 200);
  return why || `the licence server answered ${status}`;
};

/**
 * Activate a key: one call to the licence endpoint sends the key and nothing else, the answer is the signed licence
 * file, and it is verified here, offline, before anything is written. A key the server refuses, an answer that does not
 * verify, an expired licence, or a licence that carries an identity leaves no file. `keys` and `fetchImpl` are for tests.
 */
export async function activateLicense({ key, endpoint, env = process.env, keys = LICENSE_KEYS, fetchImpl = (u, o) => fetchOut(u, o, env), now = Date.now(), timeoutMs = 15000, root = null }) {
  const k = String(key || '').trim();
  if (!k || k.length > 200 || /\s/.test(k)) return { ok: false, reason: 'that does not look like a licence key' };
  if (!endpoint) return { ok: false, reason: 'no licence server is set: pass --server <https url> or set MEMEV_LICENSE_URL' };
  let res, body;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ key: k }), signal: AbortSignal.timeout(timeoutMs) });
    body = await res.text();
  } catch (e) { return { ok: false, reason: `could not reach the licence server (${e.cause?.code || e.name || 'network error'}); nothing was changed` }; }
  if (body.length > MAX_LICENSE_BYTES) return { ok: false, reason: 'the licence server sent an answer that is too large' };
  if (!res.ok) return { ok: false, reason: `the licence server refused the key: ${explain(res.status, body)}` };
  let l; try { l = JSON.parse(body); } catch { return { ok: false, reason: 'the licence server did not send a licence file' }; }
  let relay = null;
  if (l && typeof l === 'object' && !Array.isArray(l) && l.relay && typeof l.relay === 'object') relay = { default_url: l.relay.default_url, default_domain: l.relay.default_domain };
  if (l && typeof l === 'object' && !Array.isArray(l) && l.license && typeof l.license === 'object' && !l.lid) l = l.license;
  const extra = extraFields(l);
  if (extra.length) return { ok: false, reason: `the licence carries more than a licence may (${extra.join(', ')}); not installed` };
  const v = verifyLicense(l, { keys, now });
  if (v.state === 'invalid' || v.state === 'expired') return { ok: false, reason: `the licence does not install: ${v.reason}` };
  const file = licenseFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writePrivate(file, `${JSON.stringify(l, null, 2)}\n`);
  if (root && relay) applyRelayDefault(root, relay);
  return { ok: true, license: l, state: v.state, file, relay };
}

/** The raw installed licence (unverified), or null when none is installed. The verified object drops
 *  the trial and org fields, so the trial record and the conversion both read the raw file. */
export function readLicenseRaw({ env = process.env } = {}) {
  return readJson(licenseFile(env), null);
}

const isTrial = (l) => !!(l && l.trial === true);
const trialFile = (env) => path.join(configDir(env), 'trials.json');

/** The local trial record: one entry per organisation that has had a trial on this vault. */
export function readTrialRecord(env = process.env) {
  return readJson(trialFile(env), {}) || {};
}

/**
 * Whether the merge engine may run at the next sync. The licence must be live (valid or in grace)
 * and carry the merge service; a trial may merge only while it is valid, not in grace.
 */
export function mergeAllowed(license, { now = Date.now(), keys = LICENSE_KEYS } = {}) {
  if (!license) return false;
  const v = verifyLicense(license, { now, keys });
  if (!['valid', 'grace'].includes(v.state)) return false;
  if (!(v.services || []).includes('merge')) return false;
  if (isTrial(license) && v.state !== 'valid') return false;
  return true;
}

/**
 * The keep-both copies a sync left on disk, listed but never merged. Each is the other computer's
 * version of a note, kept whole next to this one, so a person decides what to keep.
 */
export function pendingMergeCopies(root) {
  const conflicts = readJson(path.join(root, '.memev', 'jobs.json'), {})?.sync?.conflicts || [];
  const out = [];
  for (const c of conflicts) {
    if (c && c.kind === 'note' && c.copy && exists(path.join(root, ...String(c.copy).split('/')))) out.push({ path: c.path, copy: c.copy, how: c.how });
  }
  return out;
}

/**
 * Install a licence file in place. A paid licence installed over a trial converts it: the trial
 * ends the day the paid licence is installed, the paid licence takes its own dates (no unused trial
 * days carry over), and the vault is left exactly as it was (no re-enrolment, no token change, no
 * restart). A trial is refused over a live paid licence, and a second trial for the same org is
 * refused locally. `keys`, `now` and `root` are for tests.
 */
export function installLicense({ file, env = process.env, keys = LICENSE_KEYS, now = Date.now(), root = null }) {
  let l; try { l = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { ok: false, reason: 'that file is not a licence' }; }
  const v = verifyLicense(l, { keys, now });
  if (v.state === 'invalid') return { ok: false, reason: `not installed: ${v.reason}` };

  const cur = readLicenseRaw({ env });
  const converted = !isTrial(l) && isTrial(cur);
  // an expired file never replaces a live licence (a wrong file would otherwise end a live trial)
  if (v.state === 'expired' && cur && ['valid', 'grace'].includes(verifyLicense(cur, { keys, now }).state)) {
    return { ok: false, reason: 'that licence has expired and the installed licence is live; nothing was changed' };
  }

  // a trial over a live paid licence is refused
  if (isTrial(l) && cur && !isTrial(cur) && ['valid', 'grace'].includes(verifyLicense(cur, { keys, now }).state)) {
    return { ok: false, reason: 'a paid licence is already active on this vault; a trial cannot be installed over it' };
  }
  // a second trial for the same org is refused locally
  if (isTrial(l) && l.org) {
    const prev = readTrialRecord(env)[l.org];
    if (prev && prev.lid !== l.lid && !l.trial_ext) {
      return { ok: false, reason: `this vault already had a trial for this organisation (${prev.lid}); a second trial cannot be installed` };
    }
  }

  const target = licenseFile(env);
  fs.mkdirSync(configDir(env), { recursive: true, mode: 0o700 });
  writePrivate(target, `${JSON.stringify(l, null, 2)}\n`);

  // record the trial, or end the one being converted
  if (isTrial(l) || (converted && cur.org)) {
    const rec = readTrialRecord(env);
    const day = new Date(now).toISOString().slice(0, 10);
    if (isTrial(l)) {
      rec[l.org] = { lid: l.lid, iat: l.iat, exp: l.exp, extended: !!l.trial_ext, ended: null, converted_to: null };
    } else {
      const e = rec[cur.org] || { lid: cur.lid, iat: cur.iat, exp: cur.exp, extended: !!cur.trial_ext, ended: null, converted_to: null };
      e.ended = day;
      e.converted_to = l.lid;
      rec[cur.org] = e;
    }
    writePrivateJson(trialFile(env), rec);
  }

  const merge = root ? { resumes: mergeAllowed(l, { now, keys }), pending: pendingMergeCopies(root) } : null;
  return { ok: true, license: l, state: v.state, file: target, converted, trial: isTrial(l), tier: l.tier, merge };
}

export async function command(cmd, pos, flags, { root, env, license = null }) {
  const sub = pos[0] || (cmd === 'devices' ? 'list' : 'status');
  if (cmd === 'license') {
    if (sub === 'status') {
      const s = licensingStatus({ root, env, license });
      if (flags.json) { console.log(JSON.stringify(s, null, 2)); return 0; }
      const l = s.license;
      console.log(l.state === 'none' ? 'Licence: Personal, no licence needed (the free tier). Everything on this computer is free and unlimited.' : `Licence ${l.lid || ''}: licence ${l.state}${l.tier ? ` (${tierLabel(l.tier)})` : ''}${l.seats ? ` · ${l.seats} computer(s)` : ''}${l.connectors != null ? ` · ${l.connectors} connector(s)` : ''} · ${l.reason}`);
      if (s.renewal) console.log(s.renewal);
      console.log(s.computers_enrolled > s.seats_licensed
        ? `Computers: ${s.computers_enrolled} enrolled, but the licence covers ${s.seats_licensed}; the others can read but not write, and none can be added. This computer is never limited.`
        : `Computers: ${s.computers_enrolled} of ${s.seats_licensed} enrolled${s.can_enroll ? '' : ' (no more can be added)'}. This computer is never limited.`);
      console.log(`Seen in the last ${s.usage.active_days} days: ${s.usage.computers} computer(s), ${s.usage.connectors} cloud connector(s), ${s.usage.local_clients} local client(s). Connectors are counted, not limited.`);
      if (!s.can_enroll && s.computers_enrolled > 1) out.info(s.enroll_refused);
      for (const n of s.notes) out.info(n);
      return 0;
    }
    if (sub === 'install') {
      const src = pos[1]; if (!src) throw new Error('memev license install <file>');
      const r = installLicense({ file: src, env, root: isVault(root) ? root : null });
      if (!r.ok) { out.bad(`not installed: ${r.reason}`); return 1; }
      out.ok(r.converted
        ? `converted the trial to a paid licence ${r.license.lid} (${r.state}) in ${r.file}; the vault is unchanged`
        : `installed licence ${r.license.lid} (${r.state}) in ${r.file}`);
      return 0;
    }
    if (sub === 'activate') {
      const key = pos[1]; if (!key) throw new Error('memev license activate <key> [--server URL]');
      const r = await activateLicense({ key, endpoint: licenseEndpoint({ flags, env }), env, root });
      if (!r.ok) { out.bad(`not activated: ${r.reason}`); return 1; }
      out.ok(`activated licence ${r.license.lid} (${r.state}) in ${r.file}; it is checked on this computer from now on, with no network`); return 0;
    }
    if (sub === 'remove') { fs.rmSync(licenseFile(env), { force: true }); out.ok('licence removed; nothing changes for Personal'); return 0; }
    throw new Error('memev license status [--json] | activate <key> | install <file> | remove');
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
    const lic = license ?? loadLicense({ env });
    const s = report({ license: lic, seats, devices: reg.list() });
    console.log(`Seats: ${s.computers_enrolled} of ${s.seats_licensed} computers${s.can_enroll ? '' : ' (no more can be added)'}`);
    console.log(licencePhrase(lic));
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
  if (sub === 'rename') {
    const d = reg.rename(pos[1], pos.slice(2).join(' '));
    // A computer's label is part of its seats' names: move every seat on it with it, so its history,
    // tasks and lead follow, and its old seat names still find the seats.
    const q = new CommitQueue(root, { delayMs: 0 });
    const bus = new Bus({ root, devices: reg, commit: (p) => q.add(p, 'bus') });
    bus.renameDeviceSeats(d.id);
    q.flush();
    out.ok(`${d.id} is now "${d.label}"`);
    return 0;
  }
  throw new Error('memev devices [list|enroll --kind remote-computer --pubkey KEY|cloud-connector|local-client --label NAME|remove ID|rotate ID|rename ID NAME|keygen]');
}
