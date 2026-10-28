// SPDX-License-Identifier: Apache-2.0
// `memev runner`: an opt-in background runner per seat. While it runs, every task the operator
// posts to the seat starts a headless turn of the seat's app, counted against the seat's daily
// limit. Off by default, and there is no default limit: the person gives one with
// --max-runs-per-day, and without it the runner refuses to start.
// The state is machine-local in .memev/runner.json (gitignored), one entry per seat.
// The cursor is per device (each computer's own counter), because the global number a message
// gets changes when another computer's log syncs in; the ids of the tasks already run are kept,
// so a task is never run twice. Only a task from the current operator seat (or the terminal) on
// that seat's own device or the host starts a run, so a log line that arrives by sync cannot.
// One watch per seat: a pid file in .memev keeps a second watch for the same seat out.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isVault } from '../engine/vault.mjs';
import { readJson, writeJson } from '../engine/util.mjs';
import { OPERATOR } from '../engine/bus.mjs';

export const HEADLESS = { 'claude-code': 'claude -p', codex: 'codex exec', 'gemini-cli': 'gemini' };
const limitHint = (seat) => `the runner needs a limit: memev runner on ${seat} --max-runs-per-day N`;

export const runnerFile = (root) => path.join(root, '.memev', 'runner.json');
export const pidFile = (root, seat) => path.join(root, '.memev', `runner-${seat}.pid`);
export function loadRunner(root) {
  return readJson(runnerFile(root), {}) || {};
}
export function saveRunner(root, state) {
  writeJson(runnerFile(root), state);
}
export const entry = (root, seat) => loadRunner(root)[seat] || null;

/** The per-device cursor for a bus: each device's highest counter so far. */
export function cursors(bus) {
  const out = {};
  for (const m of bus.all()) out[m.device] = Math.max(out[m.device] || 0, m.dseq);
  return out;
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * One watch per seat: the pid file is taken when a watch starts and dropped when it ends. A
 * stale file (its pid is gone) is replaced; a live one is not.
 */
export function takePidLock(root, seat, pid = process.pid) {
  const f = pidFile(root, seat);
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, String(pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const old = Number(fs.readFileSync(f, 'utf8').trim());
    if (old === pid) return true;
    if (old && pidAlive(old)) throw new Error(`a runner is already watching ${seat} (pid ${old}); stop it first`);
    fs.writeFileSync(f, String(pid));
    return true;
  }
}
export function releasePidLock(root, seat, pid = process.pid) {
  const f = pidFile(root, seat);
  try {
    if (Number(fs.readFileSync(f, 'utf8').trim()) === pid) fs.rmSync(f, { force: true });
  } catch {}
}

/** The headless command for an app, when it has one, or the command the person gave. */
export function commandFor(client, explicit = null) {
  if (explicit) return String(explicit).trim();
  return HEADLESS[String(client || '').trim().toLowerCase()] || null;
}

/** The runs recorded since the start of the day (UTC). */
export function runsToday(e, now = new Date()) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (e?.runs || []).filter((ts) => Date.parse(ts) >= day);
}

/**
 * Whether a message starts a run for this seat: a task from the operator, for this seat (by its
 * current name or an earlier one) or for everyone, while the day's limit has room left. names is
 * the seat's names and fromOk checks that the message really comes from the operator on a device
 * the operator can write (see sweep).
 */
export function shouldRun(e, m, seat, now = new Date(), names = null, fromOk = () => false) {
  if (!e || !e.enabled) return { ok: false, reason: 'the runner is off' };
  if (m?.type !== 'task') return { ok: false, reason: 'not a task' };
  if (!m.operator || !fromOk(m)) return { ok: false, reason: 'not from the operator' };
  const ns = names || [seat];
  if (m.to !== 'all' && !ns.includes(m.to)) return { ok: false, reason: `for ${m.to}` };
  if (runsToday(e, now).length >= Number(e.max_runs_per_day)) return { ok: false, reason: "the day's limit is reached" };
  return { ok: true, reason: null };
}

export function recordRun(e, ts) {
  return { ...e, runs: [...(e?.runs || []), ts].slice(-1000) };
}

/**
 * Start one headless turn: the seat's command, with the task body as its prompt on stdin, so a
 * body that starts with a dash is read as the prompt, not as an option.
 */
export function runTurn({ cmd, body, cwd, env = process.env } = {}) {
  const parts = String(cmd).split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    const p = spawn(parts[0], parts.slice(1), { cwd, env, stdio: ['pipe', 'ignore', 'ignore'] });
    p.stdin.on('error', () => {});
    p.stdin.write(String(body));
    p.stdin.end();
    p.on('error', (e) => resolve({ code: null, error: e.code || String(e) }));
    p.on('close', (code) => resolve({ code }));
  });
}

/**
 * The per-device cursor from a saved entry. An older entry holds one global number (the number
 * of the last message it saw); under the current order that becomes per-device counters.
 */
function cursorFor(e, bus) {
  if (e.seen && typeof e.seen === 'object' && !Array.isArray(e.seen)) return { ...e.seen };
  const n = Number(e.seen || 0);
  const out = {};
  if (n > 0) for (const m of bus.all()) if (m.seq <= n) out[m.device] = Math.max(out[m.device] || 0, m.dseq);
  return out;
}

/**
 * One pass over the bus: every new message either starts a headless turn (an operator task while
 * the day's limit has room) or is skipped. The cursor is per device and the ids of the tasks
 * already run are kept, so a task is never run twice even when another computer's log syncs in
 * and the messages' global numbers move. Only a task from the current operator seat (or the
 * terminal) on that seat's own device or the host starts a run. The run is counted before the
 * turn starts, so a slow turn still holds its place in the day. Returns what it started and
 * skipped.
 */
export async function sweep({ root, bus, seat, run = runTurn, log = () => {} } = {}) {
  const e0 = entry(root, seat);
  if (!e0) throw new Error(`no runner for ${seat}: memev runner on ${seat} --max-runs-per-day N`);
  if (!e0.enabled) throw new Error(`the runner for ${seat} is off: memev runner on ${seat} --max-runs-per-day N`);
  if (!Number.isInteger(e0.max_runs_per_day) || e0.max_runs_per_day < 1) throw new Error(limitHint(seat));
  if (!e0.cmd) throw new Error(`no headless command for ${seat}: memev runner on ${seat} --max-runs-per-day N --command "..."`);
  const rec = bus.seat(seat);
  const names = rec ? [rec.seat, ...(rec.renamed_from || [])] : [seat];
  const opSeat = bus.operator();
  const opRec = opSeat ? bus.seat(opSeat) : null;
  const fromOk = (m) =>
    (m.from === OPERATOR || (opSeat && m.from === opSeat)) &&
    (m.device === bus.devices.hostId || (opRec && m.device === opRec.device));
  const seen = cursorFor(e0, bus);
  const ran = new Set(e0.ran || []);
  const started = [];
  const skipped = [];
  for (const m of bus.all()) {
    if ((seen[m.device] || 0) >= m.dseq) continue;
    seen[m.device] = Math.max(seen[m.device] || 0, m.dseq);
    if (ran.has(m.id)) continue;
    const d = shouldRun(entry(root, seat), m, seat, new Date(), names, fromOk);
    if (d.ok) {
      ran.add(m.id);
      const s = loadRunner(root);
      s[seat] = recordRun(s[seat], new Date().toISOString());
      s[seat].ran = [...new Set([...(s[seat].ran || []), ...ran])].slice(-1000);
      s[seat].seen = { ...(s[seat].seen || {}), ...seen };
      saveRunner(root, s);
      started.push(m.id);
      log(`run ${m.id}`);
      await run({ cmd: entry(root, seat).cmd, body: m.body, cwd: root });
    } else {
      skipped.push({ id: m.id, reason: d.reason });
      log(`skip ${m.id}: ${d.reason}`);
    }
  }
  const s = loadRunner(root);
  s[seat].seen = { ...(s[seat].seen || {}), ...seen };
  saveRunner(root, s);
  return { started, skipped };
}

/**
 * The watch loop: one per seat (a pid file in .memev keeps a second one out); sweep the bus
 * every pollMs until stop() is true.
 */
export async function watch({ root, seat, pollMs = 250, stop = () => false, run = runTurn, log = () => {} } = {}) {
  takePidLock(root, seat);
  let v = null;
  try {
    const { Vault } = await import('../engine/vault.mjs');
    v = new Vault(root, { git: false }).open();
    const rec = v.bus.seat(seat);
    if (!rec) throw new Error(`no seat ${seat}; memev bus roster lists them`);
    const e = entry(root, seat);
    if (!e) throw new Error(`no runner for ${seat}: memev runner on ${seat} --max-runs-per-day N`);
    if (!e.enabled) throw new Error(`the runner for ${seat} is off: memev runner on ${seat} --max-runs-per-day N`);
    if (!Number.isInteger(e.max_runs_per_day) || e.max_runs_per_day < 1) throw new Error(limitHint(seat));
    if (!e.cmd) throw new Error(`no headless command for ${seat}: memev runner on ${seat} --max-runs-per-day N --command "..."`);
    while (!stop()) {
      await sweep({ root, bus: v.bus, seat, run, log });
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } finally {
    if (v) v.close();
    releasePidLock(root, seat);
  }
}

export async function command(cmd, pos, flags, { root, env }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const sub = pos[0] || 'status';
  const seat = pos[1];
  const { Vault } = await import('../engine/vault.mjs');
  const v = new Vault(root, { git: false }).open();
  try {
    if (sub === 'on') {
      if (!seat) throw new Error('memev runner on <seat> --max-runs-per-day N');
      const rec = v.bus.seat(seat);
      if (!rec) throw new Error(`no seat ${seat}; memev bus roster lists them`);
      if (flags['max-runs-per-day'] === undefined) throw new Error(limitHint(seat));
      const n = Number(flags['max-runs-per-day']);
      if (!Number.isInteger(n) || n < 1) throw new Error('--max-runs-per-day is a whole number of 1 or more');
      const turn = commandFor(rec.client, flags.command);
      if (!turn) throw new Error(`no headless command is known for ${rec.client}: pass --command "cmd"`);
      const s = loadRunner(root);
      s[seat] = {
        enabled: true,
        max_runs_per_day: n,
        cmd: turn,
        runs: s[seat]?.runs || [],
        ran: s[seat]?.ran || [],
        seen: cursors(v.bus),
      };
      saveRunner(root, s);
      console.log(`Runner for ${seat}: on, at most ${n} run(s) a day, each a headless turn of ${turn}.`);
      console.log(`It starts when the operator posts a task to ${seat}. memev runner watch ${seat} runs it; memev runner off ${seat} stops it.`);
      return 0;
    }
    if (sub === 'off') {
      if (!seat) throw new Error('memev runner off <seat>');
      const s = loadRunner(root);
      if (!s[seat]) throw new Error(`no runner for ${seat}`);
      s[seat] = { ...s[seat], enabled: false };
      saveRunner(root, s);
      console.log(`Runner for ${seat}: off.`);
      return 0;
    }
    if (sub === 'watch') {
      if (!seat) throw new Error('memev runner watch <seat>');
      let stop = false;
      const onSig = () => { stop = true; };
      process.once('SIGINT', onSig);
      process.once('SIGTERM', onSig);
      try {
        console.log(`Watching the bus for operator tasks for ${seat}; each starts a headless turn until the day's limit.`);
        await watch({ root, seat, stop: () => stop });
      } finally {
        process.removeListener('SIGINT', onSig);
        process.removeListener('SIGTERM', onSig);
      }
      return 0;
    }
    const s = loadRunner(root);
    const rows = Object.entries(s).map(([st, e]) => ({
      seat: st,
      enabled: !!e.enabled,
      max_runs_per_day: e.max_runs_per_day ?? null,
      cmd: e.cmd || null,
      today: runsToday(e).length,
    }));
    if (flags.json) {
      console.log(JSON.stringify(rows, null, 2));
      return 0;
    }
    if (!rows.length) {
      console.log('No runner is on. Turn one on with: memev runner on <seat> --max-runs-per-day N');
      return 0;
    }
    for (const r of rows) console.log(`${r.seat}: ${r.enabled ? 'on' : 'off'}, ${r.today}/${r.max_runs_per_day} run(s) today, ${r.cmd}`);
    return 0;
  } finally {
    v.close();
  }
}
