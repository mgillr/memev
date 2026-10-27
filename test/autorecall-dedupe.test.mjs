// Per-prompt recall within a session: an item is injected once, a new session or a compaction starts over, and past
// session journals and contract drafts stay out unless switched on, while memev_recall still finds them.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

const MEMORY = 'Webhook delivery in billing retries with jittered backoff capped at 60 seconds, with one idempotency key per delivery.';
const ASK = 'how does webhook delivery retry in billing';
let sb, draftId;
const ctxOf = (r) => (r.out.trim() ? JSON.parse(r.out).hookSpecificOutput.additionalContext : '');
const prompt = (session, text) => ctxOf(sb.hook('prompt', { session_id: session, prompt: text }, 'claude-code', ['--project', 'billing']));
const items = (ctx) => ctx.split('\n').filter((l) => l.startsWith('- [')).map((l) => l.slice(3, l.indexOf('] ')));
const memoryItem = (ctx) => items(ctx).find((it) => it.startsWith('memory/decisions/'));
const past = (ctx) => items(ctx).filter((it) => it.startsWith('work/sessions/') || it.startsWith('contracts/drafts/'));
function journals(on) {
  const f = path.join(sb.root, '.memev', 'config.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8')); c.recall = { ...c.recall, hook_include_journals: on };
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
  assert.equal(sb.run(['restart']).code, 0);
}

// A vault of its own for each test: every prompt is journaled, and a word asked about again and again across tests would
// count for less in recall each time, which is BM25 and not what these tests are about.
async function setup({ earlier = true } = {}) {
  sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  assert.equal(sb.run(['remember', MEMORY, '--kind', 'decision', '--project', 'billing', '--force']).code, 0);
  // an earlier session that asked about the same thing (its journal holds the words) and a contract draft
  if (earlier) prompt('seed-earlier', `${ASK}, and what caps the backoff`);
  const m = mcpClient(sb, 'claude-code');
  await m.request('initialize', { protocolVersion: '2025-06-18' });
  const d = await m.tool('memev_contract_draft', { title: 'Quokka ledger reconciler for billing webhooks', project: 'billing', workdir: sb.home, tasks: [{ id: 'T1', title: 'Quokka reconciler script exists', criteria: [{ statement: 'the quokka reconciler script exists', verifier: { type: 'file_exists', path: 'quokka.js' } }] }] });
  draftId = d.structuredContent.id;
  await m.close();
  assert.ok(fs.existsSync(path.join(sb.root, 'contracts', 'drafts', `${draftId}.json`)));
}
afterEach(() => { sb?.stop(); sb = null; });
after(() => cleanup());

test('MEM-112 AC02: An item injected for one prompt is not injected again for a later prompt in the same session', async () => {
  await setup({ earlier: false });
  const FOLLOW = 'what caps the webhook delivery retries in billing';
  const item = memoryItem(prompt('dedupe-a', ASK));
  assert.ok(item, 'the first prompt injects the memory');
  assert.equal(items(prompt('dedupe-a', FOLLOW)).includes(item), false, 'not injected again in the same session');
  // the follow-up does find it: a fresh session gets it, so it was left out above because it was already given
  assert.ok(items(prompt('dedupe-b', FOLLOW)).includes(item), 'a fresh session gets it for the same follow-up');
});

test('MEM-112 AC03: A new session id, or a compaction, resets the injected set', async () => {
  await setup({ earlier: false });
  const item = memoryItem(prompt('reset-a', ASK));
  assert.ok(item);
  assert.equal(items(prompt('reset-a', 'what caps the webhook delivery retries in billing')).includes(item), false, 'same session: left out');
  assert.ok(items(prompt('reset-b', 'webhook delivery retry backoff for billing')).includes(item), 'a new session gets it again');
  sb.hook('session-start', { session_id: 'reset-a', source: 'compact' }, 'claude-code', ['--project', 'billing']);
  assert.ok(items(prompt('reset-a', 'remind me about webhook delivery retries in billing')).includes(item), 'after a compaction the same session gets it again');
});

test('MEM-112 AC04: Session journals and contract drafts are not injected by the hook by default, and are with the config switch on', async () => {
  await setup();
  const draftAsk = 'quokka ledger reconciler for billing webhooks';
  assert.deepEqual(past(prompt('past-a', ASK)), [], 'no journal lines by default');
  assert.deepEqual(past(prompt('past-a', draftAsk)), [], 'no contract draft by default');
  journals(true);
  try {
    assert.ok(past(prompt('past-b', ASK)).some((it) => it.startsWith('work/sessions/')), 'journal lines with the switch on');
    assert.ok(past(prompt('past-b', draftAsk)).some((it) => it === `contracts/drafts/${draftId}.json` || it.startsWith(`contracts/drafts/${draftId}.json#`)), 'the draft with the switch on');
  } finally { journals(false); }
});

test('MEM-112 AC05: memev_recall still returns journals and drafts when asked', async () => {
  await setup();
  const m = mcpClient(sb, 'claude-code');
  try {
    await m.request('initialize', { protocolVersion: '2025-06-18' });
    const hits = async (query) => (await m.tool('memev_recall', { query, project: 'billing', limit: 10 })).structuredContent.result.map((h) => h.path);
    assert.ok((await hits(ASK)).some((p) => p.startsWith('work/sessions/')), 'a journal');
    assert.ok((await hits('quokka ledger reconciler')).includes(`contracts/drafts/${draftId}.json`), 'the draft');
  } finally { await m.close(); }
});

test("MEM-112 AC06: The 'continue' prompt after a contract draft was written injects nothing", async () => {
  await setup();
  assert.ok(fs.existsSync(path.join(sb.root, 'contracts', 'drafts', `${draftId}.json`)));
  for (const p of ['continue', 'go on', 'ok']) assert.equal(prompt('cont-a', p), '', p);
});
