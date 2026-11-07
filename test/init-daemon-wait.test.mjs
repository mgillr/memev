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
