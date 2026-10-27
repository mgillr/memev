// SPDX-License-Identifier: Apache-2.0
// `memev bus …`: the comms bus from a terminal. On the vault's computer you are the operator; on a
// computer that joined another vault, commands go there, signed with this computer's key.
import { api, clientToken, out } from './common.mjs';
import { ensureDaemon } from './daemon.mjs';
import { isVault } from '../engine/vault.mjs';

const USAGE = `memev bus roster | check [--to SEAT] [--timeout S] | send TO TYPE TEXT [--ref ID] [--release]
          | tail [--n N] [--type T] | since SEQ | tasks [--open] | unread [SEAT] | watch SEAT [--interval S]
          | operator [SEAT]`;

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

export async function command(cmd, pos, flags, { root, env }) {
  const sub = pos[0] || 'roster';
  const call = await caller(root, env);
  const json = (o) => console.log(JSON.stringify(o, null, 2));
  if (sub === 'roster') {
    const r = await call('bus_roster', {});
    if (flags.json) { json(r); return 0; }
    console.log(`Operator: ${r.operator || 'not set (memev bus operator <seat>)'} · live means a heartbeat in the last ${r.live_minutes} min`);
    for (const s of r.seats) console.log(`  ${(s.seat || '(no app yet)').padEnd(28)} ${s.state.padEnd(12)} ${String(s.device_label).padEnd(16)} ${s.last_seen ? `seen ${s.minutes_since} min ago` : 'never seen'}${s.last_message ? ` · last: ${s.last_message.type}` : ''}${s.claims.length ? ` · claims ${s.claims.join(', ')}` : ''}${s.hold ? ' · ON HOLD' : ''}`);
    return 0;
  }
  if (sub === 'check') {
    const r = await call('bus_check', { to: flags.to || 'all', timeout_s: Number(flags.timeout ?? 20) });
    if (flags.json) { json(r); return 0; }
    console.log(`Comms check ${r.check}: ${r.answered.length} answered, ${r.missing.length} did not (waited ${Math.round(r.waited_ms / 1000)} s)`);
    for (const a of r.answered) out.ok(`${a.seat} (${a.after_ms} ms)`);
    for (const m of r.missing) out.bad(`${m.seat || `computer ${m.device}`}: ${m.reason}`);
    return r.missing.some((m) => m.state === 'live') ? 1 : 0;
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
  if (sub === 'operator') {
    if (!call.route) throw new Error('only the vault\'s own computer can choose the operator seat');
    if (pos[1] === undefined) { const r = await call('bus_roster', {}); console.log(r.operator || 'not set'); return 0; }
    const r = await call.route('/v1/bus-operator', { seat: pos[1] === 'none' ? null : pos[1] });
    if (!r.ok) throw new Error(r.json?.error_description || r.text);
    out.ok(r.json.operator ? `${r.json.operator} now speaks for you on the bus` : 'no operator seat; only this terminal speaks for you'); return 0;
  }
  throw new Error(USAGE);
}
