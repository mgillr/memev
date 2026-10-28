// memev update installs the newest version from a local tarball into a new runtime folder and points the
// launcher at it. The version check is opt-in and off by default: it reads a static version file whose
// location comes from the vault config, so nothing is sent anywhere unless it is turned on.
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sandbox } from './helpers/cli.mjs';
import { cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { command, updateLine, checkEnabled, latestVersion } from '../src/cli/update.mjs';
import { stopDaemon } from '../src/cli/daemon.mjs';
import { VERSION } from '../src/engine/vault.mjs';

after(() => cleanup());

const launcherOf = (sb) => path.join(sb.env.MEMEV_CONFIG_DIR, 'bin', 'memev');

// A local tarball with the shape npm publishes (package/ at the top) and a version of its own.
async function makeTarball(version, { withSha = true } = {}) {
  const d = tmpdir('pkg-');
  const top = path.join(d, 'package');
  fs.mkdirSync(path.join(top, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(top, 'src', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(top, 'package.json'), `${JSON.stringify({ name: 'memev', version }, null, 2)}\n`);
  fs.writeFileSync(path.join(top, 'bin', 'memev.mjs'), `#!/usr/bin/env node\nconsole.log('memev ${version}');\n`);
  fs.writeFileSync(path.join(top, 'src', 'cli', 'main.mjs'), `export const VERSION = '${version}';\n`);
  const t = path.join(d, `memev-${version}.tgz`);
  spawnSync('tar', ['-czf', t, '-C', d, 'package'], { encoding: 'utf8' });
  if (withSha) {
    const { sha256 } = await import('../src/engine/util.mjs');
    fs.writeFileSync(t + '.sha256', `${sha256(fs.readFileSync(t))}  ${path.basename(t)}\n`);
  }
  return t;
}

function setUpdate(root, update) {
  const file = path.join(root, '.memev', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.update = update;
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

test('MEM-082 AC01: memev update from a local test tarball installs the new runtime and the launcher points to it', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const tarball = await makeTarball('9.9.9');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.equal(await command('update', [tarball], {}, { root: sb.root, env: sb.env }), 0);
  } finally {
    console.log = orig;
  }
  // the new runtime is a fresh folder under the config dir, holding the tarball's files
  const dir = path.join(sb.env.MEMEV_CONFIG_DIR, 'runtime', '9.9.9');
  assert.ok(fs.existsSync(path.join(dir, 'bin', 'memev.mjs')), 'the new runtime folder holds the installed files');
  assert.match(fs.readFileSync(path.join(dir, 'bin', 'memev.mjs'), 'utf8'), /memev 9\.9\.9/);
  // the launcher points at the new runtime
  const launcher = fs.readFileSync(launcherOf(sb), 'utf8');
  assert.match(launcher, new RegExp(`JS='${path.join(dir, 'bin', 'memev.mjs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), 'the launcher points at the new runtime');
  // the launcher runs the new version
  const r = spawnSync(launcherOf(sb), ['--version'], { env: { ...sb.env }, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /memev 9\.9\.9/);
  // the install is local: the module fetches nothing
  const src = fs.readFileSync(path.join(PKG, 'src', 'cli', 'update.mjs'), 'utf8');
  assert.doesNotMatch(src, /fetchOut|https?:\/\/\S+|node:(http|https|net|dns|tls)/);
});

test('MEM-082 AC02: With the check off (default), doctor and status make no network call', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  // a static file that names a newer version, but the check is off (the default)
  const vf = path.join(sb.root, 'version.txt');
  fs.writeFileSync(vf, '9.9.9\n');
  setUpdate(sb.root, { version_file: vf }); // no check key: off by default
  assert.equal(checkEnabled(sb.root, sb.env), false, 'the check is off by default');
  assert.equal(updateLine(sb.root, sb.env), null, 'no update line when the check is off');
  // the module reads only the local static file: it has no way to reach a network
  const src = fs.readFileSync(path.join(PKG, 'src', 'cli', 'update.mjs'), 'utf8');
  assert.doesNotMatch(src, /fetchOut|https?:\/\/\S+|node:(http|https|net|dns|tls)/);
  // doctor shows no update line and makes no network call
  const doc = sb.run(['doctor']);
  assert.equal(doc.out.includes('update available'), false, doc.out);
  // status makes no network call for the check: with the daemon stopped it reports that, and shows no update line
  const st = sb.run(['status']);
  assert.equal(st.out.includes('update available'), false, st.out);
});

test('MEM-082 AC03: With the check on and a newer version in the static file, doctor and status show one update available line', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const vf = path.join(sb.root, 'version.txt');
  fs.writeFileSync(vf, '9.9.9\n');
  setUpdate(sb.root, { version_file: vf, check: true });
  assert.equal(checkEnabled(sb.root, sb.env), true, 'the check is on');
  assert.equal(latestVersion(sb.root), '9.9.9');
  // doctor shows exactly one update available line
  const doc = sb.run(['doctor']);
  const docLines = doc.out.split('\n').filter((l) => l.includes('update available'));
  assert.equal(docLines.length, 1, doc.out);
  assert.match(docLines[0], /update available: memev 9\.9\.9 \(you have \S+\); run memev update/);
  // status shows exactly one update available line (the daemon is started so status can read the vault)
  const start = sb.run(['start']);
  assert.equal(start.code, 0, start.out);
  const st = sb.run(['status']);
  const stLines = st.out.split('\n').filter((l) => l.includes('update available'));
  assert.equal(stLines.length, 1, st.out);
  assert.match(stLines[0], /update available: memev 9\.9\.9 \(you have \S+\); run memev update/);
  // the same version shows no line
  fs.writeFileSync(vf, `${VERSION}\n`);
  assert.equal(updateLine(sb.root, sb.env), null, 'no line when the static file names the current version');
});

test('MEM-082 AC04: update is refused when the sha256 does not match', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const tarball = await makeTarball('9.9.9');
  // a wrong sha256 beside the tarball
  fs.writeFileSync(tarball + '.sha256', `${'0'.repeat(64)}  ${path.basename(tarball)}\n`);
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await assert.rejects(command('update', [tarball], {}, { root: sb.root, env: sb.env }), /sha256 mismatch/);
  } finally {
    console.log = orig;
  }
  // the runtime folder was not created
  const dir = path.join(sb.env.MEMEV_CONFIG_DIR, 'runtime', '9.9.9');
  assert.equal(fs.existsSync(dir), false, 'no runtime folder when the sha256 does not match');
});

test('MEM-082 AC05: update is refused when there is no sha256', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const tarball = await makeTarball('9.9.9', { withSha: false });
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await assert.rejects(command('update', [tarball], {}, { root: sb.root, env: sb.env }), /no sha256/);
  } finally {
    console.log = orig;
  }
  // the runtime folder was not created
  const dir = path.join(sb.env.MEMEV_CONFIG_DIR, 'runtime', '9.9.9');
  assert.equal(fs.existsSync(dir), false, 'no runtime folder when there is no sha256');
});

test('MEM-082 AC06: update accepts a --sha256 flag when the tarball has no .sha256 file', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const tarball = await makeTarball('9.9.9', { withSha: false });
  const { sha256 } = await import('../src/engine/util.mjs');
  const expected = sha256(fs.readFileSync(tarball));
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.equal(await command('update', [tarball], { sha256: expected }, { root: sb.root, env: sb.env }), 0);
  } finally {
    console.log = orig;
  }
  // the new runtime is installed
  const dir = path.join(sb.env.MEMEV_CONFIG_DIR, 'runtime', '9.9.9');
  assert.ok(fs.existsSync(path.join(dir, 'bin', 'memev.mjs')), 'the new runtime folder holds the installed files');
});

test('MEM-082 AC07: update restarts the daemon when it is running', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const start = sb.run(['start']);
  assert.equal(start.code, 0, start.out);
  const tarball = await makeTarball('9.9.9');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.equal(await command('update', [tarball], {}, { root: sb.root, env: sb.env }), 0);
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((l) => l.includes('Daemon restarted')), lines.join('\n'));
});

test('MEM-082 AC08: update prints a restart instruction when the daemon is not running', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  // make sure the daemon is not running
  await stopDaemon(sb.root);
  const tarball = await makeTarball('9.9.9');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.equal(await command('update', [tarball], {}, { root: sb.root, env: sb.env }), 0);
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((l) => l.includes('Run memev restart')), lines.join('\n'));
});

test('MEM-082 AC09: updateLine only warns for numerically newer versions', async () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const vf = path.join(sb.root, 'version.txt');
  setUpdate(sb.root, { version_file: vf, check: true });
  // a numerically older version shows no line
  fs.writeFileSync(vf, '0.0.1\n');
  assert.equal(updateLine(sb.root, sb.env), null, 'no line for an older version');
  // an invalid version shows no line
  fs.writeFileSync(vf, 'not-a-version\n');
  assert.equal(updateLine(sb.root, sb.env), null, 'no line for an invalid version');
  // a numerically newer version shows a line
  fs.writeFileSync(vf, '9.9.9\n');
  assert.ok(updateLine(sb.root, sb.env), 'a line for a newer version');
});
