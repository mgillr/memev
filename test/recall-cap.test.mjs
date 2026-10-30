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

const key = (h) => `${h.path}#${h.heading || ''}`;

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
      const res = await fetch(`${base}/v1/recall`, { method: 'POST', headers, body: JSON.stringify(body) });
      return res.json();
    },
    close: async () => { await new Promise((r) => s.close(r)); },
  };
}

test('MEM-108 AC02: limit 1000, limit 11, and limit 0 or negative are clamped to the range 1 to 10; the default is 6', async () => {
  const { v } = newVault();
  seed(v);
  try {
    const r = (limit) => v.recall(OWNER, { query: QUERY, ...(limit === undefined ? {} : { limit }) });
    assert.equal(r().length, 6, 'the default is 6');
    assert.equal(r(1000).length, 10, 'limit 1000 clamps to 10');
    assert.equal(r(11).length, 10, 'limit 11 clamps to 10');
    assert.equal(r(0).length, 1, 'limit 0 clamps to 1');
    assert.equal(r(-5).length, 1, 'a negative limit clamps to 1');
    assert.equal(r(1000).total, 25, 'all 25 notes match, so the cap is what keeps it at 10');
    const tool = await mcpResult(v, { query: QUERY, limit: 1000 });
    assert.ok(Array.isArray(JSON.parse(tool.content[0].text)), 'the tool text stays a JSON array of hits');
    assert.equal(tool.structuredContent.result.length, 10, 'memev_recall clamps limit 1000 to 10');
    const http = await serve(v);
    try {
      const cli = await http.post({ query: QUERY, limit: 1000 }, { cli: true });
      assert.equal(cli.total, 25);
      assert.equal(cli.next, 10, 'the route pages by tens, not by the 1000 that was sent');
      assert.ok(cli.hits.length <= 10);
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
  seed(v);
  try {
    const p1 = v.recall(OWNER, { query: QUERY, limit: 10, offset: 0 });
    assert.equal(p1.total, 25, 'the vault states how many hits exist in total');
    const tool1 = await mcpResult(v, { query: QUERY, limit: 10, offset: 0 });
    assert.equal(tool1.structuredContent.total, 25, 'memev_recall states how many hits exist in total');
    assert.equal(tool1.structuredContent.next, 10, 'memev_recall says more can be fetched with offset 10');
    const tool2 = await mcpResult(v, { query: QUERY, limit: 10, offset: 20 });
    assert.equal(tool2.structuredContent.next, null, 'memev_recall is silent when there are no more');
    const http = await serve(v);
    try {
      const first = await http.post({ query: QUERY, limit: 10, offset: 0 }, { cli: true });
      assert.equal(first.total, 25);
      assert.equal(first.next, 10, 'the route says more can be fetched with offset 10');
      assert.match(first.text, /more results: offset=10/);
      const last = await http.post({ query: QUERY, limit: 10, offset: 20 }, { cli: true });
      assert.equal(last.next, null, 'the route is silent when there are no more');
      assert.doesNotMatch(last.text, /more results/);
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
      const firstPage = (r) => { const j = JSON.parse(r.text); return (Array.isArray(j) ? j : j.hits).map((h) => `${h.path}#${h.heading || ''}@${h.score}`); };
      for (const q of queries.on_topic) {
        const a = firstPage(await cur.tool('memev_recall', { query: q.prompt, project: q.project }));
        const b = firstPage(await old.tool('memev_recall', { query: q.prompt, project: q.project }));
        assert.deepEqual(a, b, `the first page changed for: ${q.prompt}`);
      }
    } finally { cur.close(); old.close(); }
  } finally { for (const d of temp) fs.rmSync(d, { recursive: true, force: true }); }
});
