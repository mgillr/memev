// SPDX-License-Identifier: Apache-2.0
// `memev update` installs the newest version from a local tarball into a new runtime folder and points the
// launcher at it. The version check is opt-in and off by default: it reads a static version file whose location
// comes from the vault config, so nothing is sent anywhere unless it is turned on.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { configDir, exists, writeAtomic } from '../engine/util.mjs';
import { config } from './common.mjs';
import { VERSION } from '../engine/vault.mjs';
import { installRuntime, launcherScript, recordedNode } from './main.mjs';

/** The static version file the opt-in check reads, from the vault config. Empty when it is not set. */
export function versionFile(root) {
  const p = config(root)?.update?.version_file;
  return typeof p === 'string' ? p.trim() : '';
}

/** The newest version the static file names, or null when the file is missing or unreadable. */
export function latestVersion(root) {
  const f = versionFile(root);
  if (!f || !exists(f)) return null;
  const v = fs.readFileSync(f, 'utf8').trim();
  return v || null;
}

/**
 * Whether the opt-in version check is on. It is off by default: on only when the vault config sets
 * update.check to true, or the environment says so. Nothing is sent anywhere when it is off.
 */
export function checkEnabled(root, env = process.env) {
  if (env.MEMEV_UPDATE_CHECK === '1') return true;
  return config(root)?.update?.check === true;
}

/**
 * One 'update available' line when the check is on and the static file names a newer version, else null.
 * It reads only the local static file; it makes no network call.
 */
export function updateLine(root, env = process.env) {
  if (!checkEnabled(root, env)) return null;
  const latest = latestVersion(root);
  if (!latest || latest === VERSION) return null;
  return `update available: memev ${latest} (you have ${VERSION}); run memev update`;
}

/**
 * Install the tarball into a new runtime folder and point the launcher at it. The tarball is a local file
 * (the release tarball, or a test one); nothing is fetched. The new runtime is a fresh folder under the config
 * dir, and the launcher is rewritten to run it, so the old runtime stays until it is replaced.
 */
export function installFromTarball(tarball, env = process.env) {
  if (!exists(tarball)) throw new Error(`no such file: ${tarball}`);
  const cfgDir = configDir(env);
  fs.mkdirSync(cfgDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(cfgDir, 'update-'));
  try {
    fs.mkdirSync(path.join(work, 'src'), { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', path.join(work, 'src')]);
    // the tarball is the set npm publishes: package/ at the top, or the files at the top
    let top = path.join(work, 'src', 'package');
    if (!exists(path.join(top, 'package.json'))) top = path.join(work, 'src');
    const pkg = JSON.parse(fs.readFileSync(path.join(top, 'package.json'), 'utf8'));
    const ver = pkg.version || VERSION;
    const dir = path.join(cfgDir, 'runtime', ver);
    fs.mkdirSync(dir, { recursive: true });
    for (const d of ['bin', 'src', 'templates', 'vendor']) if (exists(path.join(top, d))) fs.cpSync(path.join(top, d), path.join(dir, d), { recursive: true, force: true });
    for (const f of ['package.json', 'LICENSE', 'NOTICE']) if (exists(path.join(top, f))) fs.copyFileSync(path.join(top, f), path.join(dir, f));
    const bin = path.join(cfgDir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const target = path.join(dir, 'bin', 'memev.mjs');
    if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'memev.cmd'), `@"${process.execPath}" "${target}" %*\r\n`);
    else writeAtomic(path.join(bin, 'memev'), launcherScript(recordedNode(env), target), 0o755);
    return { dir, launcher: path.join(bin, process.platform === 'win32' ? 'memev.cmd' : 'memev'), version: ver };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export async function command(cmd, pos, flags, { root, env }) {
  void cmd;
  const tarball = pos[0];
  if (!tarball) {
    console.log('Usage: memev update <tarball>');
    return 1;
  }
  const r = installFromTarball(tarball, env);
  console.log(`Installed memev ${r.version} at ${r.dir}; the launcher now runs it.`);
  return 0;
}
