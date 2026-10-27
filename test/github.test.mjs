// Guided GitHub backup with a stand-in GitHub CLI: private repo, single-repo deploy key, push guard.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
after(cleanup);

function fakeGh(dir, log, { visibility = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") echo tester ;;
  "repo view") ${visibility ? `echo "${visibility} git@github.com:tester/x.git"` : 'if [ -f "' + log + '.created" ]; then echo "git@github.com:tester/memev-vault.git"; else exit 1; fi'} ;;
  "repo create") touch "${log}.created" ;;
  "repo deploy-key") exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
}

test('github setup: private repo, a deploy key for that repo only, first push, push guard', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const bin = path.join(sb.home, 'fakebin'), log = path.join(sb.home, 'gh.log');
    fakeGh(bin, log);
    const bare = path.join(sb.home, 'backup.git'); execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
    const r = sb.run(['github', 'setup', '--remote-url', bare], { extraEnv: { PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.code, 0, r.out + r.err);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /repo create tester\/memev-vault --private/);
    assert.match(calls, /repo deploy-key add .*--repo tester\/memev-vault --allow-write/);
    assert.doesNotMatch(calls, /--public/);
    assert.ok(execFileSync('git', ['--git-dir', bare, 'log', '--oneline']).toString().trim().length > 0, 'pushed');
    assert.match(execFileSync('git', ['config', 'core.sshCommand'], { cwd: sb.root }).toString(), /IdentitiesOnly=yes/);
    const key = fs.readdirSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'keys')).find((f) => f.startsWith('deploy-') && !f.endsWith('.pub'));
    assert.equal((fs.statSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'keys', key)).mode & 0o777).toString(8), '600');
    const other = path.join(sb.home, 'other.git'); execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', other]);
    assert.throws(() => execFileSync('git', ['push', other, 'HEAD:main'], { cwd: sb.root, stdio: 'pipe' }), /refusing to push the vault/);
  } finally { sb.stop(); }
});

test('github setup refuses a repository that is not private', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const bin = path.join(sb.home, 'fakebin'), log = path.join(sb.home, 'gh.log');
    fakeGh(bin, log, { visibility: 'PUBLIC' });
    const r = sb.run(['github', 'setup', '--repo', 'tester/x'], { extraEnv: { PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.code, 1);
    assert.match(r.out, /only backs up to a private repository/);
    assert.equal(execFileSync('git', ['remote'], { cwd: sb.root }).toString().trim(), '');
  } finally { sb.stop(); }
});
