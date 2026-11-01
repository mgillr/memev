// SPDX-License-Identifier: Apache-2.0
// Small shared helpers: hashing, atomic files, private files, time, paths.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as spawnChild, spawnSync, execFileSync } from 'node:child_process';

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
/** True when a symbolic link is on the way from `root` down to `abs` (the existing segments below root, `abs` included), or when
 * `abs` is outside root. Engine code that writes the vault with its own file calls checks it first, so a link that arrived from
 * disk or a synced backup never sends a write outside the vault (issue 256). */
export function linkedUnder(root, abs) {
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return true;
  let cur = root;
  for (const seg of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg);
    let st; try { st = fs.lstatSync(cur); } catch { return false; }
    if (st.isSymbolicLink()) return true;
  }
  return false;
}
export const now = () => new Date().toISOString();
export const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
export const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

/**
 * Run a command without throwing when the binary is missing: ok is false and error holds the message,
 * so a caller can say what is wrong instead of crashing on a null stdout.
 */
export function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) return { ok: false, status: null, stdout: '', stderr: '', error: r.error.message };
  return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: null };
}

/**
 * Run a command without blocking this process, so a server keeps answering while it runs. Resolves (never rejects) to
 * { ok, status, stdout, stderr, error, timedOut, tooLarge }. The command is its own process group: a timeout or more output
 * than maxBuffer kills the whole group with SIGKILL, so a child it started does not outlive it.
 */
export function runAsync(cmd, args = [], { cwd, env, timeout = 0, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let child; let done = false; let timer = null;
    let stdout = ''; let stderr = ''; let size = 0; let timedOut = false; let tooLarge = false; let failed = null;
    const finish = (status, signal) => {
      if (done) return; done = true; clearTimeout(timer);
      const error = failed || (timedOut ? `timed out after ${Math.round(timeout / 1000)} s` : tooLarge ? 'output too large' : signal ? `ended by ${signal}` : null);
      resolve({ ok: status === 0 && !error, status: error ? null : status, stdout, stderr, error, timedOut, tooLarge });
    };
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } } };
    try { child = spawnChild(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, status: null, stdout: '', stderr: '', error: e.message, timedOut: false, tooLarge: false }); }
    const take = (which) => (b) => {
      if (done || tooLarge) return;
      size += b.length;
      if (size > maxBuffer) { tooLarge = true; killGroup(); return; }
      if (which === 'out') stdout += b; else stderr += b;
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', take('out')); child.stderr.on('data', take('err'));
    child.on('error', (e) => { failed = e.message; finish(null, null); });
    child.on('close', (status, signal) => finish(status, signal));
    // a grandchild that escaped the group and holds the pipes open must not hold the result back
    child.on('exit', (status, signal) => setTimeout(() => finish(status, signal), 2000).unref());
    if (timeout > 0) timer = setTimeout(() => { timedOut = true; killGroup(); }, timeout);
  });
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Write atomically: a temp file in the same directory, fsync, rename. */
export function writeAtomic(file, data, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', mode);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch {}
}
export const writeJson = (file, value, mode = 0o644) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
export const writePrivate = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writeAtomic(file, data, 0o600); };
export const writePrivateJson = (file, value) => writePrivate(file, `${JSON.stringify(value, null, 2)}\n`);

/** The per-user configuration directory: XDG_CONFIG_HOME, APPDATA on Windows, ~/.config otherwise. */
export function configDir(env = process.env) {
  const home = env.HOME || os.homedir();
  if (env.MEMEV_CONFIG_DIR) return env.MEMEV_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'memev');
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'memev');
  return path.join(home, '.config', 'memev');
}
export const homeDir = (env = process.env) => env.HOME || os.homedir();

export function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('hex'); }

export function timingSafeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Glob match for vault paths: ** any depth, * one segment, ? one char. */
export function globMatch(glob, p) {
  const re = '^' + glob.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, (c) => (c === '?' ? '[^/]' : `\\${c}`))).join('[^/]*')).join('.*') + '$';
  return new RegExp(re).test(p);
}

export function slug(s, max = 48) {
  // Names the old rule already gave a slug for keep it, so what was filed before an upgrade is
  // still found; the Unicode rule only takes over where the old rule said 'untitled'.
  const old = String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  if (old) return old;
  return [...String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '')].slice(0, max).join('') || 'untitled';
}

export function truncate(s, n) { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

// ---- what the vault lock (src/engine/oplog.mjs) records about this process and this boot. Each reader takes its file and process
// calls as arguments so a test can stand in for another platform. None of them goes through PATH.

/** The per-boot identifier of this machine: /proc/sys/kernel/random/boot_id on Linux, kern.bootsessionuuid on macOS, else null. */
export function machineBootId({ platform = process.platform, readFile = fs.readFileSync, exec = execFileSync } = {}) {
  try {
    if (platform === 'linux') return readFile('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
    if (platform === 'darwin') return exec('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8', env: {}, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { /* unreadable: no identifier */ }
  return null;
}

/** The pid namespace of this process (readlink /proc/self/ns/pid) on Linux, else null. */
export function pidNamespace({ platform = process.platform, readlink = fs.readlinkSync } = {}) {
  if (platform !== 'linux') return null;
  try { return readlink('/proc/self/ns/pid'); } catch { return null; }
}

/** The milliseconds of `ps -o lstart=` output ("Sun Nov  1 09:00:00 2026", in UTC), or null when it is not that shape. */
export function parseLstart(text) {
  const m = /^[A-Za-z]{3} ([A-Za-z]{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(String(text).trim());
  const month = m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1]) : -1;
  return month < 0 ? null : Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

/**
 * When a process started, in milliseconds on a scale that is the same for every reader on this boot, or null when it cannot be
 * read (the holder then counts as alive). Linux: field 22 of /proc/<pid>/stat, in clock ticks since boot (100 a second), which no
 * change of the wall clock moves. macOS: /bin/ps -o lstart= -p <pid> run with TZ=UTC and LC_ALL=C.
 */
export function processStart(pid, { platform = process.platform, readFile = fs.readFileSync, exec = execFileSync } = {}) {
  try {
    if (platform === 'linux') {
      const stat = readFile(`/proc/${pid}/stat`, 'utf8');
      const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
      return Number.isFinite(ticks) ? ticks * 10 : null;
    }
    if (platform === 'darwin') return parseLstart(exec('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { TZ: 'UTC', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { /* the process is gone or unreadable */ }
  return null;
}
