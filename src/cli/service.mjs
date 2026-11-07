// SPDX-License-Identifier: Apache-2.0
// Start Memev at login: a systemd user unit on Linux, a launchd plist on macOS, a per-user Task Scheduler
// entry on Windows. The daemon itself runs the periodic jobs (git sync, app re-detection, recall tuning) and
// supervises the tunnel, so one unit covers everything. `memev preflight` (preflight.mjs) reports what this
// machine allows before anything is set up.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { homeDir, configDir, exists, writeAtomic, run as spawn } from '../engine/util.mjs';
import { resolveRoot, out } from './common.mjs';
import { launcherPath } from './clients.mjs';

const run = (cmd, args) => { const r = spawn(cmd, args, { windowsHide: true, timeout: 15000 }); return { ok: r.ok, out: `${r.stdout}${r.stderr}`.trim() }; };
const LABEL = 'dev.memev.daemon';
// launchctl, systemctl and schtasks act on the whole user account, not on the HOME in use, so with MEMEV_NO_SERVICE set
// (tests and sandboxes set it) Memev never calls them: a sandbox must not replace the person's own login service
export const serviceOff = (env = process.env) => !!env.MEMEV_NO_SERVICE;
const TASK = 'Memev Daemon';

export function unitPaths(env = process.env, platform = process.platform) {
  const home = homeDir(env);
  if (platform === 'darwin') return { kind: 'launchd', file: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`) };
  if (platform === 'linux') return { kind: 'systemd', file: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user', 'memev.service') };
  if (platform === 'win32') return { kind: 'schtasks', file: null };
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

export async function installService({ env = process.env, root, activate = true, platform = process.platform, run: runCmd = run } = {}) {
  if (serviceOff(env)) return { status: 'skipped', detail: 'MEMEV_NO_SERVICE is set, so no login service is installed' };
  const { kind, file } = unitPaths(env, platform);
  if (kind === 'none') return { status: 'needs-manual', detail: 'no service manager support on this platform; run memev start at login' };
  const launcher = launcherPath(env);
  if (kind === 'schtasks') {
    const user = env.USERNAME || env.USER || os.userInfo().username;
    const r = runCmd('schtasks', ['create', '/tn', TASK, '/tr', `"${launcher}" serve --root "${root}"`, '/sc', 'onlogon', '/ru', user, '/f']);
    return r.ok ? { status: 'added', detail: `Task Scheduler entry "${TASK}" starts the daemon at logon for ${user}` } : { status: 'needs-manual', detail: `task creation failed: ${r.out.split('\n')[0]}` };
  }
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

export async function removeService({ env = process.env, quiet = false, platform = process.platform, run: runCmd = run } = {}) {
  if (serviceOff(env)) return { removed: false };
  const { kind, file } = unitPaths(env, platform);
  if (kind === 'schtasks') {
    const r = runCmd('schtasks', ['delete', '/tn', TASK, '/f']);
    if (!quiet) console.log(`Removed ${TASK}`);
    return { removed: r.ok };
  }
  if (!file || !exists(file)) return { removed: false };
  if (kind === 'systemd') { run('systemctl', ['--user', 'disable', '--now', 'memev.service']); fs.rmSync(file, { force: true }); run('systemctl', ['--user', 'daemon-reload']); }
  else { run('launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}/${LABEL}`]); fs.rmSync(file, { force: true }); }
  if (!quiet) console.log(`Removed ${file}`);
  return { removed: true };
}

export async function command(cmd, pos, flags, { root, env }) {
  const sub = pos[0] || 'status';
  if (sub === 'install') { const r = await installService({ env, root }); (r.status === 'added' ? out.ok : out.warn)(r.detail); return r.status === 'added' ? 0 : 1; }
  if (sub === 'remove') { await removeService({ env }); return 0; }
  if (sub === 'print') { const { kind } = unitPaths(env); console.log(renderUnit(kind === 'none' ? 'systemd' : kind, { launcher: launcherPath(env), root, logFile: path.join(root, '.memev', 'daemon.log') })); return 0; }
  const { file } = unitPaths(env); console.log(file && exists(file) ? `Installed: ${file}` : 'Not installed (memev service install)'); return 0;
}
export { resolveRoot };
