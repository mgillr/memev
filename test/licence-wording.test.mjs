// SPDX-License-Identifier: Apache-2.0
// The public docs, templates and source describe the licence by what each plan includes. They do
// not describe ways round the computer limit. This keeps that wording from coming back in a later
// edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d, ext) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), ext) : ext.some((x) => e.name.endsWith(x)) ? [path.join(d, e.name)] : []));
const FILES = ['README.md', 'CHARTER.md', 'SECURITY.md', 'NOTICE', ...walk('docs', ['.md']), ...walk('templates', ['.md']),
  ...walk('src', ['.mjs']), ...walk('bin', ['.mjs']), ...walk('scripts/license', ['.mjs']), 'scripts/license-dev.mjs'];
const BANNED = [
  /patch(?:ed)?\s+(?:\w+\s+){0,3}out/i,
  /\b(?:bypass|circumvent)/i,
  /\bget(?:s|ting)?\s+(?:past|around|round)\b/i,
  /\b(?:fake[ds]?|faking|spoof\w*)\s+(?:a\s+)?(?:cloud|user.agent)/i,
  /\bport\s+forward/i,
  /\b(?:honest|known)\s+(?:gap|limit)/i,
  /licensing\s+honest/i,
  /\bnot\s+DRM\b/i,
  /\bnothing\s+is\s+enforced\b/i,
];

test('public text carries no directions for getting round the computer limit', () => {
  const found = [];
  for (const f of FILES) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      for (const re of BANNED) if (re.test(line)) found.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});

test('the licence terms stay stated: Personal needs no licence, the plan sets the computers, grace then read-only', () => {
  const pricing = fs.readFileSync(path.join(ROOT, 'docs/PRICING.md'), 'utf8');
  assert.match(pricing, /\*\*Personal:\*\* one computer, no licence/);
  assert.match(pricing, /the plan sets how many computers can join/);
  assert.match(pricing, /grace period \(14 days unless the licence says otherwise\)/);
  assert.match(pricing, /can read but not write/);
});
