import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { unrelatedHistory, cloneOffer, syncBackup } from '../src/cli/github.mjs';
import { sandbox } from './helpers/cli.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';

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
  assert.match(p.reason, /back the vault up on the first computer with memev github setup/);
  assert.match(p.reason, /memev init on this computer and join that backup/);
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
  try {
    const root = path.join(tmpdir('second-'), 'vault');
    sb.run(['init', '--from', backup, '--root', root, '--port', String(sb.port)], { extraEnv: { PATH: bin + path.delimiter + noGh } });
    // the vault has the backup's content
    assert.equal(fs.readFileSync(path.join(root, 'notes', 'hello.md'), 'utf8'), 'the kettle is blue\n');
    // the vault is a descendant of the backup, so no new vault was created
    assert.equal(g(root, ['merge-base', '--is-ancestor', backupHead, 'HEAD']).status, 0, 'the vault keeps the backup git history');
  } finally { sb.stop(); cleanup(); }
});

test('REV-006 AC03: setup on an unrelated-history target offers the clone, and a sync names the cause', () => {
  // repository A holds a Memev vault (the first computer's backup)
  const a = tmpdir('repo-a-');
  fs.writeFileSync(path.join(a, 'README.md'), '# Your Memev vault\n');
  fs.mkdirSync(path.join(a, 'notes'));
  fs.writeFileSync(path.join(a, 'notes', 'one.md'), 'first computer\n');
  g(a, ['init', '-q', '-b', 'main']);
  g(a, ['add', '.']);
  g(a, ['commit', '-q', '-m', 'first computer']);
  // a fresh vault B with an unrelated history, pointed at A
  const b = tmpdir('repo-b-');
  fs.writeFileSync(path.join(b, 'README.md'), '# Your Memev vault\n');
  g(b, ['init', '-q', '-b', 'main']);
  g(b, ['add', '.']);
  g(b, ['commit', '-q', '-m', 'fresh vault']);
  g(b, ['remote', 'add', 'origin', a]);

  assert.equal(unrelatedHistory(b, 'origin'), true, 'the fresh vault and the backup have unrelated histories');
  const offer = cloneOffer(a);
  assert.match(offer, /unrelated history/);
  assert.match(offer, /memev init --from/);
  const sync = syncBackup(b, { remote: 'origin' });
  assert.equal(sync.ok, false);
  assert.match(sync.error, /unrelated/);
  assert.match(sync.error, /memev init --from/);
});
