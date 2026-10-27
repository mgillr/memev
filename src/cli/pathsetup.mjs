// SPDX-License-Identifier: Apache-2.0
// Getting the memev command on PATH. The launcher sits in the config folder's bin, which no shell has on PATH,
// so after a source install `memev` alone is not found. Two things handle that: until the folder is on PATH
// every `memev ...` hint that init prints shows the full launcher path, and `memev path add` puts the folder
// on PATH with the person's consent (one line in their shell's startup file on macOS and Linux, their own user
// PATH on Windows, never the system PATH). `memev path remove` takes it out again.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { configDir, homeDir } from '../engine/util.mjs';
import { out } from './common.mjs';

const MARK = '# added by memev';
const USER_ENV = 'HKCU\\Environment'; // the signed-in user's own environment, not the machine's

/** The folder the launcher is installed in. */
export const launcherDir = (env = process.env, platform = process.platform) => path.join(configDir(env), 'bin');
const launcherFile = (env, platform) => path.join(launcherDir(env, platform), platform === 'win32' ? 'memev.cmd' : 'memev');

const sameDir = (a, b, platform) => { const n = (x) => { const s = String(x).replace(/[\\/]+$/, ''); return platform === 'win32' ? s.toLowerCase() : s; }; return n(a) === n(b); };
export const pathEntries = (value, platform = process.platform) => String(value || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);

/** Whether the folder is on PATH for programs started from this environment. */
export function onPath(dir, env = process.env, platform = process.platform) {
  const key = platform === 'win32' ? Object.keys(env).find((k) => k.toLowerCase() === 'path') : 'PATH';
  return pathEntries(env[key], platform).some((e) => sameDir(e, dir, platform));
}

/** `memev` when the folder is on PATH, otherwise the full launcher path (quoted when it has spaces). */
export function commandName(env = process.env, platform = process.platform) {
  if (onPath(launcherDir(env, platform), env, platform)) return 'memev';
  const f = launcherFile(env, platform);
  return /\s/.test(f) ? `"${f}"` : f;
}

// the subcommands a hint can name: a lowercase `memev` followed by one of these is a command to run
const COMMANDS = ['init', 'connect', 'disconnect', 'uninstall', 'clients', 'status', 'doctor', 'cloud', 'tunnel', 'github', 'service', 'devices', 'invite', 'join', 'license', 'licence', 'bus', 'recall', 'card', 'remember', 'why', 'review', 'audit', 'checkpoint', 'claims', 'contract', 'verify', 'gate', 'token', 'start', 'stop', 'restart', 'serve', 'preflight', 'onboarding', 'path', 'help', 'version'];
const HINT = new RegExp(`(^|[\\s(\`'"\\u00b7:;,])memev (?=(?:${COMMANDS.join('|')})(?![\\w-]))`, 'gm');

/** Rewrite the `memev <command>` hints in a line of output to run the launcher by its full path. */
export function fullPathHints(text, launcher) { return String(text).replace(HINT, (m, pre) => `${pre}${launcher} `); }

/**
 * Run fn while everything it prints names the launcher by its full path, when the launcher's folder is not on PATH.
 * Nothing changes when it is, or for machine-readable output (--json).
 */
export async function withHints(env, argv, fn, platform = process.platform) {
  const name = commandName(env, platform);
  if (name === 'memev' || argv.includes('--json')) return fn();
  const log = console.log; const err = console.error;
  const wrap = (f) => (...a) => f(...a.map((x) => (typeof x === 'string' ? fullPathHints(x, name) : x)));
  console.log = wrap(log); console.error = wrap(err);
  try { return await fn(); } finally { console.log = log; console.error = err; }
}

/** The startup file of the person's shell, and the line that puts the folder on PATH. */
export function rcTarget(dir, env = process.env, platform = process.platform) {
  const home = homeDir(env); const shell = path.basename(env.SHELL || '');
  const q = (s) => s.replace(/(["\\$`])/g, '\\$1');
  if (shell === 'fish') return { file: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'fish', 'config.fish'), line: `fish_add_path "${q(dir)}" ${MARK}` };
  const file = shell === 'zsh' ? path.join(home, '.zshrc') : shell === 'bash' ? path.join(home, platform === 'darwin' ? '.bash_profile' : '.bashrc') : path.join(home, '.profile');
  return { file, line: `export PATH="${q(dir)}:$PATH" ${MARK}` };
}

/** Read and write the signed-in user's PATH on Windows through reg.exe. `run` is where the commands go (stubbed in tests). */
export function userPath(run = (args) => { const r = spawnSync('reg', args, { encoding: 'utf8', timeout: 15000 }); return r.error ? { ok: false, out: '' } : { ok: r.status === 0, out: `${r.stdout || ''}` }; }) {
  return {
    get() { const r = run(['query', USER_ENV, '/v', 'Path']); const m = /\bPath\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/im.exec(r.out || ''); return r.ok && m ? m[1] : ''; },
    set(value) { const r = run(['add', USER_ENV, '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f']); if (!r.ok) throw new Error('could not update your user PATH'); },
  };
}

/** Put the launcher folder on PATH. Idempotent: a second call changes nothing. */
export function addToPath({ env = process.env, platform = process.platform, dir = launcherDir(env, platform), reg = userPath() } = {}) {
  if (platform === 'win32') {
    const cur = reg.get();
    if (pathEntries(cur, platform).some((e) => sameDir(e, dir, platform))) return { changed: false, where: 'your user PATH' };
    reg.set(cur ? `${cur.replace(/;+$/, '')};${dir}` : dir);
    return { changed: true, where: 'your user PATH' };
  }
  const { file, line } = rcTarget(dir, env, platform);
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch {}
  if (text.split('\n').some((l) => l.trim() === line)) return { changed: false, where: file };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
  return { changed: true, where: file };
}

/** Take it out again: the line Memev added, or the entry in the user PATH. */
export function removeFromPath({ env = process.env, platform = process.platform, dir = launcherDir(env, platform), reg = userPath() } = {}) {
  if (platform === 'win32') {
    const cur = reg.get(); const parts = pathEntries(cur, platform);
    const keep = parts.filter((e) => !sameDir(e, dir, platform));
    if (keep.length === parts.length) return { changed: false, where: 'your user PATH' };
    reg.set(keep.join(';'));
    return { changed: true, where: 'your user PATH' };
  }
  const { file, line } = rcTarget(dir, env, platform);
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return { changed: false, where: file }; }
  const lines = text.split('\n'); const keep = lines.filter((l) => l.trim() !== line);
  if (keep.length === lines.length) return { changed: false, where: file };
  fs.writeFileSync(file, keep.join('\n'));
  return { changed: true, where: file };
}

/** On a terminal, once, offer to put memev on PATH. Declining changes nothing. */
export async function offer({ env = process.env, platform = process.platform, ask = null, reg } = {}) {
  const dir = launcherDir(env, platform);
  if (onPath(dir, env, platform) || env.MEMEV_NO_PATH_PROMPT) return null;
  const target = platform === 'win32' ? 'your user PATH' : rcTarget(dir, env, platform).file;
  let answer = '';
  if (ask) answer = await ask(target);
  else if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    answer = await rl.question(`\nAdd the memev command to ${target} so new terminals find it? [y/N] `); rl.close();
  } else return null;
  if (!/^y/i.test(String(answer).trim())) return { declined: true };
  const r = addToPath({ env, platform, dir, ...(reg ? { reg } : {}) });
  out.ok(`${r.changed ? 'Added the memev command to' : 'Already in'} ${r.where}; open a new terminal to use it`);
  return r;
}

export async function command(cmd, pos, flags, { env }) {
  const sub = pos[0] || 'status'; const dir = launcherDir(env);
  if (sub === 'add') { const r = addToPath({ env }); console.log(r.changed ? `Added ${dir} to ${r.where}. Open a new terminal to use memev.` : `${dir} is already on PATH in ${r.where}.`); return 0; }
  if (sub === 'remove') { const r = removeFromPath({ env }); console.log(r.changed ? `Removed ${dir} from ${r.where}.` : `Nothing to remove from ${r.where}.`); return 0; }
  if (sub === 'status') { const on = onPath(dir, env); console.log(on ? `memev is on PATH (${dir}).` : `memev is not on PATH. Run: ${launcherFile(env, process.platform)} path add`); return 0; }
  console.log('usage: memev path add|remove|status'); return 1;
}
