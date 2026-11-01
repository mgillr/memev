// SPDX-License-Identifier: Apache-2.0
// Start, stop and find the daemon. Anything that needs the vault starts the daemon on demand.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PKG, api, daemonInfo, pidAlive, config } from './common.mjs';

// Healthy means this vault's daemon answers: {"ok":true} and the vault_id in this vault's config.json. Anything else on
// the port, another vault's daemon or any other service, is not healthy for this vault.
export async function healthy(root, port = null) {
  try {
    const r = await api(root, '/healthz', { method: 'GET', timeoutMs: 800, port });
    if (!(r.ok && r.json?.ok === true)) return false;
    const want = config(root).vault_id;
    return !want || r.json.vault_id === want;
  } catch { return false; }
}

// True when nothing listens on the port on this machine's loopback address.
export const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer(); s.unref();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

// The port this vault should use: the one asked for when it is free or already serves this vault, otherwise the next
// free port above it. With nothing free nearby it returns the one asked for, and the daemon reports the listen error.
export async function choosePort(root, wanted) {
  const info = daemonInfo(root);
  if (info && info.port === wanted && pidAlive(info.pid)) return wanted; // this vault's daemon already has it
  if ((await portFree(wanted)) || (await healthy(root, wanted))) return wanted;
  for (let p = wanted + 1; p < Math.min(wanted + 100, 65536); p++) if (await portFree(p)) return p;
  return wanted;
}

// The listen error the daemon logged on its last start, or null when a later start served the vault.
export function lastListenError(root) {
  let text;
  try {
    const fd = fs.openSync(path.join(root, '.memev', 'daemon.log'), 'r');
    try { const size = fs.fstatSync(fd).size, n = Math.min(size, 65536), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); text = b.toString('utf8'); }
    finally { fs.closeSync(fd); }
  } catch { return null; }
  for (const line of text.split('\n').reverse()) {
    if (line.startsWith('[memev] serving ')) return null;
    const m = /^\[memev\] cannot listen on (\S+):(\d+): (.*)$/.exec(line);
    if (m) return { bind: m[1], port: Number(m[2]), message: m[3] };
  }
  return null;
}

// Why this vault's daemon is not serving, in one line: a port held by another program right now, or else the listen
// error of its last start. Null when there is nothing more to say than that it is not running.
export async function whyNotRunning(root) {
  const info = daemonInfo(root);
  if (info && pidAlive(info.pid)) return `the daemon (pid ${info.pid}) is running on port ${info.port} but does not answer; run memev restart`;
  // the daemon refuses to start on a config with a syntax error (server/main.mjs), every time, so say that and not only
  // that it is not running
  const cfgFile = path.join(root, '.memev', 'config.json');
  try { JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { if (e instanceof SyntaxError) return `${cfgFile} is not valid json, so the daemon refuses to start; fix the file and run memev start`; }
  const last = lastListenError(root);
  for (const port of new Set([Number(config(root).port) || 7787, last?.port].filter(Boolean))) {
    if (!(await portFree(port))) return `port ${port} is held by another program; run memev init --port ${await choosePort(root, port)}`;
  }
  return last ? `the last start could not listen on ${last.bind}:${last.port}: ${last.message}` : null;
}

// What the daemon just logged when it refused to start for a held vault lock (exit code 5): { pid, message }, or null when it
// logged something else. `from` is the log's size before this start, so an older start's line is never read. Exit code 5 is also the
// invalid-config exit, so the code alone does not say the vault is locked.
export function vaultLockedBy(root, from = 0) {
  let text;
  try {
    const fd = fs.openSync(path.join(root, '.memev', 'daemon.log'), 'r');
    try { const size = fs.fstatSync(fd).size, n = Math.max(0, Math.min(size - from, 65536)), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); text = b.toString('utf8'); }
    finally { fs.closeSync(fd); }
  } catch { return null; }
  for (const line of text.split('\n').reverse()) {
    const m = /^\[memev\] VaultLocked: (.*)$/.exec(line);
    if (m) return { pid: Number((/\bpid (\d+)/.exec(m[1]) || [])[1]) || null, message: m[1] };
  }
  return null;
}

export async function ensureDaemon(root, { quiet = false, waitMs = 6000 } = {}) {
  if (!fs.existsSync(path.join(root, '.memev', 'config.json'))) return false;
  const info = daemonInfo(root);
  if (info && pidAlive(info.pid) && (await healthy(root))) return true;
  return startDaemon(root, { quiet, waitMs });
}

export async function startDaemon(root, { quiet = false, waitMs = 6000, spawn: spawnProc = spawn } = {}) {
  const logFile = path.join(root, '.memev', 'daemon.log');
  try { if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`); } catch {}
  let logFrom = 0; try { logFrom = fs.statSync(logFile).size; } catch {}
  const fd = fs.openSync(logFile, 'a', 0o600);
  const child = spawnProc(process.execPath, [path.join(PKG, 'src', 'server', 'main.mjs'), '--root', root], { detached: true, stdio: ['ignore', fd, fd], env: process.env, windowsHide: true });
  child.unref(); fs.closeSync(fd);
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    const info = daemonInfo(root);
    // Only this vault's daemon counts: the one just started, or, when it exited with 3, the one already serving
    // this vault. Whatever else answers on the configured port (another vault's daemon) is not this vault.
    const ours = info && (info.pid === child.pid || (child.exitCode === 3 && pidAlive(info.pid)));
    if (ours && (await healthy(root, info.port))) { if (!quiet) console.log(`Memev is running on http://127.0.0.1:${info.port} (pid ${info.pid})`); return true; }
    if (child.exitCode !== null && child.exitCode !== 3) break; // 3 = another daemon already serves the vault
  }
  // It did not start in time. Stop it, so it cannot come up later, unreported, after this says it did not start.
  if (child.exitCode === null) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
  if (!quiet) {
    // exit code 5 with a VaultLocked line: another process holds the vault, which is not a failed start; exit code 4: the port
    const locked = child.exitCode === 5 ? vaultLockedBy(root, logFrom) : null;
    const listen = child.exitCode === 4 ? lastListenError(root) : null;
    if (locked) console.error(`The vault is locked by ${locked.pid ? `pid ${locked.pid}` : 'another process'} (VaultLocked): ${locked.message}\nStop that process, then run memev start.`);
    else if (listen) console.error(`Memev did not start: cannot listen on ${listen.bind}:${listen.port}: ${listen.message}; see ${logFile}`);
    else console.error(`Memev did not start; see ${logFile}`);
  }
  return false;
}

export async function stopDaemon(root, { waitMs = 5000 } = {}) {
  const info = daemonInfo(root);
  if (!info || !pidAlive(info.pid)) {
    // daemon.lock goes only when its pid is gone: a daemon that has taken it and is still starting has not written daemon.json yet
    const lockFile = path.join(root, '.memev', 'daemon.lock');
    try {
      fs.rmSync(path.join(root, '.memev', 'daemon.json'), { force: true });
      let holder = 0; try { holder = Number(fs.readFileSync(lockFile, 'utf8')); } catch {}
      if (!pidAlive(holder)) fs.rmSync(lockFile, { force: true });
    } catch {}
    return false;
  }
  process.kill(info.pid, 'SIGTERM');
  const until = Date.now() + waitMs;
  while (Date.now() < until && pidAlive(info.pid)) await new Promise((r) => setTimeout(r, 100));
  if (pidAlive(info.pid)) process.kill(info.pid, 'SIGKILL');
  return true;
}
