#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SR-1.35's ceilings, on any machine: builds a vault of generated notes in a temporary folder, runs each axis's own bench on it, and
// exits 1 when a number passes its ceiling or does not come back. The ceilings sit well above what the iMac measured, so a slower computer
// still passes, and those in CAUGHT sit under the old cost, so a return to it fails. The old cost grows with the vault, which is why this
// runs at 50,000 notes; at 10,000 most of it does not show. The measured figures are in docs/testing/SPEED-RESULTS.md.
//   node scripts/bench/speed/targets.mjs [--notes 50000] [--json]
//   node scripts/bench/speed/targets.mjs --evaluate <file.json>     judge numbers already taken, and run nothing
//   node scripts/bench/speed/targets.mjs --against <commit>         run these benches on that commit's code: exits 0 only if every ceiling in
//                                                                   CAUGHT fails there, and lists by name the ceilings it passes
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// name: [ceiling, unit, what it measures]. A7 on the notes with no index; A6 at 100,000 messages; the rest on the same notes after that import.
export const CEILINGS = {
  a1_start_ms: [10000, 'ms', 'spawn to /healthz, median, settled vault'],
  a7_first_import_ms: [200000, 'ms', 'spawn to /healthz on a folder of notes with no index'],
  a8_stop_ms: [2000, 'ms', 'SIGTERM to exit, median, nothing written'],
  a8_stop_after_write_ms: [2000, 'ms', 'SIGTERM to exit, median, just after a write'],
  a3_recall_p95_ms: [100, 'ms', 'real route, idle, worst of the rounds'],
  a3_recall_after_save_ms: [1000, 'ms', 'first recall after a save, worst of the rounds'],
  a2_health_timeouts: [0, 'count', '/healthz waits over 800 ms during writes'],
  a4_new_note_p50_ms: [200, 'ms', 'write route, a new note; a guard only, as the old code passes it too'],
  a5_commit_block_p50_ms: [25, 'ms', 'how long a commit stops the thread'],
  a6_roster_ms: [50, 'ms', 'SR-1.17, 50 seats and 100,000 messages'],
  a6_tasks_ms: [200, 'ms', 'bus tasks, same bus'],
  a6_send_ms: [200, 'ms', 'bus send, same bus'],
};

// The ceilings meant to catch a return to the old cost. The others guard against getting worse and claim no gain over the old code.
export const CAUGHT = ['a1_start_ms', 'a7_first_import_ms', 'a8_stop_after_write_ms', 'a3_recall_p95_ms', 'a3_recall_after_save_ms', 'a2_health_timeouts', 'a5_commit_block_p50_ms', 'a6_roster_ms', 'a6_tasks_ms', 'a6_send_ms'];

/** Against old code: every ceiling in CAUGHT must fail there, and a number that did not come back does not count as caught. */
export function judgeOld(numbers, caught = CAUGHT, ceilings = CEILINGS) {
  const rows = evaluate(numbers, ceilings).rows;
  const missed = rows.filter((r) => caught.includes(r.name) && (r.ok || r.value === null)).map((r) => r.name);
  const passes = rows.filter((r) => r.ok).map((r) => r.name);
  return { ok: missed.length === 0, missed, passes, rows };
}

/** Every ceiling must have a finite number at or under it. A number that did not come back fails, so a broken bench cannot read as a fast one. */
export function evaluate(numbers, ceilings = CEILINGS) {
  const rows = Object.entries(ceilings).map(([name, [ceiling, unit, what]]) => {
    const value = numbers?.[name];
    const measured = typeof value === 'number' && Number.isFinite(value);
    return { name, value: measured ? value : null, ceiling, unit, what, ok: measured && value <= ceiling };
  });
  return { ok: rows.every((r) => r.ok), rows };
}

const main = async () => {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const report = (numbers) => {
    const r = evaluate(numbers);
    if (argv.includes('--json')) console.log(JSON.stringify({ ...r, numbers }));
    else for (const x of r.rows) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name} ${x.value ?? 'no number'} (ceiling ${x.ceiling} ${x.unit}): ${x.what}`);
    return r.ok;
  };
  if (argv.includes('--evaluate')) process.exit(report(JSON.parse(fs.readFileSync(arg('evaluate'), 'utf8'))) ? 0 : 1);

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const HERE = path.join(REPO, 'scripts', 'bench', 'speed');
  const NOTES = Number(arg('notes', 50000));
  if (argv.includes('--against')) {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-targets-old-'));
    let verdict = 2;
    try {
      const ar = spawnSync('sh', ['-c', 'git -C "$0" archive "$1" | tar -x -C "$2"', REPO, arg('against'), old], { encoding: 'utf8' });
      if (ar.status !== 0) throw new Error(`cannot read ${arg('against')}: ${ar.stderr}`);
      fs.cpSync(HERE, path.join(old, 'scripts', 'bench', 'speed'), { recursive: true });
      const r = spawnSync(process.execPath, [path.join(old, 'scripts', 'bench', 'speed', 'targets.mjs'), '--notes', String(NOTES), '--json'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] });
      const numbers = JSON.parse(String(r.stdout).trim().split('\n').at(-1)).numbers;
      const v = judgeOld(numbers);
      console.log(JSON.stringify({ against: arg('against'), numbers, ...v, rows: undefined }));
      for (const x of v.rows) console.log(`${x.ok ? 'passes on the old code' : 'caught'} ${x.name} ${x.value ?? 'no number'} (ceiling ${x.ceiling} ${x.unit})`);
      if (!v.ok) console.log(`NOT CAUGHT, though meant to be: ${v.missed.join(', ')}`);
      verdict = v.ok ? 0 : 1;
    } catch (e) { console.error(e.message); } finally { fs.rmSync(old, { recursive: true, force: true }); }
    process.exit(verdict);
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-targets-'));
  const root = path.join(base, 'vault');
  const env = { ...process.env, HOME: path.join(base, 'home'), MEMEV_NO_SERVICE: '1', MEMEV_MACHINE_NAME: 'targets' };
  fs.mkdirSync(env.HOME);
  const runBench = (script, ...args) => {
    const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 1500000 });
    if (r.status !== 0) console.error(`${script} exited ${r.status}: ${String(r.stderr).slice(-400)}`);
    return String(r.stdout).trim().split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  };
  const worst = (a) => (a.length && a.every(Number.isFinite) ? Math.max(...a) : undefined);
  const numbers = {};
  try {
    const { initVault } = await import(pathToFileURL(path.join(REPO, 'src', 'engine', 'vault.mjs')).href);
    initVault(root, { template: path.join(REPO, 'templates', 'vault') });
    const { seedVault } = await import(pathToFileURL(path.join(REPO, 'scripts', 'bench', 'seed.mjs')).href);
    const { genNotes } = await import(pathToFileURL(path.join(HERE, 'fixture.mjs')).href);
    seedVault(root, 'small', JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'queries.json'), 'utf8')));
    genNotes(root, NOTES, 'memory', 7 + NOTES);
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a], { cwd: root, env, encoding: 'utf8' });
    git('add', '-A'); git('commit', '-qm', 'notes');

    const start = runBench('start.mjs', '--root', root, '--runs', '4', '--tree', REPO).filter((x) => x.run !== undefined && x.ok);
    numbers.a7_first_import_ms = start.find((x) => x.run === 0)?.health_ms;
    const settled = start.filter((x) => x.run > 0).sort((a, b) => a.health_ms - b.health_ms);
    numbers.a1_start_ms = settled[Math.floor(settled.length / 2)]?.health_ms;
    const stops = start.filter((x) => x.run > 0).map((x) => x.stop_ms).sort((a, b) => a - b);
    numbers.a8_stop_ms = stops[Math.floor(stops.length / 2)];
    const touched = runBench('start.mjs', '--root', root, '--runs', '3', '--tree', REPO, '--touch', '--settle', '700').filter((x) => x.run !== undefined && x.ok).map((x) => x.stop_ms).sort((a, b) => a - b);
    numbers.a8_stop_after_write_ms = touched[Math.floor(touched.length / 2)];

    const daemon = runBench('daemon.mjs', '--root', root, '--port', '47831', '--code', REPO, '--repeats', '2').at(-1);
    numbers.a3_recall_p95_ms = worst((daemon?.recall_idle ?? []).map((r) => r.p95));
    numbers.a3_recall_after_save_ms = worst((daemon?.write_cycle ?? []).flatMap((w) => [w.recall_at_save_ms, w.recall_after_ms]));
    const timeouts = (daemon?.write_cycle ?? []).map((w) => w.health.timeouts_800ms);
    numbers.a2_health_timeouts = timeouts.length ? timeouts.reduce((a, b) => a + b, 0) : undefined;

    const write = runBench('write.mjs', '--root', root, '--reps', '1', '--n', '15', '--port', '47832', '--json').find((x) => x.label === 'now');
    numbers.a4_new_note_p50_ms = write?.new_p50;
    numbers.a5_commit_block_p50_ms = runBench('git.mjs', '--root', root, '--rounds', '10', '--delay', '50', '--json').at(-1)?.queue_block?.p50;

    const bus = runBench('bus.mjs', '--seats', '50', '--messages', '100000', '--repeats', '1', '--json').at(-1);
    numbers.a6_roster_ms = bus?.roster_ms; numbers.a6_tasks_ms = bus?.tasks_ms; numbers.a6_send_ms = bus?.send_ms;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  process.exit(report(numbers) ? 0 : 1);
};

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
