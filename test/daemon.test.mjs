// Starting the daemon: the CLI reports this vault's daemon and nothing else, and a start that gives up leaves
// nothing running behind it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { cleanup, PKG, tmpdir } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { healthy } from '../src/cli/daemon.mjs';

after(() => cleanup());

const daemonFile = (sb) => path.join(sb.root, '.memev', 'daemon.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

test('a vault started on a port another vault already uses is reported as not started, not as the other daemon', () => {
  const a = sandbox(), b = sandbox();
  try {
    assert.equal(a.run(['init', '--port', String(a.port), '--local-only', '--no-connect']).code, 0);
    const first = JSON.parse(fs.readFileSync(daemonFile(a), 'utf8'));
    // the second vault is set to the port the first vault's daemon is listening on, then started
    assert.equal(b.run(['init', '--port', String(b.port), '--local-only', '--no-connect']).code, 0);
    assert.equal(b.run(['stop']).code, 0);
    const cfg = path.join(b.root, '.memev', 'config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), port: a.port }, null, 2));
    const start = b.run(['start']);
    assert.equal(start.code, 1, start.out + start.err);
    assert.match(start.out + start.err, /did not start/);
    assert.doesNotMatch(start.out, /Memev is running/);
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
    // a wait of 0 ms gives up at once: startDaemon sleeps 100 ms before its first check, so any longer wait lets
    // a fast machine bring the daemon up in time
    const src = `import('${path.join(PKG, 'src', 'cli', 'daemon.mjs')}').then((m) => m.startDaemon(process.env.MEMEV_ROOT, { quiet: true, waitMs: 0 })).then((ok) => process.stdout.write(String(ok)))`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { env: sb.env, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.stdout, 'false', r.stderr);
    // a daemon left running would write daemon.json within a fraction of a second; give it two
    await new Promise((res) => setTimeout(res, 2000));
    assert.equal(fs.existsSync(daemonFile(sb)), false, 'no daemon came up after the start gave up');
    let lockPid = null; try { lockPid = Number(fs.readFileSync(path.join(sb.root, '.memev', 'daemon.lock'), 'utf8')); } catch {}
    if (lockPid) assert.equal(alive(lockPid), false, 'the daemon that took the lock is not running');
  } finally { sb.stop(); }
});

test('MEM-004 AC02: healthy() returns false for a service that answers {"ok":true} without the vault\'s vault_id', async () => {
  const root = path.join(tmpdir('vault-id-'), 'vault');
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memev', 'config.json'), JSON.stringify({ vault_id: 'ours' }));
  let answer = null;
  const other = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer)); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  try {
    const port = other.address().port;
    for (const [body, want] of [[{ ok: true }, false], [{ ok: true, vault_id: 'another vault' }, false], [{ ok: true, vault_id: 'ours' }, true]]) {
      answer = body;
      assert.equal(await healthy(root, port), want, JSON.stringify(body));
    }
  } finally { other.close(); }
});
