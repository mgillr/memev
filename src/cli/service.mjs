// SPDX-License-Identifier: Apache-2.0
// Start Memev at login: a systemd user unit on Linux, a launchd agent on macOS. The daemon itself runs
// the periodic jobs (git sync, app re-detection, recall tuning) and supervises the tunnel, so one
// unit covers everything. `memev preflight` reports what this machine allows before anything is set up.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { homeDir, configDir, exists, writeAtomic } from '../engine/util.mjs';
import { resolveRoot, config, out } from './common.mjs';
import { launcherPath } from './clients.mjs';

const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }; };
const LABEL = 'dev.memev.daemon';

export function unitPaths(env = process.env) {
  const home = homeDir(env);
  if (process.platform === 'darwin') return { kind: 'launchd', file: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`) };
  if (process.platform === 'linux') return { kind: 'systemd', file: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user', 'memev.service') };
  return { kind: 'none', file: null };
}

export function renderUnit(kind, { launcher, root, logFile }) {
  if (kind === 'systemd') return `[Unit]
Description=Memev memory daemon
After=network-online.target

[Service]
Type=simple
ExecStart="${launcher}" serve --root "${root}"
Restart=on-failure
RestartSec=5
Environment=MEMEV_SERVICE=1

[Install]
WantedBy=default.target
`;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(launcher)}</string><string>serve</string><string>--root</string><string>${esc(root)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
</dict>
</plist>
`;
}

export async function installService({ env = process.env, root, activate = true } = {}) {
  const { kind, file } = unitPaths(env);
  if (kind === 'none') return { status: 'needs-manual', detail: 'no service manager support on this platform; run memev start at login' };
  const launcher = launcherPath(env);
  writeAtomic(file, renderUnit(kind, { launcher, root, logFile: path.join(root, '.memev', 'daemon.log') }), 0o644);
  if (!activate) return { status: 'added', detail: `${file} written (not activated)`, file };
  if (kind === 'systemd') {
    if (!exists('/run/systemd/system') && !run('systemctl', ['--user', 'is-system-running']).out) return { status: 'needs-manual', detail: `unit written to ${file}; this machine has no systemd user session (start Memev with memev start)`, file };
    const a = run('systemctl', ['--user', 'daemon-reload']); const b = run('systemctl', ['--user', 'enable', 'memev.service']);
    if (!a.ok || !b.ok) return { status: 'needs-manual', detail: `unit written to ${file}; enabling failed: ${(b.out || a.out).split('\n')[0]}`, file };
    const linger = run('loginctl', ['show-user', os.userInfo().username, '--property=Linger']).out.includes('yes');
    return { status: 'added', detail: `systemd user unit enabled${linger ? '' : ' (starts at login; for a headless machine run: loginctl enable-linger)'}`, file };
  }
  const uid = process.getuid?.() ?? 0;
  run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
  const r = run('launchctl', ['bootstrap', `gui/${uid}`, file]);
  return r.ok ? { status: 'added', detail: 'launchd agent loaded (starts at login)', file } : { status: 'needs-manual', detail: `agent written to ${file}; loading failed: ${r.out.split('\n')[0]}`, file };
}

export async function removeService({ env = process.env, quiet = false } = {}) {
  const { kind, file } = unitPaths(env);
  if (!file || !exists(file)) return { removed: false };
  if (kind === 'systemd') { run('systemctl', ['--user', 'disable', '--now', 'memev.service']); fs.rmSync(file, { force: true }); run('systemctl', ['--user', 'daemon-reload']); }
  else { run('launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}/${LABEL}`]); fs.rmSync(file, { force: true }); }
  if (!quiet) console.log(`Removed ${file}`);
  return { removed: true };
}

const portFree = (port) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });

/** What this machine allows: granted (works now), applied (Memev set it up), manual (needs you). */
export async function preflight({ env = process.env, root }) {
  const items = [];
  const add = (state, what, detail = '') => items.push({ state, what, detail });
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 22 ? 'granted' : 'manual', 'Node.js 22 or newer', `found ${process.versions.node}`);
  add(run('git', ['--version']).ok ? 'granted' : 'manual', 'git installed');
  try { fs.mkdirSync(configDir(env), { recursive: true }); fs.accessSync(configDir(env), fs.constants.W_OK); add('granted', 'config folder writable', configDir(env)); } catch { add('manual', 'config folder writable', configDir(env)); }
  const port = config(root).port || 7787;
  add((await portFree(port)) || exists(path.join(root, '.memev', 'daemon.json')) ? 'granted' : 'manual', `port ${port} free on 127.0.0.1`);
  const { kind, file } = unitPaths(env);
  add(file && exists(file) ? 'applied' : kind === 'none' ? 'manual' : 'granted', `start at login (${kind})`, file || '');
  const { pickProvider } = await import('./tunnel.mjs');
  const prov = pickProvider({ remote: { provider: 'auto' } }, env);
  add(prov === 'tailscale' ? 'granted' : 'applied', 'remote access provider', prov === 'tailscale' ? 'Tailscale Funnel (stable address)' : 'Cloudflare quick tunnel (address changes on restart; Tailscale gives a stable one)');
  add(run('git', ['config', 'user.email']).ok ? 'granted' : 'applied', 'git identity for vault commits', 'Memev uses a local identity in the vault when none is set');
  return items;
}

export async function command(cmd, pos, flags, { root, env }) {
  if (cmd === 'preflight') { for (const i of await preflight({ env, root })) console.log(`  ${i.state.padEnd(8)} ${i.what}${i.detail ? ` · ${i.detail}` : ''}`); return 0; }
  const sub = pos[0] || 'status';
  if (sub === 'install') { const r = await installService({ env, root }); (r.status === 'added' ? out.ok : out.warn)(r.detail); return r.status === 'added' ? 0 : 1; }
  if (sub === 'remove') { await removeService({ env }); return 0; }
  if (sub === 'print') { const { kind } = unitPaths(env); console.log(renderUnit(kind === 'none' ? 'systemd' : kind, { launcher: launcherPath(env), root, logFile: path.join(root, '.memev', 'daemon.log') })); return 0; }
  const { file } = unitPaths(env); console.log(file && exists(file) ? `Installed: ${file}` : 'Not installed (memev service install)'); return 0;
}
export { resolveRoot };
