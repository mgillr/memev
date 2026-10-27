// SPDX-License-Identifier: Apache-2.0
// Shared CLI plumbing: where the vault is, the client tokens, talking to the daemon.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir, homeDir, readJson, writePrivateJson, exists } from '../engine/util.mjs';
import { TokenStore } from '../engine/tokens.mjs';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STATE = '.memev';

export function parseArgs(argv, booleans = []) {
  const flags = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (booleans.includes(k) || k.startsWith('no-') || i + 1 >= argv.length || argv[i + 1].startsWith('--')) flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { flags, pos };
}

export function defaultVaultFile(env = process.env) { return path.join(configDir(env), 'default'); }
export function resolveRoot(flagRoot, env = process.env) {
  if (flagRoot) return path.resolve(String(flagRoot));
  if (env.MEMEV_ROOT) return path.resolve(env.MEMEV_ROOT);
  try { const d = fs.readFileSync(defaultVaultFile(env), 'utf8').trim(); if (d) return d; } catch {}
  return path.join(homeDir(env), 'memev');
}

export const config = (root) => readJson(path.join(root, STATE, 'config.json'), {});
export const saveConfig = (root, c) => writePrivateJson(path.join(root, STATE, 'config.json'), c);
export const clientsFile = (root) => path.join(root, STATE, 'clients.json');

/** The token a client uses (minted on first use). Cloud clients get remote tokens with memory-only paths. */
export function clientToken(root, client, { remote = false } = {}) {
  const f = clientsFile(root); const all = readJson(f, {});
  const key = remote ? `cloud:${client}` : client;
  const ts = new TokenStore(path.join(root, STATE, 'tokens.json'));
  if (all[key] && ts.verify(all[key])) return all[key];
  const t = ts.issue({ agent: client, scopes: ['read', 'write'], paths: remote ? ['memory/**', 'work/**', 'contracts/**'] : ['**'], ttlDays: remote ? 90 : 365, remote, note: remote ? 'cloud connector' : 'local client' });
  all[key] = t.token; writePrivateJson(f, all);
  return t.token;
}
export function adminToken(root) { return readJson(path.join(root, STATE, 'admin.json'), {})?.token || null; }
export const tunnelKeyFile = (root) => path.join(root, STATE, 'tunnel-key.txt');
export function tunnelKey(root) { try { return fs.readFileSync(tunnelKeyFile(root), 'utf8').trim() || null; } catch { return null; } }
export const daemonInfo = (root) => readJson(path.join(root, STATE, 'daemon.json'), null);

export function pidAlive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export async function api(root, route, { method = 'POST', body = null, token = null, timeoutMs = 3000, port = null } = {}) {
  const p = port || daemonInfo(root)?.port || config(root).port;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${p}${route}`, { method, signal: ac.signal, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } finally { clearTimeout(t); }
}

export const out = {
  ok: (m) => console.log(`  \u2713 ${m}`), warn: (m) => console.log(`  ! ${m}`), bad: (m) => console.log(`  \u2717 ${m}`), info: (m) => console.log(`    ${m}`),
};
export { exists };
