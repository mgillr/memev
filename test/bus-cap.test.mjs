// The capped bus reads: bus_unread, bus_tail and bus_since show a bounded view, mark only what
// they show read, and keep every message reachable in full.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './helpers/tmp.mjs';
import { sandbox, mcpClient } from './helpers/cli.mjs';
after(cleanup);

const SENT = 'The export suite is green after the index change, and the flaky retry is now stable under load. ';
const LONG = SENT.repeat(8); // well over 300 characters, so a capped view must cut it

function setUp() {
  const sb = sandbox();
  for (const d of ['.claude', '.cursor', '.codex']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
  const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--lead', 'claude-code@host']);
  assert.equal(init.code, 0, init.err + init.out);
  return sb;
}
// Post n status messages to everyone from codex, each with a long body.
async function postStatus(c, n) {
  for (let i = 0; i < n; i++) await c.tool('bus_send', { to: 'all', type: 'status', body: `${i + 1}. ${LONG}` });
}

test('MEM-109 AC02: 200 unread messages return the last 8, each at most 300 characters plus a cut marker, and a line giving the number not shown', async () => {
  const sb = setUp();
  const codex = mcpClient(sb, 'codex');
  const cursor = mcpClient(sb, 'cursor');
  try {
    await postStatus(codex, 200);
    const u = (await cursor.tool('bus_unread', {})).structuredContent;
    assert.ok(Array.isArray(u.messages));
    assert.equal(u.messages.length, 8, `expected the last 8, got ${u.messages.length}`);
    assert.equal(typeof u.not_shown, 'number');
    assert.ok(u.not_shown >= 0, 'the count of what was left must be present');
    assert.ok(u.messages.length + u.not_shown >= 200, `shown + not shown = ${u.messages.length + u.not_shown}`);
    for (const m of u.messages) {
      assert.ok(m.body.length <= 301, `a shown body is at most 300 plus the marker, got ${m.body.length}`);
      if (m.body.length > 300) { assert.equal(m.cut, true); assert.ok(m.body.endsWith('…'), 'a cut body carries the marker'); }
    }
  } finally { await cursor.close(); await codex.close(); sb.stop(); }
});

test('MEM-109 AC03: messages not shown by a capped bus_unread stay unread and are returned by the next call or by bus_since', async () => {
  const sb = setUp();
  const codex = mcpClient(sb, 'codex');
  const cursor = mcpClient(sb, 'cursor');
  try {
    await postStatus(codex, 12);
    const full = (await cursor.tool('bus_unread', { limit: 50, peek: true })).structuredContent;
    const total = full.messages.length;
    assert.ok(total > 8, `need more than a page of unread, got ${total}`);
    const u1 = (await cursor.tool('bus_unread', {})).structuredContent;
    assert.equal(u1.messages.length, 8);
    assert.equal(u1.not_shown, total - 8);
    const shown1 = new Set(u1.messages.map((m) => m.id));
    const u2 = (await cursor.tool('bus_unread', {})).structuredContent;
    assert.equal(u2.messages.length, total - 8, 'the second call shows what the first left');
    assert.equal(u2.not_shown, 0);
    for (const m of u2.messages) assert.ok(!shown1.has(m.id), 'a message shown twice was marked read too early');
    // the same hidden messages are also reachable by paging with bus_since from the start
    const sb2 = (await cursor.tool('bus_since', { seq: 0, limit: 50 })).structuredContent;
    for (const id of u2.messages.map((m) => m.id)) assert.ok(sb2.messages.some((m) => m.id === id), 'bus_since reaches the hidden message');
  } finally { await cursor.close(); await codex.close(); sb.stop(); }
});

test('MEM-109 AC04: bus_tail and bus_since clamp their limit to the stated maximum and report how many more exist', async () => {
  const sb = setUp();
  const codex = mcpClient(sb, 'codex');
  const cursor = mcpClient(sb, 'cursor');
  try {
    await postStatus(codex, 60);
    const t = (await cursor.tool('bus_tail', { n: 200 })).structuredContent;
    assert.equal(t.messages.length, 50, 'bus_tail clamps to the stated maximum');
    assert.ok(t.more >= 10, `bus_tail says how many more exist, got more=${t.more}`);
    const s = (await cursor.tool('bus_since', { seq: 0, limit: 200 })).structuredContent;
    assert.equal(s.messages.length, 50, 'bus_since clamps to the stated maximum');
    assert.ok(s.more >= 10, `bus_since says how many more exist, got more=${s.more}`);
    // a small request is honoured, not padded
    const t2 = (await cursor.tool('bus_tail', { n: 5 })).structuredContent;
    assert.equal(t2.messages.length, 5);
  } finally { await cursor.close(); await codex.close(); sb.stop(); }
});

test('MEM-109 AC05: a full-length message is still retrievable in full through its seq, so nothing becomes unreachable', async () => {
  const sb = setUp();
  const codex = mcpClient(sb, 'codex');
  const cursor = mcpClient(sb, 'cursor');
  try {
    const body = SENT.repeat(20); // far longer than the capped view
    const sent = (await codex.tool('bus_send', { to: 'all', type: 'status', body })).structuredContent;
    const u = (await cursor.tool('bus_unread', {})).structuredContent;
    const cut = u.messages.find((m) => m.id === sent.id);
    assert.ok(cut, 'the message is in the capped view');
    assert.equal(cut.cut, true);
    assert.ok(cut.body.length <= 301, 'the capped view cuts the body');
    const s = (await cursor.tool('bus_since', { seq: sent.seq - 1, limit: 50 })).structuredContent;
    const full = s.messages.find((m) => m.id === sent.id);
    assert.ok(full, 'the message is reachable by its seq');
    assert.equal(full.body, body, 'bus_since returns the body in full');
    assert.notEqual(full.cut, true);
  } finally { await cursor.close(); await codex.close(); sb.stop(); }
});

test('MEM-109 AC06: operator hold and task messages are always shown first and never cut, whatever the cap', async () => {
  const sb = setUp();
  const codex = mcpClient(sb, 'codex');
  const cursor = mcpClient(sb, 'cursor');
  try {
    await postStatus(codex, 20);
    const taskBody = 'TASK ' + SENT.repeat(10);
    const task = (await codex.tool('bus_send', { to: 'cursor@host', type: 'task', body: taskBody })).structuredContent;
    const holdBody = 'HOLD ' + SENT.repeat(10);
    const hold = sb.run(['bus', 'send', 'cursor@host', 'hold', holdBody]);
    assert.equal(hold.code, 0, hold.err + hold.out);
    const u = (await cursor.tool('bus_unread', {})).structuredContent;
    const t = u.messages.find((m) => m.id === task.id);
    assert.ok(t, 'the task is shown even though the cap is reached');
    assert.equal(t.body, taskBody, 'the task is never cut');
    assert.notEqual(t.cut, true);
    const h = u.messages.find((m) => m.type === 'hold' && m.operator);
    assert.ok(h, 'the operator hold is shown even though the cap is reached');
    assert.equal(h.body, holdBody, 'the hold is never cut');
    assert.notEqual(h.cut, true);
    const first = u.messages.slice(0, 2);
    assert.ok(first.some((m) => m.id === task.id), 'the task comes first');
    assert.ok(first.some((m) => m.type === 'hold'), 'the hold comes first');
    assert.equal(u.messages.length, 10, 'two priority plus the page of the rest');
  } finally { await cursor.close(); await codex.close(); sb.stop(); }
});
