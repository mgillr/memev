// Tailscale Funnel: only for cloud apps, only after explicit consent, and never touching a serve or funnel
// that something else set up on https 443. The fake answers each tailscale call the way the real CLI does:
// `tailscale serve status --json` exits 0 and prints the serve config, "{}" or "null" when there is none.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { supervise, pickProvider, funnelConsent, tunnelState, command } from '../src/cli/tunnel.mjs';
import { initVault } from '../src/engine/vault.mjs';

after(cleanup);

const TS = '/fake/tailscale';
const PORT = 41999;
const HOST = 'machine.tailnet.ts.net';
const HP = `${HOST}:443`;
const RUNNING = { ok: true, status: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${HOST}.` } }) };
const whichFn = (bin) => (bin === 'tailscale' ? TS : null);
const vault = (remote) => ({ config: { remote } });
// A serve config with one https 443 handler proxying to a local port, as `tailscale serve <port>` leaves it.
const on443 = (port, { funnel = false } = {}) => JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [HP]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } }, ...(funnel ? { AllowFunnel: { [HP]: true } } : {}) });

// A command executor that records every call; `serveStatus` is what `tailscale serve status --json` prints.
function fakeRun({ serveStatus = '{}' } = {}) {
  const recorded = [];
  const run = (cmd, args) => {
    recorded.push(args.join(' '));
    if (args[0] === 'status') return RUNNING;
    if (args[0] === 'serve' && args[1] === 'status') return { ok: true, status: 0, stdout: `${serveStatus}\n`, stderr: '' };
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };
  return { run, recorded };
}
// Commands that change what Tailscale serves (everything except the two read-only status calls).
const changes = (recorded) => recorded.filter((c) => c !== 'status --json' && c !== 'serve status --json');

async function runOnce(remote, { serveStatus, prev } = {}) {
  const root = tmpdir('tunnel-');
  if (prev) { fs.mkdirSync(path.join(root, '.memev'), { recursive: true }); fs.writeFileSync(path.join(root, '.memev', 'tunnel.json'), JSON.stringify(prev)); }
  const { run, recorded } = fakeRun({ serveStatus });
  process.env.MEMEV_NO_DOWNLOAD = '1';
  try {
    const h = supervise(vault({ enabled: true, provider: 'tailscale', ...remote }), { root, port: PORT, run, whichFn });
    await new Promise((r) => setTimeout(r, 120));
    const state = tunnelState(root);
    const started = changes(recorded);
    h.stop();
    return { state, started, stopped: changes(recorded).slice(started.length) };
  } finally {
    delete process.env.MEMEV_NO_DOWNLOAD;
  }
}

test('MEM-055 AC01: without consent no tailscale funnel command is run', async () => {
  assert.equal(funnelConsent({ remote: { provider: 'tailscale' } }), false);
  // A pinned tailscale stays tailscale (the tailnet-only serve); it never falls back to a public quick tunnel.
  const probe = fakeRun();
  assert.equal(pickProvider({ remote: { provider: 'tailscale' } }, process.env, { run: probe.run, whichFn }), 'tailscale');
  assert.equal(pickProvider({ remote: { provider: 'tailscale', funnelConsent: true } }, process.env, { run: probe.run, whichFn }), 'tailscale');

  for (const serveStatus of ['{}', 'null', '']) {
    const { state, started, stopped } = await runOnce({}, { serveStatus });
    assert.deepEqual(started, [`serve --bg ${PORT}`], `serve status ${JSON.stringify(serveStatus)}: only the tailnet serve starts`);
    assert.equal(state.mode, 'serve');
    assert.equal(state.url, `https://${HOST}`);
    assert.deepEqual(stopped, ['serve --bg --https=443 off'], 'stop turns off the serve Memev started');
  }
});

test('MEM-055 AC01: with consent and nothing on 443, the funnel opens, and stop turns it off', async () => {
  const { state, started, stopped } = await runOnce({ funnelConsent: true });
  assert.deepEqual(started, [`funnel --bg --yes ${PORT}`]);
  assert.equal(state.mode, 'funnel');
  assert.equal(state.state, 'up');
  assert.equal(state.url, `https://${HOST}`);
  assert.deepEqual(stopped, ['serve --bg --https=443 off'], 'turning off the 443 handler also clears its funnel');
});

test('MEM-055 AC01: withdrawing consent turns the funnel Memev opened back into the tailnet-only serve', async () => {
  const { state, started } = await runOnce({}, { serveStatus: on443(PORT, { funnel: true }), prev: { provider: 'tailscale', url: `https://${HOST}`, state: 'up', mode: 'funnel' } });
  assert.deepEqual(started, [`serve --bg ${PORT}`]);
  assert.equal(state.mode, 'serve');
});

test('MEM-055 AC01: memev cloud use tailscale gives no funnel consent; memev cloud funnel on needs --yes', async () => {
  const root = path.join(tmpdir('cloud-'), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const consent = () => funnelConsent(JSON.parse(fs.readFileSync(path.join(root, '.memev', 'config.json'), 'utf8')));
  const log = console.log; console.log = () => {};
  try {
    assert.equal(await command('cloud', ['use', 'tailscale'], {}, { root }), 0);
    assert.equal(consent(), false, 'choosing the provider is not consent');
    assert.equal(await command('cloud', ['funnel', 'on'], {}, { root }), 1);
    assert.equal(consent(), false, 'without --yes nothing changes');
    assert.equal(await command('cloud', ['funnel', 'on'], { yes: true }, { root }), 0);
    assert.equal(consent(), true);
    assert.equal(await command('cloud', ['funnel', 'off'], {}, { root }), 0);
    assert.equal(consent(), false);
  } finally { console.log = log; }
});

test('MEM-055 AC02: an existing funnel for the port is neither changed nor turned off on stop', async () => {
  // Someone else's funnel on https 443 (to their own app on 3000), with consent and without it.
  for (const remote of [{ funnelConsent: true }, {}]) {
    const { state, started, stopped } = await runOnce(remote, { serveStatus: on443(3000, { funnel: true }) });
    assert.deepEqual(started, [], `nothing is changed (consent ${!!remote.funnelConsent})`);
    assert.deepEqual(stopped, [], 'nothing is turned off on stop');
    assert.equal(state.url, null);
    assert.match(state.state, /left it as is/);
  }
});

test('MEM-055 AC02: a funnel to the vault port that Memev did not open is left as is too', async () => {
  // Same target port, but no tunnel state says Memev opened it, and Memev never opened funnels before this change.
  for (const prev of [undefined, { provider: 'tailscale', url: `https://${HOST}`, state: 'up' }]) {
    const { state, started, stopped } = await runOnce({ funnelConsent: true }, { serveStatus: on443(PORT, { funnel: true }), prev });
    assert.deepEqual(started, []);
    assert.deepEqual(stopped, []);
    assert.match(state.state, /left it as is/);
  }
});

test('MEM-055: a tailnet serve on 443 that Memev did not start is left as is', async () => {
  const { state, started, stopped } = await runOnce({}, { serveStatus: on443(3000) });
  assert.deepEqual(started, []);
  assert.deepEqual(stopped, []);
  assert.equal(state.url, null);
});

test('MEM-055: Memev\'s own serve from before this change (state with no mode) is still its own', async () => {
  const { state, started } = await runOnce({}, { serveStatus: on443(PORT), prev: { provider: 'tailscale', url: `https://${HOST}`, state: 'up', stable: true } });
  assert.deepEqual(started, [`serve --bg ${PORT}`]);
  assert.equal(state.mode, 'serve');
});
