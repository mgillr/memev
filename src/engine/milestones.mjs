// SPDX-License-Identifier: Apache-2.0
// Activation milestones, worked out on this computer from what the vault already keeps: its operation log,
// the comms bus and the invites file. Nothing is sent anywhere and this file makes no network call; the
// result is written to .memev/onboarding.json next to the setup checklist. docs/METRICS.md defines each one.
//
//   installed               the vault exists
//   second_app_joined       a second AI app (not the terminal) has a seat or has used the vault
//   first_cross_app_recall  an app recalled a memory another app saved
//   two_apps_one_memory     the same, within 24 hours of the save: the activation metric
//   first_bus_message       a seat sent a message other than hello
//   invite_sent             memev invite made a one-time code
//   comms_activation        the first comms check that two seats answered
//
// A milestone, once recorded, keeps its first date and is never removed.
import fs from 'node:fs';
import path from 'node:path';
import { readLines } from './oplog.mjs';
import { readJson, writeJson, now as isoNow } from './util.mjs';

export const MILESTONES = ['installed', 'second_app_joined', 'first_cross_app_recall', 'two_apps_one_memory', 'first_bus_message', 'invite_sent', 'comms_activation'];
export const WINDOW_MS = 24 * 3600e3;
const WRITES = new Set(['put', 'splice', 'append']);
// callers that are not an AI app: the terminal, files edited by hand
const NOT_AN_APP = new Set(['cli', 'external', 'terminal', 'operator', '']);
const isApp = (c) => typeof c === 'string' && !NOT_AN_APP.has(c.toLowerCase());
const ms = (ts) => Date.parse(ts);
const earlier = (a, b) => (a && (!b || ms(a) <= ms(b)) ? a : b);

/**
 * Pure: milestones from already-read data. records: operation log records in order; seats: bus seat records;
 * messages: bus messages in any order; invites: the invite records; seen: the time of this look (the date of
 * a milestone whose source keeps no date).
 */
export function deriveMilestones({ records = [], seats = [], messages = [], invites = [], seen = isoNow() } = {}) {
  const found = {};
  const mark = (name, at) => { if (at && (!found[name] || ms(at) < ms(found[name].at))) found[name] = { at }; };

  // one pass over the log: who wrote each path last, and which apps have used the vault
  const lastWrite = new Map(); const appFirst = new Map(); let first = null;
  let cross = null, activated = null;
  for (const r of records) {
    first = earlier(first, r.ts);
    if (isApp(r.client) && !appFirst.has(r.client)) appFirst.set(r.client, r.ts);
    if (WRITES.has(r.type) && r.path) lastWrite.set(r.path, { client: r.client, ts: r.ts });
    if (r.type === 'usage' && isApp(r.client)) {
      for (const item of r.data?.items || []) {
        const w = lastWrite.get(String(item).split('#')[0]);
        if (!w || !isApp(w.client) || w.client === r.client) continue;
        cross = earlier(cross, r.ts);
        if (ms(r.ts) - ms(w.ts) <= WINDOW_MS) activated = earlier(activated, r.ts);
      }
    }
  }
  if (cross) mark('first_cross_app_recall', cross);
  if (activated) mark('two_apps_one_memory', activated);

  // installed: the vault's first operation, or the first seat, or this look
  const created = seats.map((s) => s.created).filter(Boolean).sort()[0] || null;
  mark('installed', earlier(first, created) || seen);

  // second app: the second distinct app by the time it first appeared, in the log or as a seat that joined
  const apps = new Map(appFirst);
  for (const s of seats) {
    if (!s.joined || s.removed || !isApp(s.client)) continue;
    apps.set(s.client, earlier(s.joined, apps.get(s.client)));
  }
  const times = [...apps.values()].sort((a, b) => ms(a) - ms(b));
  if (times.length >= 2) mark('second_app_joined', times[1]);

  // the bus
  const talk = messages.filter((m) => m && m.type && m.type !== 'hello' && !m.check && m.type !== 'ack');
  if (talk.length) mark('first_bus_message', talk.map((m) => m.ts).sort()[0]);
  const acks = new Map();
  for (const m of messages) if (m?.type === 'ack' && m.ref && m.from) { if (!acks.has(m.ref)) acks.set(m.ref, new Map()); const by = acks.get(m.ref); by.set(m.from, earlier(m.ts, by.get(m.from))); }
  for (const c of messages.filter((m) => m?.check)) {
    const by = [...(acks.get(c.id) || new Map())].filter(([seat]) => seat !== c.from);
    if (by.length >= 2) mark('comms_activation', by.map(([, t]) => t).sort((a, b) => ms(a) - ms(b))[1]);
  }

  // an invite carries no date of its own, so it is dated by this look the first time it is seen
  if (invites.length) mark('invite_sent', seen);
  return found;
}

const jsonLines = (file) => { const out = []; for (const [line] of readLines(file)) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line is not a record */ } } return out; };
const listJson = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f), null)).filter(Boolean); } catch { return []; } };

/** Read this vault's own files (no daemon needed, nothing written). */
export function readSources(root) {
  const logDir = path.join(root, '.memev', 'oplog');
  let segs = []; try { segs = fs.readdirSync(logDir).filter((f) => /^seg-\d+\.jsonl$/.test(f)).sort(); } catch { /* no log yet */ }
  const records = []; for (const s of segs) records.push(...jsonLines(path.join(logDir, s)));
  records.sort((a, b) => a.seq - b.seq);
  let messages = []; try { for (const f of fs.readdirSync(path.join(root, 'bus', 'log')).filter((x) => x.endsWith('.jsonl'))) messages.push(...jsonLines(path.join(root, 'bus', 'log', f))); } catch { /* no bus */ }
  const inv = readJson(path.join(root, '.memev', 'invites.json'), null);
  return { records, seats: listJson(path.join(root, 'bus', 'seats')), messages, invites: Object.values(inv?.invites || {}) };
}

const file = (root) => path.join(root, '.memev', 'onboarding.json');

/** The milestones recorded so far in onboarding.json: { name: { at } }. */
export const loadMilestones = (root) => readJson(file(root), null)?.milestones || {};

/** Work out the milestones and add the new ones to onboarding.json. Recorded ones keep their date. Returns what is recorded. */
export function recordMilestones({ root, seen = isoNow() }) {
  const cur = readJson(file(root), null) || {};
  const have = cur.milestones || {};
  const found = deriveMilestones({ ...readSources(root), seen });
  const next = { ...have };
  for (const n of MILESTONES) if (found[n] && !next[n]) next[n] = found[n];
  if (JSON.stringify(next) !== JSON.stringify(have)) writeJson(file(root), { ...cur, milestones: next }, 0o600);
  return next;
}
