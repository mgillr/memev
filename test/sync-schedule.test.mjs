// REV-022: the backup sync runs every 5 minutes, once when the daemon starts, and once when it stops.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Vault, initVault } from '../src/engine/vault.mjs';
import { git } from '../src/engine/git.mjs';
import { supervise, syncOnceAsync } from '../src/cli/sync.mjs';
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

// The real daemon path: memev start and memev stop against a backup remote whose ssh takes 8 s,
// as on a network that drops port 22. Before the fix the start sync held the event loop, so start
// reported "did not start", and the stop sync outlived memev stop's 5 s and was killed.
function slowRemote(sb) {
  const slow = path.join(sb.home, 'slowssh.sh');
  fs.writeFileSync(slow, '#!/bin/sh\nsleep 8\necho "ssh: connect to host backup.example.invalid port 22: Operation timed out" >&2\nexit 255\n', { mode: 0o755 });
  git(sb.root, ['remote', 'add', 'origin', 'ssh://backup.example.invalid/vault.git']);
  git(sb.root, ['config', 'core.sshCommand', slow]);
}
const healthz = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(800) }); return r.status; } catch { return 0; } };
const daemonPid = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, '.memev', 'daemon.json'), 'utf8')).pid; } catch { return null; } };

test('REV-022 AC02: with a slow backup remote the daemon starts and answers while its start sync waits on the network', async () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    sb.run(['stop']);
    slowRemote(sb);
    const t0 = Date.now();
    const r = await sb.runAsync(['start'], { extraEnv: { MEMEV_NO_BACKGROUND: '0' } });
    assert.equal(r.code, 0, `memev start: ${r.out}${r.err}`);
    assert.ok(Date.now() - t0 < 6500, 'start returns inside ensureDaemon\'s window');
    // the start sync is still waiting on ssh: the daemon answers anyway
    const answers = [];
    for (let i = 0; i < 4; i++) { answers.push(await healthz(sb.port)); await new Promise((res) => setTimeout(res, 500)); }
    assert.deepEqual(answers, [200, 200, 200, 200], '/healthz answers during the start sync');
  } finally { sb.stop(); }
});

test('REV-022 AC03: memev stop with a slow backup remote ends inside its wait, keeps the note committed and says the push is left to the next start', async () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    sb.run(['stop']);
    slowRemote(sb);
    assert.equal((await sb.runAsync(['start'], { extraEnv: { MEMEV_NO_BACKGROUND: '0' } })).code, 0);
    const marker = 'rev022 slow stop marker';
    assert.equal(sb.run(['remember', marker, '--force']).code, 0);
    const pid = daemonPid(sb.root);
    const t0 = Date.now();
    assert.equal(sb.run(['stop']).code, 0);
    assert.ok(Date.now() - t0 < 4800, `memev stop took ${Date.now() - t0} ms; it must not reach its 5 s SIGKILL`);
    assert.ok(pid, 'a daemon was running');
    // a clean stop removes its lock; a SIGKILL leaves it
    assert.equal(fs.existsSync(path.join(sb.root, '.memev', 'daemon.lock')), false, 'the daemon stopped by itself, not by SIGKILL');
    assert.equal(git(sb.root, ['grep', '-q', marker, 'HEAD']).ok, true, 'the note is committed locally');
    const job = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'jobs.json'), 'utf8')).sync;
    assert.equal(job.shutdown, true);
    assert.equal(job.pushed, false);
    assert.match(job.error, /next start/, 'the record says what happens to the push');
  } finally { sb.stop(); }
});

test('REV-022: the background sync retries a github.com remote that hangs on port 22 through ssh.github.com:443', async () => {
  const { root, v } = newVault();
  const bin = tmpdir('fakebin-'), log = path.join(bin, 'ssh.log');
  const bare = tmpdir('bare-');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
  // a stand-in ssh: port 22 to github.com hangs, the 443 alternate serves the local bare repository
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  *ssh.github.com*git-upload-pack*) exec git upload-pack "${bare}" ;;
  *ssh.github.com*git-receive-pack*) exec git receive-pack "${bare}" ;;
  *) sleep 30; exit 255 ;;
esac
`, { mode: 0o755 });
  git(root, ['remote', 'add', 'origin', 'git@github.com:tester/vault.git']);
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
  try {
    const marker = 'rev022 port 443 marker';
    v.remember(OWNER, { text: marker, kind: 'fact', force: true });
    const t0 = Date.now();
    const res = await syncOnceAsync(v, { root, timeoutMs: 1500 });
    assert.equal(res.pushed, true, JSON.stringify(res));
    assert.ok(Date.now() - t0 < 15000, 'the hung port 22 calls were cut by the timeout');
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /git@github\.com git-upload-pack/, 'port 22 was tried first');
    assert.match(calls, /-p 443 git@ssh\.github\.com git-receive-pack/, 'the push went through ssh.github.com:443');
    assert.equal(git(bare, ['grep', '-q', marker, 'HEAD']).ok, true, 'the note reached the backup');
  } finally { process.env.PATH = savedPath; v.close(); }
});
