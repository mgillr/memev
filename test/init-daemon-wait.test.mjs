// SPDX-License-Identifier: Apache-2.0
// init waits long enough for a slow first daemon start. On the owner's first Windows install init gave up after the default
// 6 s, marked "Memev running" as failed and exited 1, while the daemon came up moments later (doctor then passed everything).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INIT_DAEMON_WAIT_MS } from '../src/cli/main.mjs';

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'main.mjs');

test('init starts the daemon with a wait of at least 30 s', () => {
  assert.ok(INIT_DAEMON_WAIT_MS >= 30000, `init waits ${INIT_DAEMON_WAIT_MS} ms`);
  const src = fs.readFileSync(MAIN, 'utf8');
  assert.match(src, /startDaemon\(root, \{ quiet: true, waitMs: INIT_DAEMON_WAIT_MS \}\)/);
});

test('a start the person asks for waits 30 s by default; an AI app hook keeps a short wait', async () => {
  const d = await import('../src/cli/daemon.mjs');
  assert.ok(d.START_WAIT_MS >= 30000, `the default start wait is ${d.START_WAIT_MS} ms`);
  const hooks = fs.readFileSync(path.join(path.dirname(MAIN), 'hooks.mjs'), 'utf8');
  assert.match(hooks, /ensureDaemon\(root, \{ quiet: true, waitMs: 6000 \}\)/, 'the hook would wait half a minute');
});
