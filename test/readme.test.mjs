// SPDX-License-Identifier: Apache-2.0
// The README first screen: one sentence, the one install command up top, and a short demo GIF,
// with the install paths and the tier table lower down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const lines = readme.split('\n');

test('MEM-016 AC01: The first install command appears within the first 25 lines of README.md and before any table', () => {
  const cmd = lines.findIndex((l) => /memev(@latest)? init/.test(l));
  const table = lines.findIndex((l) => l.startsWith('|'));
  assert.ok(cmd >= 0, 'the README names an install command');
  assert.ok(cmd < 25, `the install command is on line ${cmd + 1}, within the first 25 lines`);
  assert.ok(table === -1 || cmd < table, 'the install command comes before any table');
});

test('MEM-016 AC02: The demo GIF is committed', () => {
  const gifs = fs.readdirSync(path.join(ROOT, 'docs', 'assets')).filter((f) => f.endsWith('.gif'));
  assert.ok(gifs.length > 0, 'docs/assets/ holds a GIF');
  for (const g of gifs) assert.ok(fs.statSync(path.join(ROOT, 'docs', 'assets', g)).size > 0, `${g} is not empty`);
});

test('MEM-016 AC03: The README references the GIF', () => {
  const ref = readme.match(/docs\/assets\/[A-Za-z0-9_.-]+\.gif/);
  assert.ok(ref, 'the README names a GIF in docs/assets/');
  assert.ok(fs.existsSync(path.join(ROOT, ref[0])), `${ref[0]} exists`);
});
