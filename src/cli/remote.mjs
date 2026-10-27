// SPDX-License-Identifier: Apache-2.0
// Using a vault that lives on another computer. `memev join` saves the vault's address and this
// computer's token; `memev mcp` and the session hooks then send every request there, signed with
// this computer's device key (`memev devices keygen`). The key never leaves this computer, so the
// saved details are no use anywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, readJson, writePrivateJson, exists } from '../engine/util.mjs';
import { signRequest } from '../engine/devices.mjs';
import { out } from './common.mjs';

export const remoteFile = (env = process.env) => path.join(configDir(env), 'remote.json');
export const deviceKeyFile = (env = process.env) => path.join(configDir(env), 'keys', 'device-ed25519.pem');
export const loadRemote = (env = process.env) => { const r = readJson(remoteFile(env), null); return r?.url && r?.token ? r : null; };

/** One request to the remote vault, signed with this computer's key. */
export async function remoteFetch(remote, route, { method = 'POST', body = null, env = process.env, headers = {}, timeoutMs = 15000 } = {}) {
  const key = fs.readFileSync(deviceKeyFile(env), 'utf8');
  const u = new URL(route, `${remote.url.replace(/\/+$/, '')}/`);
  const text = body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(u, { method, signal: ac.signal, headers: { 'content-type': 'application/json', 'user-agent': 'memev-remote', authorization: `Bearer ${remote.token}`, ...signRequest(key, { method, path: u.pathname, body: text }), ...headers }, body: method === 'GET' ? undefined : text });
    const res = await r.text(); let json = null; try { json = JSON.parse(res); } catch {}
    return { ok: r.ok, status: r.status, json, text: res };
  } finally { clearTimeout(t); }
}

/** `memev join <url> --token T [--no-connect]` on the computer being added. */
export async function join(pos, flags, { env }) {
  const url = String(pos[0] || '').replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url) || !flags.token) { console.log('memev join <vault URL> --token <token>\n  The vault admin gets both from: memev devices enroll --kind remote-computer --pubkey <key> and memev cloud url'); return 2; }
  if (!exists(deviceKeyFile(env))) { out.bad('this computer has no device key yet: run memev devices keygen, give the public key to the vault admin, then join'); return 1; }
  const remote = { url, token: String(flags.token), joined: new Date().toISOString() };
  const r = await remoteFetch(remote, 'mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, env }).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!r.ok) { out.bad(`the vault refused this computer (${r.status || 'no answer'}): ${r.json?.error_description || r.text}`); return 1; }
  writePrivateJson(remoteFile(env), remote);
  out.ok(`joined the vault at ${url}; requests from this computer are signed with its device key`);
  if (!flags['no-connect']) { const { installRuntime } = await import('./main.mjs'); const { connectAll } = await import('./clients.mjs'); const rt = installRuntime(env); connectAll({ env, launcher: rt.launcher }); out.ok('connected the AI apps on this computer (memev clients)'); }
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
