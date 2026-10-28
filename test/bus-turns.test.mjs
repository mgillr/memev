// The bus sets expectations: a task to a live seat waits for its next turn, and the init checklist says so.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
after(cleanup);

const state = (roster, seat) => roster.seats.find((s) => s.seat === seat)?.state;

test('MEM-060 AC01: memev bus tasks shows waiting for next turn for an unread task addressed to a live seat', async () => {
  const sb = sandbox();
  try {
    for (const d of ['.claude', '.cursor']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--lead', 'claude-code@host']);
    assert.equal(init.code, 0, init.err + init.out);
    // each app joins on its first session, so both seats are live
    assert.equal(sb.hook('session-start', { session_id: 'lab-1', cwd: sb.home }).code, 0);
    const c = mcpClient(sb, 'cursor');
    await c.tool('bus_unread', {});
    await c.close();
    const r = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    assert.equal(state(r, 'claude-code@host'), 'live');
    assert.equal(state(r, 'cursor@host'), 'live');
    const sent = sb.run(['bus', 'send', 'cursor@host', 'task', 'Run the upload tests and report failures.']);
    assert.equal(sent.code, 0, sent.err + sent.out);
    const out = sb.run(['bus', 'tasks']).out;
    assert.match(out, /waiting for next turn/, out);
    // once the seat has read the task it is open until claimed, not waiting
    const c2 = mcpClient(sb, 'cursor');
    await c2.tool('bus_unread', {});
    await c2.close();
    const after = sb.run(['bus', 'tasks']).out;
    assert.doesNotMatch(after, /waiting for next turn/, after);
    assert.match(after, /open/, after);
  } finally { sb.stop(); }
});

test('MEM-060 AC02: the init checklist has one line explaining that apps answer between turns', async () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--lead', 'claude-code@host']);
    assert.equal(init.code, 0, init.err + init.out);
    const lines = init.out.split('\n').filter((l) => /between turns/.test(l));
    assert.equal(lines.length, 1, `one line explains it:\n${init.out}`);
    assert.match(lines[0], /apps answer between turns/);
  } finally { sb.stop(); }
});
