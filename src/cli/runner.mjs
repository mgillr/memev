// SPDX-License-Identifier: Apache-2.0
// `memev runner`: an opt-in background runner per seat. While it runs, every task the operator
// posts to the seat starts a headless turn of the seat's app, counted against the seat's daily
// limit. Off by default, and there is no default limit: the person gives one with
// --max-runs-per-day, and without it the runner refuses to start.
// The state is machine-local in .memev/runner.json (gitignored), one entry per seat.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isVault } from '../engine/vault.mjs';
import { readJson, writeJson } from '../engine/util.mjs';

export const HEADLESS = { 'claude-code': 'claude -p', codex: 'codex exec', 'gemini-cli': 'gemini' };
const limitHint = (seat) => `the runner needs a limit: memev runner on ${seat} --max-runs-per-day N`;

export const runnerFile = (root) => path.join(root, '.memev', 'runner.json');
export function loadRunner(root) {
  return readJson(runnerFile(root), {}) || {};
}
export function saveRunner(root, state) {
  writeJson(runnerFile(root), state);
}
export const entry = (root, seat) => loadRunner(root)[seat] || null;

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
 * Whether a message starts a run for this seat: a task from the operator, for this seat or for
 * everyone, while the day's limit has room left.
 */
export function shouldRun(e, m, seat, now = new Date()) {
  if (!e || !e.enabled) return { ok: false, reason: 'the runner is off' };
  if (m?.type !== 'task') return { ok: false, reason: 'not a task' };
  if (!m.operator) return { ok: false, reason: 'not from the operator' };
  if (m.to !== 'all' && m.to !== seat) return { ok: false, reason: `for ${m.to}` };
  if (runsToday(e, now).length >= Number(e.max_runs_per_day)) return { ok: false, reason: "the day's limit is reached" };
  return { ok: true, reason: null };
}

export function recordRun(e, ts) {
  return { ...e, runs: [...(e?.runs || []), ts].slice(-1000) };
}

/** Start one headless turn: the seat's command with the task body as its prompt. */
export function runTurn({ cmd, body, cwd, env = process.env } = {}) {
  const parts = String(cmd).split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    const p = spawn(parts[0], [...parts.slice(1), String(body)], { cwd, env, stdio: 'ignore' });
    p.on('error', (e) => resolve({ code: null, error: e.code || String(e) }));
    p.on('close', (code) => resolve({ code }));
  });
}

/**
 * One pass over the bus: every new message either starts a headless turn (an operator task while
 * the day's limit has room) or is skipped. The run is counted before the turn starts, so a slow
 * turn still holds its place in the day. Returns what it started and skipped.
 */
export async function sweep({ root, bus, seat, run = runTurn, log = () => {} } = {}) {
  const e0 = entry(root, seat);
  if (!e0) throw new Error(`no runner for ${seat}: memev runner on ${seat} --max-runs-per-day N`);
  if (!e0.enabled) throw new Error(`the runner for ${seat} is off: memev runner on ${seat} --max-runs-per-day N`);
  if (!Number.isInteger(e0.max_runs_per_day) || e0.max_runs_per_day < 1) throw new Error(limitHint(seat));
  if (!e0.cmd) throw new Error(`no headless command for ${seat}: memev runner on ${seat} --max-runs-per-day N --command "..."`);
  let seen = Number(e0.seen || 0);
  const started = [];
  const skipped = [];
  for (const m of bus.all().filter((x) => x.seq > seen)) {
    seen = Math.max(seen, m.seq);
    const d = shouldRun(entry(root, seat), m, seat);
    if (d.ok) {
      const s = loadRunner(root);
      s[seat] = recordRun(s[seat], new Date().toISOString());
      s[seat].seen = seen;
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
  s[seat].seen = seen;
  saveRunner(root, s);
  return { started, skipped };
}

/** The watch loop: sweep the bus every pollMs until stop() is true. */
export async function watch({ root, seat, pollMs = 250, stop = () => false, run = runTurn, log = () => {} } = {}) {
  const { Vault } = await import('../engine/vault.mjs');
  const v = new Vault(root, { git: false }).open();
  try {
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
    v.close();
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
        seen: v.bus.all().at(-1)?.seq || 0,
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
