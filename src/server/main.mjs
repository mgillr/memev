#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The daemon: one per vault. Opens the vault, serves HTTP on loopback, supervises the tunnel, syncs.
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../engine/vault.mjs';
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

// A long open (the first run, or the one conversion of an old index) says so, so memev start can tell loading from hung and leave it be.
const loadingFile = path.join(state, 'daemon.loading');
try { writePrivateJson(loadingFile, { pid: process.pid, started: now() }); } catch {}
const vault = new Vault(root).open();
const port = Number(flags.port || process.env.MEMEV_PORT || vault.config.port || 7787);
const bind = process.env.MEMEV_BIND || '127.0.0.1';
const server = createServer(vault, { tunnelKey: () => tunnelKey(root) });
const extras = [];
// the device registry records requests in memory; write it out every few seconds (report only)
const flush = setInterval(() => { try { vault.devices.saveSoon(); } catch {} }, 5000); flush.unref();
const stop = (code = 0) => {
  for (const x of extras) { try { x.stop?.(); } catch {} }
  server.close(); try { vault.close(); } catch {}
  fs.rmSync(lock, { force: true }); try { fs.rmSync(path.join(state, 'daemon.json'), { force: true }); fs.rmSync(loadingFile, { force: true }); } catch {}
  process.exit(code);
};
process.on('SIGTERM', () => stop(0)); process.on('SIGINT', () => stop(0));
vault.on('reload', () => { vault.config = { ...vault.config, ...readJson(path.join(state, 'config.json'), {}) }; for (const x of extras) x.reload?.(); });
server.on('error', (e) => { console.error(`[memev] cannot listen on ${bind}:${port}: ${e.message}`); fs.rmSync(lock, { force: true }); fs.rmSync(loadingFile, { force: true }); process.exit(4); });
server.listen(port, bind, async () => {
  writePrivateJson(path.join(state, 'daemon.json'), { pid: process.pid, port, bind, started: now(), root });
  fs.rmSync(loadingFile, { force: true });
  console.error(`[memev] serving ${root} on http://${bind}:${port}`);
  for (const mod of ['../cli/tunnel.mjs', '../cli/sync.mjs']) {
    try { const m = await import(mod); if (m.supervise) extras.push(m.supervise(vault, { root, port })); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error(`[memev] ${mod}: ${e.message}`); }
  }
  // a start trusts a note's stat, so every note's bytes are checked once behind it
  vault.on('sweep', (s) => { console.error(`[memev] sweep ${s.state}: ${s.hashed} notes in ${s.cycle_ms ?? '?'} ms, ${s.changed} changed${s.error ? `, ${s.error}` : ''}`); });
  vault.startSweep();
  vault.startIdleWork();
});
