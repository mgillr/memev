// Continuity across compaction, sessions and apps, through the real CLI, hooks and daemon.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sandbox, initWithRetry, pollUntil, mcpClient, transcript, user, assistant, todos } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

let sb;
before(() => { sb = sandbox(); const r = initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only', '--no-connect']); assert.equal(r.code, 0, r.err + r.out); });
after(() => { sb.stop(); cleanup(); });
const ctx = (r) => { assert.equal(r.code, 0, r.err); return r.out ? JSON.parse(r.out).hookSpecificOutput?.additionalContext || '' : ''; };

test('after compaction the session gets its exact state back and is told not to redo finished steps', () => {
  const tr = path.join(sb.home, 'transcripts', 's1.jsonl');
  const base = { session_id: 'sess-0001', transcript_path: tr, cwd: sb.home };
  assert.match(ctx(sb.hook('session-start', { ...base, source: 'startup' })), /memev_checkpoint/);
  sb.hook('prompt', { ...base, prompt: 'Add CSV export to the reports page' });
  transcript(tr, [user('Add CSV export to the reports page'), assistant('Starting.', [todos([['completed', 'Add export button'], ['completed', 'Write CSV serializer'], ['in_progress', 'Wire the download endpoint'], ['pending', 'Add tests for the endpoint']]), ['Edit', { file_path: 'src/reports/export.js' }]])]);
  assert.equal(sb.hook('pre-compact', { ...base, trigger: 'auto' }, 'claude-code', ['--project', 'reports']).code, 0);
  const card = ctx(sb.hook('session-start', { ...base, source: 'compact' }, 'claude-code', ['--project', 'reports']));
  assert.match(card, /\[Memev resume card\]/, 'a compaction sends the resume card');
  assert.doesNotMatch(card, /context was just compacted/i, 'the card is sent alone, with no lead line');
  assert.match(card, /In progress: Wire the download endpoint/);
  assert.match(card, /Already done \(do not redo\): Add export button; Write CSV serializer/);
  assert.match(card, /Next: Add tests for the endpoint/);
  assert.match(card, /src\/reports\/export\.js/);
});

test('the stop hook records the reply and checkpoints only when the todo list changed', () => {
  const tr = path.join(sb.home, 'transcripts', 's2.jsonl');
  const base = { session_id: 'sess-0002', transcript_path: tr, cwd: sb.home };
  transcript(tr, [user('rename the config flag'), assistant('Renamed the flag in three places.', [todos([['completed', 'Rename flag'], ['pending', 'Update docs']])])]);
  sb.hook('stop', base, 'claude-code', ['--project', 'config']);
  sb.hook('stop', base, 'claude-code', ['--project', 'config']);
  const card = ctx(sb.hook('session-start', { ...base, source: 'resume' }, 'claude-code', ['--project', 'config']));
  assert.match(card, /do not redo\): Rename flag/);
  const r = sb.run(['recall', 'Renamed the flag in three places']);
  assert.match(r.out, /work\/sessions\//);
  const cps = sb.run(['card', '--project', 'config', '--json']);
  assert.equal(JSON.parse(cps.out).project_state.checkpoints, 1, 'an unchanged todo list is not checkpointed twice');
});

test('every prompt gets relevant memory without being asked', () => {
  sb.run(['remember', 'The staging database password rotates on the first Monday of each month', '--kind', 'fact']);
  // the first recall after a remember can come back empty on a slow machine; ask again, a bounded number of times, for the same thing
  const c = pollUntil(() => ctx(sb.hook('prompt', { session_id: 'sess-0003', cwd: sb.home, prompt: 'when does the staging database password rotate?' })), (x) => /first Monday/.test(x), { timeoutMs: 20000, intervalMs: 500 });
  assert.match(c, /first Monday/);
  const none = sb.hook('prompt', { session_id: 'sess-0003', cwd: sb.home, prompt: 'zxqv plorb' });
  assert.equal(none.out, '', 'nothing injected when nothing is relevant');
});

test('sessions in several apps write at once and a new session in another app sees all of it', async () => {
  const a = mcpClient(sb, 'claude-code'), b = mcpClient(sb, 'codex');
  await Promise.all([a.request('initialize', { protocolVersion: '2025-06-18' }), b.request('initialize', { protocolVersion: '2025-06-18' })]);
  const writes = [];
  for (let i = 0; i < 25; i++) {
    writes.push(a.tool('memev_remember', { text: `Service alpha-${i} listens on port ${4000 + i}`, kind: 'fact', project: 'ports' }));
    writes.push(b.tool('memev_remember', { text: `Queue beta-${i} retries ${i % 5} times before dead-lettering`, kind: 'fact', project: 'queues' }));
  }
  const res = await Promise.all(writes);
  assert.ok(res.every((r) => !r.isError), JSON.stringify(res.find((r) => r.isError)));
  await a.tool('memev_checkpoint', { project: 'ports', task: 'document every port', done: ['alpha 0-24'], next: ['gamma services'] });
  await Promise.all([a.close(), b.close()]);
  const g = mcpClient(sb, 'gemini-cli');
  const start = await g.tool('memev_session_start', { task: 'which port does alpha-17 use', project: 'ports' });
  assert.match(start.content[0].text, /alpha-17 listens on port 4017/);
  assert.match(start.content[0].text, /Next: gamma services/);
  const q = await g.tool('memev_recall', { query: 'how many retries for queue beta-13' });
  assert.match(q.content[0].text, /beta-13 retries 3 times/);
  const st = await g.tool('memev_status', {});
  assert.ok(st.structuredContent.oplog.seq >= 51);
  await g.close();
});

test('Gemini and Cursor hook formats', () => {
  const gem = JSON.parse(sb.hook('session-start', { session_id: 'g1', cwd: sb.home, source: 'startup' }, 'gemini-cli', ['--format', 'gemini']).out);
  assert.equal(gem.hookSpecificOutput.hookEventName, 'SessionStart');
  const cur = JSON.parse(sb.hook('session-start', { conversation_id: 'c1', workspace_roots: [sb.home] }, 'cursor', ['--format', 'cursor']).out);
  assert.match(cur.additional_context, /Memev resume card/);
  assert.equal(sb.hook('prompt', { conversation_id: 'c1', prompt: 'port of alpha-3?' }, 'cursor', ['--format', 'cursor']).out, '');
});

test('hooks never break a session: with no vault they exit 0 and say so', () => {
  const r = sb.run(['hook', 'session-start', '--client', 'claude-code', '--root', path.join(sb.home, 'nowhere')], { input: '{}' });
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /not reachable/);
  assert.equal(sb.run(['hook', 'prompt', '--root', path.join(sb.home, 'nowhere')], { input: 'not json' }).code, 0);
});
