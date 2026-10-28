// SPDX-License-Identifier: Apache-2.0
// `memev preflight`: what this machine allows. memev init runs the four checks that matter before it writes
// anything (Node 22 or newer, git, the port, a folder it can write to) and stops with the exact fix for the
// platform when one fails. Every input that varies (platform, Node version, the git probe, the port, the
// folders) is a parameter, so the checks are tested for darwin, win32 and linux on any machine.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, exists, run as spawn } from '../engine/util.mjs';
import { config, out } from './common.mjs';

const probe = (cmd, args) => { const r = spawn(cmd, args, { timeout: 15000 }); return { ok: r.ok, out: `${r.stdout}${r.stderr}`.trim() }; };

/** Whether a folder, or the nearest folder above it that exists, can be written to. Writes nothing. */
export function canWrite(p) {
  let d = path.resolve(p);
  for (;;) {
    let st;
    try { st = fs.statSync(d); } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return false;
      const up = path.dirname(d); if (up === d) return false; d = up; continue;
    }
    if (!st.isDirectory()) return false;
    try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; }
  }
}

/** The port this vault will use: free, already this vault's daemon, or the next free one above it. */
async function defaultPortCheck(root, wanted) {
  const { choosePort, portFree, healthy } = await import('./daemon.mjs');
  const port = await choosePort(root, wanted);
  if (port !== wanted) return { state: 'moved', port };
  return (await portFree(wanted)) || (await healthy(root, wanted)) ? { state: 'free', port } : { state: 'none', port };
}

/** The commands that fix each check on each platform. */
export function fixFor(id, platform, extra = {}) {
  const win = platform === 'win32'; const mac = platform === 'darwin';
  if (id === 'node') return win ? 'Install Node.js 22 or newer: winget install OpenJS.NodeJS.LTS (or download it from nodejs.org), then open a new terminal.'
    : mac ? 'Install Node.js 22 or newer: brew install node (or download it from nodejs.org), then open a new terminal.'
      : 'Install Node.js 22 or newer from nodejs.org (for example with nvm: nvm install 22), then open a new terminal.';
  if (id === 'git') return win ? 'Install git: winget install Git.Git, then open a new terminal.'
    : mac ? 'Install git: xcode-select --install'
      : 'Install git: sudo apt install git (Debian, Ubuntu); on Fedora: sudo dnf install git';
  if (id === 'port') return `Free the port, or pick another one: memev init --port ${extra.suggest || 7790}`;
  if (id === 'home') return win ? 'Choose a folder you can write to: memev init --root C:\\Users\\<you>\\memev, and make sure your user profile folder is not read-only.'
    : `Make that folder writable (chmod u+w ${extra.dir || '<folder>'}), or choose another: memev init --root <folder you can write to>`;
  return '';
}

/**
 * The four checks init needs, one result each, in a fixed order. state is granted (fine), applied (Memev will
 * handle it) or manual (needs you). Nothing is created or written.
 */
export async function checkEnvironment({ env = process.env, root, port = null, platform = process.platform, nodeVersion = process.versions.node, run = probe, portCheck = defaultPortCheck, writable = canWrite } = {}) {
  const items = [];
  const add = (id, state, what, detail = '', fix = '') => items.push({ id, state, ok: state !== 'manual', what, detail, fix });
  const major = Number(String(nodeVersion).split('.')[0]);
  add('node', major >= 22 ? 'granted' : 'manual', 'Node.js 22 or newer', `found ${nodeVersion}`, major >= 22 ? '' : fixFor('node', platform));
  const g = run('git', ['--version']);
  add('git', g.ok ? 'granted' : 'manual', 'git installed', g.ok ? g.out : 'git was not found on PATH', g.ok ? '' : fixFor('git', platform));
  const wanted = Number(port) || Number(config(root).port) || 7787;
  const p = await portCheck(root, wanted);
  if (p.state === 'moved') add('port', 'applied', `port ${wanted} free on 127.0.0.1`, `in use by another program; init will use ${p.port}`);
  else if (p.state === 'free') add('port', 'granted', `port ${wanted} free on 127.0.0.1`);
  else add('port', 'manual', `port ${wanted} free on 127.0.0.1`, `${wanted} and the 99 ports above it are all in use`, fixFor('port', platform, { suggest: wanted + 1000 > 65535 ? 20000 : wanted + 1000 }));
  const dirs = [['config folder', configDir(env)], ['vault folder', root]];
  const blocked = dirs.filter(([, d]) => !writable(d));
  add('home', blocked.length ? 'manual' : 'granted', 'home writable', blocked.length ? `cannot write to ${blocked.map(([n, d]) => `the ${n} ${d}`).join(' or ')}` : dirs.map(([, d]) => d).join(', '), blocked.length ? fixFor('home', platform, { dir: blocked[0][1] }) : '');
  return items;
}

/** Print the failed checks, each with its fix. */
export function report(items) {
  const bad = items.filter((i) => !i.ok);
  for (const i of bad) { out.bad(`${i.what}: ${i.detail}`); out.info(i.fix); }
  return bad.length;
}

// What a sandbox leaves in the environment of the programs it runs: Codex sets CODEX_SANDBOX (seatbelt on macOS)
// and, when the sandbox has no network, CODEX_SANDBOX_NETWORK_DISABLED. A value of 0 or false means not set.
const MARKERS = ['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'];

/** The sandbox marker in this environment, as NAME=value, or null. */
export function sandboxMarker(env = process.env) {
  for (const k of MARKERS) { const v = String(env[k] ?? '').trim(); if (v && !/^(0|false|no)$/i.test(v)) return `${k}=${v}`; }
  return null;
}

/** The init command to run in the person's own terminal: the same one, with the options they gave. */
export function initCommand(flags = {}) {
  const parts = ['memev', 'init'];
  for (const k of ['root', 'port', 'lead']) if (typeof flags[k] === 'string' && /^[\w./:@~+-]+$/.test(flags[k])) parts.push(`--${k} ${flags[k]}`);
  for (const k of ['local-only', 'org', 'no-connect']) if (flags[k] === true) parts.push(`--${k}`);
  return parts.join(' ');
}

/** Inside a sandbox init cannot write the vault or the apps' config: it stops before anything is written. */
export function sandboxStop({ env = process.env, flags = {} } = {}) {
  const marker = sandboxMarker(env);
  if (!marker) return null;
  return [
    `This session runs inside a sandbox (${marker}), which keeps init from writing your vault and your apps' settings, so init stopped before it wrote anything.`,
    'Run this in your own terminal, outside the sandbox:',
    '',
    `    ${initCommand(flags)}`,
    '',
    'Or, in Codex, approve the request to run it outside the sandbox when it asks.',
  ].join('\n');
}

/** Print the sandbox stop and say so (true), or do nothing (false). */
export function stopInSandbox({ env = process.env, flags = {} } = {}) {
  const text = sandboxStop({ env, flags });
  if (!text) return false;
  const [first, ...rest] = text.split('\n');
  out.bad(first); console.log(rest.join('\n'));
  return true;
}

/** What init does before it writes anything: false (after printing why) when it must stop. */
export async function gate({ root, env = process.env, flags = {}, ...inject }) {
  if (stopInSandbox({ env, flags })) return false;
  const items = await checkEnvironment({ env, root, port: flags.port, ...inject });
  const failed = report(items);
  if (failed) console.log(`\nMemev did not set anything up. Fix ${failed === 1 ? 'this' : 'these'} and run memev init again.`);
  return failed === 0;
}

/** Everything this machine allows, for `memev preflight`: the init checks first, then the rest. */
export async function preflight({ env = process.env, root, ...inject }) {
  const items = await checkEnvironment({ env, root, ...inject });
  const add = (state, what, detail = '') => items.push({ id: what, state, ok: state !== 'manual', what, detail, fix: '' });
  const service = await import('./service.mjs');
  const { kind, file } = service.unitPaths(env);
  add(file && exists(file) ? 'applied' : kind === 'none' ? 'manual' : 'granted', `start at login (${kind})`, file || '');
  const { pickProvider } = await import('./tunnel.mjs');
  const prov = pickProvider({ remote: { provider: 'auto' } }, env);
  add(prov === 'tailscale' ? 'granted' : 'applied', 'remote access provider', prov === 'tailscale' ? 'Tailscale Funnel (stable address)' : 'Cloudflare quick tunnel (address changes on restart; Tailscale gives a stable one)');
  add(probe('git', ['config', 'user.email']).ok ? 'granted' : 'applied', 'git identity for vault commits', 'Memev uses a local identity in the vault when none is set');
  return items;
}

export async function command(cmd, pos, flags, { root, env }) {
  const items = await preflight({ env, root, port: flags.port });
  for (const i of items) console.log(`  ${i.state.padEnd(8)} ${i.what}${i.detail ? ` · ${i.detail}` : ''}${i.state === 'manual' && i.fix ? `\n           ${i.fix}` : ''}`);
  return items.some((i) => ['node', 'git', 'port', 'home'].includes(i.id) && !i.ok) ? 1 : 0;
}
