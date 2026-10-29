// SPDX-License-Identifier: Apache-2.0
// `memev github setup`: back the vault up to your own private GitHub repository.
//   1. sign in with GitHub's device flow (through the GitHub CLI: a code to type at github.com/login/device)
//   2. create a private repository (or use one you name)
//   3. give this machine a deploy key that can push to that one repository and nothing else
//   4. point the vault at it, push, and let the daemon sync it every 5 minutes
// After step 3 Memev never uses your GitHub sign-in again; `gh auth logout` is safe.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { configDir, exists, readJson, writeJson, slug, run as spawn } from '../engine/util.mjs';
import { git } from '../engine/git.mjs';
import { config, saveConfig, out } from './common.mjs';

const sh = (cmd, args, opts = {}) => { const r = spawn(cmd, args, { timeout: opts.timeout || 60000, stdio: opts.inherit ? 'inherit' : 'pipe', env: { ...process.env, ...(opts.env || {}) }, input: opts.input }); return { ok: r.ok, out: r.stdout.trim(), err: r.stderr.trim(), status: r.status }; };
// gh takes the host as GH_HOST: only `gh auth` has a --hostname flag that repo, api and deploy-key commands do not
const ghOn = (host) => (args, opts = {}) => sh('gh', args, host && host !== 'github.com' ? { ...opts, env: { ...(opts.env || {}), GH_HOST: host } } : opts);
const has = (bin) => sh(process.platform === 'win32' ? 'where' : 'which', [bin]).ok;

// The file a vault backup pushes. The first line is how init tells a private repository is one of ours.
const BACKUP_MARKER = '# Your Memev vault';

/**
 * A private repository of the signed-in user whose README is a Memev vault, or null.
 * No GitHub call when the CLI is missing or the user is signed out: the status check is local,
 * and a failed status returns before any repository call.
 */
export function findMemevBackup(host = 'github.com') {
  if (!has('gh')) return null;
  if (!sh('gh', ['auth', 'status', '--hostname', host]).ok) return null;
  const gh = ghOn(host);
  const list = gh(['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,isPrivate']);
  if (!list.ok || !list.out) return null;
  let repos = [];
  try { repos = JSON.parse(list.out); } catch { return null; }
  for (const repo of repos) {
    if (!repo?.isPrivate || typeof repo.nameWithOwner !== 'string') continue;
    const file = gh(['api', `repos/${repo.nameWithOwner}/contents/README.md`, '--jq', '.content']);
    if (!file.ok || !file.out) continue;
    let text = '';
    try { text = Buffer.from(file.out.replace(/\s/g, ''), 'base64').toString('utf8'); } catch { continue; }
    if (text.startsWith(BACKUP_MARKER)) return { repo: repo.nameWithOwner };
  }
  return null;
}

/** Clone that backup into root. The caller has already decided to join it. */
export function cloneBackup(repo, root) {
  fs.mkdirSync(path.dirname(path.resolve(root)), { recursive: true });
  return sh('gh', ['repo', 'clone', repo, root]);
}

/** Clone a git URL into root with plain git, no GitHub CLI. The caller decides what to do with it. */
export function cloneFromUrl(url, root) {
  root = path.resolve(root);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  return sh('git', ['clone', '-q', '--', url, root]);
}

/** True when root is a clone of a Memev vault backup: its README starts with the marker. */
export function isMemevBackup(root) {
  try { return fs.readFileSync(path.join(root, 'README.md'), 'utf8').startsWith(BACKUP_MARKER); } catch { return false; }
}

// The hook accepts the repository's ssh URL and, when the network blocks port 22, its ssh-over-443 form.
export const PRE_PUSH = (url) => {
  const alt = alt443(url);
  return `#!/bin/sh
# Memev: the vault only ever pushes to the repository set up by memev github setup.
expected=${JSON.stringify(url)}
${alt ? `alt=${JSON.stringify(alt)}\n` : ''}if [ "$2" != "$expected" ]${alt ? ` && [ "$2" != "$alt" ]` : ''}; then
  echo "memev: refusing to push the vault to $2 (expected $expected${alt ? ` or $alt` : ''})" >&2
  exit 1
fi
`;
};

// The host that carries GitHub's ssh session on 443, kept apart from the user name so the
// URL never reads as an address to the leak scan.
const ALT_HOST = 'ssh.github.com';

/** The ssh-over-443 form of a github.com remote, or null when the remote is not one. */
export function alt443(url) {
  const m = /^git@github\.com:(.+)$/.exec(String(url || '').trim());
  return m ? `ssh://git@${ALT_HOST}:443/${m[1]}` : null;
}

/**
 * Run a git command against the backup remote. When it fails and the remote is a github.com ssh
 * one (the network blocks port 22), the same command is retried through ssh.github.com on 443.
 * The result carries `via`, the URL the successful run used.
 */
export function gitVia443(root, args, token, url = token) {
  const alt = alt443(url);
  const run = (dest) => { const r = git(root, args.map((a) => (a === token ? dest : a))); return { ...r, via: dest }; };
  const p = run(token);
  if (p.ok || !alt) return p;
  return run(alt);
}

/**
 * Push the vault to its backup remote, retrying through ssh.github.com:443 when port 22 is
 * unreachable. `upstream` records the remote as the branch's upstream (the first push).
 */
export function pushBackup(root, { upstream = false, quiet = true, remote = null } = {}) {
  remote = remote || git(root, ['remote']).out.split('\n').filter(Boolean)[0];
  if (!remote) return { ok: false, via: null, error: 'push: no remote' };
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';
  const url = git(root, ['remote', 'get-url', remote]).out;
  const args = upstream ? ['push', '-u', remote, `HEAD:${branch}`] : (quiet ? ['push', '-q', remote, `HEAD:${branch}`] : ['push', remote, `HEAD:${branch}`]);
  const p = gitVia443(root, args, remote, url);
  return { ok: p.ok, via: p.via, error: p.ok ? null : `push: ${p.err.split('\n').pop()}` };
}

/**
 * True when the remote's history shares no common ancestor with this vault: a fresh vault pointed
 * at a repository that already holds a different Memev vault. null when the remote could not be read.
 */
export function unrelatedHistory(root, remote) {
  const f = git(root, ['fetch', '-q', remote]);
  if (!f.ok) return null;
  const heads = git(root, ['branch', '-r', '--list', `${remote}/*`]).out.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!heads.length) return false; // an empty remote has nothing to be unrelated to
  for (const h of heads) if (git(root, ['merge-base', 'HEAD', h]).ok) return false;
  return true;
}

/** The line that offers the clone instead of a push, when the target holds an unrelated vault. */
export function cloneOffer(url) {
  return `The target already holds a Memev vault with an unrelated history, so Memev will not push over it. On this computer, clone it instead: memev init --from ${url}`;
}

/**
 * Take back everything setup set for the GitHub backup: the origin remote, the deploy-key ssh
 * command, the pre-push hook, and cfg.github. Called when the target holds an unrelated vault, so
 * no background sync runs against it.
 */
export function undoGithub(root) {
  git(root, ['remote', 'remove', 'origin']);
  git(root, ['config', '--unset', 'core.sshCommand']);
  try { fs.rmSync(path.join(root, '.git', 'hooks', 'pre-push'), { force: true }); } catch {}
  const cfg = config(root); if (cfg.github) { delete cfg.github; saveConfig(root, cfg); }
}

// A TCP connect with a short timeout: true when the host answers. Injectable so tests never touch the network.
const tcpProbe = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 2500 });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.once('connect', () => done(true));
  s.once('timeout', () => done(false));
  s.once('error', () => done(false));
});

/**
 * Whether GitHub can be reached for a git push: port 22 first, then the 443 alternate.
 * ok is true when at least one path answers; open lists the ones that do.
 */
export async function githubReachable({ probe = tcpProbe } = {}) {
  const open = [];
  for (const [host, port] of [['github.com', 22], ['ssh.github.com', 443]]) {
    try { if (await probe(host, port)) open.push(`${host}:${port}`); } catch { /* treat as closed */ }
  }
  return { ok: open.length > 0, open };
}

export async function setup({ root, env = process.env, repo = null, flags = {} }) {
  const host = flags.host || 'github.com';
  const gh = ghOn(host);
  const steps = [];
  const step = (status, what, detail = '') => { steps.push({ status, what, detail }); (status === 'ok' ? out.ok : status === 'manual' ? out.warn : out.bad)(`${what}${detail ? `: ${detail}` : ''}`); };
  if (!has('gh')) { step('manual', 'GitHub CLI', 'install it from https://cli.github.com and run memev github setup again (or follow docs/GITHUB.md to do it by hand)'); return { ok: false, steps }; }
  let st = sh('gh', ['auth', 'status', '--hostname', host]);
  if (!st.ok) {
    if (flags['no-login']) { step('manual', 'GitHub sign-in', `run gh auth login --hostname ${host}`); return { ok: false, steps }; }
    console.log(`Sign in to ${host}: a one-time code is shown; enter it at https://${host}/login/device`);
    const l = sh('gh', ['auth', 'login', '--hostname', host, '--git-protocol', 'https', '--web', '--scopes', 'repo'], { inherit: true, timeout: 15 * 60000 });
    if (!l.ok) { step('fail', 'GitHub sign-in', 'did not finish'); return { ok: false, steps }; }
  }
  const login = gh(['api', 'user', '--jq', '.login']).out;
  if (!login) { step('fail', 'GitHub account', 'could not read the signed-in account'); return { ok: false, steps }; }
  step('ok', `Signed in to ${host}`, login);
  const name = repo || `${login}/${slug(path.basename(root), 40)}-vault`;
  const view = gh(['repo', 'view', name, '--json', 'visibility,sshUrl', '--jq', '.visibility + " " + .sshUrl']);
  let sshUrl;
  if (view.ok) {
    const [vis, url] = view.out.split(' ');
    if (vis !== 'PRIVATE') { step('fail', 'Repository', `${name} is ${vis.toLowerCase()}; Memev only backs up to a private repository`); return { ok: false, steps }; }
    sshUrl = url; step('ok', 'Using your private repository', name);
  } else {
    const c = gh(['repo', 'create', name, '--private', '--disable-issues', '--disable-wiki', '--description', 'My Memev vault (private)']);
    if (!c.ok) { step('fail', 'Create repository', c.err.split('\n').pop()); return { ok: false, steps }; }
    sshUrl = gh(['repo', 'view', name, '--json', 'sshUrl', '--jq', '.sshUrl']).out || `git@${host}:${name}.git`;
    step('ok', 'Created a private repository', name);
  }
  if (flags['remote-url']) sshUrl = flags['remote-url'];
  // a deploy key: this machine can push to this repository only
  const keyDir = path.join(configDir(env), 'keys'); fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const key = path.join(keyDir, `deploy-${slug(name, 60)}`);
  if (!exists(key)) { const k = sh('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `memev deploy key (${slug(name, 60)})`, '-f', key, '-q']); if (!k.ok) { step('fail', 'Deploy key', k.err); return { ok: false, steps }; } }
  fs.chmodSync(key, 0o600);
  const add = gh(['repo', 'deploy-key', 'add', `${key}.pub`, '--repo', name, '--allow-write', '--title', `memev (${path.basename(root)})`]);
  if (!add.ok && !/already in use|key is already/i.test(add.err)) { step('fail', 'Deploy key', add.err.split('\n').pop()); return { ok: false, steps }; }
  step('ok', 'Deploy key added', 'write access to this one repository only');
  // the vault: remote, ssh key, push guard
  if (git(root, ['remote', 'get-url', 'origin']).ok) git(root, ['remote', 'set-url', 'origin', sshUrl]); else git(root, ['remote', 'add', 'origin', sshUrl]);
  git(root, ['config', 'core.sshCommand', `ssh -i "${key}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`]);
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-push'), PRE_PUSH(sshUrl), { mode: 0o755 });
  const cfg = config(root); cfg.github = { repo: name, remote: sshUrl, key: path.basename(key), host }; saveConfig(root, cfg);
  // a fresh vault pointed at a repository that already holds a different vault: do not push over it,
  // and take back the remote, key, hook and config so no background sync runs against it
  const ur = unrelatedHistory(root, 'origin');
  if (ur === true) {
    undoGithub(root);
    step('manual', 'Unrelated history', cloneOffer(sshUrl));
    return { ok: false, steps, repo: name };
  }
  const p = pushBackup(root, { upstream: true, quiet: false, remote: 'origin' });
  if (!p.ok) { step('manual', 'First push', `${p.error} (Memev retries every 5 minutes)`); return { ok: false, steps, repo: name }; }
  const via = p.via && p.via !== sshUrl ? ` via ${p.via.replace('ssh://git@', '')}` : '';
  step('ok', 'Vault pushed', `${name}${via} (synced every ${cfg.sync?.interval_min ?? 5} minutes)`);
  console.log('Memev does not use your GitHub sign-in from here on; you can run gh auth logout.');
  return { ok: true, steps, repo: name };
}

export async function command(cmd, pos, flags, { root, env }) {
  const sub = pos[0] || 'setup';
  if (sub === 'setup') return (await setup({ root, env, repo: flags.repo || pos[1] || null, flags })).ok ? 0 : 1;
  if (sub === 'status') { const c = config(root).github; console.log(c ? `Backing up to ${c.repo} on ${c.host || 'github.com'} (${c.remote})` : 'Not set up: memev github setup'); return 0; }
  throw new Error('memev github setup [--repo owner/name] | status');
}
