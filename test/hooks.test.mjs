// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launcherScript } from '../src/cli/main.mjs';
import { sandbox } from './helpers/cli.mjs';

test('MEM-008 AC01: session-start hook with missing Node prints one notice line and exits 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-hook-test-'));
  try {
    const script = launcherScript('/nonexistent/node', '/nonexistent/memev.mjs');
    const scriptPath = path.join(tmp, 'launcher.sh');
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    const r = spawnSync('/bin/sh', [scriptPath, 'hook', 'session-start', '--client', 'claude-code'], {
      env: { PATH: '/nonexistent', HOME: tmp },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
    const lines = r.stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `expected exactly one line, got ${lines.length}: ${JSON.stringify(lines)}`);
    assert.match(lines[0], /memev doctor/);
    assert.match(lines[0], /Memev could not start/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('MEM-008 AC02: prompt hook that throws prints one notice line once per session', () => {
  const sb = sandbox();
  try {
    const badRoot = path.join(sb.home, 'no-such-vault');
    const runHook = (prompt) => {
      const r = spawnSync(process.execPath, [
        path.join(new URL('..', import.meta.url).pathname, 'bin', 'memev.mjs'),
        'hook', 'prompt', '--client', 'claude-code', '--root', badRoot,
      ], {
        input: JSON.stringify({ session_id: 'ac02-session', prompt }),
        env: { ...sb.env, MEMEV_ROOT: badRoot },
        encoding: 'utf8',
        timeout: 10000,
      });
      return r;
    };
    const r1 = runHook('first prompt');
    assert.equal(r1.status, 0, `first run should exit 0, got ${r1.status}: ${r1.stderr}`);
    const notice1 = r1.stderr.includes('Memev could not start');
    assert.ok(notice1, `first run should print notice on stderr, got: ${r1.stderr}`);

    const r2 = runHook('second prompt');
    assert.equal(r2.status, 0, `second run should exit 0, got ${r2.status}: ${r2.stderr}`);
    const notice2 = r2.stderr.includes('Memev could not start');
    assert.ok(!notice2, `second run should NOT print notice again, got: ${r2.stderr}`);
  } finally {
    sb.stop();
  }
});
