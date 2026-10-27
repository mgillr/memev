// The Tailscale provider: a joined computer reaches the vault over the tailnet with `tailscale serve`,
// which is tailnet-only. Memev never opens a Funnel, so the address is not put on the public internet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { supervise } from '../src/cli/tunnel.mjs';

after(cleanup);

test('MEM-028 AC01: with a stubbed tailscale, enabling computer access runs tailscale serve and never tailscale funnel', async () => {
  // a stub tailscale that records every call and answers `status --json` as a running node
  const stubDir = tmpdir('ts-stub-');
  const log = path.join(stubDir, 'calls.log');
  const bin = path.join(stubDir, 'tailscale');
  fs.writeFileSync(bin, [
    '#!/bin/sh',
    `echo "$@" >> ${log}`,
    'if [ "$1" = "status" ]; then',
    '  printf \'{"BackendState":"Running","Self":{"DNSName":"stub-node."}}\'',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(bin, 0o755);

  const root = path.join(tmpdir(), 'vault');
  // remote access on, pinned to the tailscale provider: this is what `memev cloud on` leads the daemon to
  const vault = { config: { remote: { enabled: true, provider: 'tailscale' } } };

  const prevPath = process.env.PATH;
  const hadNoTunnel = 'MEMEV_NO_TUNNEL' in process.env;
  const prevNoTunnel = process.env.MEMEV_NO_TUNNEL;
  process.env.PATH = `${stubDir}${path.delimiter}${prevPath}`;
  delete process.env.MEMEV_NO_TUNNEL;
  try {
    const sup = supervise(vault, { root, port: 8443 });
    await new Promise((r) => setTimeout(r, 100));
    sup.stop();
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.env.PATH = prevPath;
    if (hadNoTunnel) process.env.MEMEV_NO_TUNNEL = prevNoTunnel;
  }

  const calls = fs.readFileSync(log, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(calls.some((l) => l.startsWith('serve')), `expected a "tailscale serve" call, got: ${calls.join(' | ')}`);
  assert.ok(!calls.some((l) => l.startsWith('funnel')), `must never call "tailscale funnel", got: ${calls.join(' | ')}`);
});
