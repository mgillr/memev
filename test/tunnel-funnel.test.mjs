// Tailscale Funnel: only for cloud apps, only after explicit consent, and never touching a funnel
// that already exists for the port.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { supervise, pickProvider, funnelConsent } from '../src/cli/tunnel.mjs';

after(cleanup);

const TS = '/fake/tailscale';
const PORT = 41999;
const RUNNING = { status: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'machine.tailnet.ts.net.' } }) };
const whichFn = (bin) => (bin === 'tailscale' ? TS : null);
const vault = (remote) => ({ config: { remote } });
// A funnel command is one that changes the funnel: opens it (--yes) or turns it off. `funnel status`
// is a read-only check and is allowed.
const funnelChanges = (recorded) => recorded.filter((c) => c[1] === 'funnel' && (c.includes('--yes') || c[c.length - 1] === 'off'));

// A command executor that records every call and answers the tailscale queries the way the test says.
function fakeRun({ existing = false } = {}) {
  const recorded = [];
  const run = (cmd, args) => {
    recorded.push([cmd, ...args]);
    if (args[0] === 'status') return RUNNING;
    if (args[0] === 'funnel' && args[1] === 'status') return { status: existing ? 0 : 1, stdout: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { run, recorded };
}

test('MEM-055 AC01: without consent no tailscale funnel command is run', async () => {
  // tailscale is installed and logged in, and the user pinned tailscale, but there is no consent.
  assert.equal(funnelConsent({ remote: { provider: 'tailscale' } }), false);
  const probe = fakeRun();
  assert.equal(pickProvider({ remote: { provider: 'tailscale' } }, process.env, { run: probe.run, whichFn }), 'quick');
  // With the same machine, consent is exactly what switches the provider to tailscale.
  assert.equal(pickProvider({ remote: { provider: 'tailscale', funnelConsent: true } }, process.env, { run: probe.run, whichFn }), 'tailscale');

  const root = tmpdir('tunnel-');
  const { run, recorded } = fakeRun();
  process.env.MEMEV_NO_DOWNLOAD = '1';
  try {
    const h = supervise(vault({ enabled: true, provider: 'tailscale' }), { root, port: PORT, run, whichFn });
    await new Promise((r) => setTimeout(r, 120));
    h.stop();
    assert.deepEqual(funnelChanges(recorded), [], `no funnel on/off expected, got ${JSON.stringify(funnelChanges(recorded))}`);
  } finally {
    delete process.env.MEMEV_NO_DOWNLOAD;
  }
});

test('MEM-055 AC02: an existing funnel for the port is neither changed nor turned off on stop', async () => {
  const root = tmpdir('tunnel-');
  const { run, recorded } = fakeRun({ existing: true });
  const h = supervise(vault({ enabled: true, provider: 'tailscale', funnelConsent: true }), { root, port: PORT, run, whichFn });
  await new Promise((r) => setTimeout(r, 120));
  h.stop();
  // It checked for an existing funnel, but never opened one and never turned one off.
  assert.ok(recorded.some((c) => c[1] === 'funnel' && c[2] === 'status'), 'it should have checked for an existing funnel first');
  assert.deepEqual(funnelChanges(recorded), [], `no funnel on/off expected, got ${JSON.stringify(funnelChanges(recorded))}`);
});
