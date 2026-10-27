// Windows service management: a per-user Task Scheduler entry at logon, and a daemon that spawns without a
// console window. The platform is injected and the command runner is stubbed, so these run on any machine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { installService, removeService } from '../src/cli/service.mjs';
import { startDaemon } from '../src/cli/daemon.mjs';

after(() => cleanup());
const stubRun = (calls) => (cmd, args) => { calls.push({ cmd, args }); return { ok: true, out: 'SUCCESS: The scheduled task was created successfully.' }; };

test('MEM-078 AC01: With platform win32 injected, memev service install runs schtasks with /sc onlogon for the current user (stubbed)', async () => {
  const calls = [];
  const env = { ...process.env, USERNAME: 'rider' };
  const r = await installService({ env, root: 'C:\\vault', platform: 'win32', run: stubRun(calls) });
  assert.equal(r.status, 'added', r.detail);
  const create = calls.find((c) => c.cmd === 'schtasks' && c.args[0] === 'create');
  assert.ok(create, 'schtasks /create was run');
  const i = create.args.indexOf('/sc');
  assert.ok(i > -1 && create.args[i + 1] === 'onlogon', 'the trigger is /sc onlogon');
  const u = create.args.indexOf('/ru');
  assert.ok(u > -1 && create.args[u + 1] === 'rider', 'the task runs for the current user');
});

test('MEM-078 AC02: The daemon spawn options include windowsHide: true', async () => {
  const root = path.join(tmpdir(), 'vault');
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  let captured = null;
  const fakeSpawn = (cmd, args, opts) => { captured = opts; return { pid: 1, unref() {}, exitCode: 3 }; };
  await startDaemon(root, { quiet: true, waitMs: 10, spawn: fakeSpawn });
  assert.ok(captured, 'the daemon spawn was called');
  assert.equal(captured.windowsHide, true, 'the spawn options include windowsHide: true');
});

test('MEM-078 AC03: memev service remove deletes the task', async () => {
  const calls = [];
  const r = await removeService({ env: process.env, platform: 'win32', run: stubRun(calls), quiet: true });
  assert.equal(r.removed, true);
  const del = calls.find((c) => c.cmd === 'schtasks' && c.args[0] === 'delete');
  assert.ok(del, 'schtasks /delete was run');
  const t = del.args.indexOf('/tn');
  assert.ok(t > -1 && del.args[t + 1] === 'Memev Daemon', 'it deletes the memev task');
});
