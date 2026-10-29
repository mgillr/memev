import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
import { sandbox } from './helpers/cli.mjs';
import { tmpdir, cleanup, newVault } from './helpers/tmp.mjs';

const GIT = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
};
const g = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT } });
const which = (name) => spawnSync('which', [name], { encoding: 'utf8' }).stdout.trim();

test('REV-006 AC01: the Free refusal names the backup path', () => {
  const p = seatPolicy({ license: null, devices: [{ id: 'd1', kind: 'remote-computer', status: 'active', created: '2026-01-01', label: 'other' }] });
  assert.equal(p.can_enroll, false);
  assert.match(p.reason, /your own GitHub backup \(docs\/GITHUB\.md\)/);
  assert.match(p.reason, /memev upgrade/);
});

test('REV-006 AC02: memev init --from clones a backup with no GitHub CLI and creates no new vault', () => {
  // a repository that already holds a Memev vault (the first computer's backup)
  const backup = tmpdir('backup-');
  fs.writeFileSync(path.join(backup, 'README.md'), '# Your Memev vault\n');
  fs.mkdirSync(path.join(backup, 'notes'));
  fs.writeFileSync(path.join(backup, 'notes', 'hello.md'), 'the kettle is blue\n');
  g(backup, ['init', '-q', '-b', 'main']);
  g(backup, ['add', '.']);
  g(backup, ['commit', '-q', '-m', 'first computer backup']);
  const backupHead = g(backup, ['rev-parse', 'HEAD']).stdout.trim();

  // a PATH that has git but no GitHub CLI: git in a fresh bin, the rest of PATH minus gh's folder
  const bin = tmpdir('bin-');
  fs.symlinkSync(which('git'), path.join(bin, 'git'));
  const noGh = (process.env.PATH || '').split(path.delimiter).filter((d) => path.resolve(d) !== path.resolve(path.dirname(which('gh')))).join(path.delimiter);

  const sb = sandbox();
  const root = path.join(tmpdir('second-'), 'vault');
  try {
    sb.run(['init', '--from', backup, '--root', root, '--port', String(sb.port)], { extraEnv: { PATH: bin + path.delimiter + noGh } });
    // the vault has the backup's content
    assert.equal(fs.readFileSync(path.join(root, 'notes', 'hello.md'), 'utf8'), 'the kettle is blue\n');
    // the vault is a descendant of the backup, so no new vault was created
    assert.equal(g(root, ['merge-base', '--is-ancestor', backupHead, 'HEAD']).status, 0, 'the vault keeps the backup git history');
  } finally { sb.run(['stop', '--root', root]); sb.stop(); cleanup(); }
});

test('REV-006 AC03: setup on an unrelated-history target offers the clone and takes back what it set, and a sync names the cause', () => {
  // a first computer's backup with its own history, and the bare repository that holds it
  const a = tmpdir('repo-a-');
  fs.writeFileSync(path.join(a, 'README.md'), '# Your Memev vault\n');
  fs.mkdirSync(path.join(a, 'memory'));
  fs.writeFileSync(path.join(a, 'memory', 'one.md'), 'first computer\n');
  g(a, ['init', '-q', '-b', 'main']);
  g(a, ['add', '.']);
  g(a, ['commit', '-q', '-m', 'first computer']);
  const bare = path.join(tmpdir('bare-'), 'a.git');
  g(path.dirname(bare), ['clone', '-q', '--bare', a, bare]);
  const before = g(bare, ['rev-parse', 'refs/heads/main']).stdout.trim();

  // the real memev github setup, with a stand-in GitHub CLI, against that repository
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const bin = path.join(sb.home, 'fakebin'), log = path.join(sb.home, 'gh.log');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") echo tester ;;
  "repo view") echo "PRIVATE git@github.com:tester/memev-vault.git" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
    const r = sb.run(['github', 'setup', '--remote-url', bare], { extraEnv: { PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /unrelated history/);
    assert.match(r.out, /memev init --from/);
    // no push happened: the backup's main is unchanged
    assert.equal(g(bare, ['rev-parse', 'refs/heads/main']).stdout.trim(), before, 'the backup main is unchanged (no push)');
    // setup took back everything it set, so no background sync runs against the unrelated repository
    assert.equal(g(sb.root, ['remote']).stdout.trim(), '', 'the origin remote is removed');
    assert.notEqual(g(sb.root, ['config', 'core.sshCommand']).status, 0, 'the deploy-key ssh command is unset');
    assert.equal(fs.existsSync(path.join(sb.root, '.git', 'hooks', 'pre-push')), false, 'the pre-push hook is removed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8')).github, undefined, 'cfg.github is removed');
  } finally { sb.stop(); }

  // the real background sync against an unrelated origin, as after a manual remote or memev backup set
  const { root, v } = newVault();
  g(root, ['remote', 'add', 'origin', bare]);
  const s = syncOnce(v, { root });
  assert.equal(s.pushed, false, 'nothing is pushed into the unrelated history');
  assert.match(s.error, /unrelated history/);
  assert.match(s.error, /memev init --from/);
  v.close(); cleanup();
});
