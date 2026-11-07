// SPDX-License-Identifier: Apache-2.0
// Which app session an MCP server process belongs to, so the AI's own bus calls post as that session's seat.
//
// The session-start hook knows the session (the app passes session_id on stdin); the MCP server the app starts on
// stdio is told no session id. What both share is the app process: the app spawns the hook (through `sh -c`, or
// directly) and it spawns the MCP server. So the hook writes one small file per process above it (its parent, that
// one's parent, and one more), keyed by pid and naming the session and its seat; the MCP server walks up its own
// parents, nearest first, and the first file it finds names its session. Each file carries the process's start time,
// so a pid the system has handed to a new process since is not taken for the old one. The table comes from `ps` on
// macOS and Linux and from one PowerShell CIM query (Win32_Process) on Windows. Where it cannot be read (no PowerShell,
// or the query takes longer than WIN_PROCS_TIMEOUT_MS) nothing is linked, and the session-start context tells the AI
// which seat to pass.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, writePrivateJson } from '../engine/util.mjs';

export const LINK_DEPTH = 3;
const PROCS = 'procs';

export const WIN_PROCS_TIMEOUT_MS = 3000;
// One CIM query, the three Win32_Process properties by their documented names, as JSON. Windows PowerShell 5.1 ships
// with Windows 10 (1607 on) and 11; WMIC, the older way, is removed from Windows 11 24H2 on.
export const WIN_PROCS_COMMAND = 'Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate'
  + ' | Select-Object -Property ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress';

/** Windows PowerShell 5.1 at its fixed place under the Windows directory, or by name from PATH. */
export function windowsPowerShell(env = process.env) {
  const win = env.SystemRoot || env.windir || env.SYSTEMROOT || env.WINDIR;
  return win ? path.win32.join(win, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
}

/** A CreationDate as ConvertTo-Json writes it, as epoch milliseconds, or null. Windows PowerShell 5.1 writes
 *  "\/Date(ms)\/" (JSON.parse gives "/Date(ms)/"), possibly inside { value, ... }; PowerShell 7 writes ISO 8601
 *  with an offset; WMI itself uses the CIM form yyyymmddHHMMSS.mmmmmm+UUU (offset in minutes). */
export function cimTime(v) {
  if (v && typeof v === 'object' && 'value' in v) return cimTime(v.value);
  if (typeof v !== 'string') return null;
  let m = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(v);
  if (m) return Number(m[1]);
  m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\.(\d{6})([+-])(\d{3})$/.exec(v);
  if (m) {
    const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Math.floor(+m[7] / 1000));
    return local - (m[8] === '-' ? -1 : 1) * Number(m[9]) * 60e3;
  }
  if (!/^\d{4}-\d\d-\d\dT/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** The Get-CimInstance JSON as the process table: one process gives an object, several an array. A process with no
 *  creation time (the idle process) is left out, so a pid is only ever matched with its start time. */
export function parseWinProcs(text) {
  let j; try { j = JSON.parse(String(text).replace(/^﻿/, '').trim()); } catch { return null; }
  const rows = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : [];
  const t = new Map();
  for (const r of rows) {
    const pid = Number(r?.ProcessId); const ppid = Number(r?.ParentProcessId); const at = cimTime(r?.CreationDate);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && at !== null) t.set(pid, { ppid, started: String(at) });
  }
  return t.size ? t : null;
}

/** Every process as pid -> { ppid, started }, the same shape on every OS, or null when the table cannot be read.
 *  run has execFileSync's shape, so a test can stand in for ps or PowerShell. */
export function readProcs({ platform = process.platform, run = execFileSync, env = process.env } = {}) {
  if (platform === 'win32') {
    let out;
    try { out = run(windowsPowerShell(env), ['-NoProfile', '-NonInteractive', '-Command', WIN_PROCS_COMMAND], { encoding: 'utf8', timeout: WIN_PROCS_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1048576, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
    return parseWinProcs(out);
  }
  let out; try { out = run('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'lstart='], { encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1048576 }); } catch { return null; }
  const t = new Map();
  for (const line of String(out).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) t.set(Number(m[1]), { ppid: Number(m[2]), started: m[3] });
  }
  return t.size ? t : null;
}

// Windows keeps a process's parent id after the parent exits, so it can name a newer process that took the id; a
// parent that started after its child is not its parent. Only Windows start times (epoch ms) are compared.
const startedAfter = (a, b) => /^\d+$/.test(a ?? '') && /^\d+$/.test(b ?? '') && Number(a) > Number(b);

/** The processes above pid, nearest first, at most depth of them; pid 1 and below end the walk. */
export function ancestors(pid, table, depth = LINK_DEPTH) {
  if (!table) return [];
  const out = []; let child = table.get(pid); let cur = child?.ppid;
  while (cur > 1 && out.length < depth) {
    const p = table.get(cur); if (!p || startedAfter(p.started, child.started)) break;
    out.push({ pid: cur, started: p.started });
    child = p; cur = p.ppid;
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
