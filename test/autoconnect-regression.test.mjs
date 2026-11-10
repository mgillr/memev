// SR-1.36 T8: the tests of this contract pass on a computer with no git identity, no global or system git config and no
// GitHub login, as a person's first computer may be (owner, 8 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG, tmpdir } from './helpers/tmp.mjs';

const FILES = ['discover', 'clients-claude-msix', 'clients-chatgpt', 'clients-grok-bot', 'bus-register-seat', 'clients-backup', 'doctor-related'].map((f) => `test/${f}.test.mjs`);

test('T8-c01: the tests of this contract pass hermetically: no git identity, no git config, no GitHub token or login', () => {
  for (const f of FILES) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is there`);
  const home = tmpdir('hermetic-');
  const empty = path.join(home, 'empty-gitconfig'); fs.writeFileSync(empty, '');
  // only what node and git need to run: no identity, no tokens, a home with nothing in it
  const keep = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'ComSpec', 'PATHEXT', 'WINDIR'];
  const env = Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  Object.assign(env, { HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: empty, GH_CONFIG_DIR: path.join(home, 'gh'), XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_NO_SERVICE: '1' });
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GH_TOKEN', 'GITHUB_TOKEN', 'EMAIL']) assert.equal(env[k], undefined);
  const id = spawnSync('git', ['config', 'user.email'], { env, cwd: home, encoding: 'utf8' });
  assert.notEqual(id.status, 0, 'git has no identity in this environment');
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...FILES], { cwd: PKG, env, encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 });
  const fail = /^# fail (\d+)$/m.exec(r.stdout)?.[1]; const pass = /^# pass (\d+)$/m.exec(r.stdout)?.[1];
  assert.equal(r.status, 0, `the contract's tests failed hermetically:\n${r.stdout.split('\n').filter((l) => /^not ok|^# /.test(l)).join('\n')}\n${r.stderr}`);
  assert.equal(fail, '0'); assert.ok(Number(pass) >= 25, `pass ${pass}`);
  assert.doesNotMatch(r.stdout, /# SKIP/, 'nothing skipped');
});
