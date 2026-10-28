// MEM-101: the "Set up your office" guide. One vault, invite teammates with memev invite --teammate,
// choose the lead, read the roster, and know what is shared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('MEM-101 AC01: the office guide exists and covers one vault, inviting teammates, the lead, the roster and what is shared', () => {
  const guide = read('docs/OFFICE.md');
  assert.match(guide, /^# Set up your office/m);
  assert.match(guide, /## One vault/);
  assert.match(guide, /## Invite a teammate/);
  assert.match(guide, /## Choose the lead/);
  assert.match(guide, /## The roster/);
  assert.match(guide, /## What is shared/);
});

test('MEM-101 AC02: the guide invites a teammate with memev invite --teammate and memev join, and links the bus doc', () => {
  const guide = read('docs/OFFICE.md');
  assert.match(guide, /memev invite --teammate/);
  assert.match(guide, /memev join <code>/);
  assert.match(guide, /\[BUS\.md\]\(BUS\.md\)/);
  const readme = read('README.md');
  assert.match(readme, /\[Set up your office\]\(docs\/OFFICE\.md\)/);
});
