// SPDX-License-Identifier: Apache-2.0
// The onboarding checklist: what Memev did, what is ready, and the few things only you can do.
// Printed at the end of `memev init`; `memev onboarding` checks again (for example after a manual step).
import crypto from 'node:crypto';
import path from 'node:path';
import { readJson, writeJson, writePrivateJson, configDir, exists, now } from '../engine/util.mjs';
import { config, saveConfig } from './common.mjs';
import { fetchOut } from '../engine/net.mjs';
import { loadMilestones, recordMilestones, buildReport, MILESTONES } from '../engine/milestones.mjs';
import { cloudSeat } from './tunnel.mjs';

const ICON = { succeeded: '\u2713', added: '+', ready: '\u2713', 'needs-manual': '\u2192', failed: '\u2717', skipped: '-', unsupported: '\u00b7' };

export async function checklist({ root, env, flags = {}, launcher, daemonUp = null, firstRun = false, platform = process.platform, icacls, ask, input, output }) {
  const items = [];
  const add = (status, step, detail = '', more = {}) => items.push({ status, step, detail, ...more });
  add('succeeded', 'Vault', root);
  if (daemonUp === null) { const { healthy } = await import('./daemon.mjs'); daemonUp = await healthy(root); }
  const why = daemonUp ? null : await (await import('./daemon.mjs')).whyNotRunning(root); // the listen error, if any
  add(daemonUp ? 'succeeded' : 'failed', 'Memev running', daemonUp ? 'on this machine (127.0.0.1)' : why ? `${why} (memev doctor)` : 'run memev doctor');
  // apps
  const clients = await import('./clients.mjs');
  if (firstRun && !flags['no-connect']) {
    // the Claude Code tool consent: a flag, or one question on a terminal (asked once, kept either way)
    const hasClaude = clients.detect(env, launcher).some((c) => c.id === 'claude-code' && c.found);
    let allowTools = false;
    if (hasClaude) {
      if (flags['allow-tools'] === true) { setAllowTools(env, true); allowTools = true; }
      else allowTools = await askAllowToolsOnce({ env }).catch(() => false);
    }
    clients.connectAll({ env, launcher, allowTools: allowTools || undefined });
  }
  const found = clients.detect(env, launcher);
  for (const c of found.filter((x) => x.found)) {
    if (!c.supported) { add('unsupported', c.name, `found, not supported yet${c.manual ? `; ${c.manual}` : ''} (see docs/CLIENTS.md to ask for it)`, { app: c.id }); continue; }
    if (c.connected) { let detail = c.mode === 'hooks' ? 'MCP + session hooks + instructions: memory is loaded and saved automatically' : 'MCP + instructions'; if (c.id === 'claude-code') { const allowed = clients.claudeToolsAllowed(env); detail += allowed ? '; Memev tools are allowed, so no prompt per call' : '; Memev tools: Claude Code prompts before each call, allow them with memev connect claude-code --allow-tools'; } add(firstRun ? 'added' : 'ready', c.name, detail, { app: c.id }); if (c.manual) add('needs-manual', `${c.name}: one step`, c.manual, { app: c.id, note: true }); }
    else if (c.declined) add('skipped', c.name, 'you disconnected it (memev connect ' + c.id + ' to undo)', { app: c.id });
    else {
      // why it is not connected: a file Memev cannot edit is named, with the snippet to paste by hand
      let dry = null; try { dry = clients.connect(c.id, { env, launcher, dryRun: true }); } catch { /* reported by memev connect */ }
      add('needs-manual', c.name, dry?.status === 'needs-manual' && dry.file ? `${dry.file} ${dry.problem}, so Memev cannot add itself there; memev connect ${c.id} --print shows what to paste by hand` : `memev connect ${c.id}`, { app: c.id });
    }
  }
  // the comms bus: bus/ is in the vault and committed, every connected app has a seat (each joins
  // and says hello on its first session), and the lead is the person's choice, never automatic
  const connected = found.filter((x) => x.connected).map((x) => x.id);
  if (daemonUp) {
    const bus = await import('./bus-cli.mjs');
    let r; try { r = await bus.setupBus({ root, env, clients: connected, flags, ask: firstRun ? undefined : false }); } catch (e) { r = { ok: false, seats: [], operator: null, problems: [e.message] }; }
    if (r.ok) add('succeeded', 'Agent comms bus', `bus/ set up and committed in the vault; ${r.seats.length ? `${r.seats.length} seat(s): ${r.seats.join(', ')}, each joins on its first session` : 'no AI apps yet, each gets a seat when it connects'}`);
    if (r.ok) add('ready', 'How the bus works', 'apps answer between turns, so a task to an app waits until that app next runs a turn');
    else add('failed', 'Agent comms bus', `${r.problems.join('; ')} (memev doctor --fix)`);
    for (const n of r.notes || []) add('needs-manual', 'Lead AI', n);
    if (r.operator) add('succeeded', 'Lead AI', `${r.operator} leads and coordinates the others, chosen by you (memev bus operator <seat> changes it)`);
    else if (!(r.notes || []).length) add('needs-manual', 'Lead AI', bus.LEAD_LATER);
  } else add('failed', 'Agent comms bus', 'not set up: Memev is not running (memev doctor)');
  if (!found.some((x) => x.found)) add('needs-manual', 'AI apps', 'none found yet; install one and Memev connects it automatically within 30 minutes (or run memev connect)');
  // history import: offered once at init, on a terminal; never fails the checklist
  if (firstRun) {
    try {
      const imp = await import('./import.mjs');
      const r = await imp.offerImport({ root, env, flags, ask, input, output, cwd: process.cwd(), home: env.HOME || '' });
      if (r.asked) add(r.accepted ? 'succeeded' : 'skipped', 'History import', r.accepted ? `${r.result.imported} item(s) imported (memev import undo to remove)` : 'declined; memev import runs it any time');
    } catch { /* the checklist never fails over an import */ }
  }
  // service
  const svc = await import('./service.mjs');
  const u = svc.unitPaths(env);
  if (firstRun && !flags['no-service'] && !env.MEMEV_NO_SERVICE) { const r = await svc.installService({ env, root }); add(r.status, 'Start at login', r.detail); }
  else add(u.file && exists(u.file) ? 'ready' : 'needs-manual', 'Start at login', u.file && exists(u.file) ? u.file : 'memev service install');
  // cloud: off by default; on a terminal it is offered once, and the line says what gets exposed
  if (firstRun) await askCloudOnce({ root }).catch(() => {});
  const cfg = config(root);
  if (!cfg.remote?.enabled) add('ready', 'Cloud AI apps', cfg.profile === 'org' ? 'remote access is off, as for every organisation install; memev cloud on --yes shares what recall returns with a cloud AI app' : 'remote access is off; memev cloud on shares what recall returns with a cloud AI app (ChatGPT, claude.ai)');
  else {
    let st = readJson(path.join(root, '.memev', 'tunnel.json'), null);
    for (let i = 0; firstRun && daemonUp && i < 40 && !st?.url && !/error|no provider|MEMEV_NO_TUNNEL/.test(st?.state || ''); i++) { await new Promise((r) => setTimeout(r, 250)); st = readJson(path.join(root, '.memev', 'tunnel.json'), null); }
    const seat = cloudSeat(root);
    if (st?.url && seat) add('ready', 'Cloud AI apps (claude.ai, ChatGPT)', `${seat} is connected (memev cloud connect <app> prints the URL and waits for it)`);
    else if (st?.url) add('needs-manual', 'Cloud AI apps (claude.ai, ChatGPT)', `add a custom connector with the URL from: memev cloud url${st.stable ? '' : ' (this address changes when the tunnel restarts; Tailscale gives a stable one)'}. By plan: ChatGPT developer mode on Plus and Pro adds custom MCP servers, and full MCP with write tools is on Business, Enterprise and Edu; claude.ai Free allows one custom connector (docs/CLOUD.md has the matrix).`);
    else add('needs-manual', 'Cloud AI apps', `remote access is on but the tunnel is ${st?.state || 'starting'}; check memev cloud status, or memev cloud off for local only`);
  }
  // backup
  const { git } = await import('../engine/git.mjs');
  const remote = git(root, ['remote']).out;
  add(remote ? 'ready' : 'needs-manual', 'Backup to your own private GitHub repository', remote ? `remote ${remote}` : 'memev github setup (two minutes, one browser sign-in)');
  // a sync merge that the two computers could not join by itself: both versions are kept, the person looks
  const conflicts = readJson(path.join(root, '.memev', 'jobs.json'), {})?.sync?.conflicts || null;
  if (conflicts?.files?.length) add('needs-manual', 'Sync conflicts', `${conflicts.files.join(', ')}: both versions kept (memev doctor)`);
  // the memev command itself: a source install leaves the launcher off PATH
  const { launcherDir, onPath, commandName } = await import('./pathsetup.mjs');
  if (onPath(launcherDir(env), env)) add('ready', 'memev command', 'on your PATH');
  else add('needs-manual', 'memev command', `not on your PATH yet: memev path add puts it there (until then use ${commandName(env)})`);
  // self-test
  if (daemonUp) {
    const { fileChecks } = await import('./doctor.mjs');
    const bad = fileChecks({ root, env, platform, ...(icacls ? { icacls } : {}) }).filter((c) => c.status === 'fail');
    add(bad.length ? 'failed' : 'succeeded', 'Self-test (memev doctor)', bad.length ? bad.map((c) => c.title).join(', ') : 'all checks pass');
  }
  // contracts: off for new installs, on for existing vaults
  const contractsOn = cfg.contracts?.enabled !== false;
  add('ready', 'Contracts', contractsOn ? 'on: the Stop hook blocks while a signed contract is not verified (memev contracts off to turn off)' : 'off: the Stop hook never blocks on a contract (memev contracts on to enable)');
  // the anonymous report: asked once, off unless you say yes
  if (firstRun) await askReportOnce({ env }).catch(() => {});
  const rs = reportSettings(env);
  add('ready', 'Anonymous milestone report', rs.enabled ? 'on: only milestone names, days and a random id are sent (memev report show; memev report off)' : 'off, as it is for everyone until they choose (memev report on to share milestone names and days)');
  // the milestones are worked out here, from the vault's own files, and kept in the same file; nothing leaves the machine
  writeJson(path.join(root, '.memev', 'onboarding.json'), { at: now(), items, milestones: loadMilestones(root) }, 0o600);
  try { recordMilestones({ root }); } catch { /* the checklist never fails over a milestone */ }
  await sendReport({ root, env }).catch(() => {}); // does nothing unless the report is on and an address is set
  return items;
}

// what can wait: printed under 'Later, optional' whatever its state, so the steps that need you now stay few
const LATER = /^(Start at login|Cloud AI apps|Backup to your own private GitHub repository|memev command|Anonymous milestone report|Contracts)\b/;
const line = (i) => `  ${ICON[i.status] || '?'} ${i.step}${i.detail ? `: ${i.detail}` : ''}`;
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * Setup, then the one line that matters: Ready (the apps that now share one memory) or Not ready. Then at most two
 * steps that need you: restarting the apps (an app's own extra step belongs to it) and choosing the lead. What can
 * wait comes last, under 'Later, optional'.
 */
export function print(items) {
  const now = items.filter((i) => !LATER.test(i.step)); const later = items.filter((i) => LATER.test(i.step));
  console.log('\nSetup');
  for (const i of now.filter((x) => x.status !== 'needs-manual')) console.log(line(i));
  const failed = now.filter((i) => i.status === 'failed');
  const apps = now.filter((i) => i.app && !i.note && (i.status === 'added' || i.status === 'ready')).map((i) => i.step);
  if (failed.length) console.log(`\nNot ready: ${list(failed.map((i) => i.step))} (memev doctor says why).`);
  else console.log(`\nReady: ${apps.length > 1 ? `${list(apps)} share one memory` : apps.length ? `${apps[0]} has Memev; connect a second app and they share one memory` : 'Memev is running; connect an AI app to use it'}.`);
  const todo = now.filter((i) => i.status === 'needs-manual');
  const appTodo = todo.filter((i) => i.app); const other = todo.filter((i) => !i.app);
  const restart = apps.length || appTodo.length;
  const steps = (restart ? 1 : 0) + other.length;
  if (steps) {
    console.log(`\n${steps} step(s) need you; run memev onboarding to check again after doing them.`);
    if (restart) { console.log(`  \u2192 Apps: ${apps.length ? 'restart them as listed under Finish below' : 'connect them'}${appTodo.length ? ', and' : ''}`); for (const i of appTodo) console.log(`  ${line(i)}`); }
    for (const i of other) console.log(line(i));
  } else console.log('\nEverything is set up.');
  if (later.length) { console.log('\nLater, optional'); for (const i of later) console.log(line(i)); }
}

/** The history import is offered at init only on a terminal and never under init's --yes, so the person always sees the
 * preview before anything is imported (memev import --yes is the explicit way without a question). firstRun passes its
 * own stdin and stdout when it was given them, a test's, and the process's otherwise. */
export function initImportPrompt(flags = {}, { stdin = process.stdin, stdout = process.stdout } = {}) {
  return !flags.yes && stdin?.isTTY && stdout?.isTTY ? { ask: true, input: stdin, output: stdout } : {};
}
export async function firstRun(o) {
  const items = await checklist({ ...initImportPrompt(o.flags, o), ...o, firstRun: true }); print(items); await (await import('./pathsetup.mjs')).offer({ env: o.env });
  await finish(o);
  return items.some((i) => i.status === 'failed') ? 1 : 0;
}
/** The last thing init prints: one line per connected app saying how to make it pick Memev up. */
export async function finish({ env, launcher }) {
  const { detect } = await import('./clients.mjs');
  const apps = detect(env, launcher).filter((c) => c.connected);
  if (!apps.length) return;
  console.log('\nFinish: restart these apps');
  for (const c of apps) console.log(`  \u2192 ${c.restart}`);
}
// ---- the opt-in anonymous milestone report. Off by default; nothing is sent until it is on AND an address is set.
export const reportFile = (env = process.env) => path.join(configDir(env), 'report.json');
/** { enabled, asked, id, sent }. A fresh install: off, never asked, no id. */
export function reportSettings(env = process.env) {
  const s = readJson(reportFile(env), null) || {};
  return { enabled: s.enabled === true, asked: s.asked === true, id: typeof s.id === 'string' ? s.id : null, sent: s.sent && typeof s.sent === 'object' ? s.sent : {} };
}
const saveReport = (env, s) => writePrivateJson(reportFile(env), s);
/** Turn it on (making the random id) or off (forgetting the id, so a later yes starts a new, unrelated one). */
export function setReport(env, on) {
  const s = reportSettings(env);
  saveReport(env, on ? { ...s, enabled: true, asked: true, id: s.id || crypto.randomBytes(16).toString('hex') } : { enabled: false, asked: true, id: null, sent: {} });
  return reportSettings(env);
}
const loopbackHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
/** Where a report goes: MEMEV_REPORT_URL. There is no built-in address, so with none set nothing can be sent. */
export function reportEndpoint(env = process.env) {
  const raw = String(env.MEMEV_REPORT_URL || '').trim();
  if (!raw) return null;
  let u; try { u = new URL(raw); } catch { throw new Error(`MEMEV_REPORT_URL is not a URL: ${raw}`); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopbackHost(u.hostname))) throw new Error('MEMEV_REPORT_URL must be https (plain http only for this computer)');
  return u.toString();
}
/** What would be sent, or null when the report is off or there is nothing to say yet. */
export function reportPayload({ root, env = process.env }) {
  const s = reportSettings(env);
  if (!s.enabled || !s.id) return null;
  const p = buildReport({ id: s.id, milestones: loadMilestones(root) });
  return p.milestones.length ? p : null;
}
/** Send the report if it is on, an address is set and there is a milestone not yet reported. Never throws, never retries in a loop. */
export async function sendReport({ root, env = process.env, fetchImpl = (u, o) => fetchOut(u, o, env), timeoutMs = 3000 }) {
  const s = reportSettings(env);
  if (!s.enabled) return { sent: false, reason: 'off' };
  let endpoint; try { endpoint = reportEndpoint(env); } catch (e) { return { sent: false, reason: e.message }; }
  if (!endpoint) return { sent: false, reason: 'no report address is set, so nothing is sent' };
  const p = reportPayload({ root, env });
  if (!p) return { sent: false, reason: 'no milestones yet' };
  if (p.milestones.every((m) => s.sent[m.name] === m.date)) return { sent: false, reason: 'everything is already reported' };
  try {
    const res = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { sent: false, reason: `the report address answered ${res.status}` };
  } catch (e) { return { sent: false, reason: `could not reach the report address (${e.cause?.code || e.name || 'network error'})` }; }
  saveReport(env, { ...reportSettings(env), sent: Object.fromEntries(p.milestones.map((m) => [m.name, m.date])) });
  return { sent: true, payload: p };
}
export const REPORT_QUESTION = 'Share anonymous progress milestones to help improve Memev?\n  What would be sent: the names of the milestones you reach (for example "installed") with the day, and a random number that is not tied to you.\n  Never sent: your memories, file names or paths, app names, your name or address.\n  It is off unless you say yes, you can see the exact text with memev report show, and memev report off stops it.\n';
/** Asked once, on a terminal only. The answer is kept either way and the question never comes back. `ask` forces (true) or forbids (false) it; input and output are for tests. */
export async function askReportOnce({ env = process.env, ask, input = process.stdin, output = process.stdout } = {}) {
  if (reportSettings(env).asked) return null;
  if (!(ask ?? (!!input.isTTY && !!output.isTTY))) return null;
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input, output, terminal: false });
  let a = '';
  try { output.write(`\n${REPORT_QUESTION}`); a = (await rl.question('Share anonymous milestones? [y/N] ')).trim().toLowerCase(); } finally { rl.close(); }
  const yes = a === 'y' || a === 'yes';
  setReport(env, yes);
  return yes;
}
// ---- the Claude Code tool consent. Off by default; Claude Code prompts before each Memev tool call until it is on.
export const allowToolsFile = (env = process.env) => path.join(configDir(env), 'allow-tools.json');
/** { enabled, asked }. A fresh install: off, never asked. */
export function allowToolsSettings(env = process.env) {
  const s = readJson(allowToolsFile(env), null) || {};
  return { enabled: s.enabled === true, asked: s.asked === true };
}
const saveAllowTools = (env, s) => writePrivateJson(allowToolsFile(env), s);
/** Turn it on or off. */
export function setAllowTools(env, on) {
  const s = allowToolsSettings(env);
  saveAllowTools(env, { ...s, enabled: !!on, asked: true });
  return allowToolsSettings(env);
}
export const ALLOW_TOOLS_QUESTION = 'Let Memev call its own tools in Claude Code without a prompt each time?\n  What changes: Memev adds the Memev memory tools (recall, remember, checkpoint, status, why) to the allow list in ~/.claude/settings.json, so Claude Code runs them without asking you each time. The write and contract tools still prompt.\n  Never changes: your other permissions, or any other app. It is off unless you say yes, and memev disconnect claude-code removes them again.\n';
/** Asked once, on a terminal only. The answer is kept either way and the question never comes back. `ask` forces (true) or forbids (false) it; input and output are for tests. */
export async function askAllowToolsOnce({ env = process.env, ask, input = process.stdin, output = process.stdout } = {}) {
  const s = allowToolsSettings(env);
  if (s.asked) return s.enabled;
  if (!(ask ?? (!!input.isTTY && !!output.isTTY))) return s.enabled;
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input, output, terminal: false });
  let a = '';
  try { output.write(`\n${ALLOW_TOOLS_QUESTION}`); a = (await rl.question('Allow Memev tools in Claude Code? [y/N] ')).trim().toLowerCase(); } finally { rl.close(); }
  const yes = a === 'y' || a === 'yes';
  setAllowTools(env, yes);
  return yes;
}
// ---- cloud access for cloud AI apps. Off by default; offered once on a terminal at init.
export const CLOUD_QUESTION = 'Use your memory from ChatGPT or claude.ai?\n  What would be shared: what recall returns, to the cloud AI app that asks for it (memev cloud url prints the address and its secret).\n  It is off unless you say yes, and memev cloud off stops it.\n';
/** Offered once, on a terminal only. A yes turns remote access on and reloads the daemon; the answer is kept either way and the question never comes back. `ask` forces (true) or forbids (false) it; input and output are for tests. */
export async function askCloudOnce({ root, ask, input = process.stdin, output = process.stdout } = {}) {
  const cfg = config(root);
  if (cfg.remote?.enabled || cfg.remote?.asked) return null;
  if (!(ask ?? (!!input.isTTY && !!output.isTTY))) return null;
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input, output, terminal: false });
  let a = '';
  try { output.write(`\n${CLOUD_QUESTION}`); a = (await rl.question('Use your memory from ChatGPT or claude.ai? [y/N] ')).trim().toLowerCase(); } finally { rl.close(); }
  const yes = a === 'y' || a === 'yes';
  saveConfig(root, { ...cfg, remote: { ...cfg.remote, enabled: yes, asked: true } });
  if (yes) (await import('./tunnel.mjs')).reloadDaemon(root).catch(() => {});
  return yes;
}
async function reportCommand(pos, flags, { root, env }) {
  const sub = pos[0] || 'status';
  const s = reportSettings(env);
  const endpoint = (() => { try { return reportEndpoint(env); } catch { return null; } })();
  const preview = () => buildReport({ id: s.id || '<a random number, made when you turn the report on>', milestones: loadMilestones(root) });
  if (sub === 'on') { const r = setReport(env, true); console.log(`  \u2713 the anonymous milestone report is on (random id ${r.id.slice(0, 8)}\u2026). memev report show prints exactly what is sent; memev report off stops it.`); if (!endpoint) console.log('    No report address is set yet (MEMEV_REPORT_URL), so nothing is sent.'); return 0; }
  if (sub === 'off') { setReport(env, false); console.log('  \u2713 the anonymous milestone report is off; its random id is forgotten'); return 0; }
  if (sub === 'show') { try { recordMilestones({ root }); } catch { /* no vault yet */ } console.log(s.enabled ? 'This is exactly what is sent (and nothing else):' : 'The report is off, so nothing is sent. If you turned it on, this is exactly what would be sent:'); console.log(JSON.stringify(preview(), null, 2)); return 0; }
  if (sub === 'send') {
    if (!s.enabled) { console.log('  The report is off, so nothing was sent (memev report on turns it on).'); return 1; }
    try { recordMilestones({ root }); } catch { /* no vault yet */ }
    const r = await sendReport({ root, env });
    console.log(r.sent ? `  \u2713 sent ${r.payload.milestones.length} milestone(s)` : `  Nothing sent: ${r.reason}`);
    return r.sent || /^(everything|no milestones)/.test(r.reason) ? 0 : 1;
  }
  if (sub === 'status') {
    if (flags.json) { console.log(JSON.stringify({ enabled: s.enabled, asked: s.asked, address_set: !!endpoint }, null, 2)); return 0; }
    console.log(`Anonymous milestone report: ${s.enabled ? 'on' : 'off'}${s.asked ? '' : ' (not asked yet)'}${s.enabled && !endpoint ? '; no report address is set, so nothing is sent' : ''}`);
    console.log('It is off unless you turn it on. memev report on | off | show | send');
    return 0;
  }
  throw new Error('memev report [status] | on | off | show | send');
}
export function printMilestones(m) {
  console.log('Milestones (kept on this computer only):');
  for (const n of MILESTONES) console.log(`  ${m[n] ? '\u2713' : ' '} ${n.replace(/_/g, ' ')}${m[n] ? `  ${m[n].at.slice(0, 16).replace('T', ' ')}` : ''}`);
}
export async function command(cmd, pos, flags, { root, env }) {
  if (cmd === 'report') return reportCommand(pos, flags, { root, env });
  if (flags.milestones) { const m = recordMilestones({ root }); if (flags.json) console.log(JSON.stringify(m, null, 2)); else printMilestones(m); return 0; }
  const { launcherPath } = await import('./clients.mjs'); const items = await checklist({ root, env, flags, launcher: launcherPath(env) }); if (flags.json) console.log(JSON.stringify(items, null, 2)); else print(items); return items.some((i) => i.status === 'failed') ? 1 : 0; }
