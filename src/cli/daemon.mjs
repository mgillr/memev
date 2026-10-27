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

export async function ensureDaemon(root, { quiet = false, waitMs = 6000 } = {}) {
  if (!fs.existsSync(path.join(root, '.memev', 'config.json'))) return false;
  const info = daemonInfo(root);
  if (info && pidAlive(info.pid) && (await healthy(root))) return true;
  return startDaemon(root, { quiet, waitMs });
}

export async function startDaemon(root, { quiet = false, waitMs = 6000 } = {}) {
  const logFile = path.join(root, '.memev', 'daemon.log');
  try { if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`); } catch {}
  const fd = fs.openSync(logFile, 'a', 0o600);
  const child = spawn(process.execPath, [path.join(PKG, 'src', 'server', 'main.mjs'), '--root', root], { detached: true, stdio: ['ignore', fd, fd], env: process.env });
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
  if (!quiet) console.error(`Memev did not start; see ${logFile}`);
  return false;
}

export async function stopDaemon(root, { waitMs = 5000 } = {}) {
  const info = daemonInfo(root);
  if (!info || !pidAlive(info.pid)) { try { fs.rmSync(path.join(root, '.memev', 'daemon.json'), { force: true }); fs.rmSync(path.join(root, '.memev', 'daemon.lock'), { force: true }); } catch {} return false; }
  process.kill(info.pid, 'SIGTERM');
  const until = Date.now() + waitMs;
  while (Date.now() < until && pidAlive(info.pid)) await new Promise((r) => setTimeout(r, 100));
  if (pidAlive(info.pid)) process.kill(info.pid, 'SIGKILL');
  return true;
}
