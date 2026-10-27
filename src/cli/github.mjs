// SPDX-License-Identifier: Apache-2.0
// `memev github setup`: back the vault up to your own private GitHub repository.
//   1. sign in with GitHub's device flow (through the GitHub CLI: a code to type at github.com/login/device)
//   2. create a private repository (or use one you name)
//   3. give this machine a deploy key that can push to that one repository and nothing else
//   4. point the vault at it, push, and let the daemon sync it every 30 minutes
// After step 3 Memev never uses your GitHub sign-in again; `gh auth logout` is safe.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, exists, readJson, writeJson, slug, run as spawn } from '../engine/util.mjs';
import { git } from '../engine/git.mjs';
import { config, saveConfig, out } from './common.mjs';

const sh = (cmd, args, opts = {}) => { const r = spawn(cmd, args, { timeout: opts.timeout || 60000, stdio: opts.inherit ? 'inherit' : 'pipe', env: { ...process.env, ...(opts.env || {}) }, input: opts.input }); return { ok: r.ok, out: r.stdout.trim(), err: r.stderr.trim(), status: r.status }; };
const has = (bin) => sh(process.platform === 'win32' ? 'where' : 'which', [bin]).ok;

// The file a vault backup pushes. The first line is how init tells a private repository is one of ours.
const BACKUP_MARKER = '# Your Memev vault';

/**
 * A private repository of the signed-in user whose README is a Memev vault, or null.
 * No GitHub call when the CLI is missing or the user is signed out: the status check is local,
 * and a failed status returns before any repository call.
 */
export function findMemevBackup() {
  if (!has('gh')) return null;
  if (!sh('gh', ['auth', 'status', '--hostname', 'github.com']).ok) return null;
  const list = sh('gh', ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,isPrivate']);
  if (!list.ok || !list.out) return null;
  let repos = [];
  try { repos = JSON.parse(list.out); } catch { return null; }
  for (const repo of repos) {
    if (!repo?.isPrivate || typeof repo.nameWithOwner !== 'string') continue;
    const file = sh('gh', ['api', `repos/${repo.nameWithOwner}/contents/README.md`, '--jq', '.content']);
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

export const PRE_PUSH = (url) => `#!/bin/sh
# Memev: the vault only ever pushes to the repository set up by memev github setup.
expected=${JSON.stringify(url)}
if [ "$2" != "$expected" ]; then
  echo "memev: refusing to push the vault to $2 (expected $expected)" >&2
  exit 1
fi
`;

export async function setup({ root, env = process.env, repo = null, flags = {} }) {
  const steps = [];
  const step = (status, what, detail = '') => { steps.push({ status, what, detail }); (status === 'ok' ? out.ok : status === 'manual' ? out.warn : out.bad)(`${what}${detail ? `: ${detail}` : ''}`); };
  if (!has('gh')) { step('manual', 'GitHub CLI', 'install it from https://cli.github.com and run memev github setup again (or follow docs/GITHUB.md to do it by hand)'); return { ok: false, steps }; }
  let st = sh('gh', ['auth', 'status', '--hostname', 'github.com']);
  if (!st.ok) {
    if (flags['no-login']) { step('manual', 'GitHub sign-in', 'run gh auth login'); return { ok: false, steps }; }
    console.log('Sign in to GitHub: a one-time code is shown; enter it at https://github.com/login/device');
    const l = sh('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--scopes', 'repo'], { inherit: true, timeout: 15 * 60000 });
    if (!l.ok) { step('fail', 'GitHub sign-in', 'did not finish'); return { ok: false, steps }; }
  }
  const login = sh('gh', ['api', 'user', '--jq', '.login']).out;
  if (!login) { step('fail', 'GitHub account', 'could not read the signed-in account'); return { ok: false, steps }; }
  step('ok', 'Signed in to GitHub', login);
  const name = repo || `${login}/${slug(path.basename(root), 40)}-vault`;
  const view = sh('gh', ['repo', 'view', name, '--json', 'visibility,sshUrl', '--jq', '.visibility + " " + .sshUrl']);
  let sshUrl;
  if (view.ok) {
    const [vis, url] = view.out.split(' ');
    if (vis !== 'PRIVATE') { step('fail', 'Repository', `${name} is ${vis.toLowerCase()}; Memev only backs up to a private repository`); return { ok: false, steps }; }
    sshUrl = url; step('ok', 'Using your private repository', name);
  } else {
    const c = sh('gh', ['repo', 'create', name, '--private', '--disable-issues', '--disable-wiki', '--description', 'My Memev vault (private)']);
    if (!c.ok) { step('fail', 'Create repository', c.err.split('\n').pop()); return { ok: false, steps }; }
    sshUrl = sh('gh', ['repo', 'view', name, '--json', 'sshUrl', '--jq', '.sshUrl']).out || `git@github.com:${name}.git`;
    step('ok', 'Created a private repository', name);
  }
  if (flags['remote-url']) sshUrl = flags['remote-url'];
  // a deploy key: this machine can push to this repository only
  const keyDir = path.join(configDir(env), 'keys'); fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const key = path.join(keyDir, `deploy-${slug(name, 60)}`);
  if (!exists(key)) { const k = sh('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `memev deploy key (${slug(name, 60)})`, '-f', key, '-q']); if (!k.ok) { step('fail', 'Deploy key', k.err); return { ok: false, steps }; } }
  fs.chmodSync(key, 0o600);
  const add = sh('gh', ['repo', 'deploy-key', 'add', `${key}.pub`, '--repo', name, '--allow-write', '--title', `memev (${path.basename(root)})`]);
  if (!add.ok && !/already in use|key is already/i.test(add.err)) { step('fail', 'Deploy key', add.err.split('\n').pop()); return { ok: false, steps }; }
  step('ok', 'Deploy key added', 'write access to this one repository only');
  // the vault: remote, ssh key, push guard
  if (git(root, ['remote', 'get-url', 'origin']).ok) git(root, ['remote', 'set-url', 'origin', sshUrl]); else git(root, ['remote', 'add', 'origin', sshUrl]);
  git(root, ['config', 'core.sshCommand', `ssh -i "${key}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`]);
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-push'), PRE_PUSH(sshUrl), { mode: 0o755 });
  const cfg = config(root); cfg.github = { repo: name, remote: sshUrl, key: path.basename(key) }; saveConfig(root, cfg);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';
  const p = git(root, ['push', '-u', 'origin', `HEAD:${branch}`]);
  if (!p.ok) { step('manual', 'First push', `${p.err.split('\n').pop()} (Memev retries every 30 minutes)`); return { ok: false, steps, repo: name }; }
  step('ok', 'Vault pushed', `${name} (synced every ${cfg.sync?.interval_min ?? 30} minutes)`);
  console.log('Memev does not use your GitHub sign-in from here on; you can run gh auth logout.');
  return { ok: true, steps, repo: name };
}

export async function command(cmd, pos, flags, { root, env }) {
  const sub = pos[0] || 'setup';
  if (sub === 'setup') return (await setup({ root, env, repo: flags.repo || pos[1] || null, flags })).ok ? 0 : 1;
  if (sub === 'status') { const c = config(root).github; console.log(c ? `Backing up to ${c.repo} (${c.remote})` : 'Not set up: memev github setup'); return 0; }
  throw new Error('memev github setup [--repo owner/name] | status');
}
