// SPDX-License-Identifier: Apache-2.0
// Using a vault that lives on another computer. `memev join` saves the vault's address and this
// computer's token; `memev mcp` and the session hooks then send every request there, signed with
// this computer's device key (`memev devices keygen`). The key never leaves this computer, so the
// saved details are no use anywhere else.
import crypto from 'node:crypto';
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

/**
 * After a connection error, take the address in the git backup when the host's signature checks.
 * A bad signature leaves the saved address as it was.
 */
export function adoptSignedAddress(remote, env = process.env) {
  if (!remote?.host_pubkey) return null;
  const rec = backupAddress(remote);
  if (!verifyAddressRecord(rec, remote.host_pubkey)) return null;
  const url = String(rec.url).replace(/\/+$/, '');
  if (!url || url === String(remote.url || '').replace(/\/+$/, '')) return null;
  remote.url = url;
  const saved = readJson(remoteFile(env), null);
  if (saved?.token) writePrivateJson(remoteFile(env), { ...saved, url });
  return url;
}

export async function remoteFetch(remote, route, opts = {}) {
  try {
    return await remoteOnce(remote, route, opts);
  } catch (e) {
    if (!adoptSignedAddress(remote, opts.env || process.env)) throw e;
    return await remoteOnce(remote, route, opts);
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

/** `memev join <code>`, or `memev join <url> --token T [--no-connect]`, on the computer being added. */
export async function join(pos, flags, { env }) {
  const arg = String(pos[0] || '').trim();
  if (arg && !/^https?:\/\//.test(arg)) return joinWithCode(arg, flags, { env });
  const url = arg.replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url) || !flags.token) { console.log('memev join <code>\n  or: memev join <vault URL> --token <token>\n  A code comes from memev invite on the vault. The older path still starts with memev devices keygen.'); return 2; }
  if (!exists(deviceKeyFile(env))) { out.bad('this computer has no device key yet: run memev devices keygen, give the public key to the vault admin, then join'); return 1; }
  const remote = { url, token: String(flags.token), joined: new Date().toISOString() };
  const r = await remoteFetch(remote, 'mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, env }).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!r.ok) { out.bad(`the vault refused this computer (${r.status || 'no answer'}): ${r.json?.error_description || r.text}`); return 1; }
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
