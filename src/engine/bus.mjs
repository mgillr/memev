// SPDX-License-Identifier: Apache-2.0
// The agent comms bus: how the AI apps using one vault talk to each other and to you.
//
// Everything lives in the vault under bus/ and travels with it: through git to your own backup
// repository, and through the secure link to computers that joined. Nothing goes anywhere else.
//   bus/log/<device>.jsonl   messages, one append-only file per computer, so git never conflicts
//   bus/seats/<seat>.json    one seat per AI app (or session) on a computer
//   bus/pulse/<seat>.json    the seat's last heartbeat and what it has read
//   bus/operator.json        which seat speaks for you
// Order is the same on every computer: by time, then device id, then the device's own counter.
// What a seat has read is kept per device counter, so messages that arrive late from a computer
// that was offline are still delivered.
import fs from 'node:fs';
import path from 'node:path';
import { findSecrets } from './secrets.mjs';
import { readJson, writeJson, now } from './util.mjs';
import { allowed } from './tokens.mjs';

export const TYPES = ['hello', 'status', 'task', 'claim', 'restate', 'review', 'verdict', 'question', 'answer', 'finding', 'push', 'ack', 'hold'];
export const BUS_DIR = 'bus';
export const OPERATOR = 'operator';
const MAX_BODY = 4000;
const SEAT_RE = /^[a-z0-9][a-z0-9._-]{0,40}@[a-z0-9][a-z0-9._-]{0,40}(\/[a-z0-9._-]{1,24})?$/;
const PULSE_COMMIT_MS = 5 * 60e3;

export class BusError extends Error { constructor(code, message) { super(message); this.code = code; this.name = 'BusError'; } }

const fileOf = (seat) => seat.replace(/[^a-z0-9._-]/g, (c) => (c === '@' ? '~' : c === '/' ? '+' : '_'));
const label = (s) => String(s || 'computer').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'computer';
const order = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.device < b.device ? -1 : a.device > b.device ? 1 : a.dseq - b.dseq);
const ago = (ts, at) => Math.round((at - Date.parse(ts)) / 60e3);

export class Bus {
  /** root: the vault folder; devices: its DeviceRegistry; commit(path): queue a git commit. */
  constructor({ root, devices, commit = () => {}, config = {} }) {
    this.root = root; this.devices = devices; this.commit = commit;
    this.liveMin = config.live_min ?? 15;
    this.dir = path.join(root, BUS_DIR);
    this._cache = new Map(); this._pulseCommitted = new Map(); this._last = new Map();
  }

  _p(...a) { return path.join(this.dir, ...a); }
  _rel(...a) { return [BUS_DIR, ...a].join('/'); }

  // ---- seats
  /** The seat name for an app on a device: claude-code@host, cursor@laptop, chatgpt@cloud. */
  seatName(client, device) {
    if (!device || device.kind === 'host' || device.kind === 'local-client') return `${label(client)}@host`;
    if (device.kind === 'cloud-connector') return `${label(device.label)}@cloud`;
    return `${label(client)}@${label(device.label)}`;
  }
  seat(name) { return readJson(this._p('seats', `${fileOf(name)}.json`), null); }
  seats() {
    let f; try { f = fs.readdirSync(this._p('seats')); } catch { return []; }
    return f.filter((x) => x.endsWith('.json')).map((x) => readJson(this._p('seats', x), null)).filter((s) => s?.seat).sort((a, b) => a.seat.localeCompare(b.seat));
  }
  /** Give an app a seat (at init, when an app is connected, or on its first call). */
  register({ client, device, project = null, seat = null }) {
    const name = seat || this.seatName(client, device);
    if (!SEAT_RE.test(name)) throw new BusError('bad_request', `not a seat name: ${name}`);
    const cur = this.seat(name);
    if (cur && !cur.removed) return cur;
    const rec = { seat: name, client: label(client), device: device.id, device_kind: device.kind, device_label: device.kind === 'host' ? 'host' : device.label, project: project || null, created: now(), joined: cur?.joined || null, removed: null };
    fs.mkdirSync(this._p('seats'), { recursive: true });
    writeJson(this._p('seats', `${fileOf(name)}.json`), rec); this.commit(this._rel('seats', `${fileOf(name)}.json`));
    return rec;
  }
  operator() { return readJson(this._p('operator.json'), null)?.seat || null; }
  /** Which seat speaks for you. Only the person at the vault sets this (memev bus operator). */
  setOperator(seat) {
    if (seat && !this.seat(seat)) throw new BusError('not_found', `no seat ${seat}; memev bus roster lists them`);
    fs.mkdirSync(this.dir, { recursive: true });
    writeJson(this._p('operator.json'), { seat: seat || null, set: now() }); this.commit(this._rel('operator.json'));
    return seat;
  }

  /**
   * Resolve who is calling. ctx = { identity, client, device, local, cli }. A seat named in the call
   * must belong to the caller's own computer. The vault's terminal (memev bus …) is the operator.
   */
  resolve(ctx, { seat = null, project = null, need = 'read' } = {}) {
    const id = ctx.identity;
    // a token limited to some folders only reaches the bus if bus/ (or bus/<project>/) is one of them
    const legacy = Array.isArray(id?.paths) && id.paths.length === 3 && ['memory/**', 'work/**', 'contracts/**'].every((g) => id.paths.includes(g)); // device tokens from before the bus
    if (!legacy && !allowed(id, need === 'read' ? 'read' : 'write', `${BUS_DIR}/${project || 'all'}/messages.jsonl`)) throw new BusError('forbidden', 'this token cannot use the bus: its folders do not include bus/');
    if (need !== 'read' && id?.read_only) throw new BusError('forbidden', id.read_only);
    if (ctx.cli && ctx.local && !seat) return { seat: OPERATOR, operator: true, device: this.devices.get(this.devices.hostId), project: null };
    const dev = ctx.device || this.devices.get(this.devices.hostId);
    const computer = dev?.kind === 'local-client' ? this.devices.get(this.devices.hostId) : dev;
    if (!computer || computer.status !== 'active') throw new BusError('forbidden', 'this computer was removed from the vault, so it is off the bus');
    const own = this.seatName(ctx.client, computer);
    let name = seat || own;
    if (seat) {
      // the terminal on the vault's computer may act for any seat on that computer (memev bus watch)
      const rec = this.seat(seat);
      const mine = ctx.cli && ctx.local ? (rec ? rec.device === computer.id : seat.endsWith('@host') || seat.includes('@host/')) : rec ? rec.device === computer.id : seat.split('/')[0] === own;
      if (!mine) throw new BusError('forbidden', `${seat} belongs to another app or computer; you can only post as your own seat (${own})`);
    }
    let rec = this.seat(name);
    if (rec?.removed) throw new BusError('forbidden', `${name} was removed from the bus`);
    if (!rec) rec = this.register({ client: ctx.client, device: computer, project, seat: name });
    if (this.devices.get(rec.device)?.status !== 'active') throw new BusError('forbidden', 'this computer was removed from the vault, so it is off the bus');
    return { seat: name, operator: this.operator() === name, device: computer, project: rec.project, rec };
  }

  // ---- messages
  _logFiles() { let f; try { f = fs.readdirSync(this._p('log')); } catch { return []; } return f.filter((x) => x.endsWith('.jsonl')); }
  _readLog(file) {
    const full = this._p('log', file); let st; try { st = fs.statSync(full); } catch { return []; }
    const c = this._cache.get(file);
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.msgs;
    const msgs = []; let bad = 0;
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) { if (!line.trim()) continue; try { const m = JSON.parse(line); if (m?.id && m.device && Number.isInteger(m.dseq)) msgs.push(m); else bad++; } catch { bad++; } }
    this._cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, msgs, bad });
    return msgs;
  }
  /** Every message, in the one order every computer agrees on, numbered from 1. */
  all() {
    const out = []; for (const f of this._logFiles()) out.push(...this._readLog(f));
    out.sort(order);
    return out.map((m, i) => ({ seq: i + 1, ...m }));
  }
  _visible(who, m) {
    if (who.operator || !who.project) return true;
    return !m.project || m.project === who.project;
  }
  _toMe(who, m) { return m.from !== who.seat && (m.to === 'all' || m.to === who.seat || (m.to === OPERATOR && who.operator)); }

  send(ctx, { to = 'all', type, body = '', ref = null, project = null, seat = null, release = false, check = false } = {}) {
    if (!TYPES.includes(type)) throw new BusError('bad_request', `type must be one of: ${TYPES.join(', ')}`);
    body = String(body ?? '');
    if (body.length > MAX_BODY) throw new BusError('too_large', `keep a message under ${MAX_BODY} characters; put long text in a note and send its path`);
    const secrets = findSecrets(body);
    if (secrets.length) throw new BusError('secret', `refused: the message looks like it holds a credential (${secrets.join(', ')}). Never send keys or tokens over the bus`);
    const who = this.resolve(ctx, { seat, project, need: 'write' });
    to = String(to || 'all');
    if (to !== 'all' && to !== OPERATOR && !this.seat(to)) throw new BusError('not_found', `no seat ${to}; bus_roster lists them`);
    const all = this.all();
    if (['claim', 'restate'].includes(type)) {
      const task = all.find((m) => m.id === ref && m.type === 'task');
      if (!task) throw new BusError('bad_request', `${type} needs ref: the id of a task`);
      if (task.to !== 'all' && task.to !== who.seat) throw new BusError('forbidden', `task ${ref} is assigned to ${task.to}`);
      const claim = all.find((m) => m.type === 'claim' && m.ref === ref);
      if (type === 'claim' && claim && claim.from !== who.seat) throw new BusError('conflict', `task ${ref} is already claimed by ${claim.from}`);
      if (type === 'restate' && claim?.from !== who.seat) throw new BusError('bad_request', `claim task ${ref} before restating it`);
    }
    const msg = this._append(who, { to, type, body, ref: ref ? String(ref) : null, project: project || who.project || null, ...(release ? { release: true } : {}), ...(check ? { check: true } : {}) });
    this.pulse(ctx, { who });
    return msg;
  }
  _append(who, fields) {
    const file = `${who.device.id}.jsonl`;
    const mine = this._readLog(file);
    const last = this._last.get(file) || mine.at(-1) || null;
    let ts = now(); if (last && ts <= last.ts) ts = new Date(Date.parse(last.ts) + 1).toISOString();
    const dseq = (last?.dseq || 0) + 1;
    const msg = { id: `${who.device.id.slice(4, 12)}-${dseq}`, dseq, ts, device: who.device.id, from: who.seat, operator: !!who.operator, ...fields };
    fs.mkdirSync(this._p('log'), { recursive: true });
    fs.appendFileSync(this._p('log', file), `${JSON.stringify(msg)}\n`);
    this._last.set(file, msg);
    this.commit(this._rel('log', file));
    return { seq: this.all().find((m) => m.id === msg.id)?.seq ?? null, ...msg };
  }

  since(ctx, { seq = 0, limit = 50, seat = null } = {}) {
    const who = this.resolve(ctx, { seat }); this.pulse(ctx, { who });
    return this.all().filter((m) => m.seq > Number(seq || 0) && this._visible(who, m)).slice(0, Math.min(200, limit));
  }
  tail(ctx, { n = 20, seat = null, type = null } = {}) {
    const who = this.resolve(ctx, { seat });
    return this.all().filter((m) => this._visible(who, m) && (!type || m.type === type)).slice(-Math.min(200, n));
  }
  /** New messages for this seat; marks them read, counts as a heartbeat and answers comms checks. */
  unread(ctx, { seat = null, peek = false } = {}) {
    const who = this.resolve(ctx, { seat });
    const p = this._pulse(who.seat); const read = p.read || {};
    const all = this.all();
    const fresh = all.filter((m) => m.dseq > (read[m.device] || 0) && this._toMe(who, m) && this._visible(who, m));
    if (!peek) for (const m of all) if (this._toMe(who, m) || m.from === who.seat) read[m.device] = Math.max(read[m.device] || 0, m.dseq);
    this.pulse(ctx, { who, read: peek ? null : read });
    const acked = [];
    if (!(who.operator && who.seat === OPERATOR)) {
      for (const m of fresh.filter((x) => x.check)) if (!all.some((a) => a.type === 'ack' && a.ref === m.id && a.from === who.seat)) {
        try { if (!ctx.identity?.read_only) { this._append(who, { to: m.from, type: 'ack', body: 'comms check: here', ref: m.id, project: null }); acked.push(m.id); } } catch {}
      }
    }
    return { seat: who.seat, operator: who.operator, hold: this.holdOn(who.seat, all), messages: fresh, acked };
  }

  // ---- pulse
  _pulse(seat) { return readJson(this._p('pulse', `${fileOf(seat)}.json`), { seat, read: {} }); }
  /** A heartbeat: the seat is here. The first one also joins the seat and says hello. */
  pulse(ctx, { who = null, read = null, session = null, at = Date.now() } = {}) {
    who ||= this.resolve(ctx);
    if (who.seat === OPERATOR) return null;
    const p = this._pulse(who.seat);
    const rec = { seat: who.seat, device: who.device.id, last_seen: new Date(at).toISOString(), session: session || ctx.session || p.session || null, beats: (p.beats || 0) + 1, read: read || p.read || {} };
    fs.mkdirSync(this._p('pulse'), { recursive: true });
    const f = `${fileOf(who.seat)}.json`;
    writeJson(this._p('pulse', f), rec);
    if (at - (this._pulseCommitted.get(f) || 0) > PULSE_COMMIT_MS) { this._pulseCommitted.set(f, at); this.commit(this._rel('pulse', f)); }
    const seatRec = this.seat(who.seat);
    if (seatRec && !seatRec.joined) {
      seatRec.joined = rec.last_seen; writeJson(this._p('seats', f), seatRec); this.commit(this._rel('seats', f));
      if (!ctx.identity?.read_only) this._append(who, { to: 'all', type: 'hello', body: `${who.seat} joined${who.operator ? ' (operator)' : ''}`, ref: null, project: null });
    }
    return rec;
  }

  holdOn(seat, all = this.all()) {
    const h = all.filter((m) => m.type === 'hold' && m.operator && (m.to === seat || m.to === 'all')).at(-1);
    return h && !h.release ? { since: h.ts, by: h.from, reason: h.body, id: h.id } : null;
  }

  // ---- roster and comms check
  roster({ at = Date.now() } = {}) {
    const all = this.all(); const op = this.operator();
    const rows = this.seats().map((s) => {
      const dev = this.devices.get(s.device); const p = this._pulse(s.seat);
      const last = all.filter((m) => m.from === s.seat).at(-1);
      let state = 'never joined';
      if (s.removed || !dev || dev.status !== 'active') state = 'removed';
      else if (s.joined && p.last_seen) state = ago(p.last_seen, at) <= this.liveMin ? 'live' : 'stale';
      const claims = all.filter((m) => m.type === 'claim' && m.from === s.seat && !all.some((v) => v.type === 'verdict' && v.ref === m.ref)).map((m) => m.ref);
      const status = all.filter((m) => m.type === 'status' && m.from === s.seat && !m.check).at(-1);
      return { seat: s.seat, client: s.client, device: s.device, device_label: dev?.label || s.device_label, device_kind: dev?.kind || s.device_kind, state, operator: op === s.seat, last_seen: p.last_seen || null, minutes_since: p.last_seen ? ago(p.last_seen, at) : null, last_message: last ? { seq: last.seq, type: last.type, ts: last.ts, body: last.body.slice(0, 120) } : null, hold: this.holdOn(s.seat, all), claims, status: status ? status.body.slice(0, 160) : null, project: s.project };
    });
    // licensed computers with no app on the bus yet
    const seated = new Set(rows.map((r) => r.device));
    for (const d of this.devices.list().filter((x) => x.kind === 'remote-computer' && !seated.has(x.id))) rows.push({ seat: null, client: null, device: d.id, device_label: d.label, device_kind: d.kind, state: d.status === 'active' ? 'never joined' : 'removed', operator: false, last_seen: null, minutes_since: null, last_message: null, hold: null, claims: [], status: null, project: null });
    return { live_minutes: this.liveMin, operator: op, seats: rows };
  }
  reasonFor(row) {
    if (row.state === 'removed') return 'removed from the vault (its licence seat is free)';
    if (!row.seat) return 'no AI app registered on that computer yet';
    if (row.state === 'never joined') return 'registered, but the app has not opened a session yet';
    if (row.state === 'stale') return `offline: last heartbeat ${row.minutes_since} min ago`;
    return 'live, but no answer yet; it answers on its next turn';
  }
  /** Post a comms check and wait up to timeout_s for acks. */
  async check(ctx, { timeout_s = 20, to = 'all', seat = null } = {}) {
    const ms = Math.max(0, Math.min(25, Number(timeout_s))) * 1000;
    const msg = this.send(ctx, { to, type: 'status', body: 'Comms check: reply with ack (bus_unread does it for you).', seat, check: true });
    const targets = this.roster().seats.filter((r) => r.seat !== msg.from && (to === 'all' || r.seat === to));
    const start = Date.now(); let acks = [];
    for (;;) {
      acks = this.all().filter((m) => m.type === 'ack' && m.ref === msg.id);
      const waiting = targets.filter((r) => r.seat && r.state === 'live' && !acks.some((a) => a.from === r.seat));
      if (!waiting.length || Date.now() - start >= ms) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const answered = acks.map((a) => ({ seat: a.from, after_ms: Date.parse(a.ts) - Date.parse(msg.ts) }));
    const rows = this.roster().seats.filter((r) => r.seat !== msg.from && (to === 'all' || r.seat === to));
    const missing = rows.filter((r) => !acks.some((a) => a.from === r.seat)).map((r) => ({ seat: r.seat, device: r.device_label, state: r.state, reason: this.reasonFor(r) }));
    return { check: msg.id, seq: msg.seq, waited_ms: Date.now() - start, answered, missing };
  }

  /** Tasks with who claimed them, the restatement, the latest status and the verdict. */
  tasks(ctx, { open = false } = {}) {
    const who = this.resolve(ctx); const all = this.all().filter((m) => this._visible(who, m));
    return all.filter((m) => m.type === 'task').map((t) => {
      const rel = all.filter((m) => m.ref === t.id);
      const claim = rel.find((m) => m.type === 'claim'); const verdict = rel.filter((m) => m.type === 'verdict').at(-1);
      return { id: t.id, seq: t.seq, from: t.from, operator: t.operator, to: t.to, body: t.body, claimed_by: claim?.from || null, restated: rel.filter((m) => m.type === 'restate').at(-1)?.body || null, status: rel.filter((m) => m.type === 'status').at(-1)?.body || null, verdict: verdict?.body || null, state: verdict ? 'done' : claim ? 'claimed' : 'open' };
    }).filter((t) => !open || t.state !== 'done');
  }

  /** For memev doctor. */
  health({ at = Date.now() } = {}) {
    const files = this._logFiles(); let bad = 0; for (const f of files) { this._readLog(f); bad += this._cache.get(f)?.bad || 0; }
    const r = this.roster({ at });
    return { seats: r.seats.filter((s) => s.seat).length, live: r.seats.filter((s) => s.state === 'live').length, stale: r.seats.filter((s) => s.state === 'stale').map((s) => `${s.seat} (${s.minutes_since} min)`), never: r.seats.filter((s) => s.state === 'never joined').length, operator: r.operator, bad_lines: bad, messages: this.all().length };
  }
}
