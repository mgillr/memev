// SPDX-License-Identifier: Apache-2.0
// The runner: an opt-in background runner per seat that starts a headless turn of the seat's app
// when the operator posts it a task, at most N runs a day, with no default limit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { entry, saveRunner, sweep, watch } from '../src/cli/runner.mjs';

after(cleanup);

function seats() {
  const { v, root } = newVault();
  const host = v.devices.get(v.devices.hostId);
  v.bus.register({ client: 'codex', device: host });
  v.bus.register({ client: 'cursor', device: host });
  v.bus.setOperator('codex@host', { by: 'terminal' });
  const op = { identity: OWNER, client: 'codex', device: host, local: true, cli: true };
  const app = { identity: OWNER, client: 'cursor', device: host, local: true };
  return { v, root, bus: v.bus, op, app };
}

function stubCmd(dir, log) {
  const stub = path.join(dir, 'stub.sh');
  fs.writeFileSync(stub, `#!/bin/sh\necho "$1" >> ${log}\n`);
  fs.chmodSync(stub, 0o755);
  return stub;
}

test('MEM-061 AC01: the runner refuses to start without an explicit limit', async () => {
  const sb = sandbox();
  try {
    for (const d of ['.codex', '.cursor']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--lead', 'codex@host']);
    assert.equal(init.code, 0, init.err + init.out);
    const noLimit = sb.run(['runner', 'on', 'cursor@host']);
    assert.notEqual(noLimit.code, 0, 'on without a limit must fail');
    assert.match(noLimit.err, /limit/);
    const zero = sb.run(['runner', 'on', 'cursor@host', '--max-runs-per-day', '0']);
    assert.notEqual(zero.code, 0, 'a limit of 0 is not a limit');
    const ok = sb.run(['runner', 'on', 'cursor@host', '--max-runs-per-day', '2', '--command', 'echo']);
    assert.equal(ok.code, 0, ok.err + ok.out);
    assert.match(ok.out, /at most 2 run\(s\) a day/);
    const known = sb.run(['runner', 'on', 'codex@host', '--max-runs-per-day', '3']);
    assert.equal(known.code, 0, known.err + known.out);
    assert.match(known.out, /codex exec/);
  } finally {
    sb.stop();
  }
  // and a saved runner with no limit refuses to start
  const s = seats();
  s.v.close();
  saveRunner(s.root, { 'cursor@host': { enabled: true, cmd: 'echo', runs: [], seen: 0 } });
  await assert.rejects(watch({ root: s.root, seat: 'cursor@host', stop: () => true }), /limit/);
});

test('MEM-061 AC02: with a stub command, an operator task starts exactly one run and the limit stops further runs', async () => {
  const s = seats();
  const dir = tmpdir('runner-stub-');
  const log = path.join(dir, 'runs.log');
  const seat = 'cursor@host';
  saveRunner(s.root, { [seat]: { enabled: true, max_runs_per_day: 1, cmd: stubCmd(dir, log), runs: [], seen: 0 } });
  const task1 = s.bus.send(s.op, { to: seat, type: 'task', body: 'first task' });
  const r1 = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r1.started, [task1.id]);
  assert.equal(r1.skipped.length, 0);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'first task');
  assert.equal(entry(s.root, seat).runs.length, 1);
  s.bus.send(s.op, { to: seat, type: 'task', body: 'second task' });
  const r2 = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r2.started, []);
  assert.equal(r2.skipped.length, 1);
  assert.match(r2.skipped[0].reason, /limit/);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'first task', 'the limit stops the second run');
  s.v.close();
});

test('MEM-061 AC03: a non-operator message never starts a run', async () => {
  const s = seats();
  const dir = tmpdir('runner-stub-');
  const log = path.join(dir, 'runs.log');
  const seat = 'cursor@host';
  saveRunner(s.root, { [seat]: { enabled: true, max_runs_per_day: 5, cmd: stubCmd(dir, log), runs: [], seen: 0 } });
  const m1 = s.bus.send(s.app, { to: seat, type: 'task', body: 'app task' });
  const m2 = s.bus.send(s.app, { to: 'all', type: 'task', body: 'app task to everyone' });
  const m3 = s.bus.send(s.app, { to: seat, type: 'status', body: 'just a status' });
  const r = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r.started, []);
  const skippedIds = r.skipped.map((x) => x.id);
  for (const id of [m1.id, m2.id, m3.id]) assert.ok(skippedIds.includes(id), `${id} was skipped`);
  assert.ok(!fs.existsSync(log), 'no run was started');
  // the operator's task still runs, so it was the operator flag that mattered, not the seat
  const t = s.bus.send(s.op, { to: seat, type: 'task', body: 'operator task' });
  const r2 = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r2.started, [t.id]);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'operator task');
  s.v.close();
});
