// MEM-088: the licence direction is decided and announced. The Memev core stays Apache-2.0; the
// crdt-merge convergence engine lives in its own separate repository under FSL-1.1, converts to
// Apache-2.0 after two years, and powers the paid service and the relay layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('MEM-088 AC01: the licence direction is decided (D-14: stay Apache-2.0 or move to source-available), with the Memev core staying Apache-2.0 and the crdt-merge convergence engine in its own separate repository under FSL-1.1, converting to Apache-2.0 after two years, powering the paid service and the relay layer', () => {
  const notice = read('docs/LICENSING-NOTICE.md');
  assert.match(notice, /^# Licensing notice/m);
  assert.match(notice, /D-14/);
  assert.match(notice, /stays \*\*Apache-2\.0\*\*/);
  assert.match(notice, /crdt-merge convergence engine/);
  assert.match(notice, /its own separate\s*\n?repository/);
  assert.match(notice, /Fair Source Licence 1\.1 \(FSL-1\.1\)/);
  assert.match(notice, /converts to Apache-2\.0 after two\s*\n?years/);
  assert.match(notice, /paid service and the relay layer/);
});

test('MEM-088 AC02: the announcement text exists, and it does not claim the crdt-merge repository is public or give it a URL', () => {
  const notice = read('docs/LICENSING-NOTICE.md');
  assert.match(notice, /announcement/);
  assert.doesNotMatch(notice, /https?:\/\//);
  assert.doesNotMatch(notice, /github\.com/);
  assert.doesNotMatch(notice, /is public/i);
});
