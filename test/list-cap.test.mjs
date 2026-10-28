// memev_list returns a long folder 50 notes at a time, and the pages together are the folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server/http.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { handle, LIST_PAGE } from '../src/server/mcp.mjs';

after(cleanup);

function writeMany(v, prefix, n) {
  for (let i = 0; i < n; i++) v.write(OWNER, { path: `${prefix}/n${String(i).padStart(3, '0')}.md`, body: `# ${i}\n` });
}

async function listed(v, args, identity = OWNER) {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_list', arguments: args } }, { identity, client: 'test', local: true });
  const data = r.result.structuredContent;
  const text = r.result.content[0].text;
  if (Array.isArray(data.result)) return { notes: data.result, total: data.result.length, offset: 0, next: null, message: null, text };
  return { notes: data.notes, total: data.total, offset: data.offset, next: data.next, message: data.message, text };
}

test('MEM-110 AC02: A prefix with more than 50 notes returns 50, the total and an offset; paging with the offset returns every note exactly once', async () => {
  const { v } = newVault();
  writeMany(v, 'memory/pile', 60);
  const full = v.list(OWNER, 'memory/pile');
  const first = await listed(v, { prefix: 'memory/pile' });
  assert.equal(first.notes.length, LIST_PAGE);
  assert.equal(first.total, 60);
  assert.equal(first.offset, 0);
  assert.equal(first.next, LIST_PAGE);
  const second = await listed(v, { prefix: 'memory/pile', offset: first.next });
  assert.equal(second.offset, LIST_PAGE);
  assert.equal(second.next, null);
  const got = [...first.notes, ...second.notes];
  assert.deepEqual(got, full);
  assert.equal(new Set(got).size, got.length);
  v.close();
});

test('MEM-110 AC03: Session journal folders are listed newest first', async () => {
  const { v } = newVault();
  for (const day of ['2026-01-01', '2026-06-15', '2026-03-01']) {
    v.write(OWNER, { path: `work/sessions/${day}-claude-code-s.md`, body: `# ${day}\n` });
  }
  const page = await listed(v, { prefix: 'work/sessions' });
  assert.deepEqual(page.notes, [
    'work/sessions/2026-06-15-claude-code-s.md',
    'work/sessions/2026-03-01-claude-code-s.md',
    'work/sessions/2026-01-01-claude-code-s.md',
  ]);
  v.close();
});

test('MEM-110 AC04: A prefix with 50 or fewer notes returns all of them with no paging text', async () => {
  const { v } = newVault();
  writeMany(v, 'memory/small', 3);
  const page = await listed(v, { prefix: 'memory/small' });
  assert.equal(page.notes.length, 3);
  assert.equal(page.text.includes('Call memev_list again'), false);
  assert.equal(page.text.includes('offset'), false);
  assert.deepEqual(page.notes, v.list(OWNER, 'memory/small'));
  v.close();
});

test('MEM-110 AC05: The same cap applies to the HTTP list route used by remote callers', async () => {
  const { v } = newVault();
  writeMany(v, 'memory/pile', 60);
  const server = createServer(v, { tunnelKey: () => 'k'.repeat(32) });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    const token = v.tokens.issue({ agent: 'cloud', remote: true, paths: ['memory/**', 'work/**'], note: 'cloud connector' }).token;
    const r = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '198.51.100.7' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_list', arguments: { prefix: 'memory/pile' } } }),
    });
    const body = await r.json();
    const data = body.result.structuredContent;
    assert.equal(data.notes.length, LIST_PAGE);
    assert.equal(data.total, 60);
    assert.equal(data.offset, 0);
    assert.equal(data.next, LIST_PAGE);
  } finally { server.close(); v.close(); }
});
