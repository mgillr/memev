#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The daemon: one per vault. Opens the vault, serves HTTP on loopback, supervises the tunnel, syncs.
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../engine/vault.mjs';
import { VaultLocked } from '../engine/oplog.mjs';
import { createServer } from './http.mjs';
import { writePrivateJson, readJson, now } from '../engine/util.mjs';
import { parseArgs, tunnelKey, pidAlive } from '../cli/common.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const root = path.resolve(flags.root || process.env.MEMEV_ROOT || '.');
const state = path.join(root, '.memev');
const lock = path.join(state, 'daemon.lock');

// a vault config with a syntax error is a broken install, not a missing one: refuse to start on
// defaults and say exactly which file to fix
const cfgFile = path.join(state, 'config.json');
if (fs.existsSync(cfgFile)) {
  try { JSON.parse(fs.readFileSync(cfgFile, 'utf8')); }
  catch { console.error(`[memev] ${cfgFile} is not valid json; fix the file and start again`); process.exit(5); }
}

function takeLock() {
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); return true; }
  catch { const pid = Number(fs.readFileSync(lock, 'utf8')); if (pidAlive(pid) && pid !== process.pid) return false; fs.rmSync(lock, { force: true }); return takeLock(); }
}
if (!takeLock()) { console.error(`[memev] another daemon already serves ${root}`); process.exit(3); }

// Exit codes: 3 another daemon serves the vault, 4 the port cannot be listened on, 5 the vault's op log is held by another process
// (VaultLocked; the invalid config above also ends with 5, and `memev start` tells them apart by the line logged). The daemon's own
// daemon.lock goes first, so a refused start leaves no daemon.lock behind. Nothing here ends in an uncaught error.
const LOCKED = 5;
const dropLock = () => { try { if (fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.rmSync(lock, { force: true }); } catch {} };
let vault;
try { vault = new Vault(root).open(); }
catch (e) {
  dropLock();
  if (e instanceof VaultLocked) { console.error(`[memev] VaultLocked: ${e.message}`); process.exit(LOCKED); }
  console.error(`[memev] cannot open the vault at ${root}: ${e.message}`); process.exit(1);
}
const port = Number(flags.port || process.env.MEMEV_PORT || vault.config.port || 7787);
const bind = process.env.MEMEV_BIND || '127.0.0.1';
const server = createServer(vault, { tunnelKey: () => tunnelKey(root) });
const extras = [];
// the device registry records requests in memory; write it out every few seconds (report only)
const flush = setInterval(() => { try { vault.devices.saveSoon(); } catch {} }, 5000); flush.unref();
const stop = (code = 0) => {
  for (const x of extras) { try { x.stop?.(); } catch {} }
  server.close(); try { vault.close(); } catch {}
  fs.rmSync(lock, { force: true }); try { fs.rmSync(path.join(state, 'daemon.json'), { force: true }); } catch {}
  process.exit(code);
};
// The lock's token is checked here at every renewal interval (the lease itself runs in a worker, which cannot reach this thread). A
// daemon whose lock another holder has taken stops answering and exits with the VaultLocked code, so a supervisor waits for the
// holder, instead of answering /healthz while every write is refused. The lock file is the other holder's and is left alone.
const renewMs = Number(process.env.MEMEV_LOCK_RENEW_MS) > 0 ? Number(process.env.MEMEV_LOCK_RENEW_MS) : 15000;
const watch = setInterval(() => {
  let held = true; try { held = vault.log.holds(); } catch { held = false; }
  if (held) return;
  console.error('[memev] VaultLocked: another process holds the vault lock now; this daemon refuses writes and exits');
  stop(LOCKED);
}, Math.min(renewMs, 1000)); watch.unref();
process.on('SIGTERM', () => stop(0)); process.on('SIGINT', () => stop(0));
vault.on('reload', () => { vault.config = { ...vault.config, ...readJson(path.join(state, 'config.json'), {}) }; for (const x of extras) x.reload?.(); });
// a daemon that cannot listen closes its vault first, which releases the lock
server.on('error', (e) => { console.error(`[memev] cannot listen on ${bind}:${port}: ${e.message}`); try { vault.close(); } catch {} fs.rmSync(lock, { force: true }); process.exit(4); });
server.listen(port, bind, async () => {
  writePrivateJson(path.join(state, 'daemon.json'), { pid: process.pid, port, bind, started: now(), root });
  console.error(`[memev] serving ${root} on http://${bind}:${port}`);
  for (const mod of ['../cli/tunnel.mjs', '../cli/sync.mjs']) {
    try { const m = await import(mod); if (m.supervise) extras.push(m.supervise(vault, { root, port })); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error(`[memev] ${mod}: ${e.message}`); }
  }
});
