// SPDX-License-Identifier: Apache-2.0
// The WhatsApp library is not part of Memev. Memev has no runtime dependencies; the WhatsApp
// connection is an add-on, installed only when the person turns WhatsApp on, into this computer's
// private state (.memev/chat/whatsapp/lib/), from the manifest and lockfile in vendor/chat-whatsapp/
// (the lockfile ships as pinned-lock.json, since the Memev package itself carries no package-lock, and
// is copied in as package-lock.json for the install).
// The lockfile pins every package by version and sha512 integrity, `npm ci` refuses anything that
// does not match it, and install scripts never run.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PKG } from '../cli/common.mjs';
import { channelDir, ensureChannelDir } from './state.mjs';
import { run } from '../engine/util.mjs';

export const BAILEYS = Object.freeze({
  name: '@whiskeysockets/baileys',
  version: '7.0.0-rc14',
  integrity: 'sha512-WK+X8ju8TPGxvWIsP8hrY6JB6FltYuFe+vsqKfjOYX25JObij9qLf2c3ZGdl1Q+vhFwbnT+AZmWAB5pTvzmSiQ==',
  license: 'MIT',
});
export const ADDON_DIR = path.join(PKG, 'vendor', 'chat-whatsapp');
export const libDir = (root) => path.join(channelDir(root, 'whatsapp'), 'lib');

/** Problems with the shipped manifest and lockfile, empty when they pin exactly BAILEYS. */
export function checkPin(dir = ADDON_DIR) {
  const problems = [];
  let pkg, lock;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return ['vendor/chat-whatsapp/package.json is missing']; }
  try { lock = JSON.parse(fs.readFileSync(path.join(dir, 'pinned-lock.json'), 'utf8')); } catch { return ['vendor/chat-whatsapp/pinned-lock.json is missing']; }
  if (pkg.dependencies?.[BAILEYS.name] !== BAILEYS.version) problems.push(`the manifest does not pin ${BAILEYS.name} ${BAILEYS.version} exactly`);
  if (Object.keys(pkg.dependencies || {}).length !== 1) problems.push('the manifest names more than the one library');
  const entry = lock.packages?.[`node_modules/${BAILEYS.name}`];
  if (entry?.version !== BAILEYS.version || entry?.integrity !== BAILEYS.integrity) problems.push(`the lockfile does not pin ${BAILEYS.name} ${BAILEYS.version} with its integrity`);
  for (const [k, v] of Object.entries(lock.packages || {})) {
    if (!k) continue;
    if (!/^sha512-/.test(v.integrity || '')) problems.push(`${k} has no sha512 integrity in the lockfile`);
    let from = null; try { const u = new URL(v.resolved); from = u.protocol === 'https:' ? u.host : null; } catch {}
    if (from !== 'registry.npmjs.org') problems.push(`${k} does not come from the npm registry`);
  }
  return problems;
}
/** The installed library matches the pin, or a reason it does not. */
export function installedProblem(root) {
  const dir = libDir(root);
  let lock; try { lock = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', '.package-lock.json'), 'utf8')); } catch { return 'the WhatsApp library is not installed (memev chat whatsapp enable installs it)'; }
  const e = lock.packages?.[`node_modules/${BAILEYS.name}`];
  if (e?.version !== BAILEYS.version || e?.integrity !== BAILEYS.integrity) return `the installed WhatsApp library is not ${BAILEYS.version} with the pinned integrity`;
  return null;
}
/** Install the pinned library into this computer's private state with npm ci, no install scripts. */
export async function installBaileys(root, { runFn = run, npm = process.platform === 'win32' ? 'npm.cmd' : 'npm' } = {}) {
  const pin = checkPin();
  if (pin.length) throw new Error(`the WhatsApp add-on pin is broken: ${pin.join('; ')}`);
  ensureChannelDir(root, 'whatsapp');
  const dir = libDir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(ADDON_DIR, 'package.json'), path.join(dir, 'package.json'));
  fs.copyFileSync(path.join(ADDON_DIR, 'pinned-lock.json'), path.join(dir, 'package-lock.json'));
  const r = await runFn(npm, ['ci', '--ignore-scripts', '--legacy-peer-deps', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, timeout: 300e3 });
  if (r.status !== 0) throw new Error(`npm ci failed for the WhatsApp library: ${String(r.stderr || r.stdout || '').slice(-400)}`);
  const why = installedProblem(root);
  if (why) throw new Error(why);
  return { dir, version: BAILEYS.version };
}
/** Load the installed library, after checking it is the pinned one. */
export async function loadBaileys(root) {
  const why = installedProblem(root);
  if (why) throw new Error(why);
  const pkgDir = path.join(libDir(root), 'node_modules', ...BAILEYS.name.split('/'));
  const main = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).main || 'lib/index.js';
  return import(pathToFileURL(path.join(pkgDir, main)).href);
}
