import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
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
