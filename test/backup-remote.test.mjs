// MEM-099: GitHub Enterprise --host and memev backup set <git-url>.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox } from './helpers/cli.mjs';
import { cleanup, newVault, OWNER } from './helpers/tmp.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
after(cleanup);

function fakeGh(dir, log, host) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
echo "GH_HOST=$GH_HOST $@" >> "${log}"
case "$1" in repo|api) case "$*" in *--hostname*) echo "unknown flag: --hostname" >&2; exit 1 ;; esac ;; esac
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") echo tester ;;
  "repo view") if [ -f "${log}.created" ]; then echo "PRIVATE git@${host}:tester/memev-vault.git"; else exit 1; fi ;;
  "repo create") touch "${log}.created" ;;
  "repo deploy-key") exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
}

test('MEM-099 AC01: github setup --host uses that host for auth, repo and deploy key', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const bin = path.join(sb.home, 'fakebin'), log = path.join(sb.home, 'gh.log');
    fakeGh(bin, log, 'ghe.example.com');
    const bare = path.join(sb.home, 'backup.git'); execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
    const r = sb.run(['github', 'setup', '--host', 'ghe.example.com', '--remote-url', bare], { extraEnv: { PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.code, 0, r.out + r.err);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /auth status --hostname ghe\.example\.com/);
    // gh has no --hostname on repo, api or deploy-key commands, so the host goes in GH_HOST (the stub refuses the flag there)
    assert.match(calls, /GH_HOST=ghe\.example\.com repo view tester\/memev-vault/);
    assert.match(calls, /GH_HOST=ghe\.example\.com repo create tester\/memev-vault --private/);
    assert.match(calls, /GH_HOST=ghe\.example\.com repo deploy-key add .*--repo tester\/memev-vault --allow-write/);
    assert.match(calls, /GH_HOST=ghe\.example\.com api user/);
    assert.doesNotMatch(calls, /github\.com/);
    const cfg = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
    assert.equal(cfg.github.host, 'ghe.example.com');
    assert.equal(cfg.github.remote, bare);
  } finally { sb.stop(); }
});

test('MEM-099 AC02: backup set <file:// remote> backs up to it and sync pushes there', () => {
  const { root, v } = newVault();
  const bare = path.join(root, '..', 'backup.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
  const url = `file://${bare}`;
  execFileSync('git', ['remote', 'add', 'origin', url], { cwd: root });
  v.remember(OWNER, { text: 'Backup test memory: the kettle is blue', kind: 'fact' });
  const res = syncOnce(v, { root });
  assert.equal(res.pushed, true, `push failed: ${res.error}`);
  assert.equal(res.remote, 'origin');
  const log = execFileSync('git', ['--git-dir', bare, 'log', '--oneline']).toString();
  assert.ok(log.trim().length > 0, 'remote has commits');
  const notes = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'HEAD']).toString().split('\n');
  assert.ok(notes.some((f) => f.endsWith('.md')), 'remote has .md notes');
  v.close();
});
