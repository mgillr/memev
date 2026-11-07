// SPDX-License-Identifier: Apache-2.0
// The setup-remote allowlist has to be able to succeed: a command it lets through must then work when it runs, in the
// words the allowlist accepts. Flags are refused there, so a command that only works with a flag never can.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { freePort } from './helpers/cli.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { readJson } from '../src/engine/util.mjs';
import { Session, checkAllowlist } from '../src/cli/setup-remote.mjs';
import { MODES } from '../src/cli/deployment.mjs';

after(cleanup);

/** A session with no channel: an operator's command goes through the same gate and the real execution, one at a time. */
function operator(root) {
  const s = Object.create(Session.prototype);
  let onResult = null; const ran = [];
  Object.assign(s, {
    root, cmdId: 0, done: false,
    _out() {}, _log() {},
    channel: { send(m) { if (m.kind === 'result') onResult?.(m); } },
    execute(argv) { ran.push(argv); return Session.prototype._defaultExecute.call(s, argv); },
  });
  let id = 0;
  const send = (argv) => new Promise((res) => { onResult = res; s._handleCmd({ id: ++id, argv }); });
  return { send, ran };
}

// the session's child takes its environment from this process, and detect() reads HOME from it too
function sandboxEnv(home) {
  const keep = {};
  const set = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), MEMEV_NO_SERVICE: '1', MEMEV_NO_TUNNEL: '1' };
  for (const [k, v] of Object.entries(set)) { keep[k] = process.env[k]; process.env[k] = v; }
  return () => { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}

test('T4-c08: a command on the setup-remote allowlist is accepted and runs, and one that is not on it is refused', async () => {
  const home = tmpdir('allowlist-'); const root = path.join(home, 'vault');
  const restore = sandboxEnv(home);
  const elsewhere = process.cwd();
  initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: freePort() });
  const op = operator(root);
  try {
    // the fault itself: the allowlist accepts `deployment set local` and memev only took --mode, which the allowlist refuses
    const set = await op.send(['deployment', 'set', 'local']);
    assert.equal(set.code, 0, `deployment set local must run as allowlisted: ${set.out}`);
    assert.equal(readJson(path.join(root, '.memev', 'config.json'), {}).deployment?.mode, 'local', 'and it records the mode');
    assert.match(set.out, /deployment set: mode local/);

    // a licence file is checked as a path inside the vault, so it must be read from there and not from wherever the session runs
    assert.notEqual(elsewhere, root);
    fs.writeFileSync(path.join(root, 'key.lic'), '{}');
    const lic = await op.send(['license', 'install', 'key.lic']);
    assert.match(lic.out, /not installed/, 'the file in the vault was read');
    assert.doesNotMatch(lic.out, /not a licence/, 'the file was found: it is judged, not missing');
    assert.equal(lic.code, 1);

    // before any app is connected ready answers at once: 1, not ready. With one connected it waits for that app's first session
    const ready = await op.send(['ready']);
    assert.equal(ready.code, 1, ready.out);
    assert.match(ready.out, /No AI app is connected yet/);

    // an app that is found here: connect starts this vault's daemon, which the rest then see
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    const connect = await op.send(['connect', 'claude-code']);
    assert.equal(connect.code, 0, `connect runs: ${connect.out}`);

    // every other form on the allowlist, and the exit code it is documented to give here
    const wants = [
      [['status'], [0]],
      [['doctor'], [0, 1]], // 1 is a doctor that found something to report (a fresh vault has no backup yet)
      [['deployment', 'show'], [0]],
      [['license', 'status'], [0]],
      [['devices', 'list'], [0]],
      [['setup', 'remote', 'log'], [0]],
      [['setup', 'remote', 'log', '0123456789abcdef'], [1]], // no log with that id
    ];
    for (const [argv, codes] of wants) {
      const r = await op.send(argv);
      assert.ok(codes.includes(r.code), `${argv.join(' ')} gave ${r.code}: ${r.out}`);
      assert.doesNotMatch(r.out, /refused|Usage|unknown/i, `${argv.join(' ')} ran: ${r.out}`);
    }

    // one that is not on the list is refused, and nothing runs
    const count = op.ran.length;
    for (const argv of [['shell'], ['deployment', 'set', 'cloud'], ['deployment', 'set', '--mode', 'local'], ['stop']]) {
      assert.equal(checkAllowlist(argv, root).ok, false, `${argv.join(' ')} is not on the list`);
      const r = await op.send(argv);
      assert.equal(r.ok, false);
      assert.match(r.out, /^refused: /);
    }
    assert.equal(op.ran.length, count, 'no refused command ran');
  } finally {
    spawnSync(process.execPath, [path.join(PKG, 'bin', 'memev.mjs'), 'stop'], { env: { ...process.env, MEMEV_ROOT: root }, encoding: 'utf8', timeout: 30000 });
    restore();
  }
});

test('every deployment mode the allowlist takes is one memev holds, and it runs', async () => {
  const home = tmpdir('allowlist-'); const root = path.join(home, 'vault');
  const restore = sandboxEnv(home);
  initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: freePort() });
  const op = operator(root);
  try {
    assert.equal(checkAllowlist(['deployment', 'set', 'on-prem'], root).ok, true, 'on-prem is what a container install records');
    assert.equal(checkAllowlist(['deployment', 'set', 'container'], root).ok, false, 'memev has no mode called container');
    const { SESSION_MODES } = await import('../src/cli/setup-remote.mjs');
    assert.ok(SESSION_MODES.length > 0);
    for (const mode of SESSION_MODES) {
      assert.ok(MODES.includes(mode), `the allowlist takes ${mode}, and the modes are ${MODES.join(', ')}`);
      assert.equal(checkAllowlist(['deployment', 'set', mode], root).ok, true, mode);
      const r = await op.send(['deployment', 'set', mode]);
      assert.equal(r.code, 0, `${mode}: ${r.out}`);
      assert.equal(readJson(path.join(root, '.memev', 'config.json'), {}).deployment?.mode, mode);
    }
    // nothing outside the list: a mode memev holds and a session does not offer is refused, as the managed service is only planned
    for (const mode of MODES.filter((m) => !SESSION_MODES.includes(m))) assert.equal(checkAllowlist(['deployment', 'set', mode], root).ok, false, mode);
  } finally { restore(); }
});
