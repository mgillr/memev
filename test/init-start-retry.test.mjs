// A slow first start of the daemon on a busy CI machine (the Windows job) made init report "Memev did not start" and every
// test of a file that inits in its before hook failed with it. initWithRetry runs init, and while init says the daemon did not
// start it asks for the start again, a few times, the way a person would run memev start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initWithRetry } from './helpers/cli.mjs';

const slowThenUp = (failures) => {
  const calls = [];
  const run = (args) => { calls.push(args[0]); return calls.length <= failures ? { code: 1, out: '  ✗ Memev did not start: run memev doctor\n', err: '' } : { code: 0, out: 'Memev is running\n', err: '' }; };
  return { calls, run };
};

test('init that finds the daemon slow to start is followed by a start, and the result is the one that worked', () => {
  const { calls, run } = slowThenUp(1);
  const r = initWithRetry({ run }, ['init', '--port', '1']);
  assert.equal(r.code, 0);
  assert.deepEqual(calls, ['init', 'start']);
});

test('the retry gives up after the tries it was given and returns the last failure', () => {
  const { calls, run } = slowThenUp(99);
  const r = initWithRetry({ run }, ['init', '--port', '1'], { tries: 3 });
  assert.equal(r.code, 1);
  assert.deepEqual(calls, ['init', 'start', 'start']);
});

test('a failure that is not a slow start is returned at once, and a clean init is not repeated', () => {
  const calls = [];
  const bad = initWithRetry({ run: (a) => { calls.push(a[0]); return { code: 1, out: '', err: 'no such folder' }; } }, ['init']);
  assert.equal(bad.code, 1);
  assert.deepEqual(calls, ['init']);
  const ok = [];
  assert.equal(initWithRetry({ run: (a) => { ok.push(a[0]); return { code: 0, out: 'fine', err: '' }; } }, ['init']).code, 0);
  assert.deepEqual(ok, ['init']);
});
