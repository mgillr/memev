// SR-1.29: a hook process loads only the hook code, so the prompt hook fits MEM-098's 1.5 s budget on a slow runner.
// The hook is spawned the way an app runs it (node bin/memev.mjs hook <event>), against a stub daemon on loopback.
// The output comparison builds MEMEV_CONTRACT_BASE with git archive and is skipped when that is unset. The start-up comparison
// builds SR-1.29's own base, read from the base field of its spec, so it measures SR-1.29's change under any later contract's base.
// It runs whenever that commit is in the clone; it is skipped with a reason only when the commit is absent and no contract is being
// verified, and it fails when a contract is being verified and the field or the commit is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOAD_LOG = path.join(REPO, 'test', 'helpers', 'load-log.mjs');
const BASE = process.env.MEMEV_CONTRACT_BASE || '';
const SR129_SPEC = path.join(REPO, 'contracts', 'seed-readiness', 'specs', 'SR-1.29-a-hook-starts-without-loading-the-whole.json');
const SR129_BASE = (() => { try { return JSON.parse(fs.readFileSync(SR129_SPEC, 'utf8')).base || ''; } catch { return ''; } })();
const haveCommit = (sha) => /^[0-9a-f]{40}$/.test(sha) && spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: REPO }).status === 0;
const STARTUP_SKIP = haveCommit(SR129_BASE) || BASE ? false : `SR-1.29's base ${SR129_BASE ? SR129_BASE.slice(0, 12) + ' is not in this clone' : 'is not recorded in its spec'}`;
const EVENTS = { 'session-start': { source: 'startup' }, prompt: { prompt: 'what did I decide about the cache' }, 'pre-compact': {}, stop: {} };

// the stub answers the hook's routes after delayMs (the health check at once) and records each request
function stubServer(delayMs) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      calls.push({ route: req.url, body });
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/v1/recall') res.end(JSON.stringify({ hits: [], text: 'RECALL-TEXT' }));
        else if (req.url === '/v1/bus-pulse') res.end(JSON.stringify({ text: 'BUS-TEXT' }));
        else if (req.url === '/v1/session-start') res.end(JSON.stringify({ text: 'CARD-TEXT' }));
        else res.end(JSON.stringify({ ok: true }));
      }, req.url === '/healthz' ? 0 : delayMs);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls })));
}

// a fresh vault folder each run, so no run sees another's hook state or token
function fakeVault(port) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-hookstart-'));
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memev', 'config.json'), JSON.stringify({ port }));
  fs.writeFileSync(path.join(root, '.memev', 'daemon.json'), JSON.stringify({ pid: process.pid, port }));
  return root;
}

const runHook = (repo, event, input, root, { nodeArgs = [], extraEnv = {} } = {}) => new Promise((resolve) => {
  const t0 = process.hrtime.bigint();
  const p = spawn(process.execPath, [...nodeArgs, path.join(repo, 'bin', 'memev.mjs'), 'hook', event, '--client', 'claude-code'], {
    env: { PATH: process.env.PATH, HOME: root, MEMEV_ROOT: root, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => p.kill('SIGKILL'), 15000);
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, ms: Number(process.hrtime.bigint() - t0) / 1e6 }); });
  p.stdin.end(JSON.stringify(input));
});

const rel = (u) => (u.startsWith('file:') ? path.relative(REPO, fileURLToPath(u)).split(path.sep).join('/') : u);
async function loaded(event) {
  const stub = await stubServer(0);
  const root = fakeVault(stub.port);
  const log = path.join(root, 'load.log');
  try {
    const r = await runHook(REPO, event, EVENTS[event], root, { nodeArgs: ['--import', LOAD_LOG], extraEnv: { MEMEV_LOAD_LOG: log } });
    return { r, mods: new Set(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(rel)) };
  } finally { stub.server.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

// the base code, built once per run for each commit asked for
const baseDirs = new Map();
function baseRepo(commit = BASE) {
  if (baseDirs.has(commit)) return baseDirs.get(commit);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-hookstart-base-'));
  const tar = spawnSync('git', ['archive', '--format=tar', commit], { cwd: REPO, maxBuffer: 1 << 30 });
  assert.equal(tar.status, 0, `git archive ${commit} failed: ${tar.stderr}`);
  const x = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout });
  assert.equal(x.status, 0, `tar failed: ${x.stderr}`);
  baseDirs.set(commit, dir);
  return dir;
}

test('SR-1.29 hook loads', async () => {
  for (const event of Object.keys(EVENTS)) {
    const { r, mods } = await loaded(event);
    assert.equal(r.code, 0, `${event} exited ${r.code}`);
    assert.ok(mods.has('bin/memev.mjs') && mods.has('src/cli/hooks.mjs'), `${event}: the log did not record the hook itself: ${[...mods].join(' ')}`);
    assert.ok(!mods.has('src/cli/main.mjs'), `${event} loaded src/cli/main.mjs`);
    if (event === 'prompt') {
      for (const m of ['src/engine/vault.mjs', 'src/cli/transcript.mjs', 'src/cli/remote.mjs', 'src/engine/net.mjs']) assert.ok(!mods.has(m), `prompt loaded ${m}`);
      assert.match(r.out, /RECALL-TEXT/);
      assert.match(r.out, /BUS-TEXT/);
    }
  }
});

// timestamps, durations and random ids differ run to run; nothing else may
const norm = (s) => s.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>').replace(/\b\d+(\.\d+)? ?ms\b/g, '<ms>').replace(/\b[0-9a-f]{16,}\b/g, '<id>');

test('SR-1.29 output unchanged', { skip: !BASE && 'MEMEV_CONTRACT_BASE is not set' }, async () => {
  const base = baseRepo();
  for (const event of Object.keys(EVENTS)) {
    const got = {};
    for (const [name, repo] of [['base', base], ['new', REPO]]) {
      const stub = await stubServer(0);
      const root = fakeVault(stub.port);
      try { got[name] = await runHook(repo, event, EVENTS[event], root); } finally { stub.server.close(); fs.rmSync(root, { recursive: true, force: true }); }
    }
    assert.equal(got.new.code, got.base.code, `${event}: exit code ${got.new.code}, base ${got.base.code}`);
    assert.equal(norm(got.new.out), norm(got.base.out), `${event}: output differs from the base`);
  }
});

test('SR-1.29 prompt hook start-up', { skip: STARTUP_SKIP }, async () => {
  assert.ok(SR129_BASE, `SR-1.29's spec records no base: ${SR129_SPEC}`);
  assert.ok(haveCommit(SR129_BASE), `SR-1.29's base ${SR129_BASE.slice(0, 12)} is not in this clone`);
  const base = baseRepo(SR129_BASE);
  const ms = { base: [], new: [] };
  for (let i = 0; i < 5; i++) {
    for (const [name, repo] of [['base', base], ['new', REPO]]) {
      const stub = await stubServer(0);
      const root = fakeVault(stub.port);
      try { const r = await runHook(repo, 'prompt', EVENTS.prompt, root); assert.equal(r.code, 0); ms[name].push(r.ms); } finally { stub.server.close(); fs.rmSync(root, { recursive: true, force: true }); }
    }
  }
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const b = median(ms.base); const n = median(ms.new);
  assert.ok(n <= 0.7 * b, `new median ${n.toFixed(0)} ms is over 70% of the base median ${b.toFixed(0)} ms`);
});
