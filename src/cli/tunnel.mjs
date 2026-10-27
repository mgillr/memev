// SPDX-License-Identifier: Apache-2.0
// Remote access for cloud AI apps, on by default, one command to switch off (`memev cloud off`).
// Providers, best first:
//   tailscale   `tailscale funnel` on this machine: a stable https name on your tailnet
//   cloudflare  a named Cloudflare tunnel you configured (`memev cloud use cloudflare --name N --hostname H`): stable
//   quick       a Cloudflare quick tunnel: no account, but the address changes when it restarts
// The daemon supervises the tunnel, restarts it with backoff and records the current address.
// Everything that arrives through it is a remote request (see src/server/http.mjs for the rules).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { configDir, readJson, writePrivate, writePrivateJson, writeJson, randomToken, now, exists, run } from '../engine/util.mjs';
import { tunnelKeyFile, tunnelKey, config, saveConfig, clientToken, adminToken, api, out } from './common.mjs';
import { publishAddressRecord } from './sync.mjs';

export const CLOUDFLARED = {
  version: '2026.10.4',
  sha256: {
    'linux-x64': ['cloudflared-linux-amd64', 'ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42'],
    'linux-arm64': ['cloudflared-linux-arm64', '2b7203b4fb0ba28a0c1e12f8855ce2c25f76d266a8d5edafac5540b6812acff6'],
    'darwin-x64': ['cloudflared-darwin-amd64.tgz', 'fdec0f9a1c726f4c10283fc0cd70e602d510c72887b737270433c81a08c883a9'],
    'darwin-arm64': ['cloudflared-darwin-arm64.tgz', '49e7963072b2ca83fb44c09f4d4a7cda52d390c0c9c6f55bac83454a5bc43910'],
    'win32-x64': ['cloudflared-windows-amd64.exe', '411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8'],
  },
};

const which = (bin) => { const r = run(process.platform === 'win32' ? 'where' : 'which', [bin]); return r.ok ? r.stdout.split(/\r?\n/)[0].trim() : null; };
export function ensureTunnelKey(root) { let k = tunnelKey(root); if (!k) { k = randomToken(24); writePrivate(tunnelKeyFile(root), `${k}\n`); } return k; }
const stateFile = (root) => path.join(root, '.memev', 'tunnel.json');
export const tunnelState = (root) => readJson(stateFile(root), null);

/** Find (or, for quick tunnels, download and verify) cloudflared. */
export async function cloudflaredPath(env = process.env, { download = true } = {}) {
  const onPath = which('cloudflared'); if (onPath) return onPath;
  const key = `${process.platform}-${process.arch}`; const pin = CLOUDFLARED.sha256[key];
  if (!pin) return null;
  const dir = path.join(configDir(env), 'tools', `cloudflared-${CLOUDFLARED.version}`); const bin = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (exists(bin)) return bin;
  if (!download || env.MEMEV_NO_DOWNLOAD) return null;
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED.version}/${pin[0]}`;
  const r = await fetch(url); if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== pin[1]) throw new Error(`cloudflared checksum mismatch (got ${got.slice(0, 12)}…); not using it`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (pin[0].endsWith('.tgz')) { const tgz = path.join(dir, 'c.tgz'); fs.writeFileSync(tgz, buf); run('tar', ['xzf', tgz, '-C', dir]); fs.rmSync(tgz); }
  else fs.writeFileSync(bin, buf, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  return bin;
}

export function pickProvider(cfg, env = process.env) {
  const want = cfg.remote?.provider || 'auto';
  if (want === 'cloudflare' && cfg.remote?.cloudflare?.name) return 'cloudflare';
  if (want === 'tailscale' || want === 'auto') {
    const ts = which('tailscale');
    if (ts) { const s = spawnSync(ts, ['status', '--json'], { encoding: 'utf8', timeout: 3000 }); try { if (JSON.parse(s.stdout).BackendState === 'Running') return 'tailscale'; } catch {} }
    if (want === 'tailscale') return null;
  }
  if (want === 'cloudflare' && !cfg.remote?.cloudflare?.name) return null;
  return 'quick';
}

/** The daemon side: keep the tunnel up while remote access is on. */
export function supervise(vault, { root, port }) {
  let child = null, stopped = false, backoff = 1000, timer = null;
  const env = process.env;
  const write = (s) => writeJson(stateFile(root), { ...s, updated: now() }, 0o600);
  const log = (m) => console.error(`[memev tunnel] ${m}`);
  async function start() {
    clearTimeout(timer);
    if (stopped || !vault.config.remote?.enabled || env.MEMEV_NO_TUNNEL) { write({ enabled: !!vault.config.remote?.enabled, provider: null, url: null, state: vault.config.remote?.enabled ? 'disabled by MEMEV_NO_TUNNEL' : 'off' }); return; }
    ensureTunnelKey(root);
    const provider = pickProvider(vault.config, env);
    if (!provider) { write({ enabled: true, provider: null, url: null, state: 'no provider available' }); return; }
    try {
      if (provider === 'tailscale') {
        const ts = which('tailscale');
        const r = spawnSync(ts, ['funnel', '--bg', '--yes', String(port)], { encoding: 'utf8', timeout: 20000 });
        if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').pop());
        const st = JSON.parse(spawnSync(ts, ['status', '--json'], { encoding: 'utf8' }).stdout);
        const url = `https://${String(st.Self.DNSName).replace(/\.$/, '')}`;
        write({ enabled: true, provider, url, stable: true, state: 'up' }); log(`up at ${url}`); return;
      }
      const bin = await cloudflaredPath(env);
      if (!bin) throw new Error('cloudflared is not installed and could not be downloaded');
      const args = provider === 'cloudflare'
        ? ['tunnel', '--no-autoupdate', 'run', '--url', `http://127.0.0.1:${port}`, vault.config.remote.cloudflare.name]
        : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const fixed = provider === 'cloudflare' ? `https://${vault.config.remote.cloudflare.hostname}` : null;
      if (fixed) write({ enabled: true, provider, url: fixed, stable: true, state: 'starting' });
      const onData = (d) => {
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
        if (m && !fixed) {
          const prev = tunnelState(root)?.url;
          write({ enabled: true, provider, url: m[0], stable: false, state: 'up' });
          if (prev && prev !== m[0]) {
            fs.appendFileSync(path.join(root, '.memev', 'tunnel-urls.log'), `${now()} ${m[0]}\n`);
            log(`address changed to ${m[0]}; cloud apps need the new address (memev cloud status)`);
            try { publishAddressRecord(root, m[0]); } catch (e) { log(e.message); }
          } else log(`up at ${m[0]}`);
          backoff = 1000;
        }
        if (fixed && /Registered tunnel connection/.test(String(d))) { write({ enabled: true, provider, url: fixed, stable: true, state: 'up' }); backoff = 1000; }
      };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('exit', (code) => { child = null; if (stopped) return; write({ enabled: true, provider, url: tunnelState(root)?.url || null, state: `restarting (exit ${code})` }); timer = setTimeout(start, backoff); backoff = Math.min(backoff * 2, 5 * 60000); });
    } catch (e) { log(e.message); write({ enabled: true, provider, url: null, state: `error: ${e.message}` }); timer = setTimeout(start, backoff); backoff = Math.min(backoff * 2, 5 * 60000); }
  }
  function halt() {
    clearTimeout(timer);
    if (child) { child.removeAllListeners('exit'); child.kill(); child = null; }
    if (tunnelState(root)?.provider === 'tailscale') { const ts = which('tailscale'); if (ts) spawnSync(ts, ['funnel', '--bg', String(port), 'off'], { timeout: 10000 }); }
  }
  start();
  // the relay (off unless the setting is on) is kept up beside the tunnel; see relay.mjs and docs/RELAY.md
  const relay = import('./relay.mjs').then((m) => m.superviseRelay(vault, { root, port, env })).catch((e) => { log(`relay: ${e.message}`); return null; });
  return { stop() { stopped = true; halt(); relay.then((r) => r?.stop()); }, reload() { halt(); start(); relay.then((r) => r?.reload()); } };
}

/** Connector URLs a cloud app can use: the URL form carries the token, so treat it like a password. */
export function connectorInfo(root, client = 'cloud') {
  const st = tunnelState(root); if (!st?.url) return null;
  const token = clientToken(root, client, { remote: true });
  return { url: st.url, stable: !!st.stable, connector_url: `${st.url}/c/${token}/mcp`, mcp_url: `${st.url}/mcp`, headers: { Authorization: `Bearer ${token}` } };
}

async function reloadDaemon(root) { const t = adminToken(root); if (!t) return false; try { return (await api(root, '/v1/reload', { token: t })).ok; } catch { return false; } }

export async function command(cmd, pos, flags, { root, env = process.env }) {
  const sub = pos[0] || 'status'; const cfg = config(root);
  if (sub === 'on' || sub === 'off') {
    if (sub === 'on' && cfg.profile === 'org' && !flags.yes) { console.log('This is an organisation install, where remote access starts off. Recalled text sent through the tunnel reaches whichever cloud AI app asked for it. To switch it on anyway: memev cloud on --yes'); return 1; }
    cfg.remote = { ...cfg.remote, enabled: sub === 'on' }; saveConfig(root, cfg);
    const live = await reloadDaemon(root);
    console.log(sub === 'on' ? 'Remote access is on. Cloud AI apps can reach this vault through the tunnel (memev cloud status shows the address).' : 'Remote access is off. Only apps on this machine can reach the vault. Turn it back on with: memev cloud on');
    if (!live) out.warn('the daemon is not running; the change applies when it starts');
    return 0;
  }
  if (sub === 'use') {
    const p = pos[1]; if (!['auto', 'tailscale', 'cloudflare', 'quick'].includes(p)) throw new Error('memev cloud use auto|tailscale|cloudflare|quick');
    cfg.remote = { ...cfg.remote, provider: p, ...(p === 'cloudflare' ? { cloudflare: { name: flags.name, hostname: flags.hostname } } : {}) };
    if (p === 'cloudflare' && (!flags.name || !flags.hostname)) throw new Error('memev cloud use cloudflare --name <tunnel> --hostname <host>');
    saveConfig(root, cfg); await reloadDaemon(root); console.log(`Tunnel provider: ${p}`); return 0;
  }
  if (sub === 'relay') { const rc = await (await import('./relay.mjs')).command(pos.slice(1), flags, { root, env }); if (['on', 'off'].includes(pos[1]) && rc === 0) await reloadDaemon(root); return rc; }
  if (sub === 'rotate-key') { writePrivate(tunnelKeyFile(root), `${randomToken(24)}\n`); console.log('New legacy tunnel key. It is no longer needed: each app and computer has its own credential (memev devices). Apps that still send X-Memev-Key need the new value or should drop the header.'); return 0; }
  if (sub === 'status' || sub === 'url') {
    const st = tunnelState(root);
    if (!cfg.remote?.enabled) { console.log('Remote access: off (memev cloud on to enable)'); return 0; }
    console.log(`Remote access: on · provider ${st?.provider || 'none'} · ${st?.state || 'not started'}`);
    if (!st?.url) return st?.state === 'up' ? 0 : 1;
    const info = connectorInfo(root, flags.client || 'cloud');
    console.log(`  Address: ${info.url}${info.stable ? '' : ' (changes when the tunnel restarts; install Tailscale or set up a named Cloudflare tunnel for a stable address)'}`);
    if (flags['show-secrets'] || sub === 'url') {
      console.log(`  Connector URL for apps that take only a URL (claude.ai, ChatGPT): ${info.connector_url}`);
      console.log(`  Or ${info.mcp_url} with the header Authorization: Bearer <token> (each app and computer gets its own: memev devices enroll)`);
      console.log('  Treat the connector URL like a password. Revoke it with memev token revoke <id>.');
    } else console.log('  memev cloud url prints the connector URL (it contains a secret).');
    return 0;
  }
  throw new Error('memev cloud on|off|status|url|use|relay|rotate-key');
}
