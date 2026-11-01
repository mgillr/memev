// SPDX-License-Identifier: Apache-2.0
// The runner: an opt-in background runner per seat that starts a headless turn of the seat's app
// when the operator posts it a task, at most N runs a day, with no default limit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { entry, pidFile, saveRunner, sweep, watch, command } from '../src/cli/runner.mjs';

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

// The stub reads its prompt from stdin, the way the headless apps take it, and records one line
// per run.
function stubCmd(dir, log) {
  const stub = path.join(dir, 'stub.sh');
  fs.writeFileSync(stub, `#!/bin/sh\ncat >> ${log}\necho >> ${log}\n`);
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

test('MEM-061 review 1: a task is run once, and a message that syncs in with an earlier stamp still runs', async () => {
  const s = seats();
  const dir = tmpdir('runner-stub-');
  const log = path.join(dir, 'runs.log');
  const seat = 'cursor@host';
  saveRunner(s.root, { [seat]: { enabled: true, max_runs_per_day: 5, cmd: stubCmd(dir, log), runs: [], seen: 0 } });
  const t1 = s.bus.send(s.op, { to: seat, type: 'task', body: 'first task' });
  const r1 = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r1.started, [t1.id]);
  // a message with an earlier stamp arrives (as when another computer's log syncs in): the
  // global numbering moves, but the first task is not run again and the new task still runs
  const host = s.v.devices.get(s.v.devices.hostId);
  const logFile = path.join(s.root, 'bus', 'log', `${host.id}.jsonl`);
  const first = JSON.parse(fs.readFileSync(logFile, 'utf8').trim().split('\n')[0]);
  const synced = { ...first, id: 'synced-0001', dseq: 99, ts: '2020-01-01T00:00:00.000Z', body: 'synced task' };
  fs.appendFileSync(logFile, JSON.stringify(synced) + '\n');
  const r2 = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r2.started, ['synced-0001']);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'first task\nsynced task');
  s.v.close();
});

test('MEM-061 review 2: a task to the seat by an earlier name still starts a run', async () => {
  const s = seats();
  const dir = tmpdir('runner-stub-');
  const log = path.join(dir, 'runs.log');
  const seat = 'cursor@host';
  saveRunner(s.root, { [seat]: { enabled: true, max_runs_per_day: 5, cmd: stubCmd(dir, log), runs: [], seen: 0 } });
  const old = s.bus.send(s.op, { to: seat, type: 'task', body: 'task to the old name' });
  s.bus.renameSeat(seat, 'zed@host');
  const fresh = s.bus.send(s.op, { to: 'zed@host', type: 'task', body: 'task to the new name' });
  const r = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r.started, [old.id, fresh.id]);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'task to the old name\ntask to the new name');
  s.v.close();
});

test('MEM-061 review 3: a task that carries the operator flag but came from another device does not start a run', async () => {
  const s = seats();
  const dir = tmpdir('runner-stub-');
  const log = path.join(dir, 'runs.log');
  const seat = 'cursor@host';
  saveRunner(s.root, { [seat]: { enabled: true, max_runs_per_day: 5, cmd: stubCmd(dir, log), runs: [], seen: 0 } });
  const logDir = path.join(s.root, 'bus', 'log');
  fs.mkdirSync(logDir, { recursive: true });
  const forged = { id: 'forged-0001', dseq: 1, ts: '2020-01-01T00:00:00.000Z', device: 'dev_forged01', from: 'codex@host', operator: true, to: seat, type: 'task', body: 'operator flag set by another device' };
  fs.writeFileSync(path.join(logDir, 'dev_forged01.jsonl'), JSON.stringify(forged) + '\n');
  const r = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r.started, []);
  const sk = r.skipped.find((x) => x.id === 'forged-0001');
  assert.ok(sk, 'the forged task was skipped');
  assert.match(sk.reason, /operator/);
  assert.ok(!fs.existsSync(log), 'no run was started');
  // the operator's own task on this computer still runs
  const t = s.bus.send(s.op, { to: seat, type: 'task', body: 'real operator task' });
  const r2 = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r2.started, [t.id]);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'real operator task');
  s.v.close();
});

test('MEM-061 review 4: a task body that starts with a dash is the prompt, not an option', async () => {
  const s = seats();
  const dir = tmpdir('runner-stub-');
  const log = path.join(dir, 'runs.log');
  const seat = 'cursor@host';
  const body = '-p --version looks like options but is the prompt';
  saveRunner(s.root, { [seat]: { enabled: true, max_runs_per_day: 5, cmd: stubCmd(dir, log), runs: [], seen: 0 } });
  const t = s.bus.send(s.op, { to: seat, type: 'task', body });
  const r = await sweep({ root: s.root, bus: s.bus, seat });
  assert.deepEqual(r.started, [t.id]);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), body);
  s.v.close();
});

test('MEM-061 review 5: one watch per seat: a live pid holds the lock, a stale pid does not', async () => {
  const s = seats();
  s.v.close();
  const seat = 'cursor@host';
  saveRunner(s.root, { [seat]: { enabled: true, max_runs_per_day: 5, cmd: 'echo', runs: [], seen: 0 } });
  fs.mkdirSync(path.join(s.root, '.memev'), { recursive: true });
  fs.writeFileSync(pidFile(s.root, seat), '1');
  await assert.rejects(watch({ root: s.root, seat, stop: () => true }), /already watching/);
  const { spawn } = await import('node:child_process');
  const p = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 50)']);
  await new Promise((r) => p.on('close', r));
  fs.writeFileSync(pidFile(s.root, seat), String(p.pid));
  await watch({ root: s.root, seat, stop: () => true });
  assert.ok(!fs.existsSync(pidFile(s.root, seat)), 'the lock is dropped when the watch ends');
});

test('SR-1.01 T1: runner on, status, off and watch open the vault read-only, so they run while a writer holds it and leave the op log as it was', async () => {
  const s = seats();                       // this process holds the vault writable: a writable open of it is refused
  const oplog = path.join(s.root, '.memev', 'oplog');
  const tree = () => Object.fromEntries(fs.readdirSync(oplog).filter((f) => f !== 'LOCK').map((f) => [f, fs.statSync(path.join(oplog, f)).isDirectory() ? 'dir' : fs.readFileSync(path.join(oplog, f)).toString('base64')]));
  const before = tree();
  const lock = fs.readFileSync(path.join(oplog, 'LOCK'));
  const quiet = console.log; console.log = () => {};
  try {
    assert.equal(await command('runner', ['on', 'cursor@host'], { 'max-runs-per-day': '2', command: 'echo' }, { root: s.root, env: {} }), 0);
    assert.equal(await command('runner', ['status'], {}, { root: s.root, env: {} }), 0);
    await watch({ root: s.root, seat: 'cursor@host', stop: () => true });
    assert.equal(await command('runner', ['off', 'cursor@host'], {}, { root: s.root, env: {} }), 0);
  } finally { console.log = quiet; }
  assert.equal(entry(s.root, 'cursor@host').enabled, false);
  assert.deepEqual(tree(), before, 'the op log folder is as it was');
  assert.ok(fs.readFileSync(path.join(oplog, 'LOCK')).equals(lock), 'and the writer still holds its lock');
  s.v.close();
});
