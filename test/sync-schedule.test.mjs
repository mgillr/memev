// REV-022: the backup sync runs every 5 minutes, once when the daemon starts, and once when it stops.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Vault, initVault } from '../src/engine/vault.mjs';
import { git } from '../src/engine/git.mjs';
import { supervise } from '../src/cli/sync.mjs';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
after(cleanup);

const waitFor = async (cond, { timeout = 15000, every = 50 } = {}) => {
  const t0 = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - t0 > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, every));
  }
};

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

test('REV-022 AC01: with no sync section the sync runs every 5 minutes, and a fresh vault records 5', () => {
  const { root, v } = newVault();
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.memev', 'config.json'), 'utf8'));
  assert.equal(cfg.sync.interval_min, 5, 'a fresh vault records a 5 minute sync interval');
  v.close();

  const root2 = tmpdir('vault-');
  initVault(root2, { template: path.join(PKG, 'templates', 'vault') });
  const cfgPath = path.join(root2, '.memev', 'config.json');
  const cfg2 = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  delete cfg2.sync;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg2, null, 2));
  const v2 = new Vault(root2, { commitDelayMs: 10 }).open();
  const savedEnv = process.env.MEMEV_NO_BACKGROUND;
  process.env.MEMEV_NO_BACKGROUND = '1';
  const realSetInterval = globalThis.setInterval;
  const delays = [];
  globalThis.setInterval = (fn, ms, ...rest) => { delays.push(ms); return realSetInterval(fn, ms, ...rest); };
  let sup;
  try {
    sup = supervise(v2, { root: root2 });
  } finally {
    globalThis.setInterval = realSetInterval;
    if (savedEnv === undefined) delete process.env.MEMEV_NO_BACKGROUND; else process.env.MEMEV_NO_BACKGROUND = savedEnv;
  }
  assert.ok(delays.length >= 1, 'supervise schedules the sync interval');
  assert.equal(Math.min(...delays), 300000, 'with no sync section the sync runs every 5 minutes');
  sup.stop();
  v2.close();
});

test('REV-022 AC02: supervise runs one sync when the daemon starts, before the first interval', async () => {
  const { root, v } = newVault();
  const bare = tmpdir('bare-');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
  git(root, ['remote', 'add', 'origin', bare]);
  git(root, ['push', '-q', '-u', 'origin', 'main']);
  const savedEnv = process.env.MEMEV_NO_BACKGROUND;
  delete process.env.MEMEV_NO_BACKGROUND;
  const t0 = Date.now();
  const sup = supervise(v, { root });
  try {
    const marker = 'rev022 ac02 start sync marker';
    v.remember(OWNER, { text: marker, kind: 'fact', force: true });
    await waitFor(() => git(bare, ['grep', '-q', marker, 'HEAD']).ok);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 300000, `the start sync landed after ${elapsed}ms, before the 5 minute interval`);
  } finally {
    sup.stop();
    if (savedEnv === undefined) delete process.env.MEMEV_NO_BACKGROUND; else process.env.MEMEV_NO_BACKGROUND = savedEnv;
    v.close();
  }
});

test('REV-022 AC03: stopping the daemon commits and pushes a note written moments before stop', async () => {
  const { root, v } = newVault();
  const bare = tmpdir('bare-');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
  git(root, ['remote', 'add', 'origin', bare]);
  git(root, ['push', '-q', '-u', 'origin', 'main']);
  const savedEnv = process.env.MEMEV_NO_BACKGROUND;
  delete process.env.MEMEV_NO_BACKGROUND;
  const sup = supervise(v, { root });
  try {
    const jobs = () => { try { return JSON.parse(fs.readFileSync(path.join(root, '.memev', 'jobs.json'), 'utf8')); } catch { return {}; } };
    await waitFor(() => jobs().sync && jobs().sync.at);
    const marker = 'rev022 ac03 shutdown marker';
    assert.equal(git(bare, ['grep', '-q', marker, 'HEAD']).ok, false, 'the note is not in the backup before stop');
    v.remember(OWNER, { text: marker, kind: 'fact', force: true });
    sup.stop();
    assert.equal(git(bare, ['grep', '-q', marker, 'HEAD']).ok, true, 'the shutdown sync committed and pushed the note');
  } finally {
    if (savedEnv === undefined) delete process.env.MEMEV_NO_BACKGROUND; else process.env.MEMEV_NO_BACKGROUND = savedEnv;
    v.close();
  }
});

test('REV-022 AC04: github setup no longer says 30 minutes', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const bin = path.join(sb.home, 'fakebin'), log = path.join(sb.home, 'gh.log');
    fakeGh(bin, log);
    const bare = path.join(sb.home, 'backup.git');
    execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
    const r = sb.run(['github', 'setup', '--remote-url', bare], { extraEnv: { PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /5 minutes/, 'the setup summary says 5 minutes');
    assert.doesNotMatch(r.out, /30 minutes/, 'the setup summary no longer says 30 minutes');
  } finally { sb.stop(); }
});
