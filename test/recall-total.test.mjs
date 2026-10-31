// The recall index counts every section that matches and passes its filter while it keeps only the
// best `limit`, so a page of recall can say how many hits exist without ranking every match. I build
// an index directly from a seeded corpus, compare each page with the full ranking, and check that a
// vault recall asks the index for its page only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RecallIndex } from '../src/engine/index.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';

after(cleanup);

// 3,000 sections of 40 seeded words; each query word lands in about 30 percent of them, under the
// third that a large index drops as too common. Every fifth note lives under memory/.
function corpus(n = 3000) {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const vocab = Array.from({ length: 3000 }, (_, i) => `w${i}x`);
  const ix = new RecallIndex('/dev/null');
  for (let i = 0; i < n; i++) {
    const words = Array.from({ length: 40 }, () => vocab[Math.floor(rnd() * vocab.length)]);
    if (rnd() < 0.3) words.push('kettle'); if (rnd() < 0.3) words.push('colour');
    ix.appendSections(i % 5 === 0 ? `memory/${i}.md` : `n/${i}.md`, `## s${i}\n${words.join(' ')}\n`, { project: 'p' });
  }
  return ix;
}

const ix = corpus();
const Q = 'kettle colour';
const all = ix.query(Q, { limit: Infinity });

test('the total is every match, and the pages are slices of the full ranking', () => {
  assert.ok(all.length > 1000, `the corpus matches widely (${all.length} sections)`);
  assert.equal(all.total, all.length, 'with no limit the total is the length');
  const first = ix.query(Q, { limit: 6 });
  assert.equal(first.length, 6);
  assert.deepEqual(first, all.slice(0, 6), 'the first page is the top of the full ranking');
  assert.deepEqual(ix.query(Q, { limit: 16 }).slice(10, 16), all.slice(10, 16), 'a later page is the same slice of the full ranking');
  for (const limit of [1, 6, 16, 1000]) assert.equal(ix.query(Q, { limit }).total, all.length, `the total does not depend on limit ${limit}`);
});

test('the total counts only what passes the prefix and the filter', () => {
  const even = (d) => Number(/(\d+)\.md$/.exec(d.path)[1]) % 2 === 0;
  const filtered = ix.query(Q, { limit: 6, filter: even });
  assert.equal(filtered.total, all.filter(even).length, 'the filter is applied before counting');
  assert.ok(filtered.total < all.length && filtered.total > 0);
  const mem = ix.query(Q, { limit: 6, prefix: 'memory/' });
  assert.equal(mem.total, all.filter((h) => h.path.startsWith('memory/')).length, 'the prefix is applied before counting');
  assert.ok(mem.every((h) => h.path.startsWith('memory/')));
});

test('a query with nothing to match has a total of 0, and the total leaves the list as it was', () => {
  assert.equal(ix.query('zzzunknownword', { limit: 6 }).total, 0, 'no known word');
  assert.equal(new RecallIndex('/dev/null').query(Q, { limit: 6 }).total, 0, 'an empty index');
  const page = ix.query(Q, { limit: 6 });
  assert.ok(!Object.keys(page).includes('total'), 'the total is not an enumerable key');
  assert.deepStrictEqual(page, [...page], 'a caller comparing the list sees a plain list');
  assert.equal(JSON.stringify(page), JSON.stringify([...page]), 'a caller serialising the list sees a plain list');
});

test('counting adds no pass: the filter runs once per matching section at any limit', () => {
  const calls = (limit) => { let n = 0; ix.query(Q, { limit, filter: () => { n++; return true; } }); return n; };
  assert.equal(calls(6), all.length);
  assert.equal(calls(Infinity), all.length);
});

test('a vault recall asks the index for its page, not for every match', () => {
  const { v } = newVault();
  try {
    for (let i = 1; i <= 12; i++) v.write(OWNER, { path: `memory/kettle-${i}.md`, body: `# kettle ${i}\n\n${'kettle colour '.repeat(i)}blue.` });
    const asked = [];
    const query = v.index.query.bind(v.index);
    v.index.query = (q, o) => { asked.push(o.limit); return query(q, o); };
    const hits = v.recall(OWNER, { query: Q });
    assert.equal(hits.length, 6);
    assert.deepEqual(asked, [6], 'the index ranks only the page the caller asked for');
  } finally { v.close(); }
});
