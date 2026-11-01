// Every test file the Windows job runs starts the daemon through init, and a slow cold start on that machine makes init report
// "Memev did not start". A file that inits in a hook or a test without the retry fails on that, which is not a defect of what the
// file checks. This test reads the file list of the Windows job in the workflow and requires each init that must succeed to go
// through initWithRetry. An init that is meant to fail (it sets its own environment, as the listen-error test does) is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG } from './helpers/tmp.mjs';

const ci = fs.readFileSync(path.join(PKG, '.github', 'workflows', 'ci.yml'), 'utf8');
const line = ci.split('\n').find((l) => /node --test/.test(l) && /test\/windows\.test\.mjs/.test(l));
const files = (line.match(/test\/[\w.-]+\.mjs/g) || []);

test('the Windows job names test files', () => {
  assert.ok(files.length >= 6, files.join(' '));
});

test('every init that must succeed in a file of the Windows job goes through initWithRetry', () => {
  const bare = [];
  for (const f of files) {
    fs.readFileSync(path.join(PKG, f), 'utf8').split('\n').forEach((l, i) => {
      if (/\bsb\.run\(\['init'/.test(l) && !/extraEnv/.test(l)) bare.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, [], 'these inits do not retry a slow start');
});
