// Why a test cannot wait for the daemon's listen-error line (doctor.test.mjs, MEM-006 AC02).
// startDaemon (src/cli/daemon.mjs, the kill at lines 91-92) stops a daemon that has not answered within its wait. The line
// "[memev] cannot listen on ..." is written by src/server/main.mjs only after the daemon has opened the vault (main.mjs:28), in the
// handler at main.mjs:45. On a slow machine the daemon is stopped before it gets there, so the line is never written and polling the
// log for it never succeeds. Only a start whose wait is long enough for the daemon to reach listen writes it.
// This is the open follow-up to raise that wait (docs/scope-one/RECONCILIATION.md, "Raise the daemon start wait"; SR-1.01 and SR-1.24 scope).
// The tests here describe the present behaviour; they do not change it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn as realSpawn } from 'node:child_process';
import { cleanup, PKG } from './helpers/tmp.mjs';
import { sandbox, initWithRetry } from './helpers/cli.mjs';
import { startDaemon, whyNotRunning } from '../src/cli/daemon.mjs';

after(() => cleanup());

const MAIN = new URL(`file://${path.join(PKG, 'src', 'server', 'main.mjs').replace(/\\/g, '/')}`).href;
// a daemon that takes `ms` before it starts: the same process, started late, as on a slow machine
const lateSpawn = (ms) => (cmd, args, opts) => realSpawn(process.execPath, ['-e', `setTimeout(() => import(${JSON.stringify(MAIN)}), ${ms})`, 'x', ...args.slice(1)], opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a start that gives up before the daemon reaches listen leaves no listen-error line, and a start with a long enough wait does', async () => {
  const sb = sandbox();
  const saved = { ...process.env };
  try {
    assert.equal(initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    sb.run(['stop']);
    const log = path.join(sb.root, '.memev', 'daemon.log');
    fs.writeFileSync(log, '');
    Object.assign(process.env, sb.env, { MEMEV_BIND: '192.0.2.1' }); // an address this machine does not have: listen fails
    // the daemon needs 2 s to get going and the wait is 0.6 s: it is stopped first (startDaemon sleeps 100 ms before it first checks)
    assert.equal(await startDaemon(sb.root, { quiet: true, waitMs: 600, spawn: lateSpawn(2000) }), false);
    await sleep(3500); // longer than the daemon needed
    assert.equal(fs.readFileSync(log, 'utf8'), '', 'the log has no line: the daemon was stopped before it reached listen');
    assert.equal(await whyNotRunning(sb.root), null, 'so there is nothing to report but that it is not running');
    // the same daemon, with a wait that is long enough, reaches listen, fails there and writes the line
    assert.equal(await startDaemon(sb.root, { quiet: true, waitMs: 6000 }), false);
    assert.match(fs.readFileSync(log, 'utf8'), /\[memev\] cannot listen on 192\.0\.2\.1:\d+: listen E[A-Z]+/);
    assert.match(await whyNotRunning(sb.root), /the last start could not listen on 192\.0\.2\.1:\d+: listen E[A-Z]+/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    sb.stop();
  }
});
