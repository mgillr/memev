// Cursor: the always-on project rule (connect --project) and the stop hook's operator-task followup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup, tmpdir, PKG } from './helpers/tmp.mjs';

let sb;
before(() => { sb = sandbox(); const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']); assert.equal(r.code, 0, r.err + r.out); });
after(() => { sb.stop(); cleanup(); });

test('MEM-053 AC01: connect cursor --project writes the always-on rule and disconnect removes it', () => {
  const proj = tmpdir('proj-');
  const c = sb.run(['connect', 'cursor', '--project', proj]);
  assert.equal(c.code, 0, c.err + c.out);
  const rule = path.join(proj, '.cursor', 'rules', 'memev.mdc');
  assert.ok(fs.existsSync(rule), 'the project rule file is written');
  const t = fs.readFileSync(rule, 'utf8');
  assert.match(t, /alwaysApply:\s*true/, 'the rule is always applied');
  assert.match(t, /Memev/);
  const d = sb.run(['disconnect', 'cursor']);
  assert.equal(d.code, 0, d.err + d.out);
  assert.equal(fs.existsSync(rule), false, 'disconnect removes the rule file');
});

test('MEM-053 AC02: the Cursor stop hook follows up only on waiting operator tasks, with a loop limit', async () => {
  // the loop limit is a setting on the stop entry in hooks.json, not part of the hook output
  const c = sb.run(['connect', 'cursor']);
  assert.equal(c.code, 0, c.err + c.out);
  const hooks = JSON.parse(fs.readFileSync(path.join(sb.home, '.cursor', 'hooks.json'), 'utf8'));
  const stop = (hooks.hooks.stop || []).find((h) => /memev/.test(h.command || '') && / hook stop /.test(h.command || ''));
  assert.ok(stop, 'the stop entry is in hooks.json');
  assert.equal(stop.loop_limit, 3, 'the stop entry carries loop_limit');

  const base = { session_id: 'cur-stop', cwd: sb.home };
  const none = sb.hook('stop', base, 'cursor', ['--format', 'cursor']);
  assert.equal(none.code, 0, none.err);
  assert.equal(none.out, '', 'no followup while no operator task waits');

  // a task that is already waiting when the person types is not swallowed by the prompt hook
  const sent = sb.run(['bus', 'send', 'cursor@host', 'task', 'rotate the api keys before the release']);
  assert.equal(sent.code, 0, sent.err + sent.out);
  const p = sb.hook('prompt', { ...base, prompt: 'please carry on with the release' }, 'cursor', ['--format', 'cursor']);
  assert.equal(p.code, 0, p.err);
  assert.equal(p.out, '', 'the prompt hook shows nothing for Cursor');
  const r = sb.hook('stop', base, 'cursor', ['--format', 'cursor']);
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.match(out.followup_message, /rotate the api keys/, 'the waiting operator task goes into the followup');
  assert.equal(out.loop_limit, undefined, 'the hook output carries no loop_limit');
  const r2 = sb.hook('stop', base, 'cursor', ['--format', 'cursor']);
  assert.equal(r2.code, 0, r2.err);
  assert.equal(r2.out, '', 'the follow-up marked the task read, so a second stop gives none');

  // at loop_count 3 (the loop_limit) the hook stops following up
  const sent2 = sb.run(['bus', 'send', 'cursor@host', 'task', 'a second task while looping']);
  assert.equal(sent2.code, 0, sent2.err + sent2.out);
  const r3 = sb.hook('stop', { ...base, loop_count: 3 }, 'cursor', ['--format', 'cursor']);
  assert.equal(r3.code, 0, r3.err);
  assert.equal(r3.out, '', 'no followup at loop_count 3');

  // a fresh task from another app is not the operator's: it must not follow up
  const cc = mcpClient(sb, 'claude-code');
  await cc.request('initialize', { protocolVersion: '2025-06-18' });
  const cur = mcpClient(sb, 'cursor');
  await cur.request('initialize', { protocolVersion: '2025-06-18' });
  await cur.tool('bus_unread', {}); // read the second task
  const peer = await cc.tool('bus_send', { to: 'cursor@host', type: 'task', body: 'a peer task, not the operator' });
  assert.ok(!peer.isError, JSON.stringify(peer));
  const r4 = sb.hook('stop', base, 'cursor', ['--format', 'cursor']);
  assert.equal(r4.code, 0, r4.err);
  assert.equal(r4.out, '', 'a fresh peer task alone does not follow up');
  await cc.close();
  await cur.close();
});

test('MEM-053 AC03: CLIENTS.md documents Cursor hook limits', () => {
  const t = fs.readFileSync(path.join(PKG, 'docs', 'CLIENTS.md'), 'utf8');
  assert.match(t, /sessionStart/, 'the sessionStart-only limit is documented');
  assert.match(t, /alwaysApply/);
  assert.match(t, /followup_message/);
  assert.match(t, /loop_limit/);
});
