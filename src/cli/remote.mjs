// SPDX-License-Identifier: Apache-2.0
// Using a vault that lives on another computer. `memev join` saves the vault's address and this
// computer's token; `memev mcp` and the session hooks then send every request there, signed with
// this computer's device key (`memev devices keygen`). The key never leaves this computer, so the
// saved details are no use anywhere else.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, readJson, writePrivate, writePrivateJson, exists } from '../engine/util.mjs';
import { signRequest, decodeInvite, deviceKeygen, verifyAddressRecord } from '../engine/devices.mjs';
import { out } from './common.mjs';
import { fetchOut } from '../engine/net.mjs';

export const remoteFile = (env = process.env) => path.join(configDir(env), 'remote.json');
export const deviceKeyFile = (env = process.env) => path.join(configDir(env), 'keys', 'device-ed25519.pem');
export const loadRemote = (env = process.env) => { const r = readJson(remoteFile(env), null); return r?.url && r?.token ? r : null; };

/** One request to the remote vault, signed with this computer's key. */
async function remoteOnce(remote, route, { method = 'POST', body = null, env = process.env, headers = {}, timeoutMs = 15000 } = {}) {
  const key = fs.readFileSync(deviceKeyFile(env), 'utf8');
  const u = new URL(route, `${remote.url.replace(/\/+$/, '')}/`);
  const text = body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchOut(u, { method, signal: ac.signal, headers: { 'content-type': 'application/json', 'user-agent': 'memev-remote', authorization: `Bearer ${remote.token}`, ...signRequest(key, { method, path: u.pathname, body: text }), ...headers }, body: method === 'GET' ? undefined : text }, env);
    const res = await r.text(); let json = null; try { json = JSON.parse(res); } catch {}
    return { ok: r.ok, status: r.status, json, text: res };
  } finally { clearTimeout(t); }
}

/** Read address.json from a backup checkout this computer can already see. */
function backupAddress(remote) {
  const backup = remote?.backup;
  if (!backup || typeof backup !== 'string') return null;
  const file = path.join(backup, 'address.json');
  if (!exists(file)) return null;
  return readJson(file, null);
}

/** Where `memev join --refresh` keeps its copy of the backup's latest commit: a bare repository, no checkout. */
export const backupCacheDir = (env = process.env) => path.join(configDir(env), 'backup-cache');

/**
 * Fetch the backup's latest commit into the cache and read address.json from it. The backup is the
 * vault's git remote as the invite records it, so this computer usually has no checkout of it. A
 * backup that is a folder holding address.json is read in place.
 */
export function fetchBackupAddress(remote, env = process.env, { timeoutMs = 30000 } = {}) {
  const backup = remote?.backup;
  if (!backup || typeof backup !== 'string') return { ok: false, error: 'no backup is recorded for this vault' };
  if (exists(path.join(backup, 'address.json'))) return { ok: true, rec: backupAddress(remote) };
  const dir = backupCacheDir(env);
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const last = (r) => (r.stderr || '').trim().split('\n').pop();
  if (!exists(path.join(dir, 'HEAD'))) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const i = run(['init', '-q', '--bare']);
    if (i.status !== 0) return { ok: false, error: `could not set up the cache (${last(i) || 'git init failed'})` };
  }
  // a hosted repository's HEAD is its default branch; a bare repository made by hand may point HEAD
  // at a branch that does not exist, so try the usual branch names after it
  let f = null;
  for (const ref of ['HEAD', 'main', 'master']) {
    f = run(['fetch', '-q', '--depth', '1', backup, ref]);
    if (f.status === 0 || !/couldn't find remote ref/.test(f.stderr || '')) break;
  }
  if (f.status !== 0) return { ok: false, error: f.error?.code === 'ETIMEDOUT' ? 'the fetch timed out' : (last(f) || 'git fetch failed') };
  const s = run(['show', 'FETCH_HEAD:address.json']);
  if (s.status !== 0) return { ok: false, error: 'the backup holds no address record' };
  try { return { ok: true, rec: JSON.parse(s.stdout) }; } catch { return { ok: false, error: 'the address record in the backup is not valid JSON' }; }
}

/** Take a signed address record when the host's signature checks; null when it does not, or when the address is the same. */
function adoptRecord(remote, rec, env) {
  if (!remote?.host_pubkey || !verifyAddressRecord(rec, remote.host_pubkey)) return null;
  const url = String(rec.url).replace(/\/+$/, '');
  if (!url || url === String(remote.url || '').replace(/\/+$/, '')) return null;
  remote.url = url;
  const saved = readJson(remoteFile(env), null);
  if (saved?.token) writePrivateJson(remoteFile(env), { ...saved, url });
  return url;
}

/**
 * After a connection error, take the address in a backup checkout this computer can already see,
 * when the host's signature checks. A bad signature leaves the saved address as it was.
 */
export function adoptSignedAddress(remote, env = process.env) {
  if (!remote?.host_pubkey) return null;
  return adoptRecord(remote, backupAddress(remote), env);
}

/** `memev join --refresh` can only help a computer that has the backup's address and the vault's address key. */
export const canRefresh = (remote) => !!(remote?.backup && remote?.host_pubkey);
const RECOVER = "on the vault's computer run `memev invite`, then here run `memev join <code>`";

/** The vault did not answer and there is no signed address to follow: the host may have moved. */
export class VaultMovedError extends Error {
  constructor(url, detail, { refresh = true } = {}) {
    super(`vault address changed: ${detail || `the vault at ${url} did not answer`} (${refresh ? 'run `memev join --refresh` to fetch the current address' : `this computer has no signed address record to follow: ${RECOVER}`})`);
    this.name = 'VaultMovedError';
    this.moved = true;
    this.refresh = refresh;
  }
}

export async function remoteFetch(remote, route, opts = {}) {
  try {
    return await remoteOnce(remote, route, opts);
  } catch (e) {
    if (e?.code === 'ENOENT') throw e; // no device key on this computer: a setup problem, not a moved vault
    if (opts.follow === false) throw e; // a first join, or a check that already followed the record
    const refresh = canRefresh(remote);
    if (!adoptSignedAddress(remote, opts.env || process.env)) throw new VaultMovedError(String(remote.url), undefined, { refresh });
    try {
      return await remoteOnce(remote, route, opts);
    } catch (e2) {
      if (e2?.code === 'ENOENT') throw e2;
      throw new VaultMovedError(String(remote.url), `the vault moved to ${remote.url} but that address did not answer either`, { refresh });
    }
  }
}

const publicKeyOf = (pem) => crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');

/** `memev join <code>` makes a key, enrols this computer and connects its apps. A bad or used code writes nothing. */
async function joinWithCode(code, flags, { env }) {
  let decoded;
  try { decoded = decodeInvite(code); } catch (e) { out.bad(e.message || 'bad invite code'); return 1; }
  const keyPath = deviceKeyFile(env);
  const hadKey = exists(keyPath);
  let pem; let pub;
  if (hadKey) { pem = fs.readFileSync(keyPath, 'utf8'); pub = publicKeyOf(pem); }
  else { const k = deviceKeygen(); pem = k.privateKeyPem; pub = k.publicKey; }
  const url = decoded.address.replace(/\/+$/, '');
  let res;
  try {
    const r = await fetchOut(`${url}/v1/invite-redeem`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'memev-remote' }, body: JSON.stringify({ code, pubkey: pub, label: os.hostname() || 'laptop' }) }, env);
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    res = { ok: r.ok, status: r.status, json, text };
  } catch (e) { out.bad(`the vault did not answer: ${e.message}`); return 1; }
  if (!res.ok || !res.json?.token) { out.bad(res.json?.error_description || `the invite was refused (${res.status})`); return 1; }
  if (!hadKey) { fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 }); writePrivate(keyPath, pem); fs.writeFileSync(`${keyPath}.pub`, `${pub}\n`, { mode: 0o644 }); }
  const remote = { url, token: res.json.token, joined: new Date().toISOString() };
  if (decoded.pubkey) remote.host_pubkey = decoded.pubkey;
  if (decoded.backup) remote.backup = decoded.backup;
  writePrivateJson(remoteFile(env), remote);
  out.ok(`joined the vault at ${url}; requests from this computer are signed with its device key`);
  if (!flags['no-connect']) { const { installRuntime } = await import('./main.mjs'); const { connectAll } = await import('./clients.mjs'); const rt = installRuntime(env); const connected = connectAll({ env, launcher: rt.launcher }); out.ok('connected the AI apps on this computer (memev clients)');
    const ids = connected.filter((x) => ['added', 'already'].includes(x.status)).map((x) => x.id);
    const b = await remoteFetch(remote, 'v1/bus-register', { body: { clients: ids }, env }).catch(() => null);
    if (b?.ok) out.ok(`on the comms bus: ${b.json.seats.join(', ') || 'apps get a seat on their first session'}`); }
  return 0;
}

/**
 * `memev join --refresh`: fetch the signed address record from the backup, take it when this vault's
 * key signed it, and check the vault answers there.
 */
async function joinRefresh({ env }) {
  const saved = readJson(remoteFile(env), null);
  if (!saved?.url || !saved?.token) { out.bad('this computer has not joined a vault yet: memev join <code> first'); return 1; }
  if (!canRefresh(saved)) { out.bad(`this computer has no signed address record to follow, so there is nothing to refresh from: ${RECOVER}`); return 1; }
  const got = fetchBackupAddress(saved, env);
  if (!got.ok) { out.bad(`could not read the address record from the backup at ${saved.backup}: ${got.error}. If this computer cannot read that repository: ${RECOVER}`); return 1; }
  if (!verifyAddressRecord(got.rec, saved.host_pubkey)) { out.bad("the address record in the backup is not signed by this vault's key, so it was not used; nothing changed"); return 1; }
  const remote = { ...saved };
  const changed = !!adoptRecord(remote, got.rec, env);
  const r = await remoteFetch(remote, 'mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, env, follow: false }).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!r.ok) { out.bad(`the vault did not answer at ${remote.url}: ${r.json?.error_description || r.text}; run memev doctor`); return 1; }
  out.ok(changed ? `vault address updated to ${remote.url}` : `the stored address is current: ${remote.url}`);
  return 0;
}

/** `memev join <code>`, `memev join <url> --token T [--no-connect]`, or `memev join --refresh`, on the computer being added. */
export async function join(pos, flags, { env }) {
  if (flags.refresh) return joinRefresh({ env });
  const arg = String(pos[0] || '').trim();
  if (arg && !/^https?:\/\//.test(arg)) return joinWithCode(arg, flags, { env });
  const url = arg.replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url) || !flags.token) { console.log('memev join <code>\n  or: memev join <vault URL> --token <token>\n  A code comes from memev invite on the vault. The older path still starts with memev devices keygen.'); return 2; }
  if (!exists(deviceKeyFile(env))) { out.bad('this computer has no device key yet: run memev devices keygen, give the public key to the vault admin, then join'); return 1; }
  const remote = { url, token: String(flags.token), joined: new Date().toISOString() };
  // a first join has no saved address to follow, so a dead address is just that: no moved advice
  const r = await remoteFetch(remote, 'mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, env, follow: false }).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!r.ok) { out.bad(r.status ? `the vault refused this computer (${r.status}): ${r.json?.error_description || r.text}` : `no answer at ${url}: ${r.text}`); return 1; }
  writePrivateJson(remoteFile(env), remote);
  out.ok(`joined the vault at ${url}; requests from this computer are signed with its device key`);
  if (!flags['no-connect']) { const { installRuntime } = await import('./main.mjs'); const { connectAll } = await import('./clients.mjs'); const rt = installRuntime(env); const res = connectAll({ env, launcher: rt.launcher }); out.ok('connected the AI apps on this computer (memev clients)');
    const ids = res.filter((x) => ['added', 'already'].includes(x.status)).map((x) => x.id);
    const b = await remoteFetch(remote, 'v1/bus-register', { body: { clients: ids }, env }).catch(() => null);
    if (b?.ok) out.ok(`on the comms bus: ${b.json.seats.join(', ') || 'apps get a seat on their first session'}`); }
  return 0;
}

/** `memev mcp` when the vault is on another computer: every message goes there, signed. */
export async function runRemoteStdio(remote, client, env = process.env) {
  const readline = await import('node:readline');
  const write = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const inflight = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
    const p = (async () => {
      try {
        const r = await remoteFetch(remote, 'mcp', { body: msg, env, headers: { 'x-memev-client': client } });
        if (r.status === 202) return;
        if (!r.ok && !r.json?.jsonrpc) { if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Memev vault: ${r.json?.error_description || r.status}` } }); return; }
        if (r.text) process.stdout.write(`${r.text.trim()}\n`);
      } catch (e) { if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Memev vault: ${e.message}` } }); }
    })();
    inflight.add(p); p.finally(() => inflight.delete(p));
  });
  await new Promise((r) => rl.on('close', r));
  await Promise.all(inflight);
}
