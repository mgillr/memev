// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launcherScript } from '../src/cli/main.mjs';
import { PROTOCOL } from '../src/engine/card.mjs';
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
    const runHook = (event, sessionId, extra = {}) => {
      const r = spawnSync(process.execPath, [
        BIN,
        'hook', event, '--client', 'codex', '--root', badRoot,
      ], {
        input: JSON.stringify({ session_id: sessionId, ...extra }),
        env: { ...sb.env, MEMEV_ROOT: badRoot },
        encoding: 'utf8',
        timeout: 10000,
      });
      return r;
    };
    const parsed = (r) => {
      const out = r.stdout.trim();
      if (!out) return null;
      try { return JSON.parse(out); } catch { return null; }
    };
    const notice = (r) => parsed(r)?.hookSpecificOutput?.additionalContext ?? null;
    const r1 = runHook('prompt', 'ac02-session', { prompt: 'first prompt' });
    assert.equal(r1.status, 0, `first run should exit 0, got ${r1.status}: ${r1.stderr}`);
    const p1 = parsed(r1);
    assert.equal(p1?.hookSpecificOutput?.hookEventName, 'UserPromptSubmit', `the notice should carry the event's own name, got: ${JSON.stringify(p1)}`);
    const n1 = notice(r1);
    assert.ok(n1 && n1.includes('Memev could not start'), `first run should print the notice as context, got: ${JSON.stringify(n1)}`);
    assert.ok(n1.includes('run `memev doctor`'), `notice should name memev doctor, got: ${n1}`);

    const r2 = runHook('prompt', 'ac02-session', { prompt: 'second prompt' });
    assert.equal(r2.status, 0, `second run should exit 0, got ${r2.status}: ${r2.stderr}`);
    const n2 = notice(r2);
    assert.ok(!n2 || !n2.includes('Memev could not start'), `second run in the same session should NOT print the notice again, got: ${JSON.stringify(n2)}`);

    // a failing stop prints nothing and leaves the mark unset, so the next prompt in that
    // session still shows the notice
    const rStop = runHook('stop', 'ac02-stop-session');
    assert.equal(rStop.status, 0, `stop run should exit 0, got ${rStop.status}: ${rStop.stderr}`);
    assert.equal(rStop.stdout.trim(), '', `a failing stop should print nothing, got: ${JSON.stringify(rStop.stdout)}`);

    const r3 = runHook('prompt', 'ac02-stop-session', { prompt: 'prompt after a failing stop' });
    assert.equal(r3.status, 0, `third run should exit 0, got ${r3.status}: ${r3.stderr}`);
    const n3 = notice(r3);
    assert.ok(n3 && n3.includes('Memev could not start'), `the prompt after a failing stop should show the notice, got: ${JSON.stringify(n3)}`);

    const r4 = runHook('prompt', 'ac02-other-session', { prompt: 'first prompt in a new session' });
    assert.equal(r4.status, 0, `fourth run should exit 0, got ${r4.status}: ${r4.stderr}`);
    const n4 = notice(r4);
    assert.ok(n4 && n4.includes('Memev could not start'), `a new session should see the notice again, got: ${JSON.stringify(n4)}`);
  } finally {
    sb.stop();
  }
});

test('MEM-008: a failed session start keeps the rules, then the notice', () => {
  const sb = sandbox();
  try {
    const badRoot = path.join(sb.home, 'no-such-vault');
    const r = spawnSync(process.execPath, [
      BIN,
      'hook', 'session-start', '--client', 'codex', '--root', badRoot,
    ], {
      input: JSON.stringify({ session_id: 'ac02-start' }),
      env: { ...sb.env, MEMEV_ROOT: badRoot },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(r.status, 0, `session start should exit 0, got ${r.status}: ${r.stderr}`);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput?.additionalContext;
    assert.ok(ctx && ctx.startsWith(PROTOCOL), `the rules should come first, got: ${JSON.stringify(String(ctx).slice(0, 80))}`);
    assert.ok(ctx.includes('run `memev doctor`'), `the notice should name memev doctor, got: ${JSON.stringify(ctx)}`);
  } finally {
    sb.stop();
  }
});
