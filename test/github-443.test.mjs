// When a network blocks port 22, the GitHub backup push is retried through ssh.github.com on 443,
// and doctor reports a reachability failure with the fix.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { githubNetCheck } from '../src/cli/doctor.mjs';
after(cleanup);

function fakeGh(dir, log) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") echo tester ;;
  "repo view") if [ -f "${log}.created" ]; then echo "git@github.com:tester/memev-vault.git"; else exit 1; fi ;;
  "repo create") touch "${log}.created" ;;
  "repo deploy-key") exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
}

test('MEM-081 AC01: when port 22 is unreachable the push is retried through ssh.github.com:443', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const bin = path.join(sb.home, 'fakebin'), log = path.join(sb.home, 'ssh.log');
    const bare = path.join(sb.home, 'backup.git'); execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
    fakeGh(bin, path.join(sb.home, 'gh.log'));
    // a stand-in ssh: port 22 to github.com times out, the 443 alternate serves the local bare repository
    fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  *ssh.github.com*) exec git receive-pack "${bare}" ;;
  *) echo "ssh: connect to host github.com port 22: Connection timed out" >&2; exit 255 ;;
esac
`, { mode: 0o755 });
    const r = sb.run(['github', 'setup', '--remote-url', 'git@github.com:tester/vault.git'], { extraEnv: { PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.code, 0, r.out + r.err);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /git@github\.com git-receive-pack/, 'the port 22 push was attempted');
    assert.match(calls, /-p 443 git@ssh\.github\.com git-receive-pack/, 'the retry went through ssh.github.com:443');
    assert.ok(execFileSync('git', ['--git-dir', bare, 'log', '--oneline']).toString().trim().length > 0, 'the 443 push landed');
    assert.match(fs.readFileSync(path.join(sb.root, '.git', 'hooks', 'pre-push'), 'utf8'), /ssh\.github\.com:443/, 'the push guard accepts the 443 form');
  } finally { sb.stop(); }
});

test('MEM-081 AC02: doctor reports a reachability failure with the fix', async () => {
  const down = await githubNetCheck({ probe: async () => false });
  assert.equal(down.status, 'fail');
  assert.match(down.title, /GitHub reachable/);
  assert.match(down.detail, /github\.com:22/);
  assert.match(down.detail, /ssh\.github\.com:443/);
  assert.ok(down.fix, 'the failing check carries a fix');
  assert.match(down.fix.desc, /HTTPS/);
  assert.match(down.fix.desc, /fine-grained token/);
  const up = await githubNetCheck({ probe: async (host, port) => host === 'ssh.github.com' && port === 443 });
  assert.equal(up.status, 'ok');
  assert.match(up.detail, /ssh\.github\.com:443/);
  assert.equal(up.fix, null);
});
