// SPDX-License-Identifier: Apache-2.0
// `memev doctor`: checks everything Memev depends on and says what to do. Exit 0 when healthy.
// --fix applies the safe fixes; fixes that could lose data or cut off an app ask first (or need --yes).
// --bundle writes a support file with no secrets in it. The same checks back the memev_doctor MCP tool.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { readJson, writeJson, exists, sha256, configDir, homeDir, now } from '../engine/util.mjs';
import { redactSecrets, findSecrets } from '../engine/secrets.mjs';
import { VERSION, isVault } from '../engine/vault.mjs';
import { daemonInfo, pidAlive, config, out, clientsFile } from './common.mjs';
import { licensingStatus } from './licensing.mjs';
import { fileOf, label } from '../engine/bus.mjs';

const C = (id, title, status, detail = '', fix = null) => ({ id, title, status, detail, fix });

/** Checks that only need the files (safe inside the daemon too). */
export function fileChecks({ root, env = process.env, vault = null }) {
  const r = [];
  const major = Number(process.versions.node.split('.')[0]);
  r.push(C('node', 'Node.js 22+', major >= 22 ? 'ok' : 'fail', process.versions.node));
  const g = spawnSync('git', ['--version'], { encoding: 'utf8' });
  r.push(C('git', 'git installed', g.status === 0 ? 'ok' : 'fail', g.status === 0 ? g.stdout.trim() : 'install git'));
  if (!isVault(root)) { r.push(C('vault', 'vault exists', 'fail', `no vault at ${root}`, { desc: 'create it: memev init', destructive: false, cmd: 'init' })); return r; }
  r.push(C('vault', 'vault exists', 'ok', root));
  const state = path.join(root, '.memev');
  const loose = [];
  const mode = (f) => { try { return fs.statSync(f).mode & 0o777; } catch { return null; } };
  if ((mode(state) ?? 0) & 0o077) loose.push('.memev/');
  for (const f of ['tokens.json', 'admin.json', 'clients.json', 'tunnel-key.txt', 'config.json']) { const m = mode(path.join(state, f)); if (m !== null && m & 0o077) loose.push(f); }
  r.push(C('permissions', 'private files are private', loose.length ? 'fail' : 'ok', loose.length ? `readable by others: ${loose.join(', ')}` : '0600/0700', loose.length ? { desc: 'restrict them to you (chmod 600/700)', destructive: false, run: () => { try { fs.chmodSync(state, 0o700); } catch {} for (const f of loose) try { fs.chmodSync(path.join(state, f.replace(/\/$/, '')), f.endsWith('/') ? 0o700 : 0o600); } catch {} } } : null));
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
  r.push(C('launcher', 'stable launcher installed', exists(launcher) ? 'ok' : 'warn', exists(launcher) ? launcher : 'missing: apps cannot start Memev', exists(launcher) ? null : { desc: 'reinstall the launcher', destructive: false, cmd: 'runtime' }));
  const missing = Object.entries(clients.files || {}).filter(([f]) => { try { return !fs.readFileSync(f, 'utf8').includes('memev'); } catch { return true; } }).map(([f, rec]) => rec.client);
  const ids = Object.keys(clients.connected || {});
  r.push(C('apps', 'AI apps connected', ids.length ? (missing.length ? 'warn' : 'ok') : 'warn', ids.length ? `${ids.join(', ')}${missing.length ? `; entries missing for ${[...new Set(missing)].join(', ')}` : ''}` : 'none yet', ids.length && !missing.length ? null : { desc: 'connect every installed app again', destructive: false, cmd: 'connect' }));
  const cfg = config(root);
  const tun = readJson(path.join(state, 'tunnel.json'), null);
  if (cfg.remote?.enabled) r.push(C('remote', 'remote access', tun?.state === 'up' ? 'ok' : 'warn', tun?.state === 'up' ? `${tun.provider} at ${tun.url}${tun.stable ? '' : ' (address changes on restart)'}` : `on, but the tunnel is ${tun?.state || 'not started'}; memev cloud off switches remote access off`));
  else r.push(C('remote', 'remote access', 'ok', 'off (local only)'));
  const remote = spawnSync('git', ['remote'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const jobs = readJson(path.join(state, 'jobs.json'), {});
  r.push(C('backup', 'vault backed up off this machine', remote ? (jobs.sync?.error ? 'warn' : 'ok') : 'warn', remote ? (jobs.sync?.error ? `last sync: ${jobs.sync.error}` : `git remote ${remote}${jobs.sync?.at ? `, last sync ${jobs.sync.at}` : ''}`) : 'no backup yet: memev github setup'));
  if (jobs.sync?.warning) r.push(C('writers', 'one computer writes the git backup', 'warn', jobs.sync.warning));
  try {
    // report only: licence and seats never fail the doctor and never limit anything
    const ls = licensingStatus({ root, env, vault });
    const flagged = ls.usage.flagged || [];
    r.push(C('license', 'licence and seats (report only)', flagged.length ? 'warn' : 'ok', `${ls.license.state === 'none' ? 'free tier, no licence needed' : `licence ${ls.license.state}${ls.license.tier ? ` (${ls.license.tier})` : ''}`}; ${ls.usage.computers} computer(s), ${ls.usage.connectors} connector(s), ${ls.usage.local_clients} local client(s)${ls.notes.length ? `; ${ls.notes.join(' ')}` : ''}${flagged.length ? `; credential flagged on ${flagged.map((f) => f.label).join(', ')}: memev devices` : ''}`));
  } catch (e) { r.push(C('license', 'licence and seats (report only)', 'ok', `not checked: ${e.message}`)); }
  try { const s = fs.statfsSync(root); const freePct = (s.bavail / s.blocks) * 100; const inodePct = s.files ? (s.ffree / s.files) * 100 : 100; r.push(C('disk', 'disk space', freePct < 3 || inodePct < 3 ? 'warn' : 'ok', `${freePct.toFixed(0)}% space, ${inodePct.toFixed(0)}% inodes free`)); } catch {}
  return r;
}

/** The comms bus on disk: bus/ in the vault, a seat for every connected app, and a lead the person chose. */
export function busChecks({ root, vault = null, connected = [] }) {
  const r = [];
  const has = (f) => exists(path.join(root, 'bus', f));
  const folder = has('config.json') && has('operator.json') && has('log');
  r.push(C('bus-files', 'comms bus folder in the vault', folder ? 'ok' : 'fail', folder ? 'bus/ (committed with the vault)' : 'bus/ is missing from the vault', folder ? null : vault ? { desc: 'set bus/ up again', destructive: false, run: () => vault.bus.ensure(vault.host.id) } : { desc: 'set bus/ up again', destructive: false, cmd: 'bus' }));
  const missing = connected.filter((id) => { const f = path.join(root, 'bus', 'seats', `${fileOf(`${label(id)}@host`)}.json`); const rec = readJson(f, null); return !rec || rec.removed; });
  r.push(C('bus-seats', 'every connected app has a bus seat', missing.length ? 'fail' : 'ok', missing.length ? `no seat for ${missing.join(', ')}` : `${connected.length} app(s) seated`, missing.length ? { desc: 'seat them', destructive: false, cmd: 'bus' } : null));
  const lead = readJson(path.join(root, 'bus', 'operator.json'), null)?.seat || null;
  r.push(C('bus-lead', 'lead AI chosen', lead ? 'ok' : 'warn', lead ? `${lead} leads the others` : 'needs you: no lead AI chosen yet; pick the AI that leads and coordinates the others with memev bus operator <seat> (memev bus roster lists the seats)'));
  return r;
}

/** Ports on this machine's loopback that something is listening on. */
function loopbackListenPorts() {
  const ports = new Set();
  if (process.platform === 'linux') {
    for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      for (const line of text.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4 || cols[3] !== '0A') continue;
        const [addr, portHex] = cols[1].split(':');
        const loop = addr === '0100007F' || addr === '00000000000000000000000001000000';
        if (loop) ports.add(parseInt(portHex, 16));
      }
    }
    return [...ports];
  }
  const listed = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
  for (const line of (listed.stdout || '').split('\n')) {
    const hit = /127\.0\.0\.1:(\d+) \(LISTEN\)/.exec(line);
    if (hit) ports.add(Number(hit[1]));
  }
  return [...ports];
}

/** Another Memev on this computer, seen by its /healthz vault id. Empty when this is the only one. */
async function twoVaultChecks(root) {
  const mine = config(root).vault_id;
  if (!mine || !isVault(root)) return [];
  const minePort = daemonInfo(root)?.port || null;
  const ports = loopbackListenPorts().filter((p) => p >= 1024 && p !== minePort);
  const found = [];
  for (let i = 0; i < ports.length; i += 16) {
    const rows = await Promise.all(ports.slice(i, i + 16).map(async (port) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 200);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: ac.signal });
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

export async function allChecks({ root, env }) {
  const r = [];
  const info = daemonInfo(root);
  const { healthy, startDaemon } = await import('./daemon.mjs');
  const up = info && pidAlive(info.pid) && (await healthy(root));
  r.push(C('daemon', 'daemon running', up ? 'ok' : 'fail', up ? `pid ${info.pid}, port ${info.port}` : 'not running', up ? null : { desc: 'start it', destructive: false, run: () => startDaemon(root, { quiet: true }) }));
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
  const { unitPaths } = await import('./service.mjs');
  const u = unitPaths(env);
  r.push(C('service', 'starts at login', u.file && exists(u.file) ? 'ok' : 'warn', u.file && exists(u.file) ? u.file : 'not installed: memev service install', u.file && exists(u.file) ? null : { desc: 'install the login service', destructive: false, cmd: 'service' }));
  return dedupe(r);
}
const dedupe = (r) => { const seen = new Set(); return r.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))); };

export function bundle({ root, env, checks }) {
  const home = homeDir(env);
  const scrub = (s) => redactSecrets(String(s)).split(home).join('~').replace(/mv_[0-9a-f]{8}_[0-9a-f]+/g, 'mv_[redacted]').replace(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g, 'https://[tunnel].trycloudflare.com');
  let log = ''; try { log = fs.readFileSync(path.join(root, '.memev', 'daemon.log'), 'utf8').split('\n').slice(-200).join('\n'); } catch {}
  const cfg = config(root); delete cfg.vault_id;
  const data = { memev: VERSION, at: now(), platform: `${process.platform}-${process.arch}`, node: process.versions.node, os: os.release(), config: cfg, checks: checks.map(({ fix, ...c }) => ({ ...c, fixable: !!fix })), jobs: readJson(path.join(root, '.memev', 'jobs.json'), {}), tunnel: readJson(path.join(root, '.memev', 'tunnel.json'), null), clients: Object.keys(readJson(path.join(configDir(env), 'clients-state.json'), { connected: {} }).connected), daemon_log_tail: log };
  const file = path.join(root, '.memev', `doctor-bundle-${Date.now()}.json`);
  fs.writeFileSync(file, scrub(JSON.stringify(data, null, 2)), { mode: 0o600 });
  return file;
}

export async function command(cmd, pos, flags, { root, env }) {
  const checks = await allChecks({ root, env });
  const icon = { ok: '\u2713', warn: '!', fail: '\u2717' };
  if (flags.json) console.log(JSON.stringify(checks.map(({ fix, ...c }) => ({ ...c, fix: fix ? { desc: fix.desc, destructive: fix.destructive } : null })), null, 2));
  else { console.log(`Memev ${VERSION} doctor · ${root}`); for (const c of checks) console.log(`  ${icon[c.status]} ${c.title}${c.detail ? `: ${c.detail}` : ''}${c.fix && c.status !== 'ok' ? `\n      fix: ${c.fix.desc}${c.fix.destructive ? ' (asks first)' : ''}` : ''}`); }
  if (flags.fix) {
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
        out.ok(`fixed: ${c.title}`);
      } catch (e) { out.bad(`could not fix ${c.title}: ${e.message}`); }
    }
  }
  let final = checks;
  if (flags.fix) { final = await allChecks({ root, env }); const left = final.filter((c) => c.status === 'fail'); console.log(left.length ? `Still failing: ${left.map((c) => c.title).join(', ')}` : 'No failing checks left.'); }
  if (flags.bundle) console.log(`Support bundle (no secrets): ${bundle({ root, env, checks: final })}`);
  return final.some((c) => c.status === 'fail') ? 1 : 0;
}
