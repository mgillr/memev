// The capped bus reads: bus_unread, bus_tail and bus_since show a bounded view, mark only what
// they show read, and keep every message reachable in full.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cleanup, newVault, OWNER } from './helpers/tmp.mjs';
import { sandbox, mcpClient, BIN } from './helpers/cli.mjs';
import { hasRead, UNREAD_MAX } from '../src/engine/bus.mjs';
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

// In process with git off: codex and gemini are apps on this computer, each posting as its own seat.
function inProcess() {
  const { root, v } = newVault({ git: false });
  const host = v.devices.get(v.devices.hostId);
  for (const c of ['codex', 'gemini']) v.bus.register({ client: c, device: host });
  const ctx = (client) => ({ identity: OWNER, client, device: host, local: true });
  const pulse = () => JSON.parse(fs.readFileSync(path.join(root, 'bus', 'pulse', 'gemini~host.json'), 'utf8'));
  const statuses = () => v.bus.all().filter((m) => m.from === 'codex@host' && m.type === 'status');
  return { root, v, ctx, pulse, statuses };
}

test('MEM-109 AC03: after a capped bus_unread leaves a gap, each read value in the pulse file stays a number, the rest is in read_extra, and hasRead covers both', () => {
  const { v, ctx, pulse, statuses } = inProcess();
  try {
    for (let i = 0; i < 30; i++) v.bus.send(ctx('codex'), { to: 'all', type: 'status', body: `status ${i + 1}` });
    const u = v.bus.unread(ctx('gemini'), { capped: true });
    assert.equal(u.messages.length, 8);
    const p = pulse();
    for (const [d, n] of Object.entries(p.read || {})) assert.equal(typeof n, 'number', `read[${d}] is ${JSON.stringify(n)}; code that reads it as a number breaks`);
    const shown = new Set(u.messages.map((m) => m.id));
    const all = statuses();
    assert.equal(all.filter((m) => !shown.has(m.id)).length, 22);
    assert.ok((p.read_extra?.[all[0].device] || []).length > 0, 'the shown messages beyond the gap are kept in read_extra');
    for (const m of all) {
      assert.equal(hasRead(p, m), shown.has(m.id), `hasRead is wrong for ${m.id}`);
      assert.equal(v.bus.unreadFor('gemini@host', m), !shown.has(m.id), `unreadFor is wrong for ${m.id}`);
      // code that knows only the prefix never takes an unshown message for read
      if (!shown.has(m.id)) assert.ok(!((p.read || {})[m.device] >= m.dseq), `${m.id} looks read to a prefix-only reader`);
    }
    // a hello from the terminal, read on the seat's next turn while older messages are still unread
    const h = v.bus.send({ identity: OWNER, cli: true, local: true }, { to: 'gemini@host', type: 'hello', body: 'hello from the terminal' });
    assert.equal(hasRead(pulse(), h), false);
    const u2 = v.bus.unread(ctx('gemini'), { capped: true });
    assert.ok(u2.messages.some((m) => m.id === h.id), 'the seat sees the hello');
    assert.ok(u2.not_shown > 0, 'older messages are still unread');
    const p2 = pulse();
    assert.equal(hasRead(p2, h), true, 'the hello counts as read');
    assert.ok(!((p2.read || {})[h.device] >= h.dseq), 'the gap is still open, so the prefix alone would call the hello unread');
  } finally { v.close(); }
});

test('MEM-109 AC03: memev bus hello reports the hello read while a capped bus_unread has left older messages unread', async () => {
  const sb = setUp();
  const codex = mcpClient(sb, 'codex');
  const cursor = mcpClient(sb, 'cursor');
  try {
    for (let i = 0; i < 30; i++) await codex.tool('bus_send', { to: 'all', type: 'status', body: `status ${i + 1}` });
    assert.equal((await cursor.tool('bus_unread', {})).structuredContent.messages.length, 8);
    const hello = new Promise((resolve) => {
      const p = spawn(process.execPath, [BIN, 'bus', 'hello', 'cursor@host', '--timeout', '20'], { env: sb.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => err += d);
      p.on('close', (code) => resolve({ code, out, err }));
    });
    const sent = () => JSON.parse(sb.run(['bus', 'tail', '--json', '--type', 'hello']).out).some((m) => m.to === 'cursor@host');
    for (let i = 0; i < 100 && !sent(); i++) await new Promise((r) => setTimeout(r, 200));
    const u = (await cursor.tool('bus_unread', {})).structuredContent;
    assert.ok(u.messages.some((m) => m.type === 'hello' && m.to === 'cursor@host'), 'the app sees the hello on its next turn');
    assert.ok(u.not_shown > 0, 'older messages are still unread, so what the seat has read has a gap');
    const r = await hello;
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /cursor@host read it \d+ s after you sent it/);
  } finally { await cursor.close(); await codex.close(); sb.stop(); }
});

test('MEM-109 AC02: every capped bus_unread call shows at most the cap, so the call after one that left 22 of 30 shows 8 again, and each message is shown once', () => {
  const { v, ctx, statuses } = inProcess();
  try {
    for (let i = 0; i < 30; i++) v.bus.send(ctx('codex'), { to: 'all', type: 'status', body: `status ${i + 1}` });
    const seen = new Set(); const counts = [];
    for (let k = 0; k < 10; k++) {
      const u = v.bus.unread(ctx('gemini'), { capped: true });
      if (!u.messages.length) break;
      counts.push(u.messages.length);
      assert.ok(u.messages.length <= 8, `call ${k + 1} showed ${u.messages.length}`);
      for (const m of u.messages) { assert.ok(!seen.has(m.id), `${m.id} was shown twice`); seen.add(m.id); }
    }
    for (const m of statuses()) assert.ok(seen.has(m.id), `${m.id} was never shown`);
    assert.deepEqual(counts.slice(0, 3), [8, 8, 8], `shown per call: ${counts}`);
  } finally { v.close(); }
});

test('MEM-109 AC03: a message written offline that lands before what the last call saw is shown on the next call, whatever the cap', () => {
  const { root, v, ctx } = inProcess();
  try {
    for (let i = 0; i < 30; i++) v.bus.send(ctx('codex'), { to: 'all', type: 'status', body: `status ${i + 1}` });
    assert.equal(v.bus.unread(ctx('gemini'), { capped: true }).messages.length, 8);
    // another computer's log arrives with a message older than everything on the bus
    const late = { id: 'offline1-1', dseq: 1, ts: '2020-01-01T00:00:00.000Z', device: 'dev_offline1', from: 'codex@laptop', operator: false, to: 'all', type: 'status', body: 'written offline', ref: null, project: null };
    fs.writeFileSync(path.join(root, 'bus', 'log', 'dev_offline1.jsonl'), `${JSON.stringify(late)}\n`);
    const u = v.bus.unread(ctx('gemini'), { capped: true });
    assert.ok(u.messages.some((m) => m.id === late.id), 'the late message is shown');
    assert.equal(u.messages.length, 9, 'the late message plus the 8 the cap allows');
  } finally { v.close(); }
});

test('MEM-109 AC06: more tasks than the stated maximum show the oldest ' + UNREAD_MAX + ' in full, count the rest in not_shown, and the next call shows the rest', () => {
  const { v, ctx } = inProcess();
  try {
    const n = UNREAD_MAX + 5;
    for (let i = 0; i < n; i++) v.bus.send(ctx('codex'), { to: 'gemini@host', type: 'task', body: `task ${i + 1}. ${'x'.repeat(400)}` });
    const label = (m) => m.body.split('.')[0];
    const u1 = v.bus.unread(ctx('gemini'), { capped: true });
    const t1 = u1.messages.filter((m) => m.type === 'task');
    assert.deepEqual(t1.map(label), Array.from({ length: UNREAD_MAX }, (_, i) => `task ${i + 1}`), 'the oldest, oldest first');
    for (const m of t1) assert.ok(!m.cut && m.body.length > 300, 'a task is shown in full');
    assert.equal(u1.not_shown, 5);
    const u2 = v.bus.unread(ctx('gemini'), { capped: true });
    assert.deepEqual(u2.messages.filter((m) => m.type === 'task').map(label), Array.from({ length: 5 }, (_, i) => `task ${UNREAD_MAX + i + 1}`));
    assert.equal(u2.not_shown, 0);
  } finally { v.close(); }
});
