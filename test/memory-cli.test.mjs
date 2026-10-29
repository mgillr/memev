// `memev why`, `memev review list` and `memev audit` through the command entry, against a sandbox vault.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

let sb;
before(() => { sb = sandbox(); const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']); assert.equal(r.code, 0, r.err + r.out); });
after(() => { sb.stop(); cleanup(); });

test('REV-013 AC02: memev why, memev review list and memev audit run through the command entry in a sandbox vault and exit 0 with their expected output', () => {
  assert.equal(sb.run(['remember', 'Postgres 16 runs the billing database with logical replication', '--kind', 'decision', '--project', 'billing']).code, 0);
  assert.equal(sb.run(['remember', 'For now the staging database is read only while we debug replication', '--kind', 'gotcha']).code, 0);
  const why = sb.run(['why', 'postgres replication', '--project', 'billing']);
  assert.equal(why.code, 0, why.err);
  assert.match(why.out, /memory\/decisions\/\d{4}-\d{2}\.md#/, 'the recalled decision is listed');
  assert.match(why.out, /\(score \d/, 'with its recall score');
  const review = sb.run(['review', 'list']);
  assert.equal(review.code, 0, review.err);
  assert.match(review.out, /memory\/gotchas\/\d{4}-\d{2}\.md#/, 'the short-lived note waits in the inbox');
  assert.match(review.out, /review by \d{4}-\d{2}-\d{2}/, 'with its review date');
  assert.match(review.out, /Keep with: memev review keep/);
  const audit = sb.run(['audit']);
  assert.equal(audit.code, 0, audit.err);
  assert.match(audit.out, /2 memories; \d+ look like junk \(\d+%\)/, 'a read-only report over the two memories');
});
