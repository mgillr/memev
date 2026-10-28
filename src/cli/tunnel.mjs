// SPDX-License-Identifier: Apache-2.0
// Remote access for cloud AI apps, off by default, one command to switch on (`memev cloud on`).
// Providers, best first:
//   tailscale   `tailscale serve` on this machine: a stable https name, tailnet only; a public
//               Funnel only after the explicit `memev cloud funnel on`
//   cloudflare  a named Cloudflare tunnel you configured (`memev cloud use cloudflare --name N --hostname H`): stable
//   quick       a Cloudflare quick tunnel: no account, but the address changes when it restarts
// The daemon supervises the tunnel, restarts it with backoff and records the current address.
// Everything that arrives through it is a remote request (see src/server/http.mjs for the rules).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { configDir, readJson, writePrivate, writePrivateJson, writeJson, randomToken, now, exists, run as runCmd } from '../engine/util.mjs';
import { tunnelKeyFile, tunnelKey, config, saveConfig, clientToken, adminToken, api, out } from './common.mjs';
import { publishAddressRecord } from './sync.mjs';
import { fetchOut } from '../engine/net.mjs';
import { loadLicense } from '../engine/license.mjs';
import { limitsFor } from '../engine/entitlements.mjs';
import { TOKEN_RE } from '../engine/tokens.mjs';
import { qrText } from '../../vendor/qr.mjs';

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

const which = (bin) => { const r = runCmd(process.platform === 'win32' ? 'where' : 'which', [bin]); return r.ok ? r.stdout.split(/\r?\n/)[0].trim() : null; };
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
  const r = await fetchOut(url, {}, env); if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== pin[1]) throw new Error(`cloudflared checksum mismatch (got ${got.slice(0, 12)}…); not using it`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (pin[0].endsWith('.tgz')) { const tgz = path.join(dir, 'c.tgz'); fs.writeFileSync(tgz, buf); runCmd('tar', ['xzf', tgz, '-C', dir]); fs.rmSync(tgz); }
  else fs.writeFileSync(bin, buf, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  return bin;
}

// Tailscale Funnel is only used when the user explicitly chose it and consented to it. `auto` never
// opens a funnel on its own: a funnel exposes this machine to the public internet, so it needs a yes.
export const funnelConsent = (cfg) => cfg.remote?.funnelConsent === true;

export function pickProvider(cfg, env = process.env, { run = runCmd, whichFn = which } = {}) {
  const want = cfg.remote?.provider || 'auto';
  if (want === 'cloudflare' && cfg.remote?.cloudflare?.name) return 'cloudflare';
  // A pinned tailscale stays tailscale: without consent it is the tailnet-only serve, never a
  // public quick tunnel. A funnel is a separate explicit step (memev cloud funnel on).
  if (want === 'tailscale' || want === 'auto') {
    const ts = whichFn('tailscale');
    if (ts) { const s = run(ts, ['status', '--json'], { timeout: 3000 }); if (s.ok) { try { if (JSON.parse(s.stdout).BackendState === 'Running') return 'tailscale'; } catch {} } }
    if (want === 'tailscale') return null;
  }
  if (want === 'cloudflare' && !cfg.remote?.cloudflare?.name) return null;
  return 'quick';
}

// Every command Memev runs against Tailscale Funnel goes through here, so the tests can see and control
// each one. `run` is the command executor (defaults to the guarded run helper). A funnel that already
// exists for the port is never changed or removed: Memev only manages the funnel it created itself.
export function tailscaleFunnel({ ts, port, run = runCmd }) {
  const alreadyConfigured = () => run(ts, ['funnel', 'status', String(port)], { timeout: 5000 }).ok;
  const url = () => { const st = JSON.parse(run(ts, ['status', '--json']).stdout); return `https://${String(st.Self.DNSName).replace(/\.$/, '')}`; };
  return {
    alreadyConfigured,
    // Bring the funnel up only when there is not already one for this port. Returns the address.
    up() { if (alreadyConfigured()) return url(); const r = run(ts, ['funnel', '--bg', '--yes', String(port)], { timeout: 20000 }); if (!r.ok) throw new Error(r.error || (r.stderr || r.stdout).trim().split('\n').pop()); return url(); },
    // Turn the funnel off. Only call this for a funnel Memev opened itself (the tunnel state
    // records that); a pre-existing funnel for the port is never touched.
    down() { const r = run(ts, ['funnel', '--bg', String(port), 'off'], { timeout: 10000 }); if (!r.ok) log(`tailscale funnel off failed: ${r.error || (r.stderr || r.stdout).trim()}`); },
  };
}

/** The daemon side: keep the tunnel up while remote access is on. */
export function supervise(vault, { root, port, run = runCmd, whichFn = which }) {
  let child = null, stopped = false, backoff = 1000, timer = null;
  const env = process.env;
  const write = (s) => writeJson(stateFile(root), { ...s, updated: now() }, 0o600);
  const log = (m) => console.error(`[memev tunnel] ${m}`);
  async function start() {
    clearTimeout(timer);
    if (stopped || !vault.config.remote?.enabled || env.MEMEV_NO_TUNNEL) { write({ enabled: !!vault.config.remote?.enabled, provider: null, url: null, state: vault.config.remote?.enabled ? 'disabled by MEMEV_NO_TUNNEL' : 'off' }); return; }
    ensureTunnelKey(root);
    const provider = pickProvider(vault.config, env, { run, whichFn });
    if (!provider) { write({ enabled: true, provider: null, url: null, state: 'no provider available' }); return; }
    try {
      if (provider === 'tailscale') {
        const ts = whichFn('tailscale');
        // A funnel needs an explicit yes; without consent the tailnet-only serve is what comes up.
        if (funnelConsent(vault.config)) {
          const f = tailscaleFunnel({ ts, port, run });
          // A funnel that already exists for the port is left alone: Memev only manages the one it opens.
          if (f.alreadyConfigured()) {
            const st = run(ts, ['status', '--json']);
            if (!st.ok) throw new Error(st.error || (st.stderr || st.stdout).trim().split('\n').pop() || 'tailscale status failed');
            const url = `https://${String(JSON.parse(st.stdout).Self.DNSName).replace(/\.$/, '')}`;
            write({ enabled: true, provider, url, stable: true, state: 'up (existing funnel left as is)' }); log(`up at ${url} (existing funnel left as is)`); return;
          }
          const url = f.up();
          write({ enabled: true, provider, url, stable: true, state: 'up', mode: 'funnel' }); log(`up at ${url}`); return;
        }
        const r = run(ts, ['serve', '--bg', String(port)], { timeout: 20000 });
        if (!r.ok) throw new Error(r.error || (r.stderr || r.stdout).trim().split('\n').pop() || `tailscale serve failed (exit ${r.status})`);
        const st = run(ts, ['status', '--json']);
        if (!st.ok) throw new Error(st.error || (st.stderr || st.stdout).trim().split('\n').pop() || 'tailscale status failed');
        const parsed = JSON.parse(st.stdout);
        const url = `https://${String(parsed.Self.DNSName).replace(/\.$/, '')}`;
        write({ enabled: true, provider, url, stable: true, state: 'up', mode: 'serve' }); log(`up at ${url}`); return;
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
    if (tunnelState(root)?.provider === 'tailscale') {
      const ts = whichFn('tailscale');
      if (ts) {
        // A pre-existing funnel is never turned off; only the tunnel Memev started is, and the
        // state records whether that was a funnel Memev opened or a tailnet-only serve.
        if (tunnelState(root)?.state !== 'up (existing funnel left as is)') {
          if (tunnelState(root)?.mode === 'funnel') {
            tailscaleFunnel({ ts, port, run }).down();
          } else {
            const r = run(ts, ['serve', '--bg', '--https=443', 'off'], { timeout: 10000 });
            if (!r.ok) log(`tailscale serve off failed: ${r.error || (r.stderr || r.stdout).trim()}`);
          }
        }
      }
    }
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

/** The name of a cloud seat on the bus (any `<app>@cloud`, or the one for `app`), or null. A removed seat is gone. */
export function cloudSeat(root, app = null) {
  const dir = path.join(root, 'bus', 'seats');
  let files; try { files = fs.readdirSync(dir); } catch { return null; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const rec = readJson(path.join(dir, f), null);
    if (!rec?.seat || rec.removed) continue;
    if (app ? rec.seat === `${app}@cloud` : /@cloud$/.test(rec.seat)) return rec.seat;
  }
  return null;
}

/** The plan note: the number of connectors the tier covers, or "not capped" only when the tier has no number. */
export function planNote(limits) {
  return limits.connectors == null ? 'cloud connectors not capped' : `${limits.connectors} cloud connectors covered`;
}

/** The wait for `memev cloud connect` in ms: a positive number of seconds, 120 when the flag is missing or not a number. */
export function connectTimeoutMs(flags) {
  return Math.max(1, Number(flags.timeout) || 120) * 1000;
}

/** True once the device that holds this token has been seen since `start`.
    Every request through the connector, MCP calls included, updates the device's last_seen, so this
    catches an app that never touches the bus. A seat from before `start` does not count. */
export function deviceSeenSince(root, token, start) {
  const id = TOKEN_RE.exec(String(token || '').trim())?.[1];
  if (!id) return false;
  const reg = readJson(path.join(root, '.memev', 'devices.json'), null);
  const d = reg?.devices && Object.values(reg.devices).find((x) => x.token_id === id);
  return !!(d?.last_seen && Date.parse(d.last_seen) >= start);
}

export async function reloadDaemon(root) { const t = adminToken(root); if (!t) return false; try { return (await api(root, '/v1/reload', { token: t })).ok; } catch { return false; } }

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
    // Choosing tailscale here picks the tailnet-only serve; a public funnel is a separate explicit step.
    cfg.remote = { ...cfg.remote, provider: p, ...(p === 'cloudflare' ? { cloudflare: { name: flags.name, hostname: flags.hostname } } : {}) };
    if (p === 'cloudflare' && (!flags.name || !flags.hostname)) throw new Error('memev cloud use cloudflare --name <tunnel> --hostname <host>');
    saveConfig(root, cfg); await reloadDaemon(root); console.log(p === 'tailscale' ? 'Tunnel provider: tailscale (tailnet only; a public funnel needs memev cloud funnel on)' : `Tunnel provider: ${p}`); return 0;
  }
  if (sub === 'funnel') {
    const f = pos[1]; if (!['on', 'off'].includes(f)) throw new Error('memev cloud funnel on|off');
    if (f === 'on' && !flags.yes) { console.log('A Tailscale Funnel puts this machine on the public internet: anyone who knows the address can reach the vault. To switch it on anyway: memev cloud funnel on --yes'); return 1; }
    cfg.remote = { ...cfg.remote, funnelConsent: f === 'on' };
    saveConfig(root, cfg); await reloadDaemon(root);
    console.log(f === 'on' ? 'Tailscale Funnel is allowed: with the tailscale provider the tunnel goes public (memev cloud status shows the address).' : 'Tailscale Funnel is off: the tailscale tunnel stays tailnet only.');
    return 0;
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
  if (sub === 'connect') {
    const app = pos[1];
    if (!['chatgpt', 'claude'].includes(app)) throw new Error('memev cloud connect chatgpt|claude');
    const st = tunnelState(root);
    if (!cfg.remote?.enabled) { console.log('Remote access is off. Turn it on first: memev cloud on'); return 1; }
    if (!st?.url) { console.log(`The tunnel has no address yet (${st?.state || 'not started'}); check memev cloud status`); return 1; }
    const token = clientToken(root, app, { remote: true });
    const url = `${st.url}/c/${token}/mcp`;
    const name = app === 'claude' ? 'claude.ai' : 'ChatGPT';
    const limits = limitsFor(loadLicense({ env }));
    console.log(`Connect ${name} to this vault.`);
    console.log(`Plan: ${limits.tier} (${planNote(limits)})`);
    console.log(`Connector URL (add as a custom connector in ${name}): ${url}`);
    console.log('Treat the connector URL like a password. Revoke it with memev token revoke <id>.');
    console.log('Or scan the QR code:');
    console.log(qrText(url));
    const timeoutMs = connectTimeoutMs(flags);
    const start = Date.now();
    for (;;) {
      if (deviceSeenSince(root, token, start)) {
        const seat = cloudSeat(root, app);
        console.log(seat
          ? `  \u2713 ${app}@cloud is on the bus; ${name} is connected`
          : `  \u2713 ${name} is connected (it takes the ${app}@cloud seat on its first bus message)`);
        return 0;
      }
      if (Date.now() - start >= timeoutMs) { console.log(`  \u2192 no ${app}@cloud seat after ${Math.round(timeoutMs / 1000)}s; in ${name}, add the connector URL as a custom connector and start a chat that uses it, then run memev cloud connect ${app} again`); return 1; }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('memev cloud on|off|status|url|use|funnel|relay|rotate-key|connect');
}
