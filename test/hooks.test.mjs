// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launcherScript } from '../src/cli/main.mjs';
import { sandbox, BIN } from './helpers/cli.mjs';

test('MEM-008 AC01: session-start hook with missing Node prints one notice line and exits 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-hook-test-'));
  try {
    const script = launcherScript('/nonexistent/node', '/nonexistent/memev.mjs');
    const scriptPath = path.join(tmp, 'launcher.sh');
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    const r = spawnSync('/bin/sh', [scriptPath, 'hook', 'session-start', '--client', 'codex'], {
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
    const runHook = (sessionId, prompt) => {
      const r = spawnSync(process.execPath, [
        BIN,
        'hook', 'prompt', '--client', 'codex', '--root', badRoot,
      ], {
        input: JSON.stringify({ session_id: sessionId, prompt }),
        env: { ...sb.env, MEMEV_ROOT: badRoot },
        encoding: 'utf8',
        timeout: 10000,
      });
      return r;
    };
    const notice = (r) => {
      const out = r.stdout.trim();
      if (!out) return null;
      try { return JSON.parse(out).hookSpecificOutput?.additionalContext; } catch { return out; }
    };
    const r1 = runHook('ac02-session', 'first prompt');
    assert.equal(r1.status, 0, `first run should exit 0, got ${r1.status}: ${r1.stderr}`);
    const n1 = notice(r1);
    assert.ok(n1 && n1.includes('Memev could not start'), `first run should print the notice as context, got: ${JSON.stringify(n1)}`);
    assert.ok(n1.includes('run `memev doctor`'), `notice should name memev doctor, got: ${n1}`);

    const r2 = runHook('ac02-session', 'second prompt');
    assert.equal(r2.status, 0, `second run should exit 0, got ${r2.status}: ${r2.stderr}`);
    const n2 = notice(r2);
    assert.ok(!n2 || !n2.includes('Memev could not start'), `second run in the same session should NOT print the notice again, got: ${JSON.stringify(n2)}`);

    const r3 = runHook('ac02-other-session', 'first prompt in a new session');
    assert.equal(r3.status, 0, `third run should exit 0, got ${r3.status}: ${r3.stderr}`);
    const n3 = notice(r3);
    assert.ok(n3 && n3.includes('Memev could not start'), `a new session should see the notice again, got: ${JSON.stringify(n3)}`);
  } finally {
    sb.stop();
  }
});
