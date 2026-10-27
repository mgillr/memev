// Init offers to join an existing Memev backup, and does not call GitHub when that is impossible.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
after(cleanup);

const readme = Buffer.from('# Your Memev vault\n').toString('base64');

function writeGh(dir, log, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\n${body}\n`, { mode: 0o755 });
}

test('MEM-022 AC01: With a stubbed gh that lists a Memev backup repo, init offers to join it', () => {
  const sb = sandbox();
  try {
    const bin = path.join(sb.home, 'fakebin');
    const log = path.join(sb.home, 'gh.log');
    writeGh(bin, log, `case "$1 $2" in
  "auth status") exit 0 ;;
  "repo list") echo '[{"nameWithOwner":"tester/memev-vault","isPrivate":true}]' ;;
  "api repos/tester/memev-vault/contents/README.md") echo '${readme}' ;;
  *) exit 1 ;;
esac`);
    const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { extraEnv: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /tester\/memev-vault/);
    assert.match(r.out, /Join that vault\?/);
    assert.doesNotMatch(r.out, /Created your vault/);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /repo list/);
    assert.match(calls, /contents\/README.md/);
  } finally { sb.stop(); }
});

test('MEM-022 AC02: With gh absent or signed out, init makes no GitHub call and proceeds', () => {
  const sb = sandbox();
  try {
    const bin = path.join(sb.home, 'fakebin');
    const log = path.join(sb.home, 'gh.log');
    writeGh(bin, log, `case "$1 $2" in
  "auth status") exit 1 ;;
  *) echo "unexpected $*" >> "${log}.bad"; exit 1 ;;
esac`);
    const signedOut = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { extraEnv: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.equal(signedOut.code, 0, signedOut.out + signedOut.err);
    assert.match(signedOut.out, /Created your vault/);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /auth status/);
    assert.doesNotMatch(calls, /repo /);
    assert.doesNotMatch(calls, /api /);
    assert.equal(fs.existsSync(`${log}.bad`), false);

    const bare = path.join(sb.home, 'nogh');
    fs.mkdirSync(bare, { recursive: true });
    const git = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    fs.symlinkSync(git, path.join(bare, 'git'));
    const absent = sb.run(['init', '--port', String(sb.port + 1), '--local-only', '--no-connect', '--root', path.join(sb.home, 'other')], { extraEnv: { PATH: bare, MEMEV_ROOT: path.join(sb.home, 'other') } });
    assert.equal(absent.code, 0, absent.out + absent.err);
    assert.match(absent.out, /Created your vault/);
    assert.equal(fs.existsSync(path.join(bare, 'gh')), false);
  } finally { sb.stop(); }
});
