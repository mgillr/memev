// SPDX-License-Identifier: Apache-2.0
// `memev ready`: the end of setup, seen from the apps. An app joins the comms bus with the first session it opens (its
// first heartbeat), and two apps share one memory once one of them recalls a memory the other one wrote. This only
// reads: the seats under bus/ and the vault's operation log, from where it last stopped.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, readJson } from '../engine/util.mjs';
import { isVault } from '../engine/vault.mjs';
import { clientDefs } from './clients.mjs';
import { healthy } from './daemon.mjs';

const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// session journals are written for every app on its own; a memory is something an app chose to keep
const journal = (p) => p.startsWith('work/sessions/');

/** When each app first joined: the earliest heartbeat of any of its seats. */
function joinedAt(root, apps) {
  const dir = path.join(root, 'bus', 'seats'); const at = new Map();
  let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch {}
  for (const f of files) {
    const s = readJson(path.join(dir, f), null);
    if (!s?.joined || s.removed || !apps.includes(s.client)) continue;
    if (!at.has(s.client) || s.joined < at.get(s.client)) at.set(s.client, s.joined);
  }
  return at;
}

/** The operation log as it grows: whole lines only, each segment from the byte where the last read stopped. */
function logReader(root) {
  const dir = path.join(root, '.memev', 'oplog'); const offset = new Map();
  return function* read() {
    for (const seg of readJson(path.join(dir, 'manifest.json'), { segments: [] }).segments) {
      let fd; try { fd = fs.openSync(path.join(dir, seg.name), 'r'); } catch { continue; }
      try {
        const from = offset.get(seg.name) || 0; const size = fs.fstatSync(fd).size;
        if (size <= from) continue;
        const buf = Buffer.alloc(size - from); fs.readSync(fd, buf, 0, buf.length, from);
        const end = buf.lastIndexOf(10); if (end < 0) continue; // only a line still being written
        offset.set(seg.name, from + end + 1);
        for (const line of buf.subarray(0, end).toString('utf8').split('\n')) { if (line) { try { yield JSON.parse(line); } catch {} } }
      } finally { fs.closeSync(fd); }
    }
  };
}

/** Feed new log records into who wrote each note, and note every recall of one app's note by another app. */
function scan(read, writers, shared) {
  for (const rec of read()) {
    if (!rec.client) continue;
    if (rec.type === 'usage') {
      for (const item of rec.data?.items || []) {
        for (const w of writers.get(String(item).split('#')[0]) || []) if (w !== rec.client) shared.push([w, rec.client]);
      }
    } else if (rec.path && rec.type !== 'delete' && !journal(rec.path)) {
      if (!writers.has(rec.path)) writers.set(rec.path, new Set());
      writers.get(rec.path).add(rec.client);
    }
  }
}

export async function command(cmd, pos, flags, { root, env }) {
  if (!isVault(root)) { console.log(`No vault at ${root}. Run memev init first, or memev ready on the computer that holds the vault.`); return 1; }
  const timeout = flags.timeout === undefined ? 600 : Number(flags.timeout);
  if (!(timeout >= 0)) throw new Error('memev ready [--timeout SECONDS]');
  const names = Object.fromEntries(clientDefs(env, 'memev').map((d) => [d.id, d.name]));
  const name = (id) => names[id] || id;
  const apps = Object.keys(readJson(path.join(configDir(env), 'clients-state.json'), {}).connected || {});
  if (!apps.length) { console.log('No AI app is connected yet: memev connect <app> (memev clients lists them).'); return 1; }
  if (!(await healthy(root))) { console.log('Memev is not running: memev start, then memev ready again.'); return 1; }
  console.log(`Waiting for ${list(apps.map(name))} to join (up to ${timeout} s). Open a new session or chat in each.`);
  const every = Number(env.MEMEV_READY_POLL_MS) || 1000; const deadline = Date.now() + timeout * 1000;
  const read = logReader(root); const writers = new Map(); const shared = []; const told = new Set(); let hinted = false;
  for (;;) {
    const joined = joinedAt(root, apps);
    for (const [id, ts] of [...joined].sort((a, b) => (a[1] < b[1] ? -1 : 1))) if (!told.has(id)) { told.add(id); console.log(`${name(id)} joined at ${hhmm(ts)}`); }
    scan(read, writers, shared);
    const pair = shared.find(([w, r]) => joined.has(w) && joined.has(r));
    if (pair) {
      console.log(`Ready: ${name(pair[0])} and ${name(pair[1])} share one memory`);
      const later = apps.filter((id) => !joined.has(id));
      if (later.length) console.log(`Not joined yet: ${list(later.map(name))}. Each joins with the first session you open in it.`);
      return 0;
    }
    if (apps.length === 1 && joined.size === 1) { console.log(`Ready: ${name(apps[0])} is connected. Connect a second app to share one memory between them.`); return 0; }
    if (joined.size >= 2 && !hinted) { hinted = true; const [a, b] = [...joined.keys()]; console.log(`Now ask ${name(a)} to remember something, then ask ${name(b)} about it.`); }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(every, deadline - Date.now()));
  }
  const missing = apps.filter((id) => !told.has(id));
  if (missing.length) console.log(`Not joined after ${timeout} s: ${list(missing.map(name))}. Open a new session in ${missing.length > 1 ? 'each' : 'it'}; memev doctor shows what is wrong.`);
  else console.log(`Every app joined, but none has recalled a memory another app wrote yet. Ask one to remember something and another about it, then memev ready again.`);
  return 1;
}
