// SPDX-License-Identifier: Apache-2.0
// `memev bus …`: the comms bus from a terminal. On the vault's computer you are the operator; on a
// computer that joined another vault, commands go there, signed with this computer's key.
import { api, clientToken, out } from './common.mjs';
import { ensureDaemon } from './daemon.mjs';
import { isVault } from '../engine/vault.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../engine/git.mjs';
import { commsCheckView, commsCredentialFailure, fileOf, hasRead, label } from '../engine/bus.mjs';
import { readJson } from '../engine/util.mjs';

// ---- setting the bus up: init, connect and the doctor share this
// Every app that is found gets a seat at once. The lead (operator) seat is always the person's
// choice: asked on a terminal, given with --lead or MEMEV_LEAD, or left for later. Never automatic.
const RUNNING = [
  ['claude-code', (e) => e.CLAUDECODE === '1' || !!e.CLAUDE_CODE_ENTRYPOINT],
  ['cursor', (e) => !!e.CURSOR_TRACE_ID || !!e.CURSOR_AGENT || /cursor/i.test(e.TERM_PROGRAM || '')],
  ['codex', (e) => !!e.CODEX_SANDBOX || !!e.CODEX_MANAGED_BY_NPM],
  ['gemini-cli', (e) => e.GEMINI_CLI === '1'],
  ['windsurf', (e) => /windsurf/i.test(e.TERM_PROGRAM || '')],
  ['zed', (e) => !!e.ZED_TERM || e.TERM_PROGRAM === 'zed'],
  ['vscode', (e) => e.TERM_PROGRAM === 'vscode'],
];
/** The AI app this command runs inside, when its environment gives it away. */
export function runningApp(env = process.env) { return RUNNING.find(([, t]) => t(env))?.[0] || null; }
/** The seats to offer as lead: the app running the setup first, then the rest, then decide later. */
export function leadChoices(seats, env = process.env) {
  const run = runningApp(env); const mine = run ? seats.find((s) => s.split('@')[0] === label(run)) || null : null;
  const list = [...seats].sort((a, b) => (a === mine ? -1 : b === mine ? 1 : 0));
  return [...list.map((seat) => ({ seat, label: seat === mine ? `${seat} (running this setup)` : seat })), { seat: null, label: 'decide later' }];
}
export const LEAD_LATER = 'no lead AI chosen yet: pick the AI that leads and coordinates the others with memev bus operator <seat> (memev bus roster lists the seats), or tell any connected AI which one should lead';
/** Ask on a terminal: "Which AI should lead and coordinate the others?" Returns a seat or null. */
export async function askLead({ seats, env = process.env, input = process.stdin, output = process.stdout }) {
  const choices = leadChoices(seats, env);
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input, output, terminal: false });
  try {
    output.write('\nWhich AI should lead and coordinate the others?\n');
    choices.forEach((c, i) => output.write(`  ${i + 1}) ${c.label}\n`));
    for (let tries = 0; tries < 3; tries++) {
      const a = (await rl.question(`Choose 1-${choices.length}: `)).trim().toLowerCase();
      const n = Number(a);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].seat;
      const hit = choices.find((c) => c.seat && (c.seat === a || c.seat.split('@')[0] === a));
      if (hit) return hit.seat;
      if (/^(later|decide later|none|skip)$/.test(a)) return null;
      output.write('  not one of the choices\n');
    }
    return null;
  } finally { rl.close(); }
}
/** What is wrong with bus/ on disk and in git, for these seats. Empty when all is well. */
export function verifyBus(root, seats = []) {
  const problems = [];
  const rel = ['bus/config.json', 'bus/operator.json', ...seats.map((s) => `bus/seats/${fileOf(s)}.json`)];
  for (const f of rel) if (!fs.existsSync(path.join(root, f))) problems.push(`${f} is missing`);
  if (problems.length) return problems;
  const tracked = new Set(git(root, ['ls-files', '--', 'bus']).out.split('\n').filter(Boolean));
  const dirty = git(root, ['status', '--porcelain', '--', ...rel]).out;
  for (const f of rel) if (!tracked.has(f)) problems.push(`${f} is not committed`);
  if (!problems.length && dirty) problems.push(`bus/ has uncommitted changes: ${dirty.split('\n').length} file(s)`);
  return problems;
}
/**
 * Give every app in clients a seat on this vault and commit bus/; then settle the lead: --lead or
 * MEMEV_LEAD, else a question on a terminal, else nothing (the person picks one later).
 */
export async function setupBus({ root, env = process.env, clients = [], flags = {}, ask = null, input, output }) {
  const { api, clientToken } = await import('./common.mjs');
  if (!(await ensureDaemon(root, { quiet: true }))) return { ok: false, seats: [], operator: null, problems: ['Memev is not running (memev doctor)'] };
  const token = clientToken(root, 'cli');
  const want = String(flags.lead || env.MEMEV_LEAD || '').trim() || null;
  const r = await api(root, '/v1/bus-register', { body: { clients }, token, timeoutMs: 8000 });
  if (!r.ok) return { ok: false, seats: [], operator: null, problems: [`the vault answered ${r.status}`] };
  const seats = r.json.seats; let operator = r.json.operator; const notes = [];
  const setLead = async (seat, by) => { const o = await api(root, '/v1/bus-operator', { body: { seat, by }, token, timeoutMs: 8000 }); if (!o.ok) throw new Error(o.json?.error_description || o.text); return o.json.operator; };
  if (want && want !== 'later') {
    try { operator = await setLead(want, flags.lead ? 'the user (--lead)' : 'the user (MEMEV_LEAD)'); } catch (e) { notes.push(`--lead ${want}: ${e.message}`); }
  } else if (!operator && !want && seats.length && (ask ?? (!!process.stdin.isTTY && !!process.stdout.isTTY))) {
    const pick = await askLead({ seats, env, input, output });
    if (pick) operator = await setLead(pick, 'the user (asked at setup)');
  }
  const problems = verifyBus(root, seats);
  return { ok: !problems.length, seats, operator, problems, notes };
}

const USAGE = `memev bus roster [--card] | check [--to SEAT] [--timeout S] | send TO TYPE TEXT [--ref ID] [--release]
          | tail [--n N] [--type T] | since SEQ | tasks [--open] | unread [SEAT] | watch SEAT [--interval S]
          | hello SEAT [--timeout S] | operator [SEAT] | rename OLD NEW`;

async function caller(root, env) {
  if (!isVault(root)) {
    const { loadRemote, remoteFetch } = await import('./remote.mjs');
    const remote = loadRemote(env);
    if (!remote) throw new Error(`no vault at ${root} and this computer has not joined one (memev join)`);
    return async (name, args) => { const r = await remoteFetch(remote, 'mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, env, headers: { 'x-memev-client': 'memev-cli' }, timeoutMs: 40000 }); return unwrap(r.json, r); };
  }
  if (!(await ensureDaemon(root, { quiet: true }))) throw new Error('the daemon is not running (memev start)');
  const token = clientToken(root, 'cli');
  const call = async (name, args) => { const r = await api(root, '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token, timeoutMs: 40000 }); return unwrap(r.json, r); };
  call.route = (route, body) => api(root, route, { body, token, timeoutMs: 5000 });
  return call;
}
function unwrap(j, r) {
  if (!j?.result) throw new Error(j?.error?.message || j?.error_description || `the vault answered ${r.status}`);
  if (j.result.isError) throw new Error(j.result.content?.[0]?.text || 'refused');
  return j.result.structuredContent?.result ?? j.result.structuredContent;
}
const line = (m) => `#${m.seq} ${m.ts.slice(11, 19)} ${m.type.padEnd(8)} ${m.from}${m.operator ? ' [operator]' : ''} → ${m.to}${m.ref ? ` re ${m.ref}` : ''}  ${m.body}`;
/** A short, shareable summary of the team: the apps and the seat count. No paths, tokens, names or machine names. */
export function rosterCard(r) {
  const rows = (r.seats || []).filter((s) => s.seat);
  const n = rows.length;
  if (!n) return 'My Memev AI team\nno seats yet';
  const apps = [...new Set(rows.map((s) => s.client).filter(Boolean))];
  return `My Memev AI team\n${n} seat${n === 1 ? '' : 's'}: ${apps.join(', ')}`;
}

export async function command(cmd, pos, flags, { root, env }) {
  const sub = pos[0] || 'roster';
  const call = await caller(root, env);
  const json = (o) => console.log(JSON.stringify(o, null, 2));
  if (sub === 'roster') {
    const r = await call('bus_roster', {});
    if (flags.card) { console.log(rosterCard(r)); return 0; }
    if (flags.json) { json(r); return 0; }
    console.log(`Lead (operator): ${r.operator || 'not chosen yet; pick one with memev bus operator <seat>'} · live means a heartbeat in the last ${r.live_minutes} min`);
    for (const s of r.seats) console.log(`  ${(s.seat || '(no app yet)').padEnd(28)} ${s.state.padEnd(12)} ${String(s.device_label).padEnd(16)} ${s.last_seen ? `seen ${s.minutes_since} min ago` : 'never seen'}${s.last_message ? ` · last: ${s.last_message.type}` : ''}${s.claims.length ? ` · claims ${s.claims.join(', ')}` : ''}${s.hold ? ' · ON HOLD' : ''}${s.operator ? ' · LEAD' : ''}`);
    return 0;
  }
  if (sub === 'check') {
    let r;
    try { r = await call('bus_check', { to: flags.to || 'all', timeout_s: Number(flags.timeout ?? 20) }); }
    catch (e) {
      const fail = commsCredentialFailure(e);
      if (!fail) throw e;
      for (const l of fail.lines) console.log(l);
      return fail.code;
    }
    if (flags.json) { json(r); return 0; }
    const view = commsCheckView(r);
    for (const l of view.lines) console.log(l);
    return view.code;
  }
  if (sub === 'send') {
    const [, to, type, ...text] = pos;
    if (!to || !type) throw new Error(USAGE);
    const m = await call('bus_send', { to, type, body: text.join(' '), ref: flags.ref, release: !!flags.release });
    out.ok(`sent #${m.seq} (id ${m.id})`); return 0;
  }
  if (sub === 'tail' || sub === 'since') {
    const r = sub === 'tail' ? await call('bus_tail', { n: Number(flags.n || 20), type: flags.type }) : await call('bus_since', { seq: Number(pos[1] || 0), limit: Number(flags.n || 50) });
    if (flags.json) json(r.messages); else for (const m of r.messages) console.log(line(m));
    return 0;
  }
  if (sub === 'tasks') {
    const r = await call('bus_tasks', { open: !!flags.open });
    if (flags.json) { json(r.tasks); return 0; }
    for (const t of r.tasks) console.log(`  ${t.id.padEnd(14)} ${t.state.padEnd(8)} → ${t.to.padEnd(22)} ${t.claimed_by ? `claimed by ${t.claimed_by}` : 'unclaimed'}${t.operator ? '' : ' (agent request)'}  ${t.body.slice(0, 80)}`);
    return 0;
  }
  if (sub === 'unread') { const r = await call('bus_unread', { seat: pos[1] }); if (flags.json) json(r); else { if (r.hold) out.warn(`on hold: ${r.hold.reason}`); for (const m of r.messages) console.log(line(m)); } return 0; }
  if (sub === 'watch') {
    const seat = pos[1]; if (!seat) throw new Error('memev bus watch <seat>  (memev bus roster lists them)');
    const every = Math.max(2, Number(flags.interval || 5)) * 1000;
    out.info(`watching the bus as ${seat}; a heartbeat every ${every / 1000} s; Ctrl-C to stop`);
    for (;;) {
      try { const r = await call('bus_unread', { seat }); for (const m of r.messages) console.log(line(m)); if (r.hold) out.warn(`on hold since ${r.hold.since}: ${r.hold.reason}`); if (flags.once) return 0; }
      catch (e) { out.bad(e.message); if (flags.once) return 1; }
      await new Promise((r) => setTimeout(r, every));
    }
  }
  if (sub === 'hello') {
    // A guided test of the link: post one hello to the seat, then wait for the seat to read it on
    // its next turn (apps check the bus at the start of every turn) and say so.
    let seat = pos[1];
    if (!seat) throw new Error('memev bus hello <seat> [--timeout S]  (memev bus roster lists the seats)');
    if (seat === 'all') throw new Error('memev bus hello is to one seat, not all; pass the seat name (memev bus roster lists them, or use the operator alias)');
    // The operator alias is a natural way to test the lead: resolve it to the lead's real seat so
    // the read check watches the seat that actually reads the hello.
    if (seat === 'operator') {
      const r = await call('bus_roster', {});
      if (!r.operator) throw new Error('no operator seat is set yet; pick the lead with memev bus operator <seat> (memev bus roster lists the seats), then run memev bus hello again');
      seat = r.operator;
      out.info(`the operator is ${seat}; sending the hello there`);
    }
    const timeoutS = Math.max(1, Math.min(300, Number(flags.timeout) || 60));
    const m = await call('bus_send', { to: seat, type: 'hello', body: 'hello from the terminal: a guided test of the bus. If you are reading this, the terminal reached your app.' });
    out.ok(`sent #${m.seq} to ${seat}`);
    out.info(`what to do in the app: open ${seat} and start a turn (any message); it checks the bus at the start of every turn and will see the hello there`);
    // On the vault's own computer the pulse file says exactly what the seat has read; from another
    // computer the roster's last heartbeat is the closest signal.
    const isRead = isVault(root)
      ? () => hasRead(readJson(path.join(root, 'bus', 'pulse', `${fileOf(seat)}.json`), null), m)
      : async () => { const r = await call('bus_roster', {}); const row = (r.seats || []).find((s) => s.seat === seat); return !!row?.last_seen && row.last_seen >= m.ts; };
    const start = Date.now();
    for (;;) {
      if (await isRead()) { out.ok(`${seat} read it ${Math.max(1, Math.round((Date.now() - start) / 1000))} s after you sent it`); return 0; }
      if (Date.now() - start >= timeoutS * 1000) { out.bad(`${seat} has not read it yet; it is waiting for its next turn (open the app and start a turn, then run memev bus hello ${seat} again)`); return 1; }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (sub === 'operator') {
    if (!call.route) throw new Error('only the vault\'s own computer can choose the operator seat');
    if (pos[1] === undefined) { const r = await call('bus_roster', {}); console.log(r.operator || 'not set'); return 0; }
    const r = await call.route('/v1/bus-operator', { seat: pos[1] === 'none' ? null : pos[1] });
    if (!r.ok) throw new Error(r.json?.error_description || r.text);
    out.ok(r.json.operator ? `${r.json.operator} now speaks for you on the bus` : 'no operator seat; only this terminal speaks for you'); return 0;
  }
  if (sub === 'rename') {
    const oldName = pos[1], newName = pos[2];
    if (!oldName || !newName) throw new Error('memev bus rename <old> <new>  (memev bus roster lists the seats)');
    if (!isVault(root)) throw new Error('only the vault\'s own computer can rename a seat');
    const { DeviceRegistry, hostDevice } = await import('../engine/devices.mjs');
    const { Bus } = await import('../engine/bus.mjs');
    const { CommitQueue } = await import('../engine/git.mjs');
    const host = hostDevice(root);
    const devices = new DeviceRegistry(path.join(root, '.memev', 'devices.json'));
    devices.ensureHost(host);
    const q = new CommitQueue(root, { delayMs: 0 });
    const bus = new Bus({ root, devices, commit: (p) => q.add(p, 'bus') });
    bus.renameSeat(oldName, newName);
    q.flush();
    out.ok(`${oldName} is now ${newName}; its history and read state follow it, and the old name still finds it`);
    return 0;
  }
  throw new Error(USAGE);
}
