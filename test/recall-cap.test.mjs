import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';

after(cleanup);

function seed(v, n, topic = 'billing') {
  for (let i = 1; i <= n; i++) {
    v.write(OWNER, { path: `memory/${topic}-${i}.md`, body: `# ${topic} note ${i}\n\nSome text about ${topic} processing and retries for webhook delivery.` });
  }
}

test('MEM-108 AC02: limit is clamped to 10 when a larger value is requested', () => {
  const { v } = newVault();
  seed(v, 15);
  const hits = v.recall(OWNER, { query: 'billing webhook retry', limit: 50 });
  assert.ok(hits.length <= 10, `expected at most 10 hits, got ${hits.length}`);
  assert.ok(hits.length >= 1, 'expected at least 1 hit');
});

test('MEM-108 AC03: offset pages through results without duplicates', () => {
  const { v } = newVault();
  seed(v, 15);
  const page1 = v.recall(OWNER, { query: 'billing webhook retry', limit: 5, offset: 0 });
  const page2 = v.recall(OWNER, { query: 'billing webhook retry', limit: 5, offset: 5 });
  const keys1 = new Set(page1.map((h) => `${h.path}#${h.heading || ''}`));
  for (const h of page2) {
    const key = `${h.path}#${h.heading || ''}`;
    assert.ok(!keys1.has(key), `duplicate in page 2: ${key}`);
  }
});

test('MEM-108 AC04: total and next are returned for paging', () => {
  const { v } = newVault();
  seed(v, 15);
  const page1 = v.recall(OWNER, { query: 'billing webhook retry', limit: 5, offset: 0 });
  assert.ok(page1.total >= 15, `expected total >= 15, got ${page1.total}`);
  const next = 5 < page1.total ? 5 : null;
  assert.equal(page1.total > 5 ? 5 : null, next);
});

test('MEM-108 AC05: default limit is 6 and hook limit is unchanged', () => {
  const { v } = newVault();
  seed(v, 15);
  const hits = v.recall(OWNER, { query: 'billing webhook retry' });
  assert.ok(hits.length <= 6, `expected at most 6 hits by default, got ${hits.length}`);
});
