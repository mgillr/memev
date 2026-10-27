// Starting the daemon: the CLI reports this vault's daemon and nothing else, and a start that gives up leaves
// nothing running behind it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanup, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';

after(() => cleanup());

const daemonFile = (sb) => path.join(sb.root, '.memev', 'daemon.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

test('a vault started on a port another vault already uses is reported as not started, not as the other daemon', () => {
  const a = sandbox(), b = sandbox();
  try {
    assert.equal(a.run(['init', '--port', String(a.port), '--local-only', '--no-connect']).code, 0);
    const first = JSON.parse(fs.readFileSync(daemonFile(a), 'utf8'));
    // the second vault asks for the port the first vault's daemon is listening on
    const init = b.run(['init', '--port', String(a.port), '--local-only', '--no-connect']);
    assert.match(init.out + init.err, /did not start/);
    assert.doesNotMatch(init.out, /Memev is running/);
    assert.equal(fs.existsSync(daemonFile(b)), false, 'the second vault has no daemon');
    // and the first vault's daemon is untouched: same pid, still serving its own vault
    assert.equal(JSON.parse(fs.readFileSync(daemonFile(a), 'utf8')).pid, first.pid);
    assert.ok(alive(first.pid));
  } finally { b.stop(); a.stop(); }
});

test('a start that gives up stops the daemon it began, so none comes up later unreported', async () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    assert.equal(sb.run(['stop']).code, 0);
    assert.equal(fs.existsSync(daemonFile(sb)), false);
    // a wait of 1 ms gives up before any daemon can be ready
    const src = `import('${path.join(PKG, 'src', 'cli', 'daemon.mjs')}').then((m) => m.startDaemon(process.env.MEMEV_ROOT, { quiet: true, waitMs: 1 })).then((ok) => process.stdout.write(String(ok)))`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { env: sb.env, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.stdout, 'false', r.stderr);
    // a daemon left running would write daemon.json within a fraction of a second; give it two
    await new Promise((res) => setTimeout(res, 2000));
    assert.equal(fs.existsSync(daemonFile(sb)), false, 'no daemon came up after the start gave up');
    let lockPid = null; try { lockPid = Number(fs.readFileSync(path.join(sb.root, '.memev', 'daemon.lock'), 'utf8')); } catch {}
    if (lockPid) assert.equal(alive(lockPid), false, 'the daemon that took the lock is not running');
  } finally { sb.stop(); }
});
