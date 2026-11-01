// The protocol is sent once per session, in one place: by the session-start hook in apps that have one, otherwise in
// the MCP instructions. It is a lean text, and the instruction files point at it instead of repeating it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, initWithRetry } from './helpers/cli.mjs';
import { newVault, cleanup, OWNER, PKG } from './helpers/tmp.mjs';
import { PROTOCOL, PROTOCOL_POINTER, PROTOCOL_REVIEW } from '../src/engine/card.mjs';
import { INSTRUCTIONS, HOOK_CLIENTS, clientDefs } from '../src/cli/clients.mjs';
import { handle } from '../src/server/mcp.mjs';
import { count } from '../scripts/bench/o200k.mjs';

after(() => cleanup());
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const FORMAT = { 'claude-code': [], codex: [], 'gemini-cli': ['--format', 'gemini'], cursor: ['--format', 'cursor'] };
const contextOf = (out) => { const j = JSON.parse(out || '{}'); return j.hookSpecificOutput?.additionalContext ?? j.additional_context ?? ''; };
// the tool names the protocol tells a session to call
const TOOLS = [...new Set(PROTOCOL.match(/\b(?:memev|bus)_[a-z_]+/g))];

test('MEM-113 AC02: For each client with hooks, the MCP initialize instructions do not repeat the protocol the hook sends, and for each client without hooks the instructions carry it', async () => {
  const defs = clientDefs({}, 'memev');
  assert.deepEqual([...HOOK_CLIENTS].sort(), defs.filter((d) => d.mode === 'hooks').map((d) => d.id).sort(), 'the hook clients are the registry\'s');
  assert.ok(HOOK_CLIENTS.size >= 4 && defs.some((d) => !HOOK_CLIENTS.has(d.id)));
  const { v } = newVault();
  try {
    const init = async (client) => (await handle(v, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { identity: OWNER, client, local: true })).result.instructions;
    const start = async (client) => (await handle(v, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memev_session_start', arguments: { task: 't' } } }, { identity: OWNER, client, local: true })).result.content[0].text;
    for (const d of [...defs, { id: 'claude-ai' }]) { // claude-ai: a cloud connector, never a hook
      const text = await init(d.id);
      if (HOOK_CLIENTS.has(d.id)) {
        assert.equal(norm(text).includes(norm(PROTOCOL)), false, `${d.id}: instructions do not repeat the protocol`);
        assert.equal(text, PROTOCOL_POINTER);
        assert.ok((await start(d.id)).startsWith(PROTOCOL), `${d.id}: memev_session_start still brings it when the hook did not run`);
      } else {
        assert.equal(text, PROTOCOL, `${d.id}: no hook, so the instructions carry it`);
        assert.equal((await start(d.id)).includes(norm(PROTOCOL).slice(0, 60)), false, `${d.id}: memev_session_start does not send it a second time`);
      }
    }
  } finally { v.close(); }
  // and the session-start hook of each app that has one does bring it, in that app's format
  const sb = sandbox();
  try {
    assert.equal(initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    for (const id of HOOK_CLIENTS) {
      const ctx = contextOf(sb.hook('session-start', { session_id: `once-${id}`, source: 'startup' }, id, FORMAT[id] || []).out);
      assert.ok(ctx.includes(PROTOCOL), `${id}: the hook sends the protocol`);
      assert.equal(ctx.split(PROTOCOL).length - 1, 1, `${id}: once`);
    }
  } finally { sb.stop(); }
});

test('MEM-113 AC03: The protocol text is at most 200 tokens by the harness counter', () => {
  const n = count(PROTOCOL);
  assert.ok(n <= 200, `${n} tokens`);
  assert.ok(n > 100, 'and still a protocol');
});

test('MEM-113 AC04: Every behaviour rule in the 18abe10 protocol is either in the lean text or listed in the committed rule-by-rule review note with the reason it was dropped', () => {
  // the 18abe10 text, as the benchmark's token fixture holds it
  const old = JSON.parse(fs.readFileSync(path.join(PKG, 'test', 'bench', 'o200k-fixture.json'), 'utf8')).texts.find((t) => t.name === 'protocol_18abe10');
  assert.ok(old && count(old.text) === 562, 'the 18abe10 protocol (562 tokens)');
  // the review's pieces, in order, are the whole of it: no sentence is left unaccounted for
  assert.equal(norm(PROTOCOL_REVIEW.map((r) => r.was).join(' ')), norm(old.text));
  for (const r of PROTOCOL_REVIEW) {
    if ('now' in r) assert.ok(norm(PROTOCOL).includes(norm(r.now)), `kept: "${r.was}" is in the lean text as "${r.now}"`);
    else assert.ok(typeof r.dropped === 'string' && r.dropped.length > 10, `dropped with a reason: "${r.was}"`);
  }
  // the rules the shorter draft in the token report had lost are kept: picking the lead and signing contracts
  for (const kept of ['bus_set_operator', 'never self-appoint', 'memev_contract_sign', 'not other agents']) assert.ok(PROTOCOL.includes(kept), kept);
});

test('MEM-113 AC05: The CLAUDE.md, AGENTS.md and GEMINI.md block does not repeat rules that the hook already sends', () => {
  const repeated = (text) => TOOLS.filter((t) => t !== 'memev_session_start' && text.includes(t));
  assert.deepEqual(repeated(INSTRUCTIONS), [], 'the block names no tool the protocol rules on');
  for (const line of PROTOCOL.split('\n').slice(1)) assert.equal(INSTRUCTIONS.includes(line.replace(/^- /, '')), false, line);
  assert.match(INSTRUCTIONS, /memev_session_start/, 'it points at where the rules come from');
  // what init writes into each app's instruction file
  const sb = sandbox();
  try {
    for (const d of ['.claude', '.codex', '.gemini']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
    assert.equal(initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only']).code, 0);
    for (const f of [['.claude', 'CLAUDE.md'], ['.codex', 'AGENTS.md'], ['.gemini', 'GEMINI.md']]) {
      const text = fs.readFileSync(path.join(sb.home, ...f), 'utf8');
      assert.ok(text.includes('<!-- memev:start -->'), f.join('/'));
      assert.deepEqual(repeated(text), [], `${f.join('/')} repeats no rule`);
    }
  } finally { sb.stop(); }
});

test('the no-lead notice stops at session start once the setup session has asked', () => {
  const sb = sandbox();
  try {
    assert.equal(initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const start = (id) => contextOf(sb.hook('session-start', { session_id: id, source: 'startup' }).out);
    assert.match(start('lead-a'), /No lead AI is set/);
    const f = path.join(sb.root, 'bus', 'operator.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), asked: '2026-10-27T12:00:00.000Z' }));
    assert.doesNotMatch(start('lead-b'), /No lead AI is set/);
  } finally { sb.stop(); }
});
