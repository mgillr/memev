// The Windows process table for the session link (src/cli/session-link.mjs), tested on any OS with platform 'win32'
// injected and a fake runner in execFileSync's shape standing in for PowerShell. The JSON below is what
// `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress`
// writes: an array for several processes, one object for one, CreationDate as "\/Date(ms)\/" from Windows
// PowerShell 5.1 and as ISO 8601 from PowerShell 7.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cleanup, tmpdir } from './helpers/tmp.mjs';
import { ancestors, readProcs, readLink, writeLink, parseWinProcs, cimTime, windowsPowerShell, WIN_PROCS_TIMEOUT_MS } from '../src/cli/session-link.mjs';
import { busSessionHeaders } from '../src/cli/mcp-stdio.mjs';
after(cleanup);

const WIN = 'win32';
const ENV = { SystemRoot: 'C:\\Windows' };
// 2024-11-07T07:00:00.123Z and so on: the app started first, then its shell and the hook, then the MCP server
const T = { app: 1730962800123, shell: 1730962801000, hook: 1730962801500, mcp: 1730962802000 };
const d51 = (ms) => `"\\/Date(${ms})\\/"`; // as the JSON text carries it
const row = (pid, ppid, date) => `{"ProcessId":${pid},"ParentProcessId":${ppid},"CreationDate":${date}}`;
// Windows PowerShell 5.1: an array; the idle process (pid 0) has no CreationDate
const PS51 = `[${[row(0, 0, 'null'), row(4, 0, d51(1730962700000)), row(700, 4, d51(1730962750000)),
  row(5000, 700, d51(T.app)), row(5100, 5000, d51(T.shell)), row(5200, 5100, d51(T.hook)), row(5300, 5000, d51(T.mcp))].join(',')}]`;

/** A fake runner that records each call and answers like execFileSync with encoding utf8. */
function fakeRun(answer) {
  const calls = [];
  const run = (file, args, opts) => { calls.push({ file, args, opts }); if (answer instanceof Error) throw answer; return answer; };
  return { run, calls };
}

test('readProcs on Windows: one PowerShell CIM query, hidden, with a timeout, parsed into the same shape as ps', () => {
  const f = fakeRun(`\uFEFF${PS51}\r\n`);
  const t = readProcs({ platform: WIN, run: f.run, env: ENV });
  assert.equal(f.calls.length, 1);
  const [c] = f.calls;
  assert.equal(c.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(c.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(c.args[3], /^Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate \| Select-Object -Property ProcessId,ParentProcessId,CreationDate \| ConvertTo-Json -Compress$/);
  assert.equal(c.opts.timeout, 3000);
  assert.ok(c.opts.timeout <= 3000 && WIN_PROCS_TIMEOUT_MS === 3000);
  assert.equal(c.opts.windowsHide, true);
  assert.equal(c.opts.encoding, 'utf8');
  // same shape as the ps reader: pid -> { ppid, started }, started a string; the idle process is left out
  assert.deepEqual([...t.keys()], [4, 700, 5000, 5100, 5200, 5300]);
  assert.deepEqual(t.get(5300), { ppid: 5000, started: String(T.mcp) });
  assert.deepEqual(t.get(5000), { ppid: 700, started: String(T.app) });
  // by name from PATH when the environment names no Windows directory
  assert.equal(windowsPowerShell({}), 'powershell.exe');
});

test('one process gives an object, not an array; the ETS-wrapped date of Windows PowerShell 5.1 reads too', () => {
  const one = readProcs({ platform: WIN, run: fakeRun(row(5000, 700, d51(T.app))).run, env: ENV });
  assert.deepEqual([...one.entries()], [[5000, { ppid: 700, started: String(T.app) }]]);
  const wrapped = parseWinProcs(`{"ProcessId":5000,"ParentProcessId":700,"CreationDate":{"value":${d51(T.app)},"DisplayHint":2,"DateTime":"Thursday, November 7, 2024 8:00:00 AM"}}`);
  assert.equal(wrapped.get(5000).started, String(T.app));
});

test('CreationDate in each form gives the same start time for the same instant', () => {
  assert.equal(cimTime(`/Date(${T.app})/`), T.app); // 5.1, after JSON.parse
  assert.equal(cimTime('2024-11-07T08:00:00.1234567+01:00'), T.app); // PowerShell 7, local time with offset
  assert.equal(cimTime('2024-11-07T07:00:00.123Z'), T.app);
  assert.equal(cimTime('20241107080000.123456+060'), T.app); // CIM_DATETIME, offset in minutes
  assert.equal(cimTime('20241107020000.123456-300'), T.app);
  assert.equal(cimTime({ value: `/Date(${T.app})/` }), T.app);
  for (const bad of [null, undefined, '', 'yesterday', 42, '/Date(x)/', {}]) assert.equal(cimTime(bad), null, String(bad));
  // a PowerShell 7 table and a 5.1 table of the same processes agree, so a hook and an MCP server match either way
  const ps7 = parseWinProcs(`[${row(5000, 700, '"2024-11-07T08:00:00.1234567+01:00"')},${row(700, 4, '"2024-11-07T06:59:10+00:00"')}]`);
  assert.equal(ps7.get(5000).started, parseWinProcs(PS51).get(5000).started);
});

test('the parent-chain walk on Windows links the hook and the MCP server through the app process', () => {
  const dir = tmpdir('winlink-');
  const t = readProcs({ platform: WIN, run: fakeRun(PS51).run, env: ENV });
  // the hook runs under a shell under the app; the MCP server runs straight under the app
  assert.deepEqual(ancestors(5200, t).map((a) => a.pid), [5100, 5000, 700]);
  assert.deepEqual(ancestors(5300, t).map((a) => a.pid), [5000, 700, 4]);
  writeLink(dir, ancestors(5200, t), { session: 'W1', seat: 'claude-code@host/2', client: 'claude-code' });
  assert.equal(readLink(dir, ancestors(5300, t), 'claude-code').session, 'W1');
  assert.deepEqual(busSessionHeaders(dir, 'claude-code', () => ancestors(5300, t)), { 'x-memev-bus-session': 'W1' });
  // the app exited and Windows gave its pid to a new process: the start time differs, so the record is not taken
  const reused = parseWinProcs(PS51.replace(row(5000, 700, d51(T.app)), row(5000, 700, d51(T.app + 60e3))));
  assert.equal(readLink(dir, ancestors(5300, reused), 'claude-code'), null);
});

test('a parent id that a newer process took over ends the walk', () => {
  // the MCP server's parent exited; pid 5000 now names a process started after the MCP server
  const t = parseWinProcs(`[${row(5000, 700, d51(T.mcp + 5000))},${row(5300, 5000, d51(T.mcp))},${row(700, 4, d51(1730962750000))}]`);
  assert.deepEqual(ancestors(5300, t), []);
  // a parent that started before its child is followed
  const ok = parseWinProcs(`[${row(5000, 700, d51(T.app))},${row(5300, 5000, d51(T.mcp))},${row(700, 4, d51(1730962750000))}]`);
  assert.deepEqual(ancestors(5300, ok).map((a) => a.pid), [5000, 700]);
  // ps start times are not compared, as before
  const unix = new Map([[10, { ppid: 9, started: 'Sat Nov  7 10:00:05 2026' }], [9, { ppid: 1, started: 'Sat Nov  7 10:00:09 2026' }]]);
  assert.deepEqual(ancestors(10, unix).map((a) => a.pid), [9]);
});

test('PowerShell missing, timed out or answering nonsense: no table, no link, no session header, nothing thrown', () => {
  const dir = tmpdir('winfail-');
  const timeout = Object.assign(new Error('spawnSync powershell.exe ETIMEDOUT'), { code: 'ETIMEDOUT', signal: 'SIGTERM' });
  const missing = Object.assign(new Error('spawnSync powershell.exe ENOENT'), { code: 'ENOENT' });
  for (const answer of [timeout, missing, '', 'Get-CimInstance : Access denied', '[]', 'null', '{"ProcessId":"x"}']) {
    const t = readProcs({ platform: WIN, run: fakeRun(answer).run, env: ENV });
    assert.equal(t, null, String(answer));
    assert.deepEqual(ancestors(process.pid, t), []);
    assert.deepEqual(busSessionHeaders(dir, 'claude-code', () => ancestors(process.pid, t)), {});
  }
});

test('the timeout is real: a query that hangs is stopped near WIN_PROCS_TIMEOUT_MS', () => {
  // the runner keeps readProcs' own options and swaps PowerShell for a process that never answers
  let seen = null;
  const run = (file, args, opts) => { seen = opts; return execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], opts); };
  const t0 = Date.now();
  assert.equal(readProcs({ platform: WIN, run, env: ENV }), null);
  const took = Date.now() - t0;
  assert.equal(seen.timeout, WIN_PROCS_TIMEOUT_MS);
  assert.ok(took >= WIN_PROCS_TIMEOUT_MS - 100 && took < WIN_PROCS_TIMEOUT_MS + 2500, `took ${took} ms`);
});

test('the ps reader goes through the same runner and gives the same shape', () => {
  const f = fakeRun('    1     0 Sat Nov  7 09:00:00 2026\n  500     1 Sat Nov  7 10:00:00 2026\n  501   500 Sat Nov  7 10:00:01 2026\n');
  const t = readProcs({ platform: 'darwin', run: f.run });
  assert.equal(f.calls[0].file, 'ps');
  assert.deepEqual(t.get(501), { ppid: 500, started: 'Sat Nov  7 10:00:01 2026' });
  assert.deepEqual(ancestors(501, t).map((a) => a.pid), [500]);
  assert.equal(readProcs({ platform: 'linux', run: fakeRun(new Error('no ps')).run }), null);
});
