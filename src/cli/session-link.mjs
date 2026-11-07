// SPDX-License-Identifier: Apache-2.0
// Which app session an MCP server process belongs to, so the AI's own bus calls post as that session's seat.
//
// The session-start hook knows the session (the app passes session_id on stdin); the MCP server the app starts on
// stdio is told no session id. What both share is the app process: the app spawns the hook (through `sh -c`, or
// directly) and it spawns the MCP server. So the hook writes one small file per process above it (its parent, that
// one's parent, and one more), keyed by pid and naming the session and its seat; the MCP server walks up its own
// parents, nearest first, and the first file it finds names its session. Each file carries the process's start time,
// so a pid the system has handed to a new process since is not taken for the old one. Where the process table cannot
// be read (no `ps`, as on Windows) nothing is linked, and the session-start context tells the AI which seat to pass.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, writePrivateJson } from '../engine/util.mjs';

export const LINK_DEPTH = 3;
const PROCS = 'procs';

/** Every process as pid -> { ppid, started }, or null when the table cannot be read. */
export function procTable() {
  if (process.platform === 'win32') return null;
  let out; try { out = execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'lstart='], { encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1048576 }); } catch { return null; }
  const t = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) t.set(Number(m[1]), { ppid: Number(m[2]), started: m[3] });
  }
  return t.size ? t : null;
}

/** The processes above pid, nearest first, at most depth of them; pid 1 and below end the walk. */
export function ancestors(pid, table, depth = LINK_DEPTH) {
  if (!table) return [];
  const out = []; let cur = table.get(pid)?.ppid;
  while (cur > 1 && out.length < depth) {
    const p = table.get(cur); if (!p) break;
    out.push({ pid: cur, started: p.started });
    cur = p.ppid;
  }
  return out;
}

const fileFor = (dir, pid) => path.join(dir, PROCS, `${pid}.json`);

/** The hook's side: record that the processes above it run this session, in this seat. */
export function writeLink(dir, chain, { session, seat, client }) {
  for (const a of chain) {
    try { writePrivateJson(fileFor(dir, a.pid), { started: a.started, session, seat: seat || null, client, at: new Date().toISOString() }); } catch {}
  }
}

/** The MCP server's side: the session of the nearest process above it that a hook of the same app recorded. */
export function readLink(dir, chain, client) {
  for (const a of chain) {
    const r = readJson(fileFor(dir, a.pid), null);
    if (r && r.started === a.started && r.session && (!client || !r.client || r.client === client)) return r;
  }
  return null;
}
