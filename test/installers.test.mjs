import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { freePort as reservedPort } from './helpers/cli.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolPath = `${path.dirname(process.execPath)}:/usr/bin:/bin`;

function cleanEnv(home, extra = {}) {
  return {
    HOME: home,
    PATH: toolPath,
    TMPDIR: os.tmpdir(),
    ...extra,
  };
}

// The run-wide reservation in helpers/cli.mjs: a port freed here could be handed to another test file before install.sh binds it (issue 457).
function freePort() {
  return Promise.resolve(reservedPort());
}

function processCommand(pid) {
  const column = process.platform === 'darwin' ? 'command=' : 'args=';
  return execFileSync('ps', ['-p', String(pid), '-o', column], { encoding: 'utf8' });
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('MEM-014 AC03: release-tarball.mjs produces a tarball and a .sha256 file whose hash matches', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-rel-'));
  try {
    execFileSync('node', ['scripts/release-tarball.mjs', '--out', out], { cwd: root });
    const names = fs.readdirSync(out).filter((f) => f.endsWith('.tgz') || f.endsWith('.tar.gz'));
    assert.equal(names.length, 1, names.join(','));
    const sum = fs.readFileSync(path.join(out, names[0] + '.sha256'), 'utf8').trim().split(/\s+/)[0];
    assert.equal(sum, sha256(path.join(out, names[0])));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('MEM-014 AC02: install.sh installs from a local tarball URL and refuses a tarball whose SHA-256 does not match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-ins-'));
  try {
    const bin = path.join(dir, 'package', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package', 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(bin, 'memev.mjs'), [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "if (process.argv[2] !== 'init') process.exit(2);",
      "fs.writeFileSync(process.env.MEMEV_INSTALL_MARKER, 'ok');",
      "const home = process.env.HOME;",
      "const cfg = process.env.MEMEV_CONFIG_DIR || (process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'memev') : path.join(home, '.config', 'memev'));",
      "const launcher = path.join(cfg, 'bin', 'memev');",
      "fs.mkdirSync(path.dirname(launcher), { recursive: true });",
      "fs.writeFileSync(launcher, '#!/bin/bash\\nexit 0\\n');",
      "fs.chmodSync(launcher, 0o755);",
      '',
    ].join('\n'));
    const tarball = path.join(dir, 'memev.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', dir, 'package']);
    const good = sha256(tarball);
    const sum = path.join(dir, 'memev.tgz.sha256');
    fs.writeFileSync(sum, good + '  memev.tgz\n');
    const marker = path.join(dir, 'marker');
    execFileSync('bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], {
      env: cleanEnv(dir, { MEMEV_INSTALL_MARKER: marker }),
    });
    assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');

    fs.writeFileSync(sum, '0000000000000000000000000000000000000000000000000000000000000000  memev.tgz\n');
    const badMarker = path.join(dir, 'marker-bad');
    let failed = false;
    try {
      execFileSync('bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], {
        env: cleanEnv(dir, { MEMEV_INSTALL_MARKER: badMarker }),
      });
    } catch (e) {
      failed = true;
      const text = `${e.stdout || ''}${e.stderr || ''}`;
      assert.match(text, /SHA-256 does not match/);
    }
    assert.equal(failed, true);
    assert.equal(fs.existsSync(badMarker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install.sh refuses a URL that is not https or a file URL', () => {
  let failed = false;
  try {
    execFileSync('bash', [path.join(root, 'scripts', 'install.sh'), 'http://127.0.0.1/memev.tgz'], {
      env: cleanEnv(os.tmpdir()),
      timeout: 5000,
    });
  } catch (e) {
    failed = true;
    assert.match(`${e.stdout || ''}${e.stderr || ''}`, /URL must be https or a file URL/);
  }
  assert.equal(failed, true);
});

test('install.sh restarts the daemon from the installed copy', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-home-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-pack-'));
  const env = cleanEnv(home, {
    MEMEV_NO_SERVICE: '1',
    MEMEV_NO_TUNNEL: '1',
    MEMEV_NO_DOWNLOAD: '1',
  });
  let pid = null;
  const launcher = path.join(home, '.config', 'memev', 'bin', 'memev');
  try {
    execFileSync('node', ['scripts/release-tarball.mjs', '--out', out], { cwd: root, env, timeout: 120000 });
    const names = fs.readdirSync(out).filter((f) => f.endsWith('.tgz') || f.endsWith('.tar.gz'));
    assert.equal(names.length, 1);
    const port = await freePort();
    execFileSync('bash', [
      path.join(root, 'scripts', 'install.sh'),
      'file://' + path.join(out, names[0]),
      '--local-only',
      '--no-connect',
      '--port',
      String(port),
    ], { env, timeout: 120000 });
    const vault = fs.readFileSync(path.join(home, '.config', 'memev', 'default'), 'utf8').trim();
    const info = JSON.parse(fs.readFileSync(path.join(vault, '.memev', 'daemon.json'), 'utf8'));
    pid = info.pid;
    const cmd = processCommand(pid);
    const main = cmd.match(/\S+\/server\/main\.mjs/);
    assert.ok(main, cmd);
    assert.equal(fs.existsSync(main[0]), true);
    assert.match(main[0], /\/runtime\//);
  } finally {
    if (fs.existsSync(launcher)) {
      try { execFileSync(launcher, ['stop'], { env, timeout: 20000 }); } catch { /* already stopped */ }
    }
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

function platformKey() {
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64';
  throw new Error('no pinned runtime for ' + process.platform + ' ' + process.arch);
}

function toolShim(dir) {
  const bin = path.join(dir, 'pathbin');
  fs.mkdirSync(bin);
  const names = ['cp', 'tar', 'gzip', 'awk', 'mktemp', 'shasum', 'sha256sum', 'uname', 'grep', 'sed', 'tr', 'mkdir', 'rm', 'mv', 'chmod', 'head', 'cat', 'dirname'];
  for (const name of names) {
    let src = '';
    try { src = execFileSync('bash', ['-lc', 'command -v ' + name], { encoding: 'utf8' }).trim(); } catch { src = ''; }
    if (src) fs.symlinkSync(src, path.join(bin, name));
  }
  return bin;
}

test('MEM-041 AC02: the pinned runtime lists a SHA-256 per platform', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'node-runtime.json'), 'utf8'));
  const platforms = spec.platforms;
  assert.ok(platforms && Object.keys(platforms).length > 0);
  for (const [name, pin] of Object.entries(platforms)) {
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, name);
    assert.match(pin.url, /^https:\/\/nodejs\.org\/dist\/v22\.23\.4\//, name);
  }
});

test('MEM-041 AC01: install.sh with no node on PATH downloads the pinned runtime from the URL in node-runtime.json (stubbed) and verifies its checksum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-node-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  try {
    const key = platformKey();
    const committed = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'node-runtime.json'), 'utf8'));
    const topName = 'node-v22.23.4-' + key;
    const binDir = path.join(dir, topName, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), [
      '#!/bin/bash',
      'if [ "$1" = "--version" ]; then echo v22.23.4; exit 0; fi',
      'printf "%s\\n" "$0" > "$MEMEV_INSTALL_MARKER"',
      'mkdir -p "$HOME/.config/memev/bin"',
      'printf "%s\\n" "#!/bin/bash" "exit 0" > "$HOME/.config/memev/bin/memev"',
      'chmod +x "$HOME/.config/memev/bin/memev"',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    const archive = path.join(dir, 'node.tgz');
    execFileSync('tar', ['-czf', archive, '-C', dir, topName]);
    const good = sha256(archive);
    const specPath = path.join(dir, 'node-runtime.json');
    const spec = { version: committed.version, platforms: {} };
    spec.platforms[key] = { url: committed.platforms[key].url, sha256: good };
    fs.writeFileSync(specPath, JSON.stringify(spec));
    const log = path.join(dir, 'fetch.log');
    const fetchStub = path.join(dir, 'fetch-stub');
    fs.writeFileSync(fetchStub, '#!/bin/bash\nprintf "%s\\n" "$1" > "$MEMEV_NODE_FETCH_LOG"\ncp "$MEMEV_NODE_FAKE_TGZ" "$2"\n', { mode: 0o755 });
    const pkg = path.join(dir, 'package', 'bin');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package', 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(pkg, 'memev.mjs'), 'process.exit(0)\n');
    const tarball = path.join(dir, 'memev.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', dir, 'package']);
    fs.writeFileSync(tarball + '.sha256', sha256(tarball) + '  memev.tgz\n');
    const marker = path.join(dir, 'marker');
    const env = {
      HOME: home,
      PATH: toolShim(dir),
      TMPDIR: os.tmpdir(),
      MEMEV_INSTALL_MARKER: marker,
      MEMEV_NODE_SPEC: specPath,
      MEMEV_NODE_FETCH: fetchStub,
      MEMEV_NODE_FETCH_LOG: log,
      MEMEV_NODE_FAKE_TGZ: archive,
    };
    execFileSync('/bin/bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], { env, timeout: 20000 });
    assert.equal(fs.readFileSync(log, 'utf8').trim(), committed.platforms[key].url);
    const used = fs.readFileSync(marker, 'utf8').trim();
    assert.equal(fs.existsSync(used), true);
    assert.match(used, /\/node\/v22\.23\.4\/bin\/node$/);

    spec.platforms[key].sha256 = '0000000000000000000000000000000000000000000000000000000000000000';
    fs.writeFileSync(specPath, JSON.stringify(spec));
    const bad = path.join(dir, 'marker-bad');
    let failed = false;
    try {
      execFileSync('/bin/bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], {
        env: { ...env, MEMEV_INSTALL_MARKER: bad, MEMEV_CONFIG_DIR: path.join(dir, 'cfg-bad') },
        timeout: 20000,
      });
    } catch (e) {
      failed = true;
      assert.match(`${e.stdout || ''}${e.stderr || ''}`, /SHA-256 does not match/);
    }
    assert.equal(failed, true);
    assert.equal(fs.existsSync(bad), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function pinsBetween(text, open, close) {
  const start = text.indexOf(open);
  const end = text.indexOf(close, start + open.length);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return JSON.parse(text.slice(start + open.length, end));
}

test('the installer scripts carry the same pins as node-runtime.json', () => {
  const file = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'node-runtime.json'), 'utf8'));
  const sh = fs.readFileSync(path.join(root, 'scripts', 'install.sh'), 'utf8');
  const ps = fs.readFileSync(path.join(root, 'scripts', 'install.ps1'), 'utf8');
  const fromSh = pinsBetween(sh, "<<'END_NODE_RUNTIME'\n", '\nEND_NODE_RUNTIME');
  const fromPs = pinsBetween(ps, 'function Embedded-RuntimeSpec {\n  @\'\n', '\n\'@');
  assert.deepEqual(fromSh, file);
  assert.deepEqual(fromPs, file);
});

test('piped install.sh uses the built-in pin with no node on PATH and no spec file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-pipe-'));
  const home = path.join(dir, 'home');
  const cwd = path.join(dir, 'empty');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  try {
    const key = platformKey();
    const committed = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'node-runtime.json'), 'utf8'));
    const pkg = path.join(dir, 'package', 'bin');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package', 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(pkg, 'memev.mjs'), 'process.exit(0)\n');
    const tarball = path.join(dir, 'memev.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', dir, 'package']);
    fs.writeFileSync(tarball + '.sha256', sha256(tarball) + '  memev.tgz\n');
    const archive = path.join(dir, 'not-the-runtime');
    fs.writeFileSync(archive, 'not a node runtime\n');
    const log = path.join(dir, 'fetch.log');
    const fetchStub = path.join(dir, 'fetch-stub');
    fs.writeFileSync(fetchStub, '#!/bin/bash\nprintf "%s\\n" "$1" > "$MEMEV_NODE_FETCH_LOG"\ncp "$MEMEV_NODE_FAKE_TGZ" "$2"\n', { mode: 0o755 });
    const script = fs.readFileSync(path.join(root, 'scripts', 'install.sh'));
    const result = spawnSync('/bin/bash', ['-s', '--', 'file://' + tarball], {
      input: script,
      cwd,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        HOME: home,
        PATH: toolShim(dir),
        TMPDIR: os.tmpdir(),
        MEMEV_NODE_FETCH: fetchStub,
        MEMEV_NODE_FETCH_LOG: log,
        MEMEV_NODE_FAKE_TGZ: archive,
      },
    });
    assert.equal(fs.readFileSync(log, 'utf8').trim(), committed.platforms[key].url);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout || ''}${result.stderr || ''}`, /SHA-256 does not match/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a second install reuses the pinned runtime when its version matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-reuse-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  try {
    const key = platformKey();
    const committed = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'node-runtime.json'), 'utf8'));
    const topName = 'node-v22.23.4-' + key;
    const binDir = path.join(dir, topName, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), [
      '#!/bin/bash',
      'if [ "$1" = "--version" ]; then echo v22.23.4; exit 0; fi',
      'mkdir -p "$HOME/.config/memev/bin"',
      'printf "%s\\n" "#!/bin/bash" "exit 0" > "$HOME/.config/memev/bin/memev"',
      'chmod +x "$HOME/.config/memev/bin/memev"',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    const archive = path.join(dir, 'node.tgz');
    execFileSync('tar', ['-czf', archive, '-C', dir, topName]);
    const specPath = path.join(dir, 'node-runtime.json');
    const spec = { version: committed.version, platforms: {} };
    spec.platforms[key] = { url: committed.platforms[key].url, sha256: sha256(archive) };
    fs.writeFileSync(specPath, JSON.stringify(spec));
    const pkg = path.join(dir, 'package', 'bin');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package', 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(pkg, 'memev.mjs'), 'process.exit(0)\n');
    const tarball = path.join(dir, 'memev.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', dir, 'package']);
    fs.writeFileSync(tarball + '.sha256', sha256(tarball) + '  memev.tgz\n');
    const log = path.join(dir, 'fetch.log');
    const fetchStub = path.join(dir, 'fetch-stub');
    fs.writeFileSync(fetchStub, '#!/bin/bash\nprintf "%s\\n" "$1" > "$MEMEV_NODE_FETCH_LOG"\ncp "$MEMEV_NODE_FAKE_TGZ" "$2"\n', { mode: 0o755 });
    const env = {
      HOME: home,
      PATH: toolShim(dir),
      TMPDIR: os.tmpdir(),
      MEMEV_NODE_SPEC: specPath,
      MEMEV_NODE_FETCH: fetchStub,
      MEMEV_NODE_FETCH_LOG: log,
      MEMEV_NODE_FAKE_TGZ: archive,
    };
    execFileSync('/bin/bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], { env, timeout: 20000 });
    fs.writeFileSync(log, 'STILL\n');
    execFileSync('/bin/bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], { env, timeout: 20000 });
    assert.equal(fs.readFileSync(log, 'utf8'), 'STILL\n');
    assert.equal(fs.existsSync(path.join(home, '.config', 'memev', 'node', 'v22.23.4', 'bin', 'node')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
