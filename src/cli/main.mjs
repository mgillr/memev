// SPDX-License-Identifier: Apache-2.0
// The memev command.
import fs from 'node:fs';
import path from 'node:path';
import { PKG, parseArgs, resolveRoot, defaultVaultFile, api, clientToken, adminToken, daemonInfo, config, out } from './common.mjs';
import { ensureDaemon, startDaemon, stopDaemon, healthy, choosePort } from './daemon.mjs';
import { initVault, isVault, VERSION } from '../engine/vault.mjs';
import { TokenStore } from '../engine/tokens.mjs';
import { writeAtomic, configDir } from '../engine/util.mjs';
import { renderCard } from '../engine/card.mjs';

const HELP = `memev ${VERSION}: one memory shared by every AI session you run

Setup
  memev init [--root DIR] [--join CODE] [--local-only] [--org] [--no-connect] [--port N] [--lead SEAT]
                                   create the vault, start it, connect your AI apps and seat them on the comms bus
                                   (--join CODE adds this computer to an existing vault and creates none here.
                                   On a terminal, init asks: first computer, or joining. Without a terminal it
                                   creates a vault and says how a second computer uses memev init --join.
                                   --org: an organisation install; remote access starts off. --lead or MEMEV_LEAD
                                   picks the AI that leads the others; on a terminal init asks, otherwise none is set)
  memev connect [client|all]       register Memev in an AI app (MCP, hooks, instructions); backs up first
  memev disconnect [client|all]    remove it again, restoring the app's config
  memev uninstall [--purge]        disconnect everything and stop; --purge also removes the service files
  memev clients                    which AI apps are installed and connected
  memev preflight [--port N]       check this computer first: Node 22 or newer, git, the port, a folder to write to
                                   (init runs it before it writes anything and stops with the fix for your system)
  memev path add|remove|status     put the memev command on your PATH (a line in your shell's startup file, or your user PATH on
                                   Windows) and take it out again; until it is there, init prints the full path in every hint
  memev status | doctor [--fix] [--bundle]
  memev cloud on|off|status|url    reach this vault from cloud AI apps through a private tunnel (on by default
                                   for personal installs, off for --org installs)
  memev github setup               back the vault up to your own private GitHub repository
  memev service install|remove     start Memev at login (systemd or launchd)
  memev devices [enroll|remove|rotate|rename|keygen]   computers and apps using this vault, each with its own credential
  memev invite [--ttl SECONDS]     print a one-time code, link and QR code so another computer can join
  memev join <code>                make a key, enrol this computer and connect its apps
  memev join <url> --token T       the same, with a key and a token made ahead of time
  memev license status|activate <key>|install <file>|remove   the licence: how many computers may use this vault
  memev report [on|off|show|send]  the anonymous milestone report: off unless you turn it on; show prints what would be sent
  memev bus roster|check|send|tail|tasks|watch <seat>|operator <seat>   the comms bus between your AI apps

Daily
  memev recall <query> [--project P] [--all-projects]  |  memev card [--project P]
  memev remember <text> [--kind decision] [--why W] [--review-by DATE|DAYS] [--force]
  memev why <query> [--item path#heading] [--project P]   why recall returned what it did
  memev review [list|keep|drop|reset] [items] [--days N]  the inbox of flagged and short-lived memories
  memev audit [--json]             a read-only report on junk, duplicates and stale memories
  memev checkpoint --project P [--task T] [--done a,b] [--doing x] [--next c,d]
  memev claims [--status fact]  |  memev contract status|from-request|new|sign|verify|list|amend|decompose|hook
  memev verify [id]  |  memev gate [--workdir DIR]   check signed contracts on this machine (never CI)
  memev token issue|list|revoke|rotate
  memev start | stop | restart | serve

Integration (called by AI apps)
  memev mcp --client NAME           MCP over stdio
  memev hook session-start|prompt|pre-compact|stop --client NAME

Options: --root DIR (or MEMEV_ROOT) picks the vault; default ~/memev.`;

const OPTIONAL = { connect: './clients.mjs', disconnect: './clients.mjs', uninstall: './clients.mjs', clients: './clients.mjs', doctor: './doctor.mjs', cloud: './tunnel.mjs', tunnel: './tunnel.mjs', github: './github.mjs', service: './service.mjs', preflight: './preflight.mjs', path: './pathsetup.mjs', contract: './contracts-cli.mjs', bus: './bus-cli.mjs', license: './licensing.mjs', licence: './licensing.mjs', devices: './licensing.mjs', invite: './invite.mjs', verify: './contracts-cli.mjs', gate: './contracts-cli.mjs', onboarding: './onboarding.mjs', report: './onboarding.mjs', why: './memory-cli.mjs', review: './memory-cli.mjs', audit: './memory-cli.mjs' };

/** Copy the package to a stable place so client configs never point into a temporary npx cache. */
export function installRuntime(env = process.env) {
  const dir = path.join(configDir(env), 'runtime', VERSION);
  if (path.resolve(PKG) !== path.resolve(dir)) {
    for (const d of ['bin', 'src', 'templates', 'vendor']) if (fs.existsSync(path.join(PKG, d))) fs.cpSync(path.join(PKG, d), path.join(dir, d), { recursive: true, force: true });
    for (const f of ['package.json', 'LICENSE', 'NOTICE']) if (fs.existsSync(path.join(PKG, f))) fs.copyFileSync(path.join(PKG, f), path.join(dir, f));
  }
  const bin = path.join(configDir(env), 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const target = path.join(dir, 'bin', 'memev.mjs');
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'memev.cmd'), `@"${process.execPath}" "${target}" %*\r\n`);
  else writeAtomic(path.join(bin, 'memev'), `#!/bin/sh\nexec "${process.execPath}" "${target}" "$@"\n`, 0o755);
  return { dir, launcher: path.join(bin, process.platform === 'win32' ? 'memev.cmd' : 'memev') };
}

export async function main(argv, env = process.env) {
  // a source install leaves the launcher off PATH: init's own hints then name it by its full path
  if (argv[0] === 'init' || argv[0] === 'onboarding') { const { withHints } = await import('./pathsetup.mjs'); return withHints(env, argv, () => run(argv, env)); }
  return run(argv, env);
}

async function run(argv, env) {
  const [cmd = 'help', ...rest] = argv;
  const { flags, pos } = parseArgs(rest, ['help', 'yes', 'json', 'local-only', 'no-connect', 'no-service', 'fix', 'bundle', 'purge', 'dry-run', 'force', 'show-secrets', 'all', 'org', 'all-projects', 'release', 'open', 'once']);
  const root = resolveRoot(flags.root, env);
  const need = () => { if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`); };
  const json = (o) => console.log(JSON.stringify(o, null, 2));

  // memev <command> --help prints help and does nothing else (init --help used to run a full init)
  if (!['help', '--help', '-h', 'hook', 'mcp'].includes(cmd) && (flags.help || pos.includes('-h'))) {
    const lines = HELP.split('\n'); const own = [];
    lines.forEach((l, i) => { if (l.startsWith(`  memev ${cmd}`) || l.includes(`| ${cmd} `)) { own.push(l); for (let j = i + 1; j < lines.length && /^ {20,}/.test(lines[j]); j++) own.push(lines[j]); } });
    console.log(own.length ? `${own.join('\n')}\n\nmemev help lists every command.` : HELP);
    return 0;
  }
  if (OPTIONAL[cmd]) { const m = await import(OPTIONAL[cmd]); return m.command(cmd, pos, flags, { root, env }); }
  switch (cmd) {
    case 'help': case '--help': case '-h': console.log(HELP); return 0;
    case 'join': { const { join } = await import('./remote.mjs'); return join(pos, flags, { env }); }
    case 'version': case '--version': case '-v': console.log(VERSION); return 0;
    case 'init': {
      // inside a sandbox init cannot write anything: stop first, before even a question, and print the command to run outside
      { const pf = await import('./preflight.mjs'); if (pf.stopInSandbox({ env, flags })) return 1; }
      const invite = typeof flags.join === 'string' ? flags.join : '';
      if (flags.join !== undefined && flags.join !== false) {
        const { join } = await import('./remote.mjs');
        return join(invite ? [invite] : [], flags, { env });
      }
      if (!isVault(root) && process.stdin.isTTY && process.stdout.isTTY) {
        const readline = await import('node:readline/promises');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('Is this the first computer, or are you adding this one to an existing vault? [first/joining] ')).trim().toLowerCase();
        rl.close();
        const picked = /^(?:joining|join)(?:\s+(\S+))?/.exec(answer);
        if (picked) {
          const { join } = await import('./remote.mjs');
          return join(picked[1] ? [picked[1]] : [], flags, { env });
        }
      }
      // nothing is written until the computer can run Memev: a failed check stops here with its fix
      const { gate } = await import('./preflight.mjs');
      if (!(await gate({ root, env, flags }))) return 1;
      const fresh = !isVault(root);
      const r = initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: flags.port ? Number(flags.port) : null });
      fs.mkdirSync(path.dirname(defaultVaultFile(env)), { recursive: true });
      fs.writeFileSync(defaultVaultFile(env), `${root}\n`);
      const org = !!flags.org || env.MEMEV_PROFILE === 'org';
      if (flags['local-only'] || org) { const c = config(root); c.remote = { ...c.remote, enabled: false }; if (org) c.profile = 'org'; fs.writeFileSync(path.join(root, '.memev', 'config.json'), `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 }); }
      const rt = installRuntime(env);
      console.log(`${fresh ? 'Created' : 'Found'} your vault at ${root}`);
      if (!process.stdin.isTTY) console.log('A second computer joins this one with memev init --join and an invite from memev invite.');
      if (r.admin) console.log(`  Admin token saved to ${path.join(root, '.memev', 'admin.json')} (only this user can read it)`);
      // a port held by another program: take the next free one, and save it before any app is pointed at it
      const wanted = Number(config(root).port) || 7787;
      const port = await choosePort(root, wanted);
      if (port !== wanted) {
        const c = config(root); c.port = port;
        fs.writeFileSync(path.join(root, '.memev', 'config.json'), `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
        out.warn(`Port ${wanted} is in use by another program; Memev is using ${port}`);
      }
      const up = await startDaemon(root, { quiet: true });
      up ? out.ok(`Memev is running on http://127.0.0.1:${daemonInfo(root)?.port ?? config(root).port}`) : out.bad('Memev did not start: run memev doctor');
      const onboarding = await import('./onboarding.mjs').catch(() => null);
      if (onboarding) return onboarding.firstRun({ root, env, flags, launcher: rt.launcher, daemonUp: up });
      return up ? 0 : 1;
    }
    case 'container': {
      // the image's entry point: create the vault on first run, print how to connect, then serve
      if (!isVault(root)) { initVault(root, { template: path.join(PKG, 'templates', 'vault') }); console.log(`Created a vault in ${root}`); }
      console.log(`Connect an app: http://127.0.0.1:${config(root).port || 7787}/mcp with the header Authorization: Bearer <token>; get a token with: docker compose exec memev memev token issue <app-name>`);
      await import('../server/main.mjs'); return new Promise(() => {});
    }
    case 'selftest': {
      // a throwaway vault: write, recall, verify the log, run the doctor's checks
      const os = await import('node:os'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-selftest-'));
      const { Vault } = await import('../engine/vault.mjs'); const { fileChecks } = await import('./doctor.mjs');
      try {
        initVault(tmp, { template: path.join(PKG, 'templates', 'vault') });
        const v = new Vault(tmp, { keyDir: path.join(tmp, '.memev', 'keys') }).open(); const id = { id: 's', agent: 'selftest', scopes: ['read', 'write'], paths: ['**'] };
        v.remember(id, { text: 'Self-test memory: the kettle is blue', kind: 'fact' });
        const hit = v.recall(id, { query: 'what colour is the kettle' })[0];
        const ok = /kettle is blue/.test(hit?.snippet || '') && v.log.verify().ok;
        const checks = fileChecks({ root: tmp, env, vault: v }).filter((c) => !['apps', 'launcher', 'backup', 'remote', 'bus-seats', 'bus-lead'].includes(c.id));
        v.close();
        const bad = checks.filter((c) => c.status === 'fail');
        console.log(ok && !bad.length ? `selftest: ok (memev ${VERSION}, node ${process.versions.node})` : `selftest: FAILED ${bad.map((c) => c.title).join(', ')}`);
        return ok && !bad.length ? 0 : 1;
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    case 'start': need(); return (await ensureDaemon(root)) ? 0 : 1;
    case 'serve': need(); await import('../server/main.mjs'); return new Promise(() => {});
    case 'stop': need(); console.log((await stopDaemon(root)) ? 'Stopped.' : 'Not running.'); return 0;
    case 'restart': need(); await stopDaemon(root); return (await startDaemon(root)) ? 0 : 1;
    case 'status': {
      need(); const up = await healthy(root);
      if (!up) { console.log(`Vault ${root}: daemon not running (memev start)`); return 1; }
      const s = await api(root, '/v1/status', { method: 'GET', token: clientToken(root, 'cli') });
      if (flags.json) json(s.json); else { const j = s.json; console.log(`Memev ${j.version} · ${root}\n  log: ${j.oplog.seq} ops in ${j.oplog.segments} segment(s) · index: ${j.index.notes} notes / ${j.index.sections} sections · graph: ${j.graph.entities} entities, ${j.graph.claims} claims · heap ${j.memory.heap_mb} MB`); }
      return 0;
    }
    case 'mcp': {
      if (!isVault(root)) { const rm = await import('./remote.mjs'); const remote = rm.loadRemote(env); if (remote) { await rm.runRemoteStdio(remote, String(flags.client || 'mcp'), env); return 0; } }
      need(); const { runStdio } = await import('./mcp-stdio.mjs'); await runStdio(root, String(flags.client || 'mcp')); return 0; }
    case 'hook': { const { runHook } = await import('./hooks.mjs'); return runHook(pos[0], flags, env); }
    case 'recall': case 'remember': case 'checkpoint': case 'card': {
      need(); if (!(await ensureDaemon(root, { quiet: true }))) throw new Error('the daemon is not running');
      const token = clientToken(root, 'cli'); const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
      const call = async (route, body) => { const r = await api(root, `/v1/${route}`, { body, token }); if (!r.ok) throw new Error(r.json?.error_description || r.text); return r.json; };
      if (cmd === 'recall') { const r = await call('recall', { query: pos.join(' '), limit: Number(flags.limit || 6), project: flags.project, all_projects: !!flags['all-projects'] }); flags.json ? json(r.hits) : console.log(r.text || 'Nothing found.'); }
      if (cmd === 'remember') json(await call('remember', { text: pos.join(' '), kind: flags.kind, project: flags.project, why: flags.why, review_by: flags['review-by'], force: !!flags.force }));
      if (cmd === 'checkpoint') json(await call('checkpoint', { project: flags.project, task: flags.task, done: list(flags.done), doing: flags.doing, next: list(flags.next), files: list(flags.files), source: 'cli' }));
      if (cmd === 'card') { const r = await call('session-start', { project: flags.project, task: flags.task || pos.join(' ') || null }); console.log(flags.json ? JSON.stringify(r.card, null, 2) : renderCard(r.card)); }
      return 0;
    }
    case 'claims': {
      need(); const { Vault } = await import('../engine/vault.mjs');
      if (await healthy(root)) { const r = await fetch(`http://127.0.0.1:${daemonInfo(root).port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${clientToken(root, 'cli')}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_claims', arguments: { status: flags.status, subject: flags.subject } } }) }); console.log((await r.json()).result.content[0].text); return 0; }
      const v = new Vault(root, { git: false }).open(); try { json(v.claims({ agent: 'cli', scopes: ['read'], paths: ['**'] }, { status: flags.status, subject: flags.subject })); } finally { v.close(); } return 0;
    }
    case 'token': {
      need(); const ts = new TokenStore(path.join(root, '.memev', 'tokens.json')); const sub = pos[0] || 'list';
      if (sub === 'list') { for (const t of ts.list()) console.log(`${t.id}  ${t.agent.padEnd(16)} ${t.scopes.join('+').padEnd(16)} ${t.remote ? 'remote' : 'local '} ${t.revoked ? 'REVOKED' : t.expires ? `expires ${t.expires.slice(0, 10)}` : 'no expiry'}  ${t.paths.join(',')}`); return 0; }
      if (sub === 'issue') { const t = ts.issue({ agent: flags.agent || pos[1] || 'agent', scopes: String(flags.scopes || 'read,write').split(','), paths: String(flags.paths || '**').split(','), ttlDays: Number(flags.ttl ?? 180), remote: !!flags.remote, note: flags.note || '' }); console.log(`Token for ${flags.agent || pos[1] || 'agent'} (shown once):\n${t.token}`); return 0; }
      if (sub === 'revoke') { if (!pos[1]) throw new Error('memev token revoke <id>'); console.log(ts.revoke(pos[1]) ? `Revoked ${pos[1]}.` : `No token ${pos[1]}.`); return 0; }
      if (sub === 'rotate') { if (!pos[1]) throw new Error('memev token rotate <id>'); const t = ts.rotate(pos[1]); const f = path.join(root, '.memev', 'clients.json'); try { const all = JSON.parse(fs.readFileSync(f, 'utf8')); for (const k of Object.keys(all)) if (all[k].startsWith(`mv_${pos[1]}_`)) all[k] = t.token; fs.writeFileSync(f, JSON.stringify(all, null, 2), { mode: 0o600 }); } catch {} console.log(`Rotated ${pos[1]}; the old secret no longer works. New token (shown once):\n${t.token}`); return 0; }
      throw new Error('memev token list|issue|revoke|rotate');
    }
    case 'admin-token': need(); console.log(adminToken(root) || '(none)'); return 0;
    default: console.error(`unknown command: ${cmd}\n`); console.log(HELP); return 2;
  }
}
