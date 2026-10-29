// The backup value in an invite is handed to git fetch as the remote, so a value shaped like a git
// option is refused where the invite is decoded and again where it is read back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sandbox } from './helpers/cli.mjs';
import { cleanup, tmpdir } from './helpers/tmp.mjs';
import { encodeInvite, decodeInvite, assertBackupRemote } from '../src/engine/devices.mjs';
import { fetchBackupAddress, remoteFile } from '../src/cli/remote.mjs';
import { writePrivateJson } from '../src/engine/util.mjs';

after(() => cleanup());

const code = (backup) => encodeInvite({ address: 'http://127.0.0.1:9', secret: 's', backup });

test('REV-001 AC01: a backup value that begins with a dash or is not an accepted remote shape is refused by decodeInvite and by join: nothing is saved and no git process is started', () => {
  for (const bad of ['--upload-pack=touch /tmp/rev001-pwned', '-u', 'http://', 'relative/path', 'http:bad', 'ssh://', 'user@host', 'user@host:/']) {
    assert.throws(() => decodeInvite(code(bad)), /not a valid git remote/, `decodeInvite refused ${JSON.stringify(bad)}`);
    assert.throws(() => assertBackupRemote(bad), /not a valid git remote/);
  }
  assert.equal(fs.existsSync('/tmp/rev001-pwned'), false, 'no git process ran the option-shaped value');
  const m = sandbox();
  try {
    const r = m.run(['join', code('--upload-pack=touch /tmp/rev001-pwned'), '--no-connect']);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /not a valid git remote/);
    assert.equal(fs.existsSync(remoteFile(m.env)), false, 'nothing was saved to remote.json');
  } finally { m.stop(); }
});

test('REV-001 AC02: an https URL, an ssh URL, a user@host:path remote and an absolute local path are accepted as backup values, and an option-shaped value is not', () => {
  for (const good of ['https://example.com/vault.git', 'ssh://git@example.com:2222/v.git', 'git@example.com:v.git', '/home/user/vault.git']) {
    const d = decodeInvite(code(good));
    assert.equal(d.backup, good, `${good} was accepted`);
    assert.equal(assertBackupRemote(good), good);
  }
  assert.throws(() => decodeInvite(code('--upload-pack=x')), /not a valid git remote/);
  assert.throws(() => assertBackupRemote('--upload-pack=x'), /not a valid git remote/);
});

test('REV-001 AC03: join --refresh re-validates the saved backup value before fetching, so a remote.json written by an earlier version with a bad value refuses instead of fetching', () => {
  const m = sandbox();
  try {
    writePrivateJson(remoteFile(m.env), { url: 'http://127.0.0.1:9', token: 'mv_rev001_abcdefghijklmnopqrstuvwxyz01', host_pubkey: 'k', backup: '--upload-pack=touch /tmp/rev001-pwned', joined: '2026-10-29T00:00:00.000Z' });
    const got = fetchBackupAddress(JSON.parse(fs.readFileSync(remoteFile(m.env), 'utf8')), m.env);
    assert.equal(got.ok, false);
    assert.match(got.error, /not a valid git remote/);
    const r = m.run(['join', '--refresh']);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /not a valid git remote/);
    assert.equal(fs.existsSync('/tmp/rev001-pwned'), false, 'no git process ran the saved value');
  } finally { m.stop(); }
});

test('REV-001 AC04: the fetch in fetchBackupAddress passes --end-of-options before the remote, so git never reads the backup value as an option', () => {
  const bin = tmpdir('gitbin-');
  const log = path.join(bin, 'git.log');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  init) exit 0 ;;
  fetch) exit 128 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  const backup = path.join(tmpdir('backup-'), 'vault.git');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MEMEV_CONFIG_DIR: tmpdir('cfg-') };
  const got = fetchBackupAddress({ backup }, env);
  assert.equal(got.ok, false, 'the stubbed fetch fails, as expected');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  const fetches = calls.filter((l) => l.startsWith('fetch'));
  assert.ok(fetches.length > 0, `a git fetch was attempted: ${calls.join(' | ')}`);
  for (const c of fetches) {
    const i = c.indexOf('--end-of-options');
    assert.ok(i >= 0, `--end-of-options is on the fetch line: ${c}`);
    assert.ok(c.slice(i + '--end-of-options'.length).trim().startsWith(backup), `the remote comes after --end-of-options: ${c}`);
  }
});
