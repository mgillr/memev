// SPDX-License-Identifier: Apache-2.0
// The onboarding checklist: what Memev did, what is ready, and the few things only you can do.
// Printed at the end of `memev init`; `memev onboarding` checks again (for example after a manual step).
import path from 'node:path';
import { readJson, writeJson, exists, now } from '../engine/util.mjs';
import { config } from './common.mjs';
import { loadMilestones, recordMilestones, MILESTONES } from '../engine/milestones.mjs';

const ICON = { succeeded: '\u2713', added: '+', ready: '\u2713', 'needs-manual': '\u2192', failed: '\u2717', skipped: '-' };

export async function checklist({ root, env, flags = {}, launcher, daemonUp = null, firstRun = false, platform = process.platform, icacls }) {
  const items = [];
  const add = (status, step, detail = '') => items.push({ status, step, detail });
  add('succeeded', 'Vault', root);
  if (daemonUp === null) { const { healthy } = await import('./daemon.mjs'); daemonUp = await healthy(root); }
  const why = daemonUp ? null : await (await import('./daemon.mjs')).whyNotRunning(root); // the listen error, if any
  add(daemonUp ? 'succeeded' : 'failed', 'Memev running', daemonUp ? 'on this machine (127.0.0.1)' : why ? `${why} (memev doctor)` : 'run memev doctor');
  // apps
  const clients = await import('./clients.mjs');
  if (firstRun && !flags['no-connect']) clients.connectAll({ env, launcher });
  const found = clients.detect(env, launcher);
  for (const c of found.filter((x) => x.found)) {
    if (c.connected) { add(firstRun ? 'added' : 'ready', c.name, c.mode === 'hooks' ? 'MCP + session hooks + instructions: memory is loaded and saved automatically' : 'MCP + instructions'); if (c.manual) add('needs-manual', `${c.name}: one step`, c.manual); }
    else add(c.declined ? 'skipped' : 'needs-manual', c.name, c.declined ? 'you disconnected it (memev connect ' + c.id + ' to undo)' : `memev connect ${c.id}`);
  }
  // the comms bus: bus/ is in the vault and committed, every connected app has a seat (each joins
  // and says hello on its first session), and the lead is the person's choice, never automatic
  const connected = found.filter((x) => x.connected).map((x) => x.id);
  if (daemonUp) {
    const bus = await import('./bus-cli.mjs');
    let r; try { r = await bus.setupBus({ root, env, clients: connected, flags, ask: firstRun ? undefined : false }); } catch (e) { r = { ok: false, seats: [], operator: null, problems: [e.message] }; }
    if (r.ok) add('succeeded', 'Agent comms bus', `bus/ set up and committed in the vault; ${r.seats.length ? `${r.seats.length} seat(s): ${r.seats.join(', ')}, each joins on its first session` : 'no AI apps yet, each gets a seat when it connects'}`);
    else add('failed', 'Agent comms bus', `${r.problems.join('; ')} (memev doctor --fix)`);
    for (const n of r.notes || []) add('needs-manual', 'Lead AI', n);
    if (r.operator) add('succeeded', 'Lead AI', `${r.operator} leads and coordinates the others, chosen by you (memev bus operator <seat> changes it)`);
    else if (!(r.notes || []).length) add('needs-manual', 'Lead AI', bus.LEAD_LATER);
  } else add('failed', 'Agent comms bus', 'not set up: Memev is not running (memev doctor)');
  if (!found.some((x) => x.found)) add('needs-manual', 'AI apps', 'none found yet; install one and Memev connects it automatically within 30 minutes (or run memev connect)');
  // service
  const svc = await import('./service.mjs');
  const u = svc.unitPaths(env);
  if (firstRun && !flags['no-service'] && !env.MEMEV_NO_SERVICE) { const r = await svc.installService({ env, root }); add(r.status, 'Start at login', r.detail); }
  else add(u.file && exists(u.file) ? 'ready' : 'needs-manual', 'Start at login', u.file && exists(u.file) ? u.file : 'memev service install');
  // cloud
  const cfg = config(root);
  if (!cfg.remote?.enabled) add('ready', 'Cloud AI apps', cfg.profile === 'org' ? 'remote access is off, as for every organisation install (memev cloud on --yes to enable)' : 'remote access is off (memev cloud on to enable)');
  else {
    let st = readJson(path.join(root, '.memev', 'tunnel.json'), null);
    for (let i = 0; firstRun && daemonUp && i < 40 && !st?.url && !/error|no provider|MEMEV_NO_TUNNEL/.test(st?.state || ''); i++) { await new Promise((r) => setTimeout(r, 250)); st = readJson(path.join(root, '.memev', 'tunnel.json'), null); }
    if (st?.url) add('needs-manual', 'Cloud AI apps (claude.ai, ChatGPT)', `add a custom connector with the URL from: memev cloud url${st.stable ? '' : ' (this address changes when the tunnel restarts; Tailscale gives a stable one)'}`);
    else add('needs-manual', 'Cloud AI apps', `remote access is on but the tunnel is ${st?.state || 'starting'}; check memev cloud status, or memev cloud off for local only`);
  }
  // backup
  const { git } = await import('../engine/git.mjs');
  const remote = git(root, ['remote']).out;
  add(remote ? 'ready' : 'needs-manual', 'Backup to your own private GitHub repository', remote ? `remote ${remote}` : 'memev github setup (two minutes, one browser sign-in)');
  // self-test
  if (daemonUp) {
    const { fileChecks } = await import('./doctor.mjs');
    const bad = fileChecks({ root, env, platform, ...(icacls ? { icacls } : {}) }).filter((c) => c.status === 'fail');
    add(bad.length ? 'failed' : 'succeeded', 'Self-test (memev doctor)', bad.length ? bad.map((c) => c.title).join(', ') : 'all checks pass');
  }
  // the milestones are worked out here, from the vault's own files, and kept in the same file; nothing leaves the machine
  writeJson(path.join(root, '.memev', 'onboarding.json'), { at: now(), items, milestones: loadMilestones(root) }, 0o600);
  try { recordMilestones({ root }); } catch { /* the checklist never fails over a milestone */ }
  return items;
}

export function print(items) {
  console.log('\nSetup');
  for (const i of items) console.log(`  ${ICON[i.status] || '?'} ${i.step}${i.detail ? `: ${i.detail}` : ''}`);
  const manual = items.filter((i) => i.status === 'needs-manual');
  console.log(manual.length ? `\n${manual.length} step(s) need you; run memev onboarding to check again after doing them.` : '\nEverything is set up.');
}

export async function firstRun(o) { const items = await checklist({ ...o, firstRun: true }); print(items); return items.some((i) => i.status === 'failed') ? 1 : 0; }
export function printMilestones(m) {
  console.log('Milestones (kept on this computer only):');
  for (const n of MILESTONES) console.log(`  ${m[n] ? '\u2713' : ' '} ${n.replace(/_/g, ' ')}${m[n] ? `  ${m[n].at.slice(0, 16).replace('T', ' ')}` : ''}`);
}
export async function command(cmd, pos, flags, { root, env }) {
  if (flags.milestones) { const m = recordMilestones({ root }); if (flags.json) console.log(JSON.stringify(m, null, 2)); else printMilestones(m); return 0; }
  const { launcherPath } = await import('./clients.mjs'); const items = await checklist({ root, env, flags, launcher: launcherPath(env) }); if (flags.json) console.log(JSON.stringify(items, null, 2)); else print(items); return items.some((i) => i.status === 'failed') ? 1 : 0; }
