// MEM-093: the backup interval copy in the docs matches the code. The default sync interval is
// 30 minutes, so the docs say "every 30 minutes"; if the default ever drops to 5 minutes or less,
// "every few minutes" is accurate again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function defaultIntervalMin() {
  const src = read('src/engine/vault.mjs');
  const m = src.match(/interval_min:\s*(\d+)/);
  assert.ok(m, 'default sync interval not found in src/engine/vault.mjs');
  return Number(m[1]);
}

test('MEM-093 AC01: the docs say "every few minutes" only if the default interval is 5 minutes or less', () => {
  const interval = defaultIntervalMin();
  const readme = read('README.md');
  const github = read('docs/GITHUB.md');
  const saysFew = readme.includes('every few minutes') || github.includes('every few minutes');
  if (interval <= 5) {
    assert.ok(saysFew, 'default is 5 minutes or less, so the docs may say "every few minutes"');
  } else {
    assert.ok(!saysFew, 'default is more than 5 minutes, so the docs must not say "every few minutes"');
    assert.match(readme, new RegExp(`every ${interval} minutes`), 'README says the actual default interval');
    assert.match(github, new RegExp(`every ${interval} minutes`), 'GITHUB.md says the actual default interval');
  }
});
