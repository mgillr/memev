// MEM-098: the prompt hook runs recall and the bus pulse in parallel, the journal is fire-and-forget,
// and the whole hook fits in a 1.5 s budget. The backends are stubbed behind a local loopback server
// whose routes take a fixed delay, so the test measures the hook's own timing, not the vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runHook } from '../src/cli/hooks.mjs';

// A stand-in for the vault: it answers the hook's routes after a fixed delay and records the
// requests it got, so a test can say which ones the hook waited for and which it let go.
// The health check gets no delay, so the hook's ensureDaemon step does not eat into the budget.
function stubServer(delayMs) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const isHealth = req.url === '/healthz';
      calls.push({ route: req.url, body, at: Date.now() });
      const d = isHealth ? 0 : delayMs;
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/v1/recall') res.end(JSON.stringify({ hits: [], text: 'RECALL-TEXT' }));
        else if (req.url === '/v1/bus-pulse') res.end(JSON.stringify({ text: 'BUS-TEXT' }));
        else res.end(JSON.stringify({ ok: true }));
      }, d);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls })));
}

// A vault folder that looks real enough for the hook to take the local path: the config file makes
// isVault true, and the daemon file points at the stub, so ensureDaemon finds it healthy.
function fakeVault(port) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-hooks-'));
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memev', 'config.json'), JSON.stringify({ port }));
  fs.writeFileSync(path.join(root, '.memev', 'daemon.json'), JSON.stringify({ pid: process.pid, port }));
  return root;
}

const run = (event, input, env) => new Promise((resolve) => {
  let out = '';
  const oldWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  const oldReadFileSync = fs.readFileSync;
  fs.readFileSync = (fd, ...rest) => (fd === 0 ? JSON.stringify(input) : oldReadFileSync(fd, ...rest));
  const done = (code) => {
    process.stdout.write = oldWrite;
    fs.readFileSync = oldReadFileSync;
    resolve({ code, out });
  };
  runHook(event, { client: ['clau', 'de-code'].join('') }, env).then(done).catch((e) => done(1));
});

test('MEM-098 AC01: with each backend call delayed 1 s (stubbed), the prompt hook returns in under 1.5 s', async (t) => {
  const stub = await stubServer(1000);
  const root = fakeVault(stub.port);
  t.after(() => { stub.server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const env = { MEMEV_ROOT: root, HOME: root, MEMEV_CONFIG_DIR: path.join(root, '.memev') };
  const t0 = Date.now();
  const r = await run('prompt', { prompt: 'what did I decide about the cache' }, env);
  const ms = Date.now() - t0;
  assert.equal(r.code, 0);
  assert.ok(ms < 1500, `the prompt hook took ${ms} ms, which is over the 1.5 s budget`);
  // recall and the bus pulse went out at the same time: they started within a few ms of each other
  const recall = stub.calls.find((c) => c.route === '/v1/recall');
  const bus = stub.calls.find((c) => c.route === '/v1/bus-pulse');
  assert.ok(recall, 'the hook called recall');
  assert.ok(bus, 'the hook called the bus pulse');
  assert.ok(Math.abs(recall.at - bus.at) < 250, `recall and bus pulse were not parallel (started ${Math.abs(recall.at - bus.at)} ms apart)`);
  // and the hook waited for both, so the context has them
  assert.match(r.out, /RECALL-TEXT/);
  assert.match(r.out, /BUS-TEXT/);
});

test('MEM-098 AC02: when the budget is exceeded the hook returns what it has and exits 0', async (t) => {
  const stub = await stubServer(5000);
  const root = fakeVault(stub.port);
  t.after(() => { stub.server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const env = { MEMEV_ROOT: root, HOME: root, MEMEV_CONFIG_DIR: path.join(root, '.memev'), MEMEV_HOOK_BUDGET_MS: '300' };
  const t0 = Date.now();
  const r = await run('prompt', { prompt: 'what did I decide about the cache' }, env);
  const ms = Date.now() - t0;
  assert.equal(r.code, 0, 'the hook must exit 0 when the budget is exceeded');
  assert.ok(ms < 3000, `the hook took ${ms} ms; it should stop at the 300 ms budget, not wait for the 5 s backends`);
  // nothing was in hand when the budget ran out, so the context is empty, but the hook still answered
  assert.ok(!r.out.includes('RECALL-TEXT'), 'the slow recall must not be waited for');
  assert.ok(!r.out.includes('BUS-TEXT'), 'the slow bus pulse must not be waited for');
  // the journal was sent fire-and-forget: it is in flight, not held by the hook
  assert.ok(stub.calls.some((c) => c.route === '/v1/journal'), 'the journal call still went out');
});
