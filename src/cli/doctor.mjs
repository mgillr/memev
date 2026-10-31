// SPDX-License-Identifier: Apache-2.0
// `memev doctor`: checks everything Memev depends on and says what to do. Exit 0 when healthy.
// --fix applies the safe fixes; fixes that could lose data or cut off an app ask first (or need --yes).
// --bundle writes a support file with no secrets in it. The same checks back the memev_doctor MCP tool.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { readJson, writeJson, exists, sha256, configDir, homeDir, now, run } from '../engine/util.mjs';
import { redactSecrets, findSecrets } from '../engine/secrets.mjs';
import { VERSION, isVault } from '../engine/vault.mjs';
import { PKG, daemonInfo, pidAlive, config, out, clientsFile, tokenExpiryWarnings } from './common.mjs';
import { EXPIRY_WARNING_DAYS } from '../engine/tokens.mjs';
import { licensingStatus, licencePhrase } from './licensing.mjs';
import { alt443, githubReachable } from './github.mjs';
import { label } from '../engine/bus.mjs';
import { fetchOut } from '../engine/net.mjs';
import { fixFor } from './preflight.mjs';
import { updateLine } from './update.mjs';

const C = (id, title, status, detail = '', fix = null) => ({ id, title, status, detail, fix });

/** Run icacls on a path; null when icacls is not available (not Windows, or not on PATH). */
export function runIcacls(args) {
  const r = run('icacls', args, { timeout: 15000 });
  if (!r.ok) return null;
  return r.stdout;
}

/** Principals an ACL entry may name without making a file readable by others: this user, the system and administrators. */
function aclOthers(text, file, user) {
  const ok = (who) => {
    const w = who.trim().toLowerCase();
    if (w === 'creator owner' || w === 'system' || w.endsWith('\\system') || w.endsWith('\\administrators') || w === 'administrators' || w.endsWith('\\trustedinstaller')) return true;
    const u = String(user || '').toLowerCase();
    return !!u && (w === u || w.endsWith(`\\${u}`));
  };
  const others = [];
  for (let line of String(text).split(/\r?\n/)) {
    if (line.startsWith(file)) line = line.slice(file.length);
    const m = /^\s*(.+?):\(/.exec(line);
    if (m && !/\(DENY\)/.test(line) && !ok(m[1])) others.push(m[1].trim());
  }
  return [...new Set(others)];
}

const under = (file, base) => { const rel = path.relative(path.resolve(base), path.resolve(file)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

/**
 * Which of Memev's private files other users can read. POSIX: the mode bits. Windows has no mode bits to judge
 * (every file reports 0o666), so there the ACL is read with icacls where it exists, and where it does not the
 * files only count as private when they sit under the user profile, whose ACL already keeps other users out.
 */
export function privateFiles({ state, names, env = process.env, platform = process.platform, icacls = runIcacls }) {
  const loose = [];
  if (platform !== 'win32') {
    const mode = (f) => { try { return fs.statSync(f).mode & 0o777; } catch { return null; } };
    if ((mode(state) ?? 0) & 0o077) loose.push('.memev/');
    for (const f of names) { const m = mode(path.join(state, f)); if (m !== null && m & 0o077) loose.push(f); }
    return { loose, unknown: false, detail: '0600/0700', fix: loose.length ? { desc: 'restrict them to you (chmod 600/700)', destructive: false, run: () => { try { fs.chmodSync(state, 0o700); } catch {} for (const f of loose) try { fs.chmodSync(path.join(state, f.replace(/\/$/, '')), f.endsWith('/') ? 0o700 : 0o600); } catch {} } } : null };
  }
  const user = env.USERNAME || (() => { try { return os.userInfo().username; } catch { return ''; } })();
  const targets = [['.memev/', state], ...names.filter((f) => exists(path.join(state, f))).map((f) => [f, path.join(state, f)])];
  let aclSeen = false;
  for (const [label, file] of targets) {
    const text = icacls([file]);
    if (text === null) continue;
    aclSeen = true;
    if (aclOthers(text, file, user).length) loose.push(label);
  }
  const fix = loose.length ? { desc: 'restrict them to you (icacls /inheritance:r, then grant your user)', destructive: false, run: () => { for (const [label, file] of targets) if (loose.includes(label)) { icacls([file, '/inheritance:r']); icacls([file, '/grant:r', `${user}:(OI)(CI)F`]); } } } : null;
  if (aclSeen) return { loose, unknown: false, detail: 'only you, the system and administrators can read them (checked with icacls)', fix };
  const home = homeDir(env);
  if (under(state, home)) return { loose, unknown: false, detail: 'under your user profile, which other users cannot read (icacls not available to check)', fix: null };
  return { loose, unknown: true, detail: `${state} is outside your user profile and icacls is not available to check it; keep the vault under ${home}`, fix: null };
}

/**
 * The Node the launcher runs, decided the way the launcher decides: node from PATH when it is 22 or newer, else the
 * recorded one. A launcher from before that rule, and the Windows one, only ever run the recorded Node.
 */
export function launcherNode(file, env = process.env) {
  const text = fs.readFileSync(file, 'utf8');
  const rec = /^REC='((?:[^']|'\\'')*)'$/m.exec(text)?.[1].replace(/'\\''/g, "'") ?? /^(?:exec |@)"([^"]+)"/m.exec(text)?.[1] ?? null;
  const version = (f) => { const r = spawnSync(f, ['--version'], { encoding: 'utf8', timeout: 10000 }); return r.status === 0 ? r.stdout.trim() : null; };
  let onPath = null, onPathVersion = null;
  if (/^REC=/m.test(text)) {
    onPath = String(env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'node')).find((f) => exists(f)) || null;
    if (onPath && onPath !== rec) {
      onPathVersion = version(onPath);
      if (Number(/^v?(\d+)/.exec(onPathVersion || '')?.[1]) >= 22) return { node: onPath, version: onPathVersion, from: 'PATH', recorded: rec };
    }
  }
  if (rec && exists(rec)) return { node: rec, version: version(rec), from: 'recorded', recorded: rec };
  return { node: null, recorded: rec, onPath, onPathVersion };
}

/** Checks that only need the files (safe inside the daemon too). */
export function fileChecks({ root, env = process.env, vault = null, platform = process.platform, icacls = runIcacls, license = null }) {
  const r = [];
  const major = Number(process.versions.node.split('.')[0]);
  r.push(C('node', 'Node.js 22+', major >= 22 ? 'ok' : 'fail', process.versions.node));
  const g = run('git', ['--version']);
  r.push(C('git', 'git installed', g.ok ? 'ok' : 'fail', g.ok ? g.stdout.trim() : `not found on PATH (${g.error})`, g.ok ? null : { desc: 'install git', destructive: false, cmd: 'git' }));
  if (!isVault(root)) { r.push(C('vault', 'vault exists', 'fail', `no vault at ${root}`, { desc: 'create it: memev init', destructive: false, cmd: 'init' })); return r; }
  r.push(C('vault', 'vault exists', 'ok', root));
  const state = path.join(root, '.memev');
  const names = ['tokens.json', 'admin.json', 'clients.json', 'tunnel-key.txt', 'config.json'];
  const mine = privateFiles({ state, names, env, platform, icacls });
  r.push(C('permissions', 'private files are private', mine.loose.length ? 'fail' : mine.unknown ? 'warn' : 'ok', mine.loose.length ? `readable by others: ${mine.loose.join(', ')}` : mine.detail, mine.loose.length ? mine.fix : null));
  const warnings = tokenExpiryWarnings(root);
  r.push(C('token-expiry', 'credentials do not silently expire', warnings.length ? 'warn' : 'ok', warnings.length ? warnings.join('; ') : `no credential expires within ${EXPIRY_WARNING_DAYS} days`));
  if (vault) {
    const v = vault.log.verify();
    r.push(C('oplog', 'operation log intact', v.ok ? 'ok' : 'fail', v.ok ? `${v.ops} ops in ${v.segments} segment(s), every seal and chain verified` : v.errors.slice(0, 3).join('; ')));
    const notes = vault.allNotes(); const idx = vault.index.stats().notes;
    r.push(C('index', 'recall index covers every note', idx === notes.length ? 'ok' : 'warn', `${idx}/${notes.length} notes`, idx === notes.length ? null : { desc: 'rebuild the index', destructive: false, run: () => vault.reindexAll() }));
    let drift = 0; for (const [p, h] of vault.log.heads) { if (h.deleted || !h.ch) continue; const b = vault._read(p); if (b === null || sha256(b) !== h.ch) drift++; }
    r.push(C('drift', 'notes match the log', drift ? 'warn' : 'ok', drift ? `${drift} note(s) changed outside Memev; they are imported on the next write or restart` : 'in sync', drift ? { desc: 'import the changes now', destructive: false, run: () => { for (const [p] of vault.log.heads) vault.syncFromDisk(p, 'doctor'); } } : null));
    let leaks = 0; for (const p of notes.filter((x) => !x.startsWith('work/sessions/')).slice(0, 5000)) if (findSecrets(vault._read(p) || '').length) leaks++;
    r.push(C('secrets', 'no credentials stored in notes', leaks ? 'warn' : 'ok', leaks ? `${leaks} note(s) look like they hold a credential; rotate it and remove it from the note (git history keeps old versions)` : 'none found'));
    const b = vault.bus.health();
    r.push(C('bus', 'agent comms bus', b.bad_lines ? 'fail' : b.stale.length ? 'warn' : 'ok', `${b.seats} seat(s), ${b.live} live, ${b.messages} message(s)${b.operator ? `, operator ${b.operator}` : ', no operator seat'}${b.never ? `, ${b.never} never joined` : ''}${b.stale.length ? `; stale: ${b.stale.join(', ')} (no heartbeat lately: the app is closed or offline; memev bus check asks everyone)` : ''}${b.bad_lines ? `; ${b.bad_lines} unreadable line(s) in bus/log/` : ''}`));
  }
  const clients = readJson(path.join(configDir(env), 'clients-state.json'), { connected: {}, files: {} });
  r.push(...busChecks({ root, vault, connected: Object.keys(clients.connected || {}) }));
  const launcher = path.join(configDir(env), 'bin', process.platform === 'win32' ? 'memev.cmd' : 'memev');
  const ln = exists(launcher) ? launcherNode(launcher, env) : null;
  if (!ln) r.push(C('launcher', 'stable launcher installed', 'warn', 'missing: apps cannot start Memev', { desc: 'reinstall the launcher', destructive: false, cmd: 'runtime' }));
  else if (ln.node) r.push(C('launcher', 'stable launcher installed', 'ok', `${launcher} runs ${ln.node}${ln.version ? ` (${ln.version})` : ''}${ln.from === 'PATH' ? ', found on PATH' : ''}`));
  else r.push(C('launcher', 'stable launcher installed', 'fail', `${launcher} finds no Node.js 22 or newer: ${ln.onPath ? `node on PATH is ${ln.onPathVersion || 'not runnable'}` : 'no node on PATH'}, and the recorded ${ln.recorded || 'Node'} is gone`,
    { desc: `${fixFor('node', platform)} Then run memev doctor --fix to point the launcher at it.`, destructive: false, cmd: 'runtime' }));
  const missing = Object.entries(clients.files || {}).filter(([f]) => { try { return !fs.readFileSync(f, 'utf8').includes('memev'); } catch { return true; } }).map(([f, rec]) => rec.client);
  const ids = Object.keys(clients.connected || {});
  // after memev init --no-connect the person connects each app themselves, so --fix never connects them all (issue 284)
  const chosen = config(root).clients?.auto_connect === false;
  if (chosen && !ids.length) r.push(C('apps', 'AI apps connected', 'ok', 'none yet, as chosen with --no-connect: memev connect <app> connects one'));
  else if (chosen && missing.length) r.push(C('apps', 'AI apps connected', 'warn', `${ids.join(', ')}; entries missing for ${[...new Set(missing)].join(', ')}: memev connect <app> for each, as chosen with --no-connect`));
  else r.push(C('apps', 'AI apps connected', ids.length ? (missing.length ? 'warn' : 'ok') : 'warn', ids.length ? `${ids.join(', ')}${missing.length ? `; entries missing for ${[...new Set(missing)].join(', ')}` : ''}` : 'none yet', ids.length && !missing.length ? null : { desc: 'connect every installed app again', destructive: false, cmd: 'connect' }));
  const cfg = config(root);
  // deployment: report where the vault runs and what kind of AI provider it uses. Report only: it
  // never fails the run. The one warning is a choice that cannot work as written.
  const dep = cfg.deployment || {};
  const depMode = ['local', 'on-prem', 'cloud-hosted'].includes(dep.mode) ? dep.mode : 'local';
  const depProvider = ['hosted-api', 'internal-llm', 'mixed'].includes(dep.ai_provider) ? dep.ai_provider : 'unset';
  const depMismatch = depMode === 'cloud-hosted' && depProvider === 'internal-llm';
  r.push(C('deployment', 'deployment mode', depMismatch ? 'warn' : 'ok', depMismatch
    ? `mode ${depMode}, provider ${depProvider}: an internal model is only reachable inside your network, so it cannot be reached from a managed host; see docs/DOCKER.md for the self-hosted install`
    : `mode ${depMode}, provider ${depProvider}`));
  const tun = readJson(path.join(state, 'tunnel.json'), null);
  if (cfg.remote?.enabled) r.push(C('remote', 'remote access', tun?.state === 'up' ? 'ok' : 'warn', tun?.state === 'up' ? `${tun.provider} at ${tun.url}${tun.stable ? '' : ' (address changes on restart)'}` : `on, but the tunnel is ${tun?.state || 'not started'}; memev cloud off switches remote access off`));
  else r.push(C('remote', 'remote access', 'ok', 'off (local only)'));
  const remote = run('git', ['remote'], { cwd: root }).stdout.trim();
  const jobs = readJson(path.join(state, 'jobs.json'), {});
  const relay = cfg.remote?.relay || {};
  const relayState = readJson(path.join(state, 'relay-state.json'), null);
  // the relay is the vault's address, not its backup. 'connecting' is not a failure yet, and 'off' with the setting on
  // means the daemon is not holding the relay (stopped, or MEMEV_NO_TUNNEL), not that the relay is down
  const fallback = `the relay address does not reach the vault${tun?.state === 'up' ? ' (the tunnel does)' : ''}, and your other computers still get its notes through this git backup`;
  const relayHeld = env.MEMEV_NO_TUNNEL || relayState?.state === 'off';
  const relayDown = relayState && !['up', 'connecting', 'off'].includes(relayState.state);
  const relayLine = !remote ? ''
    : relay.enabled && relayHeld
      ? `; the relay is on but not running${env.MEMEV_NO_TUNNEL ? ' (MEMEV_NO_TUNNEL is set)' : ''}, so ${fallback}; memev cloud relay status shows the relay's state`
      : relay.enabled && relayDown
        ? `; the relay is on but unreachable, so ${fallback}; memev cloud relay status shows the relay's state`
        : !relay.enabled && (relay.url || relay.domain)
          ? `; the relay is off, so ${fallback}; memev cloud relay on switches it back on`
          : '';
  r.push(C('backup', 'vault backed up off this machine', remote ? (jobs.sync?.error ? 'warn' : 'ok') : 'warn', remote ? (jobs.sync?.error ? `last sync: ${jobs.sync.error}` : `git remote ${remote}${jobs.sync?.at ? `, last sync ${jobs.sync.at}` : ''}`) + relayLine : 'no backup yet: memev github setup'));
  if (jobs.sync?.warning) r.push(C('writers', 'one computer writes the git backup', 'warn', jobs.sync.warning));
  try {
    // report only: licence and seats never fail the doctor and never limit anything
    const ls = licensingStatus({ root, env, vault, license });
    const flagged = ls.usage.flagged || [];
    const renewal = ls.renewal;
    r.push(C('license', 'licence and seats (report only)', flagged.length || renewal ? 'warn' : 'ok', `${licencePhrase(ls.license)}; ${ls.usage.computers} computer(s), ${ls.usage.connectors} connector(s), ${ls.usage.local_clients} local client(s)${ls.notes.length ? `; ${ls.notes.join(' ')}` : ''}${renewal ? `; ${renewal}` : ''}${flagged.length ? `; credential flagged on ${flagged.map((f) => f.label).join(', ')}: memev devices` : ''}`));
  } catch (e) { r.push(C('license', 'licence and seats (report only)', 'ok', `not checked: ${e.message}`)); }
  try { const s = fs.statfsSync(root); const freePct = (s.bavail / s.blocks) * 100; const inodePct = s.files ? (s.ffree / s.files) * 100 : 100; r.push(C('disk', 'disk space', freePct < 3 || inodePct < 3 ? 'warn' : 'ok', `${freePct.toFixed(0)}% space, ${inodePct.toFixed(0)}% inodes free`)); } catch {}
  const upd = updateLine(root, env);
  if (upd) r.push(C('update', 'update available', 'warn', upd));
  if (env.MEMEV_CONTAINER === '1') {
    const vaultWritable = (() => { try { const t = path.join(root, '.memev', `write-test-${process.pid}`); fs.writeFileSync(t, 'ok'); fs.rmSync(t, { force: true }); return true; } catch { return false; } })();
    r.push(C('container-vault', 'vault volume mounted and writable', vaultWritable ? 'ok' : 'fail', vaultWritable ? `${root} is writable` : `${root} is not writable; check the volume mount`));
    r.push(C('container-loopback', 'host port (check it on the host)', 'ok', 'the host port mapping is not visible from inside the container; check it on the host with: docker compose -f compose.trial.yaml port memev 7787'));
    r.push(C('container-remote', 'remote access off', cfg.remote?.enabled ? 'warn' : 'ok', cfg.remote?.enabled ? 'remote access is on in the vault config; run memev cloud off in the container' : 'off (local only)'));
  }
  return r;
}

/** The comms bus on disk: bus/ in the vault, a seat for every connected app, and a lead the person chose. */
export function busChecks({ root, vault = null, connected = [] }) {
  const r = [];
  const has = (f) => exists(path.join(root, 'bus', f));
  const folder = has('config.json') && has('operator.json') && has('log');
  r.push(C('bus-files', 'comms bus folder in the vault', folder ? 'ok' : 'fail', folder ? 'bus/ (committed with the vault)' : 'bus/ is missing from the vault', folder ? null : vault ? { desc: 'set bus/ up again', destructive: false, run: () => vault.bus.ensure(vault.host.id) } : { desc: 'set bus/ up again', destructive: false, cmd: 'bus' }));
  // each connected app's seat on this computer, whatever it is called: <app>@<machine>, an older <app>@host, or a new name
  let seats = [];
  try { seats = fs.readdirSync(path.join(root, 'bus', 'seats')).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(root, 'bus', 'seats', f), null)).filter(Boolean); } catch { /* no seats yet */ }
  const missing = connected.filter((id) => !seats.some((s) => s.client === label(id) && s.device_kind === 'host' && !s.removed));
  r.push(C('bus-seats', 'every connected app has a bus seat', missing.length ? 'fail' : 'ok', missing.length ? `no seat for ${missing.join(', ')}` : `${connected.length} app(s) seated`, missing.length ? { desc: 'seat them', destructive: false, cmd: 'bus' } : null));
  const lead = readJson(path.join(root, 'bus', 'operator.json'), null)?.seat || null;
  r.push(C('bus-lead', 'lead AI chosen', lead ? 'ok' : 'warn', lead ? `${lead} leads the others` : 'needs you: no lead AI chosen yet; pick the AI that leads and coordinates the others with memev bus operator <seat> (memev bus roster lists the seats)'));
  return r;
}

/**
 * Whether GitHub can be reached for the git backup: port 22 first, then ssh.github.com on 443.
 * A failing check carries the fix. probe is injectable so tests never touch the network.
 */
export async function githubNetCheck({ probe } = {}) {
  const net = await githubReachable({ probe });
  return C('github-net', 'GitHub reachable for the backup', net.ok ? 'ok' : 'fail',
    net.ok ? `reachable at ${net.open.join(', ')}` : 'neither github.com:22 nor ssh.github.com:443 answers, so the backup cannot push',
    net.ok ? null : { desc: 'fix the network, or push over HTTPS with a fine-grained token for that one repository (docs/GITHUB.md)', destructive: false });
}

/** The next ports above this vault. A second vault started because the preferred port was taken lands here. */
function nearbyPorts(minePort) {
  const base = Number(minePort) || 7787;
  const ports = [];
  for (let p = base + 1; p < Math.min(base + 100, 65536); p++) ports.push(p);
  return ports;
}

/** Another Memev on this computer, seen by its /healthz vault id. Empty when this is the only one. */
async function twoVaultChecks(root) {
  const mine = config(root).vault_id;
  if (!mine || !isVault(root)) return [];
  const ports = nearbyPorts(daemonInfo(root)?.port || config(root).port);
  const found = [];
  for (let i = 0; i < ports.length; i += 16) {
    const rows = await Promise.all(ports.slice(i, i + 16).map(async (port) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 200);
      try {
        const r = await fetchOut(`http://127.0.0.1:${port}/healthz`, { signal: ac.signal });
        const body = await r.json();
        if (body?.ok === true && body.vault_id && body.vault_id !== mine) return body.vault_id;
      } catch { /* closed port or not Memev */ }
      finally { clearTimeout(timer); }
      return null;
    }));
    for (const id of rows) if (id) found.push(id);
  }
  if (!found.length) return [];
  const ids = [...new Set(found)];
  return [C('two-vaults', 'one vault on this computer', 'warn', `two vaults on this computer: this one is ${mine} and another is ${ids.join(', ')}. Join that vault instead of keeping two: memev init --join`)];
}

/**
 * The vault id a local backup remote carries in its signed address record (address.json, committed with the
 * backup). Null when the remote is not a local path (a git URL would need the network) or carries no readable
 * record, so the doctor never reaches for the network to answer it.
 */
function backupVaultId(url) {
  if (!url || !path.isAbsolute(url) || !exists(url)) return null;
  const id = (text) => { try { const rec = JSON.parse(text); return rec && typeof rec.vault_id === 'string' ? rec.vault_id : null; } catch { return null; } };
  try { const t = id(fs.readFileSync(path.join(url, 'address.json'), 'utf8')); if (t) return t; } catch { /* not a work tree */ }
  const r = run('git', ['--git-dir', url, 'show', 'HEAD:address.json'], { timeout: 5000 });
  return r.ok ? id(r.stdout) : null;
}

export async function allChecks({ root, env }) {
  const r = [];
  const info = daemonInfo(root);
  const { healthy, startDaemon, whyNotRunning } = await import('./daemon.mjs');
  const up = info && pidAlive(info.pid) && (await healthy(root));
  const why = up ? null : await whyNotRunning(root); // for example another program on its port
  r.push(C('daemon', 'daemon running', up ? 'ok' : 'fail', up ? `pid ${info.pid}, port ${info.port}` : why || 'not running', up ? null : { desc: 'start it', destructive: false, run: () => startDaemon(root, { quiet: true }) }));
  r.push(...await twoVaultChecks(root));
  let vault = null;
  if (!up && isVault(root)) { const { Vault } = await import('../engine/vault.mjs'); try { vault = new Vault(root, { git: false }).open(); } catch (e) { r.push(C('open', 'vault opens', 'fail', e.message)); } }
  if (up) {
    const restart = async () => { const d = await import('./daemon.mjs'); await d.stopDaemon(root); await d.startDaemon(root, { quiet: true }); };
    try {
      const { api, clientToken } = await import('./common.mjs');
      const s = await api(root, '/mcp', { token: clientToken(root, 'doctor'), body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_doctor', arguments: {} } }, timeoutMs: 20000 });
      const live = s.json?.result?.structuredContent?.checks || [];
      r.push(...live.filter((c) => ['oplog', 'index', 'drift', 'secrets', 'bus'].includes(c.id)).map((c) => ({ ...c, fix: c.fix ? { desc: `${c.fix} (restarts Memev)`, destructive: false, run: restart } : null })));
    } catch (e) { r.push(C('mcp', 'MCP answers', 'fail', e.message)); }
    r.push(...fileChecks({ root, env, vault: null }));
  } else r.push(...fileChecks({ root, env, vault }));
  if (vault) vault.close();
  // the reachability probe only runs for a GitHub ssh backup, so a local or HTTPS remote never touches the network here
  const remoteR = run('git', ['remote'], { cwd: root });
  const backupRemote = remoteR.ok ? remoteR.stdout.trim().split('\n')[0] : '';
  if (backupRemote) {
    const urlR = run('git', ['remote', 'get-url', backupRemote], { cwd: root });
    const url = urlR.ok ? urlR.stdout.trim() : '';
    if (url && alt443(url)) r.push(await githubNetCheck());
    const theirs = backupVaultId(url);
    const mine = config(root).vault_id;
    if (theirs && mine && theirs !== mine) r.push(C('backup-vault', 'backup belongs to this vault', 'warn', `the backup belongs to a different vault: this one is ${mine} and the backup is ${theirs}. Two vaults per user are not supported. Join that vault instead of keeping two: memev init --join`));
  }
  const { unitPaths, serviceOff } = await import('./service.mjs');
  const u = unitPaths(env);
  if (serviceOff(env)) r.push(C('service', 'starts at login', 'ok', 'off: MEMEV_NO_SERVICE is set'));
  else r.push(C('service', 'starts at login', u.file && exists(u.file) ? 'ok' : 'warn', u.file && exists(u.file) ? u.file : 'not installed: memev service install', u.file && exists(u.file) ? null : { desc: 'install the login service', destructive: false, cmd: 'service' }));
  return dedupe(r);
}
const dedupe = (r) => { const seen = new Set(); return r.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))); };

/** Where a support bundle goes: the support page, which names the contact and what the bundle holds. */
export function supportLines(pkg = PKG) {
  const page = path.join(pkg, 'docs', 'SUPPORT.md');
  return [`To get help, send this file as described in ${exists(page) ? page : 'docs/SUPPORT.md in the Memev package'}.`, 'It is plain JSON you can read first: it holds no tokens, keys or passwords, and your home folder is shortened to ~.'];
}

export function bundle({ root, env, checks }) {
  const home = homeDir(env);
  const scrub = (s) => redactSecrets(String(s)).split(home).join('~').replace(/mv_[0-9a-f]{8}_[0-9a-f]+/g, 'mv_[redacted]').replace(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g, 'https://[tunnel].trycloudflare.com');
  let log = ''; try { log = fs.readFileSync(path.join(root, '.memev', 'daemon.log'), 'utf8').split('\n').slice(-200).join('\n'); } catch {}
  const cfg = config(root); delete cfg.vault_id;
  const data = { memev: VERSION, at: now(), platform: `${process.platform}-${process.arch}`, node: process.versions.node, os: os.release(), config: cfg, checks: checks.map(({ fix, ...c }) => ({ ...c, fixable: !!fix })), jobs: readJson(path.join(root, '.memev', 'jobs.json'), {}), tunnel: readJson(path.join(root, '.memev', 'tunnel.json'), null), clients: Object.keys(readJson(path.join(configDir(env), 'clients-state.json'), { connected: {} }).connected), daemon_log_tail: log };
  const file = path.join(root, '.memev', `doctor-bundle-${Date.now()}.json`);
  // Scrub each value before it is written as JSON: once a line break has become the two characters \n, the first
  // letter of a token that follows it no longer starts a word, and a pattern that needs a word start misses it.
  const clean = (v) => (typeof v === 'string' ? scrub(v) : Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);
  fs.writeFileSync(file, scrub(JSON.stringify(clean(data), null, 2)), { mode: 0o600 });
  return file;
}

export async function command(cmd, pos, flags, { root, env }) {
  const checks = await allChecks({ root, env });
  const icon = { ok: '\u2713', warn: '!', fail: '\u2717' };
  if (flags.json) console.log(JSON.stringify(checks.map(({ fix, ...c }) => ({ ...c, fix: fix ? { desc: fix.desc, destructive: fix.destructive } : null })), null, 2));
  else { console.log(`Memev ${VERSION} doctor · ${root}`); for (const c of checks) console.log(`  ${icon[c.status]} ${c.title}${c.detail ? `: ${c.detail}` : ''}${c.fix && c.status !== 'ok' ? `\n      fix: ${c.fix.desc}${c.fix.destructive ? ' (asks first)' : ''}` : ''}`); }
  let final = checks;
  if (flags.fix) {
    const tried = [];
    for (const c of checks.filter((x) => x.status !== 'ok' && x.fix)) {
      if (c.fix.destructive && !flags.yes) {
        if (!process.stdin.isTTY) { out.warn(`skipped (needs confirmation, rerun with --yes): ${c.fix.desc}`); continue; }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(`  ${c.fix.desc}? [y/N] `); rl.close(); if (!/^y/i.test(a)) continue;
      }
      try {
        if (c.fix.run) await c.fix.run();
        else if (c.fix.cmd === 'connect') { const m = await import('./clients.mjs'); m.connectAll({ env, launcher: m.launcherPath(env), force: false }); }
        else if (c.fix.cmd === 'runtime' || c.fix.cmd === 'service') { const m = await import('./main.mjs'); m.installRuntime(env); if (c.fix.cmd === 'service') { const s = await import('./service.mjs'); await s.installService({ env, root }); } }
        else if (c.fix.cmd === 'bus') { const st = readJson(path.join(configDir(env), 'clients-state.json'), { connected: {} }); const { setupBus } = await import('./bus-cli.mjs'); const b = await setupBus({ root, env, clients: Object.keys(st.connected || {}), ask: false }); if (!b.ok) throw new Error(b.problems.join('; ')); }
        else if (c.fix.cmd === 'init') { out.warn('run memev init'); continue; }
        else if (c.fix.cmd === 'git') { out.warn('install git, then rerun memev doctor'); continue; }
        tried.push(c);
      } catch (e) { out.bad(`could not fix ${c.title}: ${e.message}`); }
    }
    // a fix is done only when its check passes when the checks run again
    final = await allChecks({ root, env });
    for (const c of tried) {
      const now = final.find((x) => x.id === c.id && x.title === c.title) ?? final.find((x) => x.id === c.id);
      if (!now || now.status === 'ok') out.ok(`fixed: ${c.title}`);
      else out.bad(`could not fix ${c.title}${now.detail ? `: ${now.detail}` : ''}`);
    }
    const left = final.filter((c) => c.status === 'fail'); console.log(left.length ? `Still failing: ${left.map((c) => c.title).join(', ')}` : 'No failing checks left.');
  }
  if (flags.bundle) { console.log(`Support bundle (no secrets): ${bundle({ root, env, checks: final })}`); for (const l of supportLines()) console.log(l); }
  return final.some((c) => c.status === 'fail') ? 1 : 0;
}
