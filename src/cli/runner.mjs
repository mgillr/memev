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
// a sub-seat's '/' becomes '+', as the bus names its own files (fileOf), so runner-my-app@pc+2.pid sits beside the others;
// '@' is kept, so the pid file of a seat that already ran keeps its name
export const pidFile = (root, seat) => path.join(root, '.memev', `runner-${String(seat).replace(/\//g, '+')}.pid`);
export function loadRunner(root) {
  return readJson(runnerFile(root), {}) || {};
}
export function saveRunner(root, state) {
  writeJson(runnerFile(root), state);
}
export const entry = (root, seat) => loadRunner(root)[seat] || null;

/** The per-device cursor for a bus: each device's highest counter so far. */
export function cursors(bus) {
  return bus.counters();
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

/** Runs per day for the last `days` days, oldest first, from the kept run times (the last 1,000). UTC days. */
export function runsByDay(e, days = 7, now = new Date()) {
  const n = Math.max(1, Math.min(90, Math.floor(Number(days)) || 7));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10);
    out.push({ day: d, runs: (e?.runs || []).filter((ts) => String(ts).slice(0, 10) === d).length });
  }
  return out;
}

export function recordRun(e, ts) {
  return { ...e, runs: [...(e?.runs || []), ts].slice(-1000) };
}

/**
 * Start one headless turn: the seat's command, with the task body as its prompt on stdin, so a
 * body that starts with a dash is read as the prompt, not as an option.
 */
export function runTurn({ cmd, body, cwd, seat = null, env = process.env } = {}) {
  const parts = String(cmd).split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    // MEMEV_SEAT pins the turn's session to the runner's seat, so its hooks and its bus calls post as that seat
    const p = spawn(parts[0], parts.slice(1), { cwd, env: seat ? { ...env, MEMEV_SEAT: seat } : env, stdio: ['pipe', 'ignore', 'ignore'] });
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
  for (const m of bus.pastCounters(seen)) {
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
      await run({ cmd: entry(root, seat).cmd, body: m.body, cwd: root, seat: names[0] });
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

/**
 * The sub-seats for --agents N: my-app@my-laptop/2, /3 ... in order, each one this app's runner already holds, or one no
 * live session holds (by the roster's live rule), so N background agents never share a seat with a session in use.
 */
export function agentSeats(bus, app, n, state = {}) {
  const device = bus.devices.get(bus.devices.hostId);
  const base = bus.ownSeatName(app, device);
  const out = [];
  for (let i = 2; i < 100 && out.length < n; i++) {
    const name = `${base}/${i}`; const r = bus.seat(name);
    if (state[name]) { out.push(name); continue; }
    if (!r) { out.push(name); continue; }
    if (r.removed || r.device !== device.id || r.client !== app) continue;
    if (!bus._liveNow(r, bus._pulse(r.seat))) out.push(r.seat);
  }
  if (out.length < n) throw new Error(`only ${out.length} free sub-seat(s) for ${app}`);
  return out.map((name) => bus.seat(name) || bus.register({ client: app, device, seat: name }));
}
/** The runner seats of one app (an app id rather than a seat): every seat in the runner state whose app it is. */
const seatsOfApp = (bus, state, app) => Object.keys(state).filter((n) => bus.seat(n)?.client === app);

export async function command(cmd, pos, flags, { root, env }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const sub = pos[0] || 'status';
  const seat = pos[1];
  const { Vault } = await import('../engine/vault.mjs');
  const v = new Vault(root, { git: false }).open();
  try {
    if (sub === 'on') {
      if (!seat) throw new Error('memev runner on <seat> --max-runs-per-day N');
      if (flags['max-runs-per-day'] === undefined) throw new Error(limitHint(seat));
      const n = Number(flags['max-runs-per-day']);
      if (!Number.isInteger(n) || n < 1) throw new Error('--max-runs-per-day is a whole number of 1 or more');
      let recs;
      if (flags.agents !== undefined) {
        // N background agents of one app: memev runner on my-app --agents 3 takes the sub-seats /2, /3, /4
        const k = Number(flags.agents);
        if (!Number.isInteger(k) || k < 1 || k > 20) throw new Error('--agents is a whole number from 1 to 20');
        if (seat.includes('@')) throw new Error(`--agents takes an app, not a seat: memev runner on ${seat.split('@')[0]} --agents ${k} --max-runs-per-day ${n}`);
        recs = agentSeats(v.bus, seat, k, loadRunner(root));
      } else {
        let rec = v.bus.seat(seat);
        // a sub-seat of a seat on this computer is made when a runner is turned on for it
        const parent = !rec && seat.includes('/') ? v.bus.seat(seat.split('/')[0]) : null;
        if (parent && !parent.removed && parent.device === v.devices.hostId) rec = v.bus.register({ client: parent.client, device: v.devices.get(parent.device), seat });
        if (!rec) throw new Error(`no seat ${seat}; memev bus roster lists them`);
        recs = [rec];
      }
      const s = loadRunner(root);
      for (const rec of recs) {
        const turn = commandFor(rec.client, flags.command);
        if (!turn) throw new Error(`no headless command is known for ${rec.client}: pass --command "cmd"`);
        const name = rec.seat;
        s[name] = { enabled: true, max_runs_per_day: n, cmd: turn, runs: s[name]?.runs || [], ran: s[name]?.ran || [], seen: cursors(v.bus) };
        console.log(`Runner for ${name}: on, at most ${n} run(s) a day, each a headless turn of ${turn}.`);
      }
      saveRunner(root, s);
      const what = recs.length > 1 ? seat : recs[0].seat;
      console.log(`It starts when the operator posts a task to ${recs.map((r) => r.seat).join(', ')}. memev runner watch ${what} runs it; memev runner off ${what} stops it.`);
      return 0;
    }
    if (sub === 'off') {
      if (!seat) throw new Error('memev runner off <seat>');
      const s = loadRunner(root);
      const list = s[seat] ? [seat] : seat.includes('@') ? [] : seatsOfApp(v.bus, s, seat);
      if (!list.length) throw new Error(`no runner for ${seat}`);
      for (const n of list) { s[n] = { ...s[n], enabled: false }; console.log(`Runner for ${n}: off.`); }
      saveRunner(root, s);
      return 0;
    }
    if (sub === 'watch') {
      if (!seat) throw new Error('memev runner watch <seat>');
      let stop = false;
      const onSig = () => { stop = true; };
      process.once('SIGINT', onSig);
      process.once('SIGTERM', onSig);
      try {
        // an app rather than a seat watches every runner seat of that app at once, each with its own pid file and state
        const s = loadRunner(root);
        const list = s[seat] || seat.includes('@') ? [seat] : seatsOfApp(v.bus, s, seat).filter((n) => s[n].enabled);
        if (!list.length) throw new Error(`no runner is on for ${seat}: memev runner on ${seat} --agents N --max-runs-per-day N`);
        console.log(`Watching the bus for operator tasks for ${list.join(', ')}; each starts a headless turn until the day's limit.`);
        const done = await Promise.allSettled(list.map((n) => watch({ root, seat: n, stop: () => stop })));
        const failed = done.find((d) => d.status === 'rejected'); if (failed) throw failed.reason;
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
      ...(flags.days ? { by_day: runsByDay(e, Number(flags.days)) } : {}),
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
