import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server/http.mjs';
import { handle } from '../src/server/mcp.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';

after(cleanup);

const QUERY = 'billing webhook retry';

// 25 notes that all match the query, each with a different number of mentions, so the
// ranking is a strict order and the pages are meaningful.
function seed(v, n = 25) {
  for (let i = 1; i <= n; i++) {
    const mentions = Array.from({ length: i }, () => 'billing webhook retry').join(' ');
    v.write(OWNER, { path: `memory/billing-${i}.md`, body: `# billing note ${i}\n\n${mentions} delivery.` });
  }
}

// 300 notes about other things. With only the 25 matching notes in the vault, the query words are in every note and
// the top score stays under 1, the CLI bar, so the route returns no hits and nothing about its pages can be checked.
function filler(v, n = 300) {
  const words = ['garden', 'ledger', 'compass', 'harbour', 'kettle', 'violin', 'granite', 'meadow', 'lantern', 'orbit', 'saddle', 'thistle'];
  for (let i = 1; i <= n; i++) {
    const body = Array.from({ length: 12 }, (_, j) => words[(i * 7 + j * 5) % words.length]).join(' ');
    v.write(OWNER, { path: `memory/other-${i}.md`, body: `# other note ${i}\n\n${body} ${i}.` });
  }
}

const key = (h) => `${h.path}#${h.heading || ''}`;

// The memev_recall text is the JSON array of hits, then one continuation line when more hits match than the page
// shows. The line holds no bracket, so the array ends at the last one.
const textHits = (text) => JSON.parse(text.slice(0, text.lastIndexOf(']') + 1));
const lastLine = (text) => text.slice(text.lastIndexOf('\n') + 1);

async function mcpResult(v, args) {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_recall', arguments: args } }, { identity: OWNER, client: 'test', local: true });
  return r.result;
}

async function serve(v) {
  const s = createServer(v);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const token = v.tokens.issue({ agent: 'local' }).token;
  const base = `http://127.0.0.1:${s.address().port}`;
  return {
    post: async (body, { cli = false } = {}) => {
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
      if (cli) headers['x-memev-client'] = 'cli';
      const res = await fetch(`${base}/v1/recall`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
      return res.json();
    },
    close: async () => { await new Promise((r) => s.close(r)); },
  };
}

test('MEM-108 AC02: limit 1000, limit 11, and limit 0 or negative are clamped to the range 1 to 10; the default is 6', async () => {
  const { v } = newVault();
  seed(v); filler(v);
  try {
    const r = (limit) => v.recall(OWNER, { query: QUERY, ...(limit === undefined ? {} : { limit }) });
    assert.equal(r().length, 6, 'the default is 6');
    assert.equal(r(1000).length, 10, 'limit 1000 clamps to 10');
    assert.equal(r(11).length, 10, 'limit 11 clamps to 10');
    assert.equal(r(0).length, 1, 'limit 0 clamps to 1');
    assert.equal(r(-5).length, 1, 'a negative limit clamps to 1');
    assert.equal(r(1000).total, 25, 'all 25 notes match, so the cap is what keeps it at 10');
    const tool = await mcpResult(v, { query: QUERY, limit: 1000 });
    assert.ok(Array.isArray(textHits(tool.content[0].text)), 'the tool text still starts with the JSON array of hits');
    assert.equal(textHits(tool.content[0].text).length, 10, 'the array in the text is clamped to 10 too');
    assert.equal(tool.structuredContent.result.length, 10, 'memev_recall clamps limit 1000 to 10');
    const http = await serve(v);
    try {
      const cli = await http.post({ query: QUERY, limit: 1000 }, { cli: true });
      assert.equal(cli.total, 25);
      assert.equal(cli.next, 10, 'the route pages by tens, not by the 1000 that was sent');
      assert.equal(cli.hits.length, 10, 'with the filler notes every match clears the CLI bar, so the clamp is what stops the route at 10');
      const hook = await http.post({ query: QUERY });
      assert.equal(hook.next, 4, 'the hook keeps its own limit of 4');
    } finally { await http.close(); }
  } finally { v.close(); }
});

test('MEM-108 AC03: offset 10 returns hits 11 to 20 of the same ranking, with no overlap and no gap against offset 0', () => {
  const { v } = newVault();
  seed(v);
  try {
    const p1 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 0 });
    const p2 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 10 });
    const p3 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 20 });
    assert.equal(p1.length, 10);
    assert.equal(p2.length, 10, 'offset 10 returns the next 10');
    assert.equal(p3.length, 5, 'the last page is the remainder');
    const all = [...p1, ...p2, ...p3];
    assert.equal(new Set(all.map(key)).size, 25, 'no overlap between the pages');
    assert.deepEqual(new Set(all.map((h) => h.path)), new Set(Array.from({ length: 25 }, (_, i) => `memory/billing-${i + 1}.md`)), 'no gap: every match appears on exactly one page');
    const lo = (p) => Math.min(...p.map((h) => h.score));
    const hi = (p) => Math.max(...p.map((h) => h.score));
    assert.ok(lo(p1) >= hi(p2), 'page 2 ranks at or below page 1');
    assert.ok(lo(p2) >= hi(p3), 'page 3 ranks at or below page 2');
  } finally { v.close(); }
});

test('MEM-108 AC04: the result states how many hits exist in total, and that more can be fetched with an offset when there are more', async () => {
  const { v } = newVault();
  seed(v); filler(v);
  try {
    const p1 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 0 });
    assert.equal(p1.total, 25, 'the vault states how many hits exist in total');
    const tool1 = await mcpResult(v, { query: QUERY, limit: 10, offset: 0 });
    assert.equal(tool1.structuredContent.total, 25, 'memev_recall states how many hits exist in total');
    assert.equal(tool1.structuredContent.next, 10, 'memev_recall says more can be fetched with offset 10');
    assert.equal(lastLine(tool1.content[0].text), 'Showing hits 1-10 of 25. Call memev_recall again with offset 10. 15 hits remain.', 'the text a model reads states the total and the next offset');
    assert.deepEqual(textHits(tool1.content[0].text).map(key), tool1.structuredContent.result.map(key), 'the hits before the line are the JSON array they always were');
    const tool2 = await mcpResult(v, { query: QUERY, limit: 10, offset: 20 });
    assert.equal(tool2.structuredContent.next, null, 'memev_recall is silent when there are no more');
    assert.deepEqual(JSON.parse(tool2.content[0].text).map(key), tool2.structuredContent.result.map(key), 'the last page has no continuation line: the text is the JSON array alone');
    const http = await serve(v);
    try {
      const first = await http.post({ query: QUERY, limit: 10, offset: 0 }, { cli: true });
      assert.equal(first.total, 25);
      assert.equal(first.next, 10, 'the route says more can be fetched with offset 10');
      assert.equal(first.hits.length, 10, 'the first page on the route holds 10 hits over the CLI bar');
      const last = await http.post({ query: QUERY, limit: 10, offset: 20 }, { cli: true });
      assert.equal(last.next, null, 'the route is silent when there are no more');
      assert.equal(last.hits.length, 5, 'the last page on the route is the remainder');
    } finally { await http.close(); }
  } finally { v.close(); }
});

test('MEM-108 AC03 through the tool: memev_recall passes the offset on and clamps the limit both ways; limit 1000 gives next 10 and limit -5 gives next 1', async () => {
  const { v } = newVault();
  seed(v); filler(v);
  try {
    const page2 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 10 }).map((h) => h.path);
    assert.equal(page2.length, 10);
    const tool = await mcpResult(v, { query: QUERY, limit: 10, offset: 10 });
    assert.deepEqual(tool.structuredContent.result.map((h) => h.path), page2, 'offset 10 through the tool returns hits 11 to 20, not page 1 again');
    assert.deepEqual(textHits(tool.content[0].text).map((h) => h.path), page2, 'the text carries the same page');
    assert.equal(tool.structuredContent.next, 20);
    assert.equal(lastLine(tool.content[0].text), 'Showing hits 11-20 of 25. Call memev_recall again with offset 20. 5 hits remain.');
    const page3 = await mcpResult(v, { query: QUERY, limit: 10, offset: 20 });
    const all = [...(await mcpResult(v, { query: QUERY, limit: 10 })).structuredContent.result, ...tool.structuredContent.result, ...page3.structuredContent.result];
    assert.equal(new Set(all.map(key)).size, 25, 'following next through the tool reaches every match once');
    const big = await mcpResult(v, { query: QUERY, limit: 1000 });
    assert.equal(big.structuredContent.result.length, 10);
    assert.equal(big.structuredContent.next, 10, 'next is computed from the clamped limit, so limit 1000 says the next page starts at 10');
    const neg = await mcpResult(v, { query: QUERY, limit: -5 });
    assert.equal(neg.structuredContent.result.length, 1);
    assert.equal(neg.structuredContent.next, 1, 'a negative limit clamps to 1 before next is computed');
    assert.equal(lastLine(neg.content[0].text), 'Showing hits 1-1 of 25. Call memev_recall again with offset 1. 24 hits remain.');
  } finally { v.close(); }
});

test('MEM-108 AC03 through the route: the HTTP route pages from the offset it was given and clamps the limit both ways', async () => {
  const { v } = newVault();
  seed(v); filler(v);
  try {
    const bar = 1;
    const page1 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 0 }).filter((h) => h.score >= bar).map((h) => h.path);
    const page2 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 10 }).filter((h) => h.score >= bar).map((h) => h.path);
    assert.ok(page1.length === 10 && page2.length === 10, `with the filler notes the matching notes score over the CLI bar: ${page1.length} and ${page2.length}`);
    const http = await serve(v);
    try {
      const first = await http.post({ query: QUERY, limit: 10, offset: 0 }, { cli: true });
      assert.deepEqual(first.hits.map((h) => h.path), page1);
      const second = await http.post({ query: QUERY, limit: 10, offset: 10 }, { cli: true });
      assert.deepEqual(second.hits.map((h) => h.path), page2, 'offset 10 on the route returns hits 11 to 20, not page 1 again');
      assert.equal(second.next, 20);
      const neg = await http.post({ query: QUERY, limit: -5 }, { cli: true });
      assert.equal(neg.hits.length, 1);
      assert.equal(neg.next, 1, 'a negative limit clamps to 1 on the route before next is computed');
    } finally { await http.close(); }
  } finally { v.close(); }
});

test('MEM-108 offset bound: an offset past 1000 asks the index for at most 1010 hits and returns an empty page with next null, on the tool and on the route', async () => {
  const { v } = newVault();
  seed(v);
  const asked = [];
  const query = v.index.query.bind(v.index);
  v.index.query = (q, opts) => { asked.push(opts.limit); return query(q, opts); };
  try {
    const BOUND = 1000;
    const tool9 = await mcpResult(v, { query: QUERY, offset: 1e9 });
    assert.equal(tool9.structuredContent.result.length, 0, 'offset 1e9 is past every page');
    assert.equal(tool9.structuredContent.next, null, 'next is null past the bound, not an offset that says more exists');
    assert.equal(tool9.structuredContent.total, 25, 'the total is still reported');
    assert.equal(tool9.content[0].text, '[]', 'no hits are left after offset 1e9, so there is no continuation line');
    // 1e309 in a JSON request parses to Infinity; the tool handler sees that value
    const toolInf = await mcpResult(v, { query: QUERY, offset: Infinity });
    assert.equal(toolInf.structuredContent.result.length, 0);
    assert.equal(toolInf.structuredContent.next, null);
    const deep = await mcpResult(v, { query: QUERY, limit: 10, offset: 990 });
    assert.equal(deep.structuredContent.next, null, 'an in-range deep page past the last hit has no next');
    const http = await serve(v);
    try {
      const r9 = await http.post({ query: QUERY, offset: 1e9 }, { cli: true });
      assert.deepEqual(r9.hits, []); assert.equal(r9.next, null); assert.equal(r9.total, 25);
      const rInf = await http.post(`{"query":${JSON.stringify(QUERY)},"offset":1e309}`, { cli: true });
      assert.deepEqual(rInf.hits, []); assert.equal(rInf.next, null);
    } finally { await http.close(); }
    const most = Math.max(...asked);
    assert.equal(asked.length, 5, 'three tool calls and two route calls each asked the index once');
    assert.ok(most <= BOUND + 10, `the index is never asked for more than the bound plus one page: it was asked for ${most}`);
  } finally { v.close(); }
});

test('MEM-108 offset bound: with more matches than the bound, next stops at 1000 instead of pointing past it, on the tool and on the route', async () => {
  const { v } = newVault();
  // The index is stood in for: 5000 matches, every page a run of fake hits over the CLI bar. Seeding 5000 notes would
  // test the same lines a hundred times slower.
  const TOTAL = 5000;
  v.index.query = (q, { limit }) => {
    const list = Array.from({ length: Math.min(limit, TOTAL) }, (_, i) => ({ path: `memory/m-${i}.md`, heading: '', line: 1, snippet: 'billing webhook retry', score: 5, project: null }));
    return Object.defineProperty(list, 'total', { value: TOTAL, configurable: true });
  };
  try {
    const atBound = await mcpResult(v, { query: QUERY, limit: 10, offset: 990 });
    assert.equal(atBound.structuredContent.result.length, 10);
    assert.equal(atBound.structuredContent.next, 1000, 'the page that ends at the bound still points to it');
    assert.equal(lastLine(atBound.content[0].text), 'Showing hits 991-1000 of 5000. Call memev_recall again with offset 1000. 4000 hits remain.');
    const pastBound = await mcpResult(v, { query: QUERY, limit: 10, offset: 995 });
    assert.equal(pastBound.structuredContent.result.length, 10, 'the last page before the bound is served in full');
    assert.equal(pastBound.structuredContent.next, null, 'next would be 1005, past the bound, so it is null although 5000 matches exist');
    assert.equal(pastBound.structuredContent.total, TOTAL);
    assert.equal(lastLine(pastBound.content[0].text), 'Showing hits 996-1005 of 5000. Recall does not page past offset 1000; narrow the query to reach the rest.', 'at the bound the text still says more match, and how to reach them');
    const beyond = await mcpResult(v, { query: QUERY, limit: 10, offset: 2000 });
    assert.equal(beyond.structuredContent.result.length, 0);
    assert.equal(lastLine(beyond.content[0].text), 'No hits at offset 2000; 5000 match. Recall does not page past offset 1000; narrow the query to reach the rest.');
    const http = await serve(v);
    try {
      const r1 = await http.post({ query: QUERY, limit: 10, offset: 990 }, { cli: true });
      assert.equal(r1.hits.length, 10); assert.equal(r1.next, 1000);
      const r2 = await http.post({ query: QUERY, limit: 10, offset: 995 }, { cli: true });
      assert.equal(r2.hits.length, 10); assert.equal(r2.next, null, 'the route stops next at the bound too');
    } finally { await http.close(); }
  } finally { v.close(); }
});

test('MEM-108 AC05: the first page of the labelled queries keeps the ranking and scores of 18abe10', async () => {
  const H = await import('../scripts/bench/harness.mjs');
  const home = H.prepare();
  const temp = [home];
  try {
    const baseSha = '18abe10161ca34d4665bb2fc58b1dc4f84c9bacb';
    const baseDir = H.extract(H.REPO, baseSha);
    temp.push(baseDir);
    const baseCode = await H.loadCode(baseDir, baseSha);
    const curCode = await H.loadCode(H.REPO, H.revParse(H.REPO, 'HEAD'));
    const queries = JSON.parse(fs.readFileSync(H.QUERIES, 'utf8'));
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-ac05-'));
    temp.push(base);
    const cur = H.seeded(curCode, base, 'small', queries, 'cur');
    const old = H.seeded(baseCode, base, 'small', queries, 'base');
    try {
      const firstPage = (r) => { const t = r.result.content[0].text; const j = t.endsWith(']') || t.endsWith('}') ? JSON.parse(t) : textHits(t); return (Array.isArray(j) ? j : j.hits).map((h) => `${h.path}#${h.heading || ''}@${h.score}`); };
      for (const q of queries.on_topic) {
        const a = firstPage(await cur.tool('memev_recall', { query: q.prompt, project: q.project }));
        const b = firstPage(await old.tool('memev_recall', { query: q.prompt, project: q.project }));
        assert.deepEqual(a, b, `the first page changed for: ${q.prompt}`);
      }
    } finally { cur.close(); old.close(); }
  } finally { for (const d of temp) fs.rmSync(d, { recursive: true, force: true }); }
});
