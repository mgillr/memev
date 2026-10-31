// SPDX-License-Identifier: Apache-2.0
// Small shared helpers: hashing, atomic files, private files, time, paths.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
