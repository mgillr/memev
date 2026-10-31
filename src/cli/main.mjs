// SPDX-License-Identifier: Apache-2.0
// The memev command.
import fs from 'node:fs';
import path from 'node:path';
import { PKG, parseArgs, BOOLEAN_FLAGS, resolveRoot, defaultVaultFile, api, clientToken, adminToken, daemonInfo, config, saveConfig, out, tokenExpiryWarnings } from './common.mjs';
import { ensureDaemon, startDaemon, stopDaemon, healthy, choosePort } from './daemon.mjs';
import { initVault, isVault, VERSION } from '../engine/vault.mjs';
import { TokenStore } from '../engine/tokens.mjs';
import { writeAtomic, configDir, slug } from '../engine/util.mjs';
import { renderCard } from '../engine/card.mjs';
import { fetchOut } from '../engine/net.mjs';

const HELP = `memev ${VERSION}: one memory shared by every AI session you run

Setup
  memev init [--root DIR] [--join CODE] [--from URL] [--local-only] [--org] [--no-connect] [--port N] [--lead SEAT]
                                    create the vault, start it, connect your AI apps and seat them on the comms bus
                                    (--join CODE adds this computer to an existing vault and creates none here.
                                    --from URL clones an existing vault backup with plain git, no GitHub CLI, so a
                                    second computer joins the vault instead of creating a new one.
                                    On a terminal, init asks: first computer, or joining. If GitHub is signed in
                                    and a private backup's README is a Memev vault, init offers to join that
                                    vault before it creates a new one. With no GitHub CLI, or signed out, init
                                    makes no GitHub call. Without a terminal it
                                    creates a vault and says how a second computer uses memev init --join.
                                   --org: an organisation install; remote access starts off. --lead or MEMEV_LEAD
                                   picks the AI that leads the others; on a terminal init asks, otherwise none is set)
  memev connect [client|all]       register Memev in an AI app (MCP, hooks, instructions); backs up first
  memev disconnect [client|all]    remove it again, restoring the app's config
  memev uninstall [--purge]        disconnect everything and stop; --purge also removes the service files
  memev clients                    which AI apps are installed and connected
  memev ready [--timeout S] [--json]   wait for each connected app's first session, then for two of them to share a memory;
                                    --json prints one machine readable object (ok, smoke, clients with id, name, joined,
                                    joinedAt) and exits 0 when ready, 1 when not ready within the timeout, 2 on a usage error
  memev preflight [--port N]       check this computer first: Node 22 or newer, git, the port, a folder to write to
                                   (init runs it before it writes anything and stops with the fix for your system)
  memev path add|remove|status     put the memev command on your PATH (a line in your shell's startup file, or your user PATH on
                                   Windows) and take it out again; until it is there, init prints the full path in every hint
  memev status | doctor [--fix] [--bundle] [--json]
  memev deployment [set --mode M --ai T]   where this vault runs and what kind of AI provider it uses,
                                    and the trial path that fits; set writes the choice into the vault config
  memev cloud on|off|status|url    reach this vault from cloud AI apps through a private tunnel (off until you
                                   turn it on, or say yes when init asks on a terminal)
  memev github setup [--host H]    back the vault up to your own private GitHub repository (--host for GitHub Enterprise)
  memev backup set <git-url>       back the vault up to any private git remote (GitHub Enterprise, self-hosted, file)
  memev service install|remove     start Memev at login (systemd or launchd)
  memev devices [enroll|remove|rotate|rename|keygen]   computers and apps using this vault, each with its own credential
  memev invite [--ttl SECONDS] [--local]   print a one-time code, link and QR code so another computer can join
                                       (refuses without a reachable address: turn the secure link on with memev cloud on; --local mints the
                                       loopback address for a computer that shares this machine, and says so)
  memev join <code>                make a key, enrol this computer and connect its apps
  memev join <url> --token T       the same, with a key and a token made ahead of time
  memev join --refresh             fetch the vault's current address from the signed record in the backup
  memev license status|activate <key>|install <file>|remove   the licence: how many computers may use this vault
  memev upgrade                    the plans and what each adds, and how to buy
  memev plan                       what this vault uses: computers used and allowed, connectors counted
  memev agentid bind|verify|setup  bind an agent role to a person, verify a binding, or set one up
                                   (Business and Corporate; verify is free)
  memev report [on|off|show|send]  the anonymous milestone report: off unless you turn it on; show prints what would be sent
  memev bus roster|check|send|tail|tasks|watch <seat>|operator <seat>   the comms bus between your AI apps
  memev runner on|off|watch|status <seat> [--max-runs-per-day N] [--command CMD]   an opt-in background runner: a headless turn of the
                                    seat's app when the operator posts it a task, at most N runs a day (you give N; there is no default)

Daily
  memev recall <query> [--project P] [--all-projects]  |  memev card [--project P] [--aider]
  memev project [set <name>]       the project name this folder's memories are filed under, and where
                                   it comes from (a pin, the git top-level folder, or the folder);
                                   set <name> pins a name for this repository or folder
  memev remember <text> [--kind decision] [--why W] [--review-by DATE|DAYS] [--force]
  memev why <query> [--item path#heading] [--project P]   why recall returned what it did
  memev review [list|keep|drop|reset] [items] [--days N]  the inbox of flagged and short-lived memories
  memev audit [--json]             a read-only report on junk, duplicates and stale memories
  memev compact [--dry-run]        measure and shrink the vault: archive sealed op-log segments and move old
                                    journal sessions out of the index; --dry-run only prints the size report
  memev checkpoint --project P [--task T] [--done a,b] [--doing x] [--next c,d]
  memev claims [--status fact]  |  memev contract status|from-request|new|sign|approve|verify|list|amend|decompose|hook
  memev verify [id]  |  memev gate [--workdir DIR]   check signed contracts on this machine (never CI)
  memev token issue|list|revoke|rotate
  memev start | stop | restart | serve
  memev update <tarball> [--sha256 HEX]   install a new version from a release tarball

Integration (called by AI apps)
  memev mcp --client NAME           MCP over stdio
  memev hook session-start|prompt|pre-compact|stop --client NAME

  memev --version                    the installed version, one line

Options: --root DIR (or MEMEV_ROOT) picks the vault; default ~/memev.`;

const OPTIONAL = { connect: './clients.mjs', disconnect: './clients.mjs', uninstall: './clients.mjs', clients: './clients.mjs', doctor: './doctor.mjs', deployment: './deployment.mjs', cloud: './tunnel.mjs', tunnel: './tunnel.mjs', github: './github.mjs', service: './service.mjs', preflight: './preflight.mjs', path: './pathsetup.mjs', contract: './contracts-cli.mjs', contracts: './contracts-cli.mjs', bus: './bus-cli.mjs', runner: './runner.mjs', license: './licensing.mjs', licence: './licensing.mjs', devices: './licensing.mjs', invite: './invite.mjs', agentid: './agentid.mjs', verify: './contracts-cli.mjs', gate: './contracts-cli.mjs', onboarding: './onboarding.mjs', ready: './ready.mjs', report: './onboarding.mjs', why: './memory-cli.mjs', review: './memory-cli.mjs', audit: './memory-cli.mjs', update: './update.mjs', upgrade: './upgrade.mjs', plan: './upgrade.mjs', compact: './compact.mjs', setup: './setup-remote.mjs' };

/** Copy the package to a stable place so client configs never point into a temporary npx cache. */
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/**
 * The launcher every app runs on macOS and Linux. It uses node from PATH when that is Node 22 or newer, and otherwise
 * the Node recorded at install, so a Node upgrade that removes the old binary does not stop Memev in every app.
 */
export function launcherScript(node, target) {
  return `#!/bin/sh
# node from PATH when it is Node 22 or newer, otherwise the Node recorded at install
REC=${sq(node)}
JS=${sq(target)}
N=$(command -v node 2>/dev/null)
if [ -n "$N" ] && [ "$N" != "$REC" ]; then
  V=$("$N" --version 2>/dev/null); V=\${V#v}; V=\${V%%.*}
  case "$V" in ''|*[!0-9]*) ;; *) [ "$V" -ge 22 ] && exec "$N" "$JS" "$@" ;; esac
fi
[ -x "$REC" ] && exec "$REC" "$JS" "$@"
if [ "$1" = "hook" ] && [ "$2" = "session-start" ]; then
  # the app expects JSON on stdout for a hook, so the notice goes out the same way the hook's own
  # output does: plain for --format plain, { additional_context } for cursor, hookSpecificOutput otherwise
  FMT=claude
  prev=
  for a in "$@"; do
    [ "$prev" = --format ] && FMT=$a
    case $a in --format=*) FMT=\${a#--format=} ;; esac
    prev=$a
  done
  MSG="Memev could not start (Node not found); run memev doctor"
  case "$FMT" in
    plain) echo "$MSG" ;;
    cursor) printf '{"additional_context":"%s"}' "$MSG" ;;
    *) printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$MSG" ;;
  esac
  exit 0
fi
if [ "$1" = "hook" ]; then
  exit 0
fi
echo "memev: no Node.js 22 or newer: node on PATH is missing or older, and $REC is gone. Install Node.js 22 or newer, then run: node \\"$JS\\" doctor --fix" >&2
exit 127
`;
}

/** The Node to record: its name on PATH when that is this same Node (a link such as /usr/local/bin/node outlives an upgrade), else this binary. */
export function recordedNode(env = process.env) {
  const real = (f) => { try { return fs.realpathSync(f); } catch { return null; } };
  for (const d of String(env.PATH || '').split(path.delimiter)) {
    const f = d && path.join(d, 'node');
    if (!f || !fs.existsSync(f)) continue;
    return real(f) === real(process.execPath) ? f : process.execPath; // the first node on PATH decides
  }
  return process.execPath;
}

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
  else writeAtomic(path.join(bin, 'memev'), launcherScript(recordedNode(env), target), 0o755);
  return { dir, launcher: path.join(bin, process.platform === 'win32' ? 'memev.cmd' : 'memev') };
}

export async function main(argv, env = process.env) {
  // a source install leaves the launcher off PATH: init's own hints then name it by its full path
  if (argv[0] === 'init' || argv[0] === 'onboarding') { const { withHints } = await import('./pathsetup.mjs'); return withHints(env, argv, () => run(argv, env)); }
  return run(argv, env);
}

async function run(argv, env) {
  const [cmd = 'help', ...rest] = argv;
  const { flags, pos } = parseArgs(rest, BOOLEAN_FLAGS);
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
      // the free second-computer path: clone an existing backup with plain git, no GitHub CLI
      let fromUrl = null;
      if (flags.from !== undefined && typeof flags.from !== 'string') {
        console.log('memev init --from <git-url> needs a git URL. Example: memev init --from git@github.com:you/vault.git');
        return 1;
      }
      if (flags.from) {
        const { cloneFromUrl, isMemevBackup } = await import('./github.mjs');
        const cloned = cloneFromUrl(flags.from, root);
        if (!cloned.ok) { console.log(`Could not clone ${flags.from}: ${cloned.err.split('\n').pop()}. Init did not create a new vault.`); return 1; }
        if (!isMemevBackup(root)) {
          try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
          console.log(`${flags.from} is not a Memev vault backup (its README is not a Memev vault). Init did not create a new vault.`);
          return 1;
        }
        fromUrl = flags.from;
      }
      if (!flags.from && !isVault(root) && process.stdin.isTTY && process.stdout.isTTY) {
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
      // after the check, so a failing check leaves the home untouched (the GitHub CLI writes its own state)
      if (!isVault(root)) {
        const { findMemevBackup, cloneBackup } = await import('./github.mjs');
        const backup = findMemevBackup();
        if (backup) {
          console.log(`A Memev backup is at ${backup.repo}. Join that vault?`);
          if (!(process.stdin.isTTY && process.stdout.isTTY)) {
            console.log('Run memev init in a terminal to answer. Init did not create a new vault.');
            return 0;
          }
          const readline = await import('node:readline/promises');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = (await rl.question('[yes/no] ')).trim().toLowerCase();
          rl.close();
          if (/^(y|yes)$/.test(answer)) {
            const cloned = cloneBackup(backup.repo, root);
            if (!cloned.ok) { console.log(`Could not clone ${backup.repo}. Init did not create a new vault.`); return 1; }
          }
        }
      }
      const fresh = !isVault(root);
      const r = initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: flags.port ? Number(flags.port) : null });
      fs.mkdirSync(path.dirname(defaultVaultFile(env)), { recursive: true });
      fs.writeFileSync(defaultVaultFile(env), `${root}\n`);
      const org = !!flags.org || env.MEMEV_PROFILE === 'org';
      if (flags['local-only'] || org) { const c = config(root); c.remote = { ...c.remote, enabled: false, asked: true }; if (org) c.profile = 'org'; fs.writeFileSync(path.join(root, '.memev', 'config.json'), `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 }); }
      const rt = installRuntime(env);
      if (fromUrl) {
        console.log(`Cloned your vault from ${fromUrl} into ${root}`);
      } else {
        console.log(`${fresh ? 'Created' : 'Found'} your vault at ${root}`);
        if (!process.stdin.isTTY) console.log('A second computer joins this one with memev init --join and an invite from memev invite.');
      }
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
      // the image's entry point: create the vault on first run, run the container doctor checks, print how to connect, then serve
      if (!isVault(root)) { initVault(root, { template: path.join(PKG, 'templates', 'vault') }); console.log(`Created a vault in ${root}`); }
      if (env.MEMEV_CONTAINER === '1') {
        const { fileChecks } = await import('./doctor.mjs');
        const checks = fileChecks({ root, env }).filter((x) => x.id.startsWith('container-'));
        for (const c of checks.filter((x) => x.status === 'fail' || x.status === 'warn')) console.log(`doctor: ${c.status} ${c.title}: ${c.detail}`);
      }
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
      if (flags.json) json(s.json); else { const j = s.json; console.log(`Memev ${j.version} · ${root}\n  log: ${j.oplog.seq} ops in ${j.oplog.segments} segment(s) · index: ${j.index.notes} notes / ${j.index.sections} sections · graph: ${j.graph.entities} entities, ${j.graph.claims} claims · heap ${j.memory.heap_mb} MB`); for (const w of tokenExpiryWarnings(root)) console.log(`  ! ${w}`); const { updateLine } = await import('./update.mjs'); const u = updateLine(root, env); if (u) console.log(`  ${u}`); }
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
      if (cmd === 'card') {
        const r = await call('session-start', { project: flags.project, task: flags.task || pos.join(' ') || null });
        const cardText = renderCard(r.card, { root });
        console.log(flags.json ? JSON.stringify(r.card, null, 2) : cardText);
        if (flags.aider) { const { aiderHandoff } = await import('./clients.mjs'); const h = aiderHandoff({ env, cardText }); out.ok(`Aider: resume card written to ${h.conventions} and added to the read list in ${h.conf}`); }
      }
      return 0;
    }
    case 'claims': {
      need(); const { Vault } = await import('../engine/vault.mjs');
      if (await healthy(root)) { const r = await fetchOut(`http://127.0.0.1:${daemonInfo(root).port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${clientToken(root, 'cli')}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_claims', arguments: { status: flags.status, subject: flags.subject } } }) }); console.log((await r.json()).result.content[0].text); return 0; }
      const v = new Vault(root, { git: false }).open(); try { json(v.claims({ agent: 'cli', scopes: ['read'], paths: ['**'] }, { status: flags.status, subject: flags.subject })); } finally { v.close(); } return 0;
    }
    case 'token': {
      need(); const ts = new TokenStore(path.join(root, '.memev', 'tokens.json')); const sub = pos[0] || 'list';
      if (sub === 'list') { for (const t of ts.list()) console.log(`${t.id}  ${t.agent.padEnd(16)} ${t.scopes.join('+').padEnd(16)} ${t.remote ? 'remote' : 'local '} ${t.revoked ? 'REVOKED' : t.expires ? `expires ${t.expires.slice(0, 10)}` : 'no expiry'}  ${t.paths.join(',')}`); return 0; }
      if (sub === 'issue') { const t = ts.issue({ agent: flags.agent || pos[1] || 'agent', scopes: String(flags.scopes || 'read,write').split(','), paths: String(flags.paths || '**').split(','), ttlDays: Number(flags.ttl ?? 180), remote: !!flags.remote, note: flags.note || '' }); console.log(`Token for ${flags.agent || pos[1] || 'agent'} (shown once):\n${t.token}`); return 0; }
      if (sub === 'revoke') { if (!pos[1]) throw new Error('memev token revoke <id>'); console.log(ts.revoke(pos[1]) ? `Revoked ${pos[1]}.` : `No token ${pos[1]}.`); return 0; }
      if (sub === 'rotate') { if (!pos[1]) throw new Error('memev token rotate <id> [--ttl DAYS]'); const adminFile = path.join(root, '.memev', 'admin.json'); let adminRec = null; try { adminRec = JSON.parse(fs.readFileSync(adminFile, 'utf8')); } catch {} const isAdmin = adminRec?.id === pos[1]; const t = ts.rotate(pos[1], { ttlDays: Number(flags.ttl ?? (isAdmin ? 0 : 365)) }); if (isAdmin) { fs.writeFileSync(`${adminFile}.tmp`, JSON.stringify({ ...adminRec, token: t.token }, null, 2), { mode: 0o600 }); fs.renameSync(`${adminFile}.tmp`, adminFile); } /* the admin token's new secret goes into admin.json at once, with no expiry unless --ttl is given, so the CLI's admin calls keep working (issue 282) */ const f = path.join(root, '.memev', 'clients.json'); try { const all = JSON.parse(fs.readFileSync(f, 'utf8')); for (const k of Object.keys(all)) if (all[k].startsWith(`mv_${pos[1]}_`)) all[k] = t.token; fs.writeFileSync(f, JSON.stringify(all, null, 2), { mode: 0o600 }); } catch {} console.log(`Rotated ${pos[1]}; the credential now expires ${t.expires ? t.expires.slice(0, 10) : 'never'}. The old secret no longer works, so the link pasted into the cloud app must be pasted again: memev cloud url prints the new one. New token (shown once):\n${t.token}`); return 0; }
      throw new Error('memev token list|issue|revoke|rotate');
    }
    case 'project': {
      const { projectInfo } = await import('./hooks.mjs');
      const info = projectInfo(process.cwd(), root);
      if (!info) throw new Error('no folder to show');
      if (pos[0] === 'set') {
        need();
        const name = pos[1];
        if (!name) throw new Error('memev project set <name>');
        if (!/[\p{L}\p{N}]/u.test(name)) throw new Error('the name has no letters or digits, so it would pin the shared untitled project');
        const c = config(root); c.projects = { ...c.projects, [info.top]: name }; saveConfig(root, c);
        console.log(`Pinned ${slug(name)} for ${info.top}; recall and the hooks use it from now on.`);
        return 0;
      }
      const from = info.source === 'pinned' ? 'pinned with memev project set' : info.source === 'git' ? `the git top-level folder ${info.top}` : `the folder ${info.top}`;
      console.log(`${info.name}  (${from})`);
      return 0;
    }
    case 'admin-token': need(); console.log(adminToken(root) || '(none)'); return 0;
    case 'backup': {
      const sub = pos[0] || 'status';
      if (sub === 'set') {
        const url = pos[1];
        if (!url) throw new Error('memev backup set <git-url>');
        const { git } = await import('../engine/git.mjs');
        if (git(root, ['remote', 'get-url', 'origin']).ok) git(root, ['remote', 'set-url', 'origin', url]); else git(root, ['remote', 'add', 'origin', url]);
        const cfg = config(root); cfg.backup = { remote: url }; saveConfig(root, cfg);
        console.log(`Backup remote set to ${url}`);
        return 0;
      }
      if (sub === 'status') {
        const { git } = await import('../engine/git.mjs');
        const url = git(root, ['remote', 'get-url', 'origin']).out;
        console.log(url ? `Backing up to ${url}` : 'Not set up: memev backup set <git-url>');
        return 0;
      }
      throw new Error('memev backup set <git-url> | status');
    }
    default: console.error(`unknown command: ${cmd}\n`); console.log(HELP); return 2;
  }
}
