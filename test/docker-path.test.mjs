// SO-R-B: the Docker path. I read the image and compose file statically, I test the graceful stop
// against a daemon started in the sandbox, I run the smoke script against a recording stub docker,
// and I run the container entry point outside Docker through the same code path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { cleanup, PKG, tmpdir } from './helpers/tmp.mjs';
import { sandbox, BIN } from './helpers/cli.mjs';
import { initVault, Vault, isVault } from '../src/engine/vault.mjs';

after(() => cleanup());

const read = (p) => fs.readFileSync(path.join(PKG, p), 'utf8');

const waitFor = async (fn, ms = 20000) => {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start >= ms) throw new Error(`timed out after ${ms}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const refused = (port) => new Promise((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); reject(new Error('the listener is still open')); });
  s.once('error', (e) => resolve(e.code));
});

const stopChild = (child) => new Promise((res) => {
  const t0 = Date.now();
  child.once('close', (code) => res({ code, ms: Date.now() - t0 }));
  child.kill('SIGTERM');
});

test('SO-R-B AC01: the Dockerfile and compose.yaml carry the named volume, the loopback port, the full health check, an unprivileged user, the version label and a pinned tag', () => {
  const dockerfile = read('Dockerfile');
  const compose = read('compose.yaml');
  const pkg = JSON.parse(read('package.json'));
  assert.match(compose, /^\s+memev-vault:\s*$/m, 'the vault is a named volume');
  assert.match(compose, /memev-vault:\/vault/, 'the volume is mounted at /vault');
  assert.match(compose, /127\.0\.0\.1:7787:7787/, 'the port is published on the loopback address by default');
  const hc = dockerfile.split('\n').find((l) => l.startsWith('HEALTHCHECK'));
  assert.ok(hc, 'the Dockerfile has a HEALTHCHECK');
  for (const f of ['--interval', '--timeout', '--retries', '--start-period']) assert.ok(hc.includes(f), `the HEALTHCHECK has ${f}`);
  assert.match(hc, /\/healthz/, 'the HEALTHCHECK probes /healthz');
  assert.match(dockerfile, /^USER memev$/m, 'the process runs as an unprivileged user');
  assert.doesNotMatch(dockerfile, /^USER\s+root/m, 'the process does not run as root');
  assert.ok(dockerfile.includes(`ARG MEMEV_VERSION=${pkg.version}`), 'ARG MEMEV_VERSION matches the package version');
  assert.match(dockerfile, /org\.opencontainers\.image\.version="\$\{MEMEV_VERSION\}"/, 'the image carries org.opencontainers.image.version from package.json');
  const m = /image:\s*\$\{MEMEV_IMAGE:-([^}]+)\}/.exec(compose);
  assert.ok(m, 'compose names the image with a MEMEV_IMAGE override');
  assert.ok(m[1].includes(':'), 'the default image has a tag');
  assert.notEqual(m[1].slice(m[1].lastIndexOf(':') + 1), 'latest', 'the compose file pins a tag that is not latest');
});

test('SO-R-B AC01: a daemon that receives SIGTERM flushes the op-log, closes its listener and exits 0 within the grace period, the op-log intact afterwards', async () => {
  const sb = sandbox();
  const root = path.join(tmpdir('vault-'), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: sb.port });
  const child = spawn(process.execPath, [path.join(PKG, 'src', 'server', 'main.mjs'), '--root', root, '--port', String(sb.port)], { env: { ...sb.env, MEMEV_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  try {
    await waitFor(() => err.includes('serving'));
    const r = sb.run(['remember', 'graceful stop note', '--kind', 'fact'], { extraEnv: { MEMEV_ROOT: root } });
    assert.equal(r.code, 0, r.out + r.err);
    const { code, ms } = await stopChild(child);
    assert.ok(ms <= 10000, `the daemon exited within the documented 10 second grace period (took ${ms}ms)`);
    assert.equal(code, 0, `the daemon exited 0 (got ${code}); stderr: ${err}`);
    assert.equal(await refused(sb.port), 'ECONNREFUSED', 'the listener is closed');
    const v = new Vault(root).open();
    assert.equal(v.log.verify().ok, true, 'the op-log verifies after the stop');
    const hit = v.recall({ id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] }, { query: 'graceful stop note' })[0];
    assert.ok(hit && hit.snippet.includes('graceful stop note'), 'the note written before the stop is still recalled');
    v.close();
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

test('SO-R-B AC02: docs/DOCKER.md documents the path and every variable the image reads', () => {
  const docs = read('docs/DOCKER.md');
  const names = new Set();
  for (const src of [read('Dockerfile'), read('compose.yaml'), read('src/server/main.mjs')]) {
    for (const m of src.matchAll(/MEMEV_[A-Z0-9_]+/g)) names.add(m[0]);
  }
  assert.ok(names.size >= 9, `I found ${names.size} variables the image reads`);
  for (const n of [...names].sort()) assert.ok(docs.includes(n), `docs/DOCKER.md documents ${n}`);
  for (const h of [/persistent data/i, /ports/i, /permission/i, /health check/i, /upgrad/i, /shutdown/i]) assert.match(docs, h, `docs/DOCKER.md has a ${h} section`);
  assert.match(docs, /docker compose pull/, 'the upgrade path pulls the new tag');
  assert.match(docs, /docker compose up -d/, 'the upgrade path starts it');
  const shutdown = docs.split(/##\s*Safe shutdown/)[1] || '';
  assert.match(shutdown, /keeps the volume/i, 'the shutdown section says down keeps the volume');
  assert.match(docs, /docker pull /, 'the pull-and-run example pulls the image');
  assert.match(docs, /placeholder/i, 'the page marks the image name as a placeholder until a registry is decided');
});

const STUB = `#!/bin/sh
echo "docker $*" >> "$DOCKER_STUB_LOG"
if [ "$1" = "volume" ]; then
  echo "local  memev-vault"
  exit 0
fi
if [ "$1" != "compose" ]; then
  exit 0
fi
case "$2" in
  ps)
    if [ -n "\${DOCKER_STUB_UNHEALTHY:-}" ]; then
      echo '{"Service":"memev","State":"running","Health":"starting"}'
    elif [ -f "$DOCKER_STUB_STATE/need-healthy" ]; then
      rm -f "$DOCKER_STUB_STATE/need-healthy"
      echo '{"Service":"memev","State":"running","Health":"starting"}'
    else
      echo '{"Service":"memev","State":"running","Health":"healthy"}'
    fi
    ;;
  up|restart)
    touch "$DOCKER_STUB_STATE/need-healthy"
    ;;
  exec)
    case "$*" in
      *recall*) echo "docker smoke note" ;;
    esac
    ;;
esac
exit 0
`;

const step = (line) => {
  if (line.startsWith('docker pull ')) return 'pull';
  if (line.startsWith('docker volume')) return 'volume';
  const parts = line.split(' ');
  if (parts[1] === 'compose') {
    if (parts[2] === 'exec') return parts.includes('remember') ? 'exec-remember' : 'exec-recall';
    return parts[2];
  }
  return parts[1];
};

test('SO-R-B AC03: the smoke script runs the persistence check in the right order against a recording stub docker', () => {
  assert.equal(spawnSync('bash', ['-n', path.join(PKG, 'scripts', 'docker-smoke.sh')]).status, 0, 'the smoke script parses');
  const bin = tmpdir('stubbin-');
  fs.writeFileSync(path.join(bin, 'docker'), STUB, { mode: 0o755 });
  const runSmoke = (extraEnv = {}) => {
    const logDir = tmpdir('stublog-');
    const log = path.join(logDir, 'log');
    const r = spawnSync('sh', [path.join(PKG, 'scripts', 'docker-smoke.sh')], {
      cwd: PKG,
      encoding: 'utf8',
      timeout: 60000,
      env: { PATH: bin + path.delimiter + process.env.PATH, DOCKER_STUB_LOG: log, DOCKER_STUB_STATE: tmpdir('stubstate-'), MEMEV_SMOKE_HEALTH_TIMEOUT: '10', ...extraEnv },
    });
    const steps = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(step) : [];
    return { ...r, steps };
  };
  const ok = runSmoke();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /docker smoke: ok/);
  assert.deepEqual(ok.steps, ['build', 'up', 'ps', 'ps', 'exec-remember', 'restart', 'ps', 'ps', 'exec-recall', 'down', 'volume', 'down'], 'the steps run in order');
  const pulled = runSmoke({ MEMEV_IMAGE: 'example/memev:0.1.0' });
  assert.equal(pulled.status, 0, pulled.stdout + pulled.stderr);
  assert.equal(pulled.steps[0], 'pull', 'a published image is pulled');
  assert.ok(!pulled.steps.includes('build'), 'no local build when the image is pulled');
  const bad = runSmoke({ DOCKER_STUB_UNHEALTHY: '1', MEMEV_SMOKE_HEALTH_TIMEOUT: '1' });
  assert.notEqual(bad.status, 0, 'an unhealthy container fails the smoke');
  assert.match(bad.stderr, /failed at wait for healthy/, 'the failure names the step');
});

test('SO-R-B AC04: first run on an empty volume creates the vault and serves it', async () => {
  const sb = sandbox();
  assert.ok(!fs.existsSync(sb.root), 'the volume starts empty');
  const child = spawn(process.execPath, [BIN, 'container'], { env: { ...sb.env, MEMEV_CONTAINER: '1', MEMEV_PORT: String(sb.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  try {
    await waitFor(() => err.includes('serving'));
    assert.ok(isVault(sb.root), 'the vault was created in the volume');
    const { code, ms } = await stopChild(child);
    assert.ok(ms <= 10000, `the entry point exited within the grace period (took ${ms}ms)`);
    assert.equal(code, 0, `the entry point exited 0 (got ${code}); stderr: ${err}`);
    assert.equal(await refused(sb.port), 'ECONNREFUSED', 'the listener is closed');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

test('SO-R-B AC04: a syntax error in the mounted config logs one line naming the file and exits non-zero without a stack trace', () => {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  assert.equal(sb.run(['stop']).code, 0);
  const cfg = path.join(sb.root, '.memev', 'config.json');
  fs.writeFileSync(cfg, '{ not valid json');
  const r = spawnSync(process.execPath, [BIN, 'container'], { env: { ...sb.env, MEMEV_CONTAINER: '1', MEMEV_PORT: String(sb.port) }, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(r.status, 0, 'the entry point exits non-zero on a broken config');
  const all = `${r.stdout}\n${r.stderr}`;
  const lines = all.split('\n').filter((l) => l.includes(cfg));
  assert.equal(lines.length, 1, `exactly one line names the config file; output: ${all}`);
  assert.doesNotMatch(all, /^\s*at /m, 'no stack trace');
  assert.doesNotMatch(all, /SyntaxError/, 'no raw SyntaxError');
});

test('SO-R-B AC05: docs/DOCKER.md says publishing a versioned image needs the registry decision and the owner\'s go', () => {
  const docs = read('docs/DOCKER.md');
  assert.match(docs, /registry\s+decision/i, 'the page names the registry decision');
  assert.match(docs, /owner's go/i, 'the page names the owner\'s go');
});
