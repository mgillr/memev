import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('package.json names the memev command', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin.memev, 'bin/memev.mjs');
});
