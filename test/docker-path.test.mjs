// SO-R-B: the Docker path. I read the image and compose file statically, I test the graceful stop
// against a daemon started in the sandbox, I run the smoke script against a recording stub docker
// and curl, and I run the container entry point outside Docker through the same code path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { cleanup, PKG, tmpdir } from './helpers/tmp.mjs';
import { sandbox, BIN } from './helpers/cli.mjs';
import { initVault, Vault, isVault } from '../src/engine/vault.mjs';
import { configDir } from '../src/engine/util.mjs';
import { whyNotRunning } from '../src/cli/daemon.mjs';

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
  assert.match(compose, /"127\.0\.0\.1:\$\{MEMEV_PORT:-7787\}:\$\{MEMEV_PORT:-7787\}"/, 'the port is published on the loopback address, 7787 unless MEMEV_PORT says otherwise');
  assert.match(compose, /^\s+MEMEV_PORT:\s*\$\{MEMEV_PORT:-7787\}\s*$/m, 'the daemon in the container listens on the port compose publishes');
  const hc = dockerfile.split('\n').find((l) => l.startsWith('HEALTHCHECK'));
  assert.ok(hc, 'the Dockerfile has a HEALTHCHECK');
  for (const f of ['--interval', '--timeout', '--retries', '--start-period']) assert.ok(hc.includes(f), `the HEALTHCHECK has ${f}`);
  assert.match(hc, /\/healthz/, 'the HEALTHCHECK probes /healthz');
  assert.match(hc, /http:\/\/127\.0\.0\.1:\$\{MEMEV_PORT:-7787\}\/healthz/, 'the HEALTHCHECK probes the port the daemon listens on');
  assert.match(dockerfile, /^ENV\s.*\bMEMEV_CONFIG_DIR=\/vault\/\.memev\/\S+/m, 'the config folder (signing key, licence, trial record) is in the volume, under .memev/');
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

test('SO-R-B AC02: the image keeps the config folder in the vault volume, where the vault\'s git never commits it', () => {
  const value = /^ENV\s.*\bMEMEV_CONFIG_DIR=(\S+)/m.exec(read('Dockerfile'))?.[1];
  assert.ok(value, 'the Dockerfile sets MEMEV_CONFIG_DIR');
  assert.ok(value.startsWith('/vault/'), `the config folder is in the volume, not in the container's home: ${value}`);
  // the volume's first run, outside Docker: /vault is a fresh vault
  const root = path.join(tmpdir('vol-'), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const dir = configDir({ HOME: '/home/memev', MEMEV_CONFIG_DIR: path.join(root, value.slice('/vault/'.length)) });
  assert.ok(dir.startsWith(root + path.sep), 'the config folder resolves inside the volume');
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'keys', 'signing.pem'), 'not a real key');
  fs.writeFileSync(path.join(dir, 'license.json'), '{}');
  for (const rel of ['keys/signing.pem', 'license.json']) {
    const file = path.relative(root, path.join(dir, rel));
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '-q', file]).status, 0, `the vault's git ignores ${file}, so a key or a licence is never committed or pushed to a backup`);
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
  const persistent = docs.split(/##\s*Persistent data/)[1]?.split(/\n##\s/)[0] || '';
  assert.match(persistent, /MEMEV_CONFIG_DIR/, 'the persistent data section names the config folder in the volume');
  assert.match(persistent, /signing key/i, 'and says the signing key is kept there');
  assert.match(persistent, /licen[cs]e/i, 'and the licence');
  assert.match(docs, /memev-smoke/, 'the page says the smoke runs in a compose project of its own');
});

// The stub stands in for docker and curl as shell functions, sourced before the smoke script, so the run needs no new
// executable file and never reaches a real docker. It logs every call and keeps the volumes and the remembered notes in
// DOCKER_STUB_STATE. Without -p, compose uses the folder name as the project, as docker does: that is the project of a
// memev deployed from this checkout.
const STUB = `
stub_log() { echo "$*" >> "$DOCKER_STUB_LOG"; }
curl() {
  stub_log "curl $*"
  printf '%s' "\${DOCKER_STUB_CURL_CODE:-401}"
}
docker() {
  stub_log "docker $*"
  case "$1" in
    compose) shift ;;
    volume)
      case "$2" in
        ls) sed 's/^/local  /' "$DOCKER_STUB_STATE/volumes" ;;
        inspect) grep -qx "$3" "$DOCKER_STUB_STATE/volumes" || return 1 ;;
      esac
      return 0 ;;
    *) return 0 ;;
  esac
  project=$(basename "$PWD")
  if [ "$1" = "-p" ]; then project="$2"; shift 2; fi
  case "$1" in
    ps)
      if [ -n "\${DOCKER_STUB_UNHEALTHY:-}" ] || [ -f "$DOCKER_STUB_STATE/need-healthy" ]; then
        rm -f "$DOCKER_STUB_STATE/need-healthy"
        echo '{"Service":"memev","State":"running","Health":"starting"}'
      else
        echo '{"Service":"memev","State":"running","Health":"healthy"}'
      fi ;;
    up)
      grep -qx "\${project}_memev-vault" "$DOCKER_STUB_STATE/volumes" || echo "\${project}_memev-vault" >> "$DOCKER_STUB_STATE/volumes"
      touch "$DOCKER_STUB_STATE/need-healthy" ;;
    restart) touch "$DOCKER_STUB_STATE/need-healthy" ;;
    down)
      if [ "\${2:-}" = "-v" ] || [ -n "\${DOCKER_STUB_DOWN_DROPS_VOLUME:-}" ]; then
        grep -vx "\${project}_memev-vault" "$DOCKER_STUB_STATE/volumes" > "$DOCKER_STUB_STATE/volumes.new" || true
        mv "$DOCKER_STUB_STATE/volumes.new" "$DOCKER_STUB_STATE/volumes"
      fi ;;
    exec)
      case "$5" in
        remember) [ -n "\${DOCKER_STUB_LOSE_WRITES:-}" ] || echo "$6" >> "$DOCKER_STUB_STATE/notes" ;;
        recall) cat "$DOCKER_STUB_STATE/notes" 2>/dev/null || true ;;
      esac ;;
  esac
  return 0
}
`;

const step = (line) => {
  if (line.startsWith('curl ')) return 'curl';
  if (line.startsWith('docker pull ')) return 'pull';
  if (line.startsWith('docker volume')) return 'volume';
  const parts = line.split(' ');
  if (parts[1] === 'compose') {
    const sub = parts[2] === '-p' ? parts.slice(4) : parts.slice(2);
    if (sub[0] === 'exec') return sub.includes('remember') ? 'exec-remember' : 'exec-recall';
    if (sub[0] === 'down') return sub.includes('-v') ? 'down -v' : 'down';
    return sub[0];
  }
  return parts[1];
};

const SMOKE = path.join(PKG, 'scripts', 'docker-smoke.sh');
// the volume of a memev deployed from this checkout: docker names it after the folder
const DEPLOYED = `${path.basename(PKG)}_memev-vault`;

const runSmoke = (extraEnv = {}, { notes = [] } = {}) => {
  const state = tmpdir('stubstate-');
  const log = path.join(state, 'log');
  fs.writeFileSync(path.join(state, 'volumes'), `${DEPLOYED}\n`);
  if (notes.length) fs.writeFileSync(path.join(state, 'notes'), notes.map((n) => `${n}\n`).join(''));
  const stub = path.join(state, 'stub.sh');
  fs.writeFileSync(stub, STUB);
  // T-INS-04 runs the script with sh; sourcing it after the stub is the same run with docker and curl stood in for
  const r = spawnSync('sh', ['-c', '. "$1"; . "$2"', 'sh', stub, SMOKE], {
    cwd: PKG,
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: process.env.PATH, DOCKER_STUB_LOG: log, DOCKER_STUB_STATE: state, MEMEV_SMOKE_HEALTH_TIMEOUT: '10', ...extraEnv },
  });
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  const volumes = fs.readFileSync(path.join(state, 'volumes'), 'utf8').split('\n').filter(Boolean);
  const remembered = lines.filter((l) => step(l) === 'exec-remember').map((l) => l.replace(/^.* remember /, '').replace(/ --kind fact$/, ''));
  return { ...r, lines, steps: lines.map(step), volumes, remembered };
};

test('SO-R-B AC03: the smoke script runs the persistence check in the right order, in a compose project of its own, against a recording stub docker', () => {
  assert.equal(spawnSync('bash', ['-n', SMOKE]).status, 0, 'the smoke script parses');
  const ok = runSmoke();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /docker smoke: ok/);
  assert.deepEqual(ok.steps, ['build', 'up', 'ps', 'ps', 'curl', 'exec-remember', 'restart', 'ps', 'ps', 'exec-recall', 'down', 'volume', 'down -v'], 'the steps run in order');
  const compose = ok.lines.filter((l) => l.startsWith('docker compose'));
  assert.ok(compose.length > 0 && compose.every((l) => l.startsWith('docker compose -p memev-smoke ')), `every compose call names the memev-smoke project, so a deployed memev is never recreated or stopped: ${compose.join(' | ')}`);
  assert.ok(ok.lines.includes('docker volume inspect memev-smoke_memev-vault'), 'the volume is checked by its exact name');
  assert.deepEqual(ok.volumes, [DEPLOYED], 'the smoke project\'s volume is removed at the end and the deployed volume is untouched');
  const pulled = runSmoke({ MEMEV_IMAGE: 'example/memev:0.1.0' });
  assert.equal(pulled.status, 0, pulled.stdout + pulled.stderr);
  assert.equal(pulled.steps[0], 'pull', 'a published image is pulled');
  assert.ok(!pulled.steps.includes('build'), 'no local build when the image is pulled');
  const bad = runSmoke({ DOCKER_STUB_UNHEALTHY: '1', MEMEV_SMOKE_HEALTH_TIMEOUT: '1' });
  assert.notEqual(bad.status, 0, 'an unhealthy container fails the smoke');
  assert.match(bad.stderr, /failed at wait for healthy/, 'the failure names the step');
  assert.deepEqual(bad.volumes, [DEPLOYED], 'a failed run removes its volume too');
});

test('SO-R-B AC03: the smoke fails when the published port answers an MCP call without a token (LAB-TEST-PLAN T-INS-04)', () => {
  const ok = runSmoke();
  const curl = ok.lines.find((l) => l.startsWith('curl '));
  assert.ok(curl && curl.includes('http://127.0.0.1:7787/mcp') && !/authorization/i.test(curl), `the check posts to /mcp on the published port with no token: ${curl}`);
  const open = runSmoke({ DOCKER_STUB_CURL_CODE: '200' });
  assert.notEqual(open.status, 0, 'a 200 without a token fails the smoke');
  assert.match(open.stderr, /failed at 401 without a token \(got 200\)/);
  const port = runSmoke({ MEMEV_PORT: '17787' });
  assert.equal(port.status, 0, port.stdout + port.stderr);
  assert.ok(port.lines.find((l) => l.startsWith('curl ')).includes('http://127.0.0.1:17787/mcp'), 'the check follows MEMEV_PORT, the port compose publishes');
});

test('SO-R-B AC03: the persistence checks can fail: a note from an earlier run or a volume of another project does not pass them', () => {
  const one = runSmoke();
  const two = runSmoke();
  assert.equal(one.remembered.length, 1);
  assert.notEqual(one.remembered[0], two.remembered[0], 'every run writes a note of its own');
  // the vault still holds the note an earlier run wrote, and this run's write is lost
  const lost = runSmoke({ DOCKER_STUB_LOSE_WRITES: '1' }, { notes: ['docker smoke note', ...one.remembered] });
  assert.notEqual(lost.status, 0, 'an earlier run\'s note does not stand in for this run\'s');
  assert.match(lost.stderr, /failed at read the note back/);
  // down takes the smoke volume with it while the deployed memev's volume, which also ends in memev-vault, is there
  const gone = runSmoke({ DOCKER_STUB_DOWN_DROPS_VOLUME: '1' });
  assert.notEqual(gone.status, 0, 'another project\'s memev-vault volume does not pass the check');
  assert.match(gone.stderr, /failed at volume memev-smoke_memev-vault kept after down/);
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

test('SO-R-B AC04: with a syntax error in the config the doctor\'s daemon check names the file instead of only saying the daemon is not running', async () => {
  const root = path.join(tmpdir('vault-'), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  assert.equal(await whyNotRunning(root), null, 'a stopped vault with a good config has no reason to report');
  const cfg = path.join(root, '.memev', 'config.json');
  fs.writeFileSync(cfg, '{ not valid json');
  const why = await whyNotRunning(root);
  assert.ok(why && why.includes(cfg), `the reason names the config file: ${why}`);
  assert.match(why, /not valid json/);
});

test('SO-R-B AC05: docs/DOCKER.md says publishing a versioned image needs the registry decision and the owner\'s go', () => {
  const docs = read('docs/DOCKER.md');
  assert.match(docs, /registry\s+decision/i, 'the page names the registry decision');
  assert.match(docs, /owner's go/i, 'the page names the owner\'s go');
});
