// On a slow CI machine (the Windows job) a result a test reads can arrive a moment after the command that causes it returns: the first
// recall of a new note, or the listen error the daemon writes to its log as init prints. pollUntil runs a step again, a bounded
// number of times, until the result is the expected one, and returns the last result either way, so the assertion that follows is
// the same assertion on the result it would have been, and a result that never comes still fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollUntil, hookUntil } from './helpers/cli.mjs';

test('pollUntil returns at once when the first result is the expected one', () => {
  let calls = 0;
  const r = pollUntil(() => { calls++; return 'ready'; }, (x) => x === 'ready', { timeoutMs: 500, intervalMs: 5 });
  assert.equal(r, 'ready');
  assert.equal(calls, 1);
});

test('pollUntil runs the step again until the result is the expected one', () => {
  let calls = 0;
  const r = pollUntil(() => (++calls < 4 ? '' : 'first Monday'), (x) => x !== '', { timeoutMs: 2000, intervalMs: 5 });
  assert.equal(r, 'first Monday');
  assert.equal(calls, 4);
});

test('pollUntil is bounded and returns the last result when the expected one never comes', () => {
  let calls = 0;
  const t0 = Date.now();
  const r = pollUntil(() => `try ${++calls}`, () => false, { timeoutMs: 60, intervalMs: 10 });
  assert.equal(r, `try ${calls}`);
  assert.ok(calls >= 2 && calls < 50, `ran ${calls} times`);
  assert.ok(Date.now() - t0 < 2000);
});

// A hook never breaks a session: when the daemon does not answer inside the hook's own timeout it prints a notice and exits 0
// (src/cli/hooks.mjs). On a slow machine a test that wants the real answer asks again, a bounded number of times, while the output is that notice.
test('hookUntil asks the hook again while it prints the not-reachable notice, and returns the first real answer', () => {
  const outs = ['[Memev is not reachable right now (The operation was aborted); run `memev doctor`.]', '[Memev is not reachable right now (The operation was aborted); run `memev doctor`.]', 'Memev resume card'];
  const seen = [];
  const sb = { hook: (...a) => { seen.push(a); return { code: 0, out: outs[Math.min(seen.length - 1, 2)], err: '' }; } };
  const r = hookUntil(sb, ['session-start', { session_id: 'g1' }, 'gemini-cli', ['--format', 'gemini']], { timeoutMs: 2000, intervalMs: 5 });
  assert.equal(r.out, 'Memev resume card');
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0], seen[2], 'the same hook call each time');
});

test('hookUntil is bounded and returns the last notice when the daemon never answers', () => {
  const sb = { hook: () => ({ code: 0, out: '[Memev is not reachable right now (The operation was aborted); run `memev doctor`.]', err: '' }) };
  const r = hookUntil(sb, ['session-start', {}], { timeoutMs: 60, intervalMs: 10 });
  assert.match(r.out, /not reachable/);
});
