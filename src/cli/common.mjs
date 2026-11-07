// SPDX-License-Identifier: Apache-2.0
// Shared CLI plumbing: where the vault is, the client tokens, talking to the daemon.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { configDir, homeDir, readJson, writePrivateJson, exists } from '../engine/util.mjs';
import { TokenStore, TOKEN_RE, EXPIRY_WARNING_DAYS, expiryWarningLine, expiredWarningLine } from '../engine/tokens.mjs';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STATE = '.memev';

// The flags every memev command reads as booleans. main.mjs and the hook entry both parse with this list, so a hook
// started through bin/memev.mjs sees exactly the flags it saw when it went through main.
export const BOOLEAN_FLAGS = ['help', 'yes', 'json', 'local-only', 'no-connect', 'no-service', 'fix', 'bundle', 'purge', 'dry-run', 'force', 'show-secrets', 'all', 'org', 'all-projects', 'release', 'open', 'once', 'refresh', 'aider', 'local', 'ai-history', 'preview'];

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

/**
 * The token a client uses (minted on first use). Cloud clients get remote tokens with memory-only paths.
 * Connector credentials are long-lived (a year, like local ones) and revocable; the 14-day-ahead warning
 * in doctor, memev status and the resume card says before one gets close to its expiry.
 */
export function clientToken(root, client, { remote = false } = {}) {
  const f = clientsFile(root); const all = readJson(f, {});
  const key = remote ? `cloud:${client}` : client;
  const ts = new TokenStore(path.join(root, STATE, 'tokens.json'));
  if (all[key] && ts.verify(all[key])) return all[key];
  // the credential being replaced has stopped working (it expired or was revoked); revoke the record
  // too, so it does not warn forever
  const old = all[key] && TOKEN_RE.exec(all[key]);
  if (old) ts.revoke(old[1]);
  const t = ts.issue({ agent: client, scopes: ['read', 'write'], paths: remote ? ['memory/**', 'work/**', 'contracts/**', 'bus/**'] : ['**'], ttlDays: 365, remote, note: remote ? 'cloud connector' : 'local client' });
  all[key] = t.token; writePrivateJson(f, all);
  return t.token;
}

/** The credentials that have already expired, or that will expire within `days` days, one warning line each. */
export function tokenExpiryWarnings(root, { days = EXPIRY_WARNING_DAYS } = {}) {
  const ts = new TokenStore(path.join(root, STATE, 'tokens.json'));
  return [...ts.expired().map((t) => expiredWarningLine(t)), ...ts.expiringWithin(days).map((t) => expiryWarningLine(t))];
}
export function adminToken(root) { return readJson(path.join(root, STATE, 'admin.json'), {})?.token || null; }
export const tunnelKeyFile = (root) => path.join(root, STATE, 'tunnel-key.txt');
export function tunnelKey(root) { try { return fs.readFileSync(tunnelKeyFile(root), 'utf8').trim() || null; } catch { return null; } }
export const daemonInfo = (root) => readJson(path.join(root, STATE, 'daemon.json'), null);

export function pidAlive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// `memev mcp --client X` must not take X's seat when it was not launched by X. A marker an app sets
// in its children is inherited by every descendant, so it names an ancestor, not the parent, and it
// may only confirm the claim it names: a marker of another app never relabels the seat. I resolve in
// order: the claim's own marker, then the direct parent's process name when it is a known app (a
// parent named claude is the claude-code CLI binary), then, for a claude-code claim with no
// CLAUDECODE and a parent I can read, the parent's name, and only then the claim. Only claude-code
// takes that parent-name fallback; codex, gemini-cli and windsurf under an unknown parent (such as
// node) keep their claim. Terminals set markers too (TERM_PROGRAM, ZED_TERM); they only wrap, so
// they never relabel the seat. CLAUDECODE is set by claude-code in the children it launches;
// CODEX_CLI, GEMINI_CLI and WINDSURF_CLI are unverified, I could not confirm those apps set them.
export const ENV_MARKERS = { CLAUDECODE: 'claude-code', CODEX_CLI: 'codex', GEMINI_CLI: 'gemini-cli', WINDSURF_CLI: 'windsurf' };
const MARKER_OF = Object.fromEntries(Object.entries(ENV_MARKERS).map(([k, id]) => [id, k]));
const KNOWN_APPS = new Set(['claude-code', 'codex', 'gemini-cli', 'cursor', 'claude-desktop', 'windsurf',
  // more apps whose binary has the app's own id, as their docs show it (iflow mcp add, tabnine mcp list)
  'iflow', 'tabnine']);
// Keyed by the parent's raw process name, case-sensitive: the claude-code CLI binary is named
// claude, the desktop app's binary is named Claude, and only the former maps to claude-code.
// The others are binaries their docs name in commands: qwen mcp add, auggie mcp add, vibe mcp add.
const PARENT_NAME_AS_APP = { claude: 'claude-code', qwen: 'qwen-code', auggie: 'augment', vibe: 'mistral-vibe' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** The name of the parent process, or null when it cannot be read. */
export function parentProcName(ppid = process.ppid) {
  if (!ppid) return null;
  try { const c = fs.readFileSync(`/proc/${ppid}/comm`, 'utf8').trim(); if (c) return c; } catch {}
  try { const o = execFileSync('ps', ['-o', 'comm=', '-p', String(ppid)], { encoding: 'utf8', timeout: 1500 }).trim(); if (o) return o.split('/').pop(); } catch {}
  return null;
}

/** The client to seat as: the claim when its own marker stands, else a known app that launched us
 *  (a parent named claude is the claude-code CLI binary), else the parent's name when the claim is
 *  claude-code, CLAUDECODE is absent and I can read the parent, else the claim. A marker of another
 *  app never relabels the seat; it may only confirm the claim it names. */
export function effectiveClient(claimed, env = process.env, ppid = process.ppid) {
  const want = norm(claimed);
  const own = MARKER_OF[want];
  if (own && env[own]) return want;
  const name = parentProcName(ppid);
  if (name) {
    if (PARENT_NAME_AS_APP[name]) return PARENT_NAME_AS_APP[name];
    const id = norm(name);
    if (KNOWN_APPS.has(id)) return id;
  }
  if (want === 'claude-code' && !env.CLAUDECODE && name) return norm(name);
  return want;
}

// A hook process talks to the daemon with node:http: bin/memev.mjs turns this on before it runs a hook, because loading
// fetch's implementation costs more start-up time than a hook can spare on a slow runner (MEM-098). Every other
// command, and in-process callers such as the bench harness (which hands fetch calls to the server in-process), keep
// fetchOut, imported on first use so that a hook process never loads it. The daemon is always on this computer's
// loopback address, never behind a proxy, so both give the same answer: status, ok for 2xx, the body text and its JSON.
let directLoopback = false;
export function useDirectLoopback() { directLoopback = true; }

// node:http is required, not imported: an ESM import of it reads every export, and one of them loads fetch's
// implementation, which is the cost this avoids.
const http = createRequire(import.meta.url)('node:http');
function loopback(port, route, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const h = body != null ? { ...headers, 'content-length': Buffer.byteLength(body) } : headers;
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: h, signal, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}
async function viaFetch(port, route, opts) {
  const { fetchOut } = await import('../engine/net.mjs');
  const r = await fetchOut(`http://127.0.0.1:${port}${route}`, { ...opts, body: opts.body ?? undefined });
  return { status: r.status, text: await r.text() };
}

export async function api(root, route, { method = 'POST', body = null, token = null, timeoutMs = 3000, port = null } = {}) {
  const p = port || daemonInfo(root)?.port || config(root).port;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const opts = { method, signal: ac.signal, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : null };
    const r = directLoopback ? await loopback(p, route, opts) : await viaFetch(p, route, opts);
    let json = null; try { json = JSON.parse(r.text); } catch {}
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json, text: r.text };
  } finally { clearTimeout(t); }
}

export const out = {
  ok: (m) => console.log(`  \u2713 ${m}`), warn: (m) => console.log(`  ! ${m}`), bad: (m) => console.log(`  \u2717 ${m}`), info: (m) => console.log(`    ${m}`),
};
export { exists };
