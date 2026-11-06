// SPDX-License-Identifier: Apache-2.0
// The agent comms bus: how the AI apps using one vault talk to each other and to you.
//
// Everything lives in the vault under bus/ and travels with it: through git to your own backup
// repository, and through the secure link to computers that joined. Nothing goes anywhere else.
//   bus/log/<device>.jsonl   messages, append-only and written by one computer, so git never conflicts; when it reaches
//                            SEGMENT_BYTES the computer goes on in <device>.2.jsonl, <device>.3.jsonl and so on, and the
//                            full file is never touched again. Every reader takes every *.jsonl here, so a computer on an
//                            older version reads them too. One limit: code older than this takes its last counter from
//                            <device>.jsonl alone, so a computer put back on it after a file rolled over reuses counters
//                            (docs/BUS.md)
//   bus/seats/<seat>.json    one seat per AI app (or session) on a computer
//   bus/pulse/<seat>.json    the seat's last heartbeat and what it has read
//   bus/operator.json        which seat speaks for you
//   bus/config.json          the layout version, so another computer knows how to read the rest
// init seeds these (Vault.open on an older vault), and they are committed with the vault like any note.
// Order is the same on every computer: by time, then device id, then the device's own counter.
// What a seat has read is kept per device counter, so messages that arrive late from a computer
// that was offline are still delivered.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findSecrets } from './secrets.mjs';
import { readJson, writeJson, now, linkedUnder } from './util.mjs';
import { allowed } from './tokens.mjs';

export const TYPES = ['hello', 'status', 'task', 'claim', 'restate', 'review', 'verdict', 'question', 'answer', 'finding', 'push', 'ack', 'hold', 'transition'];
export const BUS_DIR = 'bus';
export const OPERATOR = 'operator';
const MAX_BODY = 4000;
export const LEAD_NEEDED = 'No lead AI is set for this vault. Ask the user which AI should lead and coordinate the others (bus_roster lists the seats), then call bus_set_operator with the seat and their answer. Never choose yourself or another app without asking.';
const SEAT_RE = /^[a-z0-9][a-z0-9._-]{0,40}@[a-z0-9][a-z0-9._-]{0,40}(\/[a-z0-9._-]{1,24})?$/;
const REF_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const PULSE_COMMIT_MS = 5 * 60e3;
// git stores each new version of a file whole until it next packs, and refuses a blob over 100 MiB for good. So a message file
// stops growing here: small enough that a commit stays cheap (scripts/bench/speed/lab/bus-git-cost.mjs), and two of them merged by
// sync stay far under the limit. A message is at most some 24 KB, so a file ends at most that far over this.
export const SEGMENT_BYTES = 4 * 1048576;
// What a seat has read, per device counter: pulse.read[device] is the contiguous prefix, kept a plain number so older
// code still reads it, and pulse.read_extra[device] lists the counters read beyond a gap, which older code ignores (it
// shows those once more, which is harmless). hasRead is the one rule; the bus and memev bus hello both use it.
const readPrefix = (read, device) => { const v = (read || {})[device]; return typeof v === 'number' ? v : 0; };
const readState = (p) => ({ read: { ...(p?.read || {}) }, extra: { ...(p?.read_extra || {}) } });
export function hasRead(pulse, m) {
  return m.dseq <= readPrefix(pulse?.read, m.device) || (pulse?.read_extra?.[m.device] || []).includes(m.dseq);
}

export const UNREAD_VIEW = 8;   // default messages a capped bus_unread shows
export const UNREAD_MAX = 50;   // stated maximum for the bus_unread limit
export const BODY_CUT = 300;    // characters per message in the capped view
export const CUT_MARK = '…';    // appended when a body is cut to fit the view
export const TAIL_MAX = 50;     // stated maximum for bus_tail n
export const SINCE_MAX = 50;    // stated maximum for bus_since limit

export class BusError extends Error { constructor(code, message) { super(message); this.code = code; this.name = 'BusError'; } }

export const fileOf = (seat) => seat.replace(/[^a-z0-9._-]/g, (c) => (c === '@' ? '~' : c === '/' ? '+' : '_'));
export const label = (s) => String(s || 'computer').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'computer';
const order = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.device < b.device ? -1 : a.device > b.device ? 1 : a.dseq - b.dseq);
// A line someone wrote by hand can carry its own seq, or a time or device that is not text. It is read as it always was, but
// the view then gives up the short cuts that rely on seq being the place in the order. Memev itself never writes one.
const ownSeq = new WeakSet();
const digest = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');
const newRecord = (st, text) => ({ size: st.size, mtimeMs: st.mtimeMs, msgs: [], bad: 0, exotic: false, endsLine: !text || text.endsWith('\n'), at: 0 });
/** Parse lines of a file's text into its record from where it got to, until the deadline. A blank line is not a bad line. */
function parseSome(rec, text, until) {
  let at = rec.at; let n = 0;
  while (at < text.length) {
    let nl = text.indexOf('\n', at); if (nl < 0) nl = text.length;
    if (text.charCodeAt(at) === 123 || text.slice(at, nl).trim()) {
      try {
        const m = JSON.parse(text.slice(at, nl));
        if (m?.id && m.device && Number.isInteger(m.dseq)) { rec.msgs.push(m); if (Object.hasOwn(m, 'seq')) { ownSeq.add(m); rec.exotic = true; } else if (typeof m.ts !== 'string' || typeof m.device !== 'string') rec.exotic = true; } else rec.bad++;
      } catch { rec.bad++; }
    }
    at = nl + 1;
    if (until !== Infinity && ++n % 200 === 0 && performance.now() >= until) break;
  }
  rec.at = at;
  return at >= text.length;
}
/** What leaves the class: a message of its own, with seq first. A line that carries its own seq keeps it, as the spread always did. */
const copyOut = (m) => ({ seq: m.seq, ...m });
const newView = (files, exotic) => ({ files, exotic, place: null, msgs: [], firstById: new Map(), byFrom: new Map(), claimsBy: new Map(), statusBy: new Map(), byRef: new Map(), tasks: [], holds: [], verdicts: new Set(), runs: new Map() });
const listIn = (map, key) => { let l = map.get(key); if (!l) { l = []; map.set(key, l); } return l; };
/** Add a message to a list kept in the bus order; nearly always that is the end. */
const putInOrder = (list, m, atEnd) => { if (atEnd) { list.push(m); return; } let i = list.length; while (i > 0 && order(list[i - 1], m) > 0) i--; if (i === list.length) list.push(m); else list.splice(i, 0, m); };
/** Where a message sits in the order: its seq, except beside a line that carries its own. */
const placeOf = (v, m) => (v.place ? v.place.get(m) : m.seq);
function addToView(v, m, atEnd) {
  const had = v.firstById.get(m.id); if (!had || (!atEnd && order(m, had) < 0)) v.firstById.set(m.id, m);
  putInOrder(listIn(v.byFrom, m.from), m, atEnd);
  if (m.ref !== null && m.ref !== undefined) putInOrder(listIn(v.byRef, m.ref), m, atEnd);
  if (m.type === 'claim') putInOrder(listIn(v.claimsBy, m.from), m, atEnd);
  else if (m.type === 'status') { if (!m.check) putInOrder(listIn(v.statusBy, m.from), m, atEnd); }
  else if (m.type === 'task') putInOrder(v.tasks, m, atEnd);
  else if (m.type === 'verdict') v.verdicts.add(m.ref);
  else if (m.type === 'hold' && m.operator) putInOrder(v.holds, m, atEnd);
  const run = listIn(v.runs, m.device); let i = run.length; while (i > 0 && (run[i - 1].dseq > m.dseq)) i--; if (i === run.length) run.push(m); else run.splice(i, 0, m);
}
/** The last message in bus order across several lists kept in that order. */
const lastOf = (v, map, names) => { let best = null; for (const n of names) { const m = map.get(n)?.at(-1); if (m && (!best || placeOf(v, m) > placeOf(v, best))) best = m; } return best; };
const ago = (ts, at) => Math.round((at - Date.parse(ts)) / 60e3);

export class Bus {
  /** root: the vault folder; devices: its DeviceRegistry; commit(path): queue a git commit. */
  constructor({ root, devices, commit = () => {}, config = {} }) {
    this.root = root; this.devices = devices; this.commit = commit;
    this.liveMin = config.live_min ?? 15;
    this.cloudTasks = !!config.cloud_tasks;
    this.segmentBytes = config.segment_bytes ?? SEGMENT_BYTES;
    this.dir = path.join(root, BUS_DIR);
    this._cache = new Map(); this._pulseCommitted = new Map(); this._last = new Map();
  }

  _p(...a) { return path.join(this.dir, ...a); }
  _rel(...a) { return [BUS_DIR, ...a].join('/'); }
  /** The bus writes its own files with its own file calls, so it checks each one first: a symbolic link on the way from the
   * vault root refuses the write, wherever the link came from (issue 256). */
  _w(...abs) { for (const a of abs) if (linkedUnder(this.root, a)) throw new BusError('bad_path', `${path.relative(this.root, a).split(path.sep).join('/')} goes through a symbolic link; the bus does not follow links in the vault`); }

  /** Seed bus/ (the caller commits it) so the bus is part of the vault from the first commit: the layout, no operator yet, and this computer's own (empty) message file. */
  ensure(deviceId) {
    const files = [
      ['config.json', () => writeJson(this._p('config.json'), { format: 1, log: 'log/<device>.jsonl, then log/<device>.<n>.jsonl once that is full; append-only, written by one computer each', seats: 'seats/<seat>.json', pulse: 'pulse/<seat>.json', operator: 'operator.json' })],
      ['operator.json', () => writeJson(this._p('operator.json'), { seat: null, set: null })],
      ...(deviceId ? [[`log/${deviceId}.jsonl`, () => fs.writeFileSync(this._p('log', `${deviceId}.jsonl`), '')]] : []),
    ];
    this._w(this._p('config.json'), this._p('operator.json'), this._p('log'), ...(deviceId ? [this._p('log', `${deviceId}.jsonl`)] : []));
    fs.mkdirSync(this._p('log'), { recursive: true });
    const created = [];
    for (const [rel, make] of files) if (!fs.existsSync(this._p(...rel.split('/')))) { make(); created.push(this._rel(...rel.split('/'))); }
    return { paths: files.map(([rel]) => this._rel(...rel.split('/'))), created };
  }

  // ---- seats
  /** The short name of this vault's own computer: the host device's label, so seats read my-app@my-laptop. */
  machineName() {
    const host = this.devices.get(this.devices.hostId);
    return label(host?.label || 'this computer');
  }
  /** The seat name for an app on a device: my-app@my-laptop, cursor@laptop, chatgpt@cloud. A teammate's computer is enrolled as <name>-<machine>, so its seats read <app>@<name>-<machine>. */
  seatName(client, device) {
    if (!device || device.kind === 'host' || device.kind === 'local-client') return `${label(client)}@${this.machineName()}`;
    if (device.kind === 'cloud-connector') return `${label(device.label)}@cloud`;
    return `${label(client)}@${label(device.label)}`;
  }
  /**
   * The seat this app uses on this computer: the one it already has here (its machine-name seat, an older '@host'
   * seat, or a numbered one), otherwise its machine-name seat. A seat is only ever one computer's: when another
   * computer with the same short name holds that name, this one takes the first free <app>@<machine>-2, -3 ...
   */
  ownSeatName(client, device) {
    const fresh = this.seatName(client, device);
    const mine = (n) => { const r = this.seat(n); return r && (!device || r.device === device.id) ? r.seat : null; };
    const legacy = !device || device.kind === 'host' || device.kind === 'local-client' ? `${label(client)}@host` : null;
    const held = mine(fresh) || (legacy && legacy !== fresh && mine(legacy));
    if (held) return held;
    const [app, machine] = fresh.split('@');
    for (let i = 1; i < 100; i++) {
      const n = i === 1 ? fresh : `${app}@${machine.slice(0, 41 - `-${i}`.length)}-${i}`;
      const r = this.seat(n);
      if (!r) return n;
      if (!device || r.device === device.id) return r.seat;
    }
    throw new BusError('conflict', `no free seat name for ${fresh}`);
  }
  /** True when the machine part of a seat name is this vault's own computer (or the older 'host' word). */
  _onHost(seat) {
    const at = String(seat).split('@');
    if (at.length < 2) return false;
    const machine = at[1].split('/')[0];
    return machine === 'host' || machine === this.machineName();
  }
  seat(name) {
    const rec = readJson(this._p('seats', `${fileOf(name)}.json`), null);
    if (rec) return rec;
    for (const s of this.seats()) if ((s.renamed_from || []).includes(name)) return s;
    return null;
  }
  seats() {
    let f; try { f = fs.readdirSync(this._p('seats')); } catch { return []; }
    return f.filter((x) => x.endsWith('.json')).map((x) => readJson(this._p('seats', x), null)).filter((s) => s?.seat).sort((a, b) => a.seat.localeCompare(b.seat));
  }
  /** Give an app a seat (at init, when an app is connected, or on its first call). */
  register({ client, device, project = null, seat = null }) {
    const name = seat || this.ownSeatName(client, device);
    if (!SEAT_RE.test(name)) throw new BusError('bad_request', `not a seat name: ${name}`);
    const cur = this.seat(name);
    if (cur && !cur.removed && device && cur.device !== device.id) throw new BusError('conflict', `seat ${name} belongs to another computer`);
    if (cur && !cur.removed) return cur;
    const rec = { seat: name, client: label(client), device: device.id, device_kind: device.kind, device_label: device.label, project: project || null, created: now(), joined: cur?.joined || null, removed: null };
    this._w(this._p('seats', `${fileOf(name)}.json`));
    fs.mkdirSync(this._p('seats'), { recursive: true });
    writeJson(this._p('seats', `${fileOf(name)}.json`), rec); this.commit(this._rel('seats', `${fileOf(name)}.json`));
    return rec;
  }
  /** Rename a seat: the record, its pulse and its history follow it, and the old name still finds it. */
  renameSeat(oldName, newName) {
    const rec = this.seat(oldName);
    if (!rec) throw new BusError('not_found', `no seat ${oldName}; memev bus roster lists them`);
    if (rec.removed) throw new BusError('not_found', `no seat ${oldName}; it was removed from the bus`);
    if (oldName === newName) return rec;
    if (!SEAT_RE.test(newName)) throw new BusError('bad_request', `not a seat name: ${newName}`);
    const clash = this.seat(newName);
    if (clash && clash.seat !== rec.seat) throw new BusError('conflict', `seat ${newName} already exists`);
    const from = rec.seat;
    rec.seat = newName;
    rec.renamed_from = [...new Set([...(rec.renamed_from || []), from])];
    this._w(this._p('seats', `${fileOf(from)}.json`), this._p('seats', `${fileOf(newName)}.json`), this._p('pulse', `${fileOf(from)}.json`), this._p('pulse', `${fileOf(newName)}.json`), this._p('operator.json'));
    fs.mkdirSync(this._p('seats'), { recursive: true });
    const oldF = this._p('seats', `${fileOf(from)}.json`);
    const newF = this._p('seats', `${fileOf(newName)}.json`);
    if (oldF !== newF && fs.existsSync(oldF)) fs.renameSync(oldF, newF);
    writeJson(newF, rec);
    this.commit(this._rel('seats', `${fileOf(newName)}.json`));
    if (oldF !== newF) this.commit(this._rel('seats', `${fileOf(from)}.json`));
    const pOld = this._p('pulse', `${fileOf(from)}.json`);
    const pNew = this._p('pulse', `${fileOf(newName)}.json`);
    if (fs.existsSync(pOld)) {
      fs.mkdirSync(this._p('pulse'), { recursive: true });
      fs.renameSync(pOld, pNew);
      this.commit(this._rel('pulse', `${fileOf(newName)}.json`));
      this.commit(this._rel('pulse', `${fileOf(from)}.json`));
    }
    const op = readJson(this._p('operator.json'), null);
    if (op?.seat === from) { writeJson(this._p('operator.json'), { ...op, seat: newName }); this.commit(this._rel('operator.json')); }
    return rec;
  }
  /**
   * A computer's label changed: move every seat on it to the name its new label gives, so the seat's
   * history, tasks and lead follow it, and its old names still find the seat.
   */
  renameDeviceSeats(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return [];
    const moved = [];
    for (const s of this.seats()) {
      if (s.device !== deviceId || s.removed) continue;
      const base = this._seatNameAfterRename(s.seat, device);
      if (!base || base === s.seat) continue;
      // a name another computer already holds goes to the first free <app>@<machine>-2, -3 ..., as ownSeatName does
      const [app, rest] = base.split('@'); const [machine, sub] = rest.split('/');
      let next = null;
      for (let i = 1; i < 100 && !next; i++) {
        const n = i === 1 ? base : `${app}@${machine.slice(0, 41 - `-${i}`.length)}-${i}${sub ? `/${sub}` : ''}`;
        const r = this.seat(n);
        if (!r || r.seat === s.seat) next = n;
      }
      if (!next) throw new BusError('conflict', `no free seat name for ${base}`);
      if (next === s.seat) continue;
      moved.push(this.renameSeat(s.seat, next));
    }
    return moved;
  }
  /** The seat name a seat on this device takes once the device's label is what it is now. */
  _seatNameAfterRename(name, device) {
    const at = String(name).split('@');
    if (at.length < 2) return null;
    const [app, rest] = at;
    const [machine, sub] = rest.split('/');
    if (device.kind === 'cloud-connector') {
      const app2 = label(device.label);
      if (app2 === app) return null;
      return `${app2}@${machine}${sub ? `/${sub}` : ''}`;
    }
    const machine2 = device.kind === 'remote-computer' ? label(device.label) : this.machineName();
    if (machine2 === machine) return null;
    return `${app}@${machine2}${sub ? `/${sub}` : ''}`;
  }
  /** A seat's name and the names it had before a rename: messages to or from any of them are its own. */
  _names(seat) {
    const rec = this.seat(seat);
    return [...new Set([seat, ...(rec ? [rec.seat, ...(rec.renamed_from || [])] : [])])];
  }
  operator() { return readJson(this._p('operator.json'), null)?.seat || null; }
  /**
   * Which seat leads and speaks for you. Never chosen by Memev or by an AI on its own: the person
   * picks it at init, with memev bus operator, or by answering an AI that then calls bus_set_operator.
   */
  setOperator(seat, { by = 'terminal', answer = null } = {}) {
    const rec = seat ? this.seat(seat) : null;
    if (seat && (!rec || rec.removed)) throw new BusError('not_found', `no seat ${seat}; memev bus roster lists them`);
    this._w(this._p('operator.json'));
    fs.mkdirSync(this.dir, { recursive: true });
    writeJson(this._p('operator.json'), { seat: seat || null, set: now(), by, ...(answer ? { user_answer: answer } : {}) }); this.commit(this._rel('operator.json'));
    return seat || null;
  }
  /** A seat name from what the person typed: a seat, or an app id meaning its seat on this computer. */
  seatFor(choice) {
    const c = String(choice || '').trim().toLowerCase();
    if (!c) return null;
    if (this.seat(c)) return c;
    const own = this.ownSeatName(c, this.devices.get(this.devices.hostId));
    return this.seat(own) ? own : null;
  }
  /**
   * bus_set_operator: an AI passes on the person's answer to "which AI should lead?". It only works
   * while no lead is set and only from this computer; the answer must name the seat it sets. Changing
   * a lead that is already set is for the person at the terminal (memev bus operator <seat>).
   */
  chooseLead(ctx, { seat, user_answer } = {}) {
    if (!ctx.local) throw new BusError('forbidden', 'the lead is chosen on the vault\'s own computer');
    const cur = this.operator();
    if (cur) throw new BusError('conflict', `${cur} already leads; only the person can change it, from the terminal: memev bus operator <seat>`);
    const answer = String(user_answer || '').trim().slice(0, 300);
    if (!answer) throw new BusError('bad_request', 'ask the user which AI should lead and pass their answer as user_answer; never pick one yourself');
    const name = this.seatFor(seat);
    if (!name) throw new BusError('not_found', `no seat ${seat}; bus_roster lists them`);
    const rec = this.seat(name); const words = answer.toLowerCase();
    if (!words.includes(name) && !words.includes(rec.client) && !words.includes(rec.client.replace(/-/g, ' '))) throw new BusError('bad_request', `the user's answer does not name ${name}; ask them again and pass their exact words`);
    const who = this.resolve(ctx, { need: 'write' });
    this.setOperator(name, { by: who.seat, answer });
    this._append({ ...who, operator: false }, { to: 'all', type: 'status', body: `${name} now leads and speaks for the user (the user chose it: "${answer.slice(0, 120)}")`, ref: null, project: null });
    return { operator: name };
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
    const own = this.ownSeatName(ctx.client, computer);
    let name = seat || own;
    if (seat) {
      // the terminal on the vault's computer may act for any seat on that computer (memev bus watch)
      const rec = this.seat(seat);
      // an app posts only as its own seat: a recorded seat must be on this computer and registered by this app, so a local
      // app cannot speak as another app's seat, the lead's included (issue 263)
      const mine = ctx.cli && ctx.local ? (rec ? rec.device === computer.id : this._onHost(seat)) : rec ? rec.device === computer.id && rec.client === label(ctx.client) : seat.split('/')[0] === own;
      if (!mine) throw new BusError('forbidden', `${seat} belongs to another app or computer; you can only post as your own seat (${own})`);
    }
    let rec = this.seat(name);
    if (rec && rec.seat !== name) name = rec.seat; // the seat was renamed: post under its current name
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
    const bytes = fs.readFileSync(full); const text = bytes.toString('utf8');
    const rec = newRecord(st, text); parseSome(rec, text, Infinity);
    // a file that has changed once will change again, as sync brings more: from now on it can prove the next change only added lines
    if (c) rec.digest = digest(bytes);
    this._cache.set(file, rec);
    return rec.msgs;
  }
  /**
   * Where this computer's next message goes, and its last message so far. Its counter runs on across its files: an empty or
   * unreadable newest file falls back to the one before, so a counter is never used twice by losing sight of an older file.
   * Only the numbers really in the folder are looked at, so what a file is named never sets how far a loop runs.
   */
  _writeTo(id) {
    const plain = `${id}.jsonl`; const prefix = `${id}.`; const numbers = [];
    for (const f of this._logFiles()) {
      if (!f.startsWith(prefix) || f === plain) continue;
      const n = Number(/^(\d+)\.jsonl$/.exec(f.slice(prefix.length))?.[1]);
      if (Number.isSafeInteger(n) && n >= 2) numbers.push(n);
    }
    numbers.sort((x, y) => y - x); const high = numbers[0] ?? 1;
    const nameOf = (n) => (n === 1 ? plain : `${id}.${n}.jsonl`);
    let last = null;
    for (const n of [...numbers, 1]) { last = this._readLog(nameOf(n)).at(-1) || null; if (last) break; }
    let size = 0; try { size = fs.statSync(this._p('log', nameOf(high))).size; } catch {}
    return { file: nameOf(size >= this.segmentBytes ? high + 1 : high), last };
  }
  /** Each computer's highest counter so far. */
  counters() { const out = {}; for (const [device, run] of this._view().runs) out[device] = Math.max(0, run.at(-1).dseq); return out; }
  /** The messages above a per-computer cursor, in order, each the caller's own. */
  pastCounters(seen) { const view = this._view(); return this._pastRead(view, { read: seen, extra: {} }).map(copyOut); }
  /** Every message, in the one order every computer agrees on, numbered from 1. The caller owns what it gets back. */
  all() { return this._view().msgs.map(copyOut); }
  /**
   * The messages in order and what roster, tasks and unread need from them, kept until a log file changes on disk. Every
   * call checks each file's size and modified time, as _readLog does, so sync, a merge or another process is seen at once.
   * The message objects are shared and their seq can move, so nothing outside this class may hold one: copyOut first.
   */
  _view() {
    const files = this._logFiles(); const v = this._viewNow;
    if (v && v.files.size === files.length && files.every((f) => v.files.has(f) && this._unchanged(f, v.files.get(f)))) return v;
    if (v && this._tookGrowth(v, files)) return v;
    const out = []; const stamps = new Map(); let exotic = false;
    for (const f of files) { const msgs = this._readLog(f); const c = this._cache.get(f); exotic ||= c?.exotic; stamps.set(f, c || null); for (const m of msgs) out.push(m); }
    out.sort(order);
    const next = newView(stamps, exotic);
    if (exotic) next.place = new Map(out.map((m, i) => [m, i]));
    for (let i = 0; i < out.length; i++) { if (!exotic || !ownSeq.has(out[i])) out[i].seq = i + 1; addToView(next, out[i], true); }
    next.msgs = out;
    this._viewNow = next;
    return next;
  }
  /**
   * Do the first read a little at a time, so no prompt pays for it and the thread stays free. A call that arrives meanwhile just
   * does what is left itself, and anything that changed a file while this ran throws this work away; the next read starts over.
   */
  async warm({ sliceMs = 8 } = {}) {
    const breathe = () => new Promise((r) => setImmediate(r));
    for (const f of this._logFiles()) {
      if (this._cache.get(f)) continue;
      const full = this._p('log', f); let st; let text; try { st = fs.statSync(full); text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      await breathe();
      const rec = newRecord(st, text);
      while (!parseSome(rec, text, performance.now() + sliceMs)) await breathe();
      let now_; try { now_ = fs.statSync(full); } catch { continue; }
      if (!this._cache.get(f) && now_.size === st.size && now_.mtimeMs === st.mtimeMs) this._cache.set(f, rec);
      await breathe();
    }
    if (this._viewNow) return;
    const files = this._logFiles(); const stamps = new Map(); const out = []; let exotic = false;
    for (const f of files) { const c = this._cache.get(f); if (!c) return; stamps.set(f, c); exotic ||= c.exotic; for (const m of c.msgs) out.push(m); }
    const sizes = files.map((f) => stamps.get(f).size);
    out.sort(order);
    await breathe();
    const next = newView(stamps, exotic);
    if (exotic) next.place = new Map(out.map((m, i) => [m, i]));
    const stale = () => this._viewNow || files.some((f, i) => this._cache.get(f) !== stamps.get(f) || stamps.get(f).size !== sizes[i]);
    for (let i = 0; i < out.length;) {
      // the message objects are shared: once anything else has numbered them, this must not touch them again
      if (stale()) return;
      const until = performance.now() + sliceMs;
      for (let n = 0; i < out.length && (n % 200 !== 199 || performance.now() < until); i++, n++) { if (!exotic || !ownSeq.has(out[i])) out[i].seq = i + 1; addToView(next, out[i], true); }
      if (i < out.length) await breathe();
    }
    next.msgs = out;
    if (!stale()) this._viewNow = next;
  }
  /**
   * Another computer's lines arrived by sync. When every changed file is a new file, or is what it was plus whole lines at the
   * end (the digest proves it, not the size), they go in where they belong and nothing else is read or sorted. Anything else
   * returns false, and the caller reads the changed files and builds the view again.
   */
  _tookGrowth(v, files) {
    if (v.exotic || !files.every((f) => this._cache.has(f) || !v.files.has(f)) || [...v.files.keys()].some((f) => !files.includes(f))) return false;
    const taken = [];
    for (const f of files) {
      const c = v.files.has(f) ? v.files.get(f) : null;
      if (c && this._unchanged(f, c)) continue;
      if (c && (c !== this._cache.get(f) || !c.digest || !c.endsLine)) return false;
      const full = this._p('log', f); let st; let bytes; try { st = fs.statSync(full); bytes = fs.readFileSync(full); } catch { return false; }
      if (bytes.length !== st.size || bytes.length < (c?.size || 0) || (c && digest(bytes.subarray(0, c.size)) !== c.digest)) return false;
      const text = bytes.toString('utf8', c?.size || 0);
      const rec = newRecord(st, text); parseSome(rec, text, Infinity);
      if (rec.exotic) return false;
      taken.push({ f, c, rec, st, sum: digest(bytes) });
    }
    if (!taken.length) return false;
    for (const { rec } of taken) for (const m of rec.msgs) if (!this._placeInView(v, m)) { this._viewNow = null; for (const t of taken) this._cache.delete(t.f); return false; }
    for (const { f, c, rec, st, sum } of taken) {
      const into = c || newRecord({ size: 0, mtimeMs: 0 }, '');
      into.size = st.size; into.mtimeMs = st.mtimeMs; into.bad += rec.bad; into.endsLine = rec.endsLine; into.digest = sum;
      for (const m of rec.msgs) into.msgs.push(m);
      this._cache.set(f, into); v.files.set(f, into);
    }
    return true;
  }
  /** One new message into the view, moving what comes after it. False for an exact tie, whose place depends on the order the files are read in. */
  _placeInView(v, m) {
    const msgs = v.msgs; let i = msgs.length; while (i > 0 && order(msgs[i - 1], m) > 0) i--;
    if (i > 0 && order(msgs[i - 1], m) === 0) return false;
    if (i === msgs.length) msgs.push(m); else msgs.splice(i, 0, m);
    for (let k = i; k < msgs.length; k++) msgs[k].seq = k + 1;
    addToView(v, m, false);
    return true;
  }
  /**
   * The line just appended goes into what is already in memory, so a message costs nothing per message already on the bus.
   * Only when the file is now exactly what was known plus this line: anything else (another writer got in between, or a crash
   * left half a line before this one) leaves the stale record, and the next read sees the size differ and reads the file.
   */
  _tookOwnLine(file, line) {
    let c = this._cache.get(file);
    // a file that did not exist before this line: a computer's first, or the next one after a full file
    if (!c) c = newRecord({ size: 0, mtimeMs: 0 }, '');
    if (c.exotic) return;
    let st; try { st = fs.statSync(this._p('log', file)); } catch { return; }
    if (st.size !== c.size + Buffer.byteLength(line)) return;
    const m = JSON.parse(line);
    c.size = st.size; c.mtimeMs = st.mtimeMs; c.msgs.push(m); c.digest = null;
    this._cache.set(file, c);
    const v = this._viewNow;
    if (!v) return;
    if (v.exotic) { this._viewNow = null; return; }
    if (v.files.has(file) && v.files.get(file) !== c) { this._viewNow = null; return; }
    v.files.set(file, c);
    // nearly always the new message is the last; one that lands before a computer whose clock is ahead moves those after it
    if (!this._placeInView(v, m)) this._viewNow = null;
  }
  _unchanged(file, cached) {
    const c = this._cache.get(file); if (!c || c !== cached) return false;
    let st; try { st = fs.statSync(this._p('log', file)); } catch { return false; }
    return c.size === st.size && c.mtimeMs === st.mtimeMs;
  }
  _visible(who, m) {
    if (who.operator || !who.project) return true;
    return !m.project || m.project === who.project;
  }
  _toMe(who, m, names = this._names(who.seat)) { return !names.includes(m.from) && (m.to === 'all' || names.includes(m.to) || (m.to === OPERATOR && who.operator)); }

  send(ctx, { to, type, body = '', ref = null, project = null, seat = null, release = false, check = false } = {}) {
    if (!TYPES.includes(type)) throw new BusError('bad_request', `type must be one of: ${TYPES.join(', ')}`);
    body = String(body ?? '');
    if (body.length > MAX_BODY) throw new BusError('too_large', `keep a message under ${MAX_BODY} characters; put long text in a note and send its path`);
    const secrets = findSecrets(body);
    if (secrets.length) throw new BusError('secret', `refused: the message looks like it holds a credential (${secrets.join(', ')}). Never send keys or tokens over the bus`);
    if (ref != null && !REF_RE.test(String(ref))) throw new BusError('bad_request', 'ref must be a message or task id: letters, digits and . _ : -, at most 64 characters');
    const who = this.resolve(ctx, { seat, project, need: 'write' });
    to = String(to || (who.device?.kind === 'cloud-connector' ? OPERATOR : 'all'));
    if (who.device?.kind === 'cloud-connector') {
      const toOperator = to === OPERATOR || (!!this.operator() && to === this.operator());
      if (!toOperator && !(this.cloudTasks && type === 'task')) throw new BusError('forbidden', 'a cloud seat may post only to the operator; to let a cloud app assign a task to a seat, the person turns on the bus cloud_tasks setting');
    }
    if (to !== 'all' && to !== OPERATOR && !this.seat(to)) throw new BusError('not_found', `no seat ${to}; bus_roster lists them`);
    if (['claim', 'restate'].includes(type)) {
      const view = this._view();
      const task = view.tasks.find((m) => m.id === ref);
      if (!task) throw new BusError('bad_request', `${type} needs ref: the id of a task`);
      if (task.to !== 'all' && task.to !== who.seat) throw new BusError('forbidden', `task ${ref} is assigned to ${task.to}`);
      const claim = (view.byRef.get(ref) || []).find((m) => m.type === 'claim');
      if (type === 'claim' && claim && claim.from !== who.seat) throw new BusError('conflict', `task ${ref} is already claimed by ${claim.from}`);
      if (type === 'restate' && claim?.from !== who.seat) throw new BusError('bad_request', `claim task ${ref} before restating it`);
    }
    const msg = this._append(who, { to, type, body, ref: ref ? String(ref) : null, project: project || who.project || null, ...(release ? { release: true } : {}), ...(check ? { check: true } : {}) });
    this.pulse(ctx, { who });
    return msg;
  }
  /**
   * A task changed state: the coordinator posts one message of type transition to the operator seat and one to the assignee's seat
   * (when it has one). The body is ids and states only, and it is checked for secrets like any message. The bus carries it
   * between turns; the project store stays the truth, so no state lives here.
   */
  postTransition({ project, task, from, to, correlation = null, assignee = null } = {}) {
    const body = JSON.stringify({ project, task, from, to, correlation });
    const secrets = findSecrets(body);
    if (secrets.length) throw new BusError('secret', `refused: the message looks like it holds a credential (${secrets.join(', ')}). Never send keys or tokens over the bus`);
    if (body.length > MAX_BODY) throw new BusError('too_large', `keep a message under ${MAX_BODY} characters`);
    const device = this.devices.get(this.devices.hostId);
    const who = { seat: `project@${this.machineName()}`, operator: false, device, project: project ?? null };
    const rec = assignee && assignee !== OPERATOR ? this.seat(assignee) : null;
    const to_ = [OPERATOR, ...(rec && !rec.removed ? [rec.seat] : [])];
    return to_.map((t) => this._append(who, { to: t, type: 'transition', body, ref: null, project: project ?? null }));
  }
  _append(who, fields) {
    const { file, last: lastInFiles } = this._writeTo(who.device.id);
    const last = this._last.get(who.device.id) || lastInFiles;
    let ts = now(); if (last && ts <= last.ts) ts = new Date(Date.parse(last.ts) + 1).toISOString();
    const dseq = (last?.dseq || 0) + 1;
    const msg = { id: `${who.device.id.slice(4, 12)}-${dseq}`, dseq, ts, device: who.device.id, from: who.seat, operator: !!who.operator, ...fields };
    this._w(this._p('log', file));
    fs.mkdirSync(this._p('log'), { recursive: true });
    const line = `${JSON.stringify(msg)}\n`;
    // A kill can leave half a line at the end. This message starts a line of its own, or it would run into that and be lost with it.
    const torn = this._cache.get(file)?.endsLine === false;
    fs.appendFileSync(this._p('log', file), torn ? `\n${line}` : line);
    this._last.set(who.device.id, msg);
    this.commit(this._rel('log', file));
    this._tookOwnLine(file, line);
    return { seq: this._view().firstById.get(msg.id)?.seq ?? null, ...msg };
  }

  since(ctx, { seq = 0, limit = 50, seat = null } = {}) {
    const who = this.resolve(ctx, { seat }); this.pulse(ctx, { who });
    const lim = Math.min(Math.max(1, Math.floor(Number(limit)) || SINCE_MAX), SINCE_MAX);
    const view = this._view(); const after = Number(seq || 0); const msgs = view.msgs;
    // seq is the place in the order, so the scan starts where the answer starts; a line with its own seq means reading them all
    const start = view.exotic ? 0 : Math.min(msgs.length, Math.max(0, Math.floor(after) || 0));
    const matched = []; for (let i = start; i < msgs.length; i++) if (msgs[i].seq > after && this._visible(who, msgs[i])) matched.push(msgs[i]);
    return { messages: matched.slice(0, lim).map(copyOut), more: Math.max(0, matched.length - lim) };
  }
  tail(ctx, { n = 20, seat = null, type = null } = {}) {
    const who = this.resolve(ctx, { seat });
    const lim = Math.min(Math.max(1, Math.floor(Number(n)) || 20), TAIL_MAX);
    const matched = this._view().msgs.filter((m) => this._visible(who, m) && (!type || m.type === type));
    return { messages: matched.slice(-lim).map(copyOut), more: Math.max(0, matched.length - lim) };
  }
  /** The read state for a device: the contiguous prefix from read and the counters read beyond a gap from read_extra. */
  _readUpTo(st, device) {
    return { upTo: readPrefix(st.read, device), extra: new Set(st.extra[device] || []) };
  }
  _storeRead(st, device, upTo, extra) {
    const arr = [...extra].filter((d) => d > upTo).sort((a, b) => a - b);
    if (upTo > 0) st.read[device] = upTo; else delete st.read[device];
    if (arr.length) st.extra[device] = arr; else delete st.extra[device];
  }
  /**
   * The messages this read state does not cover, in bus order. Each computer's run is held in counter order, so the read
   * position is a place to jump to: the cost follows what is unread, not what is on the bus.
   */
  _pastRead(view, st) {
    let out = [];
    for (const [device, run] of view.runs) {
      const upTo = readPrefix(st.read, device); const extra = st.extra[device]; const skip = extra?.length ? new Set(extra) : null;
      let lo = 0; let hi = run.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (run[mid].dseq <= upTo) lo = mid + 1; else hi = mid; }
      if (!skip && view.runs.size === 1) { out = run.slice(lo); break; }
      for (let i = lo; i < run.length; i++) if (!skip || !skip.has(run[i].dseq)) out.push(run[i]);
    }
    out.sort((a, b) => placeOf(view, a) - placeOf(view, b));
    return out;
  }
  /** Mark one message read, keeping the contiguous prefix and the extras. */
  _markRead(st, m) {
    const { upTo, extra } = this._readUpTo(st, m.device);
    if (m.dseq <= upTo) return;
    if (m.dseq === upTo + 1) {
      let n = m.dseq;
      while (extra.has(n + 1)) { extra.delete(n + 1); n += 1; }
      this._storeRead(st, m.device, n, extra);
    } else {
      extra.add(m.dseq);
      this._storeRead(st, m.device, upTo, extra);
    }
  }
  /** Mark every message up to and including m read (the old all-at-once behaviour). */
  _markAllRead(st, m) {
    const { upTo, extra } = this._readUpTo(st, m.device);
    const newUp = Math.max(upTo, m.dseq);
    const rest = new Set([...extra].filter((d) => d > newUp));
    this._storeRead(st, m.device, newUp, rest);
  }
  /** One message in the capped view: body cut to BODY_CUT unless it is a priority type. */
  _viewOne(m, { cut = true } = {}) {
    const doCut = cut && m.body.length > BODY_CUT;
    return { seq: m.seq, id: m.id, from: m.from, to: m.to, type: m.type, ref: m.ref, operator: m.operator, ts: m.ts, body: doCut ? m.body.slice(0, BODY_CUT) + CUT_MARK : m.body, cut: doCut };
  }
  /** New messages for this seat; counts as a heartbeat and answers comms checks.
   * Capped (a limit, or the capped flag) it shows the priority messages (hold, task) in full, then
   * any message that arrived later with an older time (never lost under the cap), then the last
   * `limit` of the in-order rest cut to BODY_CUT; it marks only what it showed read and says how
   * many it left. Uncapped it returns every fresh message and marks them all read, as the hook
   * path does. */
  unread(ctx, { seat = null, peek = false, limit = null, capped = false } = {}) {
    const who = this.resolve(ctx, { seat });
    const p = this._pulse(who.seat); const st = readState(p);
    const view = this._view(); const all = view.msgs;
    const names = this._names(who.seat);
    // only what lies past this seat's read position can be fresh, so that is all this looks at (a seat that has kept up looks at nothing)
    const above = this._pastRead(view, st);
    const fresh = above.filter((m) => this._toMe(who, m, names) && this._visible(who, m));
    const cap = capped || limit != null;
    const isPriority = (m) => m.type === 'task' || (m.type === 'hold' && m.operator);
    let shownMsgs = fresh; let notShown = 0;
    if (cap) {
      const lim = Math.min(Math.max(1, Math.floor(Number(limit)) || UNREAD_VIEW), UNREAD_MAX);
      // priority messages come first, in full, oldest first, at most UNREAD_MAX of them; the rest stay unread and are counted
      const allPriority = []; const late = []; const rest = [];
      // I always show a message that arrived after this seat's last call but landed at or before
      // what that call saw (written offline, for example), so it is not buried under newer ones. It
      // is new if its device counter is above the highest that call saw from its device; what was
      // already there and left unshown is not late, so the cap still applies to it on the next call.
      const seen = p.seen_seq || 0; const seenDseq = p.seen_dseq || null;
      const isLate = (m) => !!seenDseq && m.seq <= seen && m.dseq > (seenDseq[m.device] || 0);
      for (const m of fresh) { if (isPriority(m)) allPriority.push(m); else if (isLate(m)) late.push(m); else rest.push(m); }
      const priority = allPriority.slice(0, UNREAD_MAX); const newest = rest.slice(-lim);
      shownMsgs = [...priority, ...[...late, ...newest].sort((a, b) => a.seq - b.seq)];
      notShown = rest.length - newest.length + (allPriority.length - priority.length);
    }
    if (!peek) {
      if (cap) {
        for (const m of shownMsgs) this._markRead(st, m);
        for (const m of above) if (names.includes(m.from)) this._markRead(st, m);
      } else {
        // the read position moves to the highest counter meant for this seat on each computer, however many there are below it
        for (const run of view.runs.values()) {
          for (let i = run.length - 1; i >= 0; i--) if (this._toMe(who, run[i], names) || names.includes(run[i].from)) { this._markAllRead(st, run[i]); break; }
        }
      }
    }
    // these are answered as of the start of the call, whatever the heartbeat or an ack below adds to the bus
    const messages = cap ? shownMsgs.map((m) => this._viewOne(m, { cut: !isPriority(m) })) : fresh.map(copyOut);
    const hold = this.holdOn(who.seat, view);
    const toAck = who.operator && who.seat === OPERATOR ? [] : fresh.filter((x) => x.check && !(view.byRef.get(x.id) || []).some((a) => a.type === 'ack' && names.includes(a.from)));
    const ackOf = toAck.map((m) => ({ id: m.id, from: m.from }));
    // what this call saw: the bus position and, per device, the highest counter
    const frontier = all.length ? all[all.length - 1].seq : (p.seen_seq || 0);
    const seenDseq = this.counters();
    this.pulse(ctx, { who, read: peek ? null : st.read, readExtra: peek ? null : st.extra, seen: peek ? null : frontier, seenDseq: peek ? null : seenDseq });
    const acked = [];
    for (const m of ackOf) {
      try { if (!ctx.identity?.read_only) { this._append(who, { to: m.from, type: 'ack', body: 'comms check: here', ref: m.id, project: null }); acked.push(m.id); } } catch {}
    }
    return { seat: who.seat, operator: who.operator, hold, messages, ...(cap ? { not_shown: notShown } : {}), acked, ...(this.operator() ? {} : { lead_needed: LEAD_NEEDED }) };
  }

  // ---- pulse
  _pulse(seat) { return readJson(this._p('pulse', `${fileOf(seat)}.json`), { seat, read: {} }); }
  /** A heartbeat: the seat is here. The first one also joins the seat and says hello. */
  pulse(ctx, { who = null, read = null, readExtra = null, seen = null, seenDseq = null, session = null, at = Date.now() } = {}) {
    who ||= this.resolve(ctx);
    if (who.seat === OPERATOR) return null;
    const p = this._pulse(who.seat);
    const rec = { seat: who.seat, device: who.device.id, last_seen: new Date(at).toISOString(), session: session || ctx.session || p.session || null, beats: (p.beats || 0) + 1, read: read || p.read || {}, read_extra: readExtra || p.read_extra || {}, seen_seq: seen == null ? (p.seen_seq || 0) : seen, seen_dseq: seenDseq || p.seen_dseq || null };
    const f = `${fileOf(who.seat)}.json`;
    this._w(this._p('pulse', f));
    fs.mkdirSync(this._p('pulse'), { recursive: true });
    writeJson(this._p('pulse', f), rec);
    if (at - (this._pulseCommitted.get(f) || 0) > PULSE_COMMIT_MS) { this._pulseCommitted.set(f, at); this.commit(this._rel('pulse', f)); }
    const seatRec = this.seat(who.seat);
    if (seatRec && !seatRec.joined) {
      seatRec.joined = rec.last_seen; this._w(this._p('seats', f)); writeJson(this._p('seats', f), seatRec); this.commit(this._rel('seats', f));
      if (!ctx.identity?.read_only) this._append(who, { to: 'all', type: 'hello', body: `${who.seat} joined${who.operator ? ' (operator)' : ''}`, ref: null, project: null });
    }
    return rec;
  }

  holdOn(seat, view = this._view(), names = this._names(seat)) {
    const holds = view.holds;
    let h = null; for (let i = holds.length - 1; i >= 0 && !h; i--) if (names.includes(holds[i].to) || holds[i].to === 'all') h = holds[i];
    return h && !h.release ? { since: h.ts, by: h.from, reason: h.body, id: h.id } : null;
  }

  // ---- roster and comms check
  roster({ at = Date.now() } = {}) {
    const view = this._view(); const op = this.operator();
    const rows = this.seats().map((s) => {
      const dev = this.devices.get(s.device); const p = this._pulse(s.seat);
      const names = [s.seat, ...(s.renamed_from || [])];
      const last = lastOf(view, view.byFrom, names);
      let state = 'never joined';
      if (s.removed || !dev || dev.status !== 'active') state = 'removed';
      else if (s.joined && p.last_seen) state = ago(p.last_seen, at) <= this.liveMin ? 'live' : 'stale';
      const claimed = names.length > 1 ? [...new Set(names)].flatMap((n) => view.claimsBy.get(n) || []).sort((a, b) => placeOf(view, a) - placeOf(view, b)) : view.claimsBy.get(names[0]) || [];
      const claims = claimed.filter((m) => !view.verdicts.has(m.ref)).map((m) => m.ref);
      const status = lastOf(view, view.statusBy, names);
      return { seat: s.seat, client: s.client, device: s.device, device_label: dev?.label || s.device_label, device_kind: dev?.kind || s.device_kind, teammate: dev?.teammate || null, state, operator: op === s.seat, last_seen: p.last_seen || null, minutes_since: p.last_seen ? ago(p.last_seen, at) : null, last_message: last ? { seq: last.seq, type: last.type, ts: last.ts, body: last.body.slice(0, 120) } : null, hold: this.holdOn(s.seat, view, names), claims, status: status ? status.body.slice(0, 160) : null, project: s.project };
    });
    // licensed computers with no app on the bus yet
    const seated = new Set(rows.map((r) => r.device));
    for (const d of this.devices.list().filter((x) => x.kind === 'remote-computer' && !seated.has(x.id))) rows.push({ seat: null, client: null, device: d.id, device_label: d.label, device_kind: d.kind, teammate: d.teammate || null, state: d.status === 'active' ? 'never joined' : 'removed', operator: false, last_seen: null, minutes_since: null, last_message: null, hold: null, claims: [], status: null, project: null });
    return { live_minutes: this.liveMin, operator: op, seats: rows, ...(op ? {} : { lead_needed: LEAD_NEEDED }) };
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
      acks = (this._view().byRef.get(msg.id) || []).filter((m) => m.type === 'ack').map(copyOut);
      const waiting = targets.filter((r) => r.seat && r.state === 'live' && !acks.some((a) => a.from === r.seat));
      if (!waiting.length || Date.now() - start >= ms) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const answered = acks.map((a) => ({ seat: a.from, after_ms: Date.parse(a.ts) - Date.parse(msg.ts) }));
    const rows = this.roster().seats.filter((r) => r.seat !== msg.from && (to === 'all' || r.seat === to));
    const missing = rows.filter((r) => !acks.some((a) => a.from === r.seat)).map((r) => ({ seat: r.seat, device: r.device_label, client: r.client, state: r.state, reason: this.reasonFor(r) }));
    return { check: msg.id, seq: msg.seq, waited_ms: Date.now() - start, answered, missing };
  }

  /** Has this seat not seen this message yet (its read prefix or extras do not cover it)? */
  unreadFor(seat, m) {
    const p = this._pulse(seat);
    return !hasRead(p, m);
  }
  /** Tasks with who claimed them, the restatement, the latest status and the verdict. An unclaimed
   * task to a live seat that has not read it yet waits for that seat's next turn. */
  tasks(ctx, { open = false } = {}) {
    const who = this.resolve(ctx); const view = this._view();
    const live = new Set(this.roster().seats.filter((r) => r.seat && r.state === 'live').map((r) => r.seat));
    const pulses = new Map(); const pulseOf = (seat) => { let p = pulses.get(seat); if (p === undefined) { p = this._pulse(seat); pulses.set(seat, p); } return p; };
    return view.tasks.filter((m) => this._visible(who, m)).map((t) => {
      const rel = (view.byRef.get(t.id) || []).filter((m) => this._visible(who, m));
      const claim = rel.find((m) => m.type === 'claim'); const verdict = rel.filter((m) => m.type === 'verdict').at(-1);
      const state = verdict ? 'done' : claim ? 'claimed' : live.has(t.to) && !hasRead(pulseOf(t.to), t) ? 'waiting for next turn' : 'open';
      return { id: t.id, seq: t.seq, from: t.from, operator: t.operator, to: t.to, body: t.body, claimed_by: claim?.from || null, restated: rel.filter((m) => m.type === 'restate').at(-1)?.body || null, status: rel.filter((m) => m.type === 'status').at(-1)?.body || null, verdict: verdict?.body || null, state };
    }).filter((t) => !open || t.state !== 'done');
  }

  /** For memev doctor. */
  health({ at = Date.now() } = {}) {
    const files = this._logFiles(); let bad = 0; for (const f of files) { this._readLog(f); bad += this._cache.get(f)?.bad || 0; }
    const r = this.roster({ at });
    return { seats: r.seats.filter((s) => s.seat).length, live: r.seats.filter((s) => s.state === 'live').length, stale: r.seats.filter((s) => s.state === 'stale').map((s) => `${s.seat} (${s.minutes_since} min)`), never: r.seats.filter((s) => s.state === 'never joined').length, operator: r.operator, bad_lines: bad, messages: this._view().msgs.length };
  }
}

/** The one line other sessions get while no lead is set and the setup session has asked: it overrides the protocol's ask rule. */
export const LEAD_ASKED_LINE = 'The lead AI is not chosen yet. The person was already asked at setup, so do not ask again; `memev bus operator <seat>` sets it.';
/** The suggestion the setup session gets with the question: its own seat, for the person to accept or not. */
export const leadSuggestion = (seat) => `Suggested: ${seat} (the app in this session, which ran first after setup). The person decides.`;

/** Record that the setup session has asked which AI should lead, so other sessions get a quiet line instead of the question. */
export function markLeadAsked(root) {
  const f = path.join(root, BUS_DIR, 'operator.json');
  const op = readJson(f, null) || {};
  if (op.asked) return;
  if (linkedUnder(root, f)) return; // never written through a link (issue 256); the mark only quiets the lead question
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeJson(f, { ...op, asked: now() });
}

/** answered, ready (answers on its next turn), not opened yet, or a rejected credential. */
export function commsMark(row) {
  const reason = String(row.reason || '');
  if (row.state === 'rejected' || (/credential/i.test(reason) && /reject/i.test(reason))) return 'broken';
  if (row.state === 'live') return 'ready';
  if (!row.seat || row.state === 'never joined') return 'closed';
  return 'other';
}

/** Lines and exit code for `memev bus check`. Exit 1 only when a credential is rejected. */
export function commsCheckView(r) {
  const answered = r.answered || [];
  const buckets = { ready: [], closed: [], broken: [], other: [] };
  for (const m of r.missing || []) buckets[commsMark(m)].push(m);
  const lines = [`Comms check ${r.check}: ${answered.length} answered, ${buckets.ready.length} ready, ${buckets.closed.length} not opened yet${buckets.broken.length ? `, ${buckets.broken.length} broken` : ''} (waited ${Math.round((r.waited_ms || 0) / 1000)} s)`];
  for (const a of answered) lines.push(`  \u2713 ${a.seat} (${a.after_ms} ms)`);
  for (const m of buckets.ready) lines.push(`  \u25cf ${m.seat}: ready, answers on its next turn`);
  for (const m of buckets.closed) {
    const who = m.seat || m.device || 'that computer';
    const app = m.client || (m.seat ? m.seat.split('@')[0] : 'an app');
    lines.push(`  \u25cb ${who}: not opened yet, open ${app}`);
  }
  for (const m of buckets.other) lines.push(`    ${m.seat || m.device}: ${m.reason}`);
  for (const m of buckets.broken) lines.push(`  \u2717 ${m.seat || m.device}: ${m.reason || 'credential rejected'}`);
  return { lines, code: buckets.broken.length ? 1 : 0 };
}

/** A refused credential is a broken seat: the check prints a cross and exits 1. */
export function commsCredentialFailure(err) {
  const msg = String(err?.message || err || '');
  if (!/401|403|credential|unauthori[sz]ed|invalid token|rejected/i.test(msg)) return null;
  return { lines: [`  \u2717 credential rejected: ${msg}`], code: 1 };
}
