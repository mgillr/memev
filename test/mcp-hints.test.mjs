// The MCP tool list marks each read-only tool with annotations.readOnlyHint so a cloud app that
// only allows read and fetch (ChatGPT Plus and Pro developer mode) can still use it, and a write
// tool never carries the hint. The per-plan matrix in docs/CLOUD.md says which plans allow what.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toolList } from '../src/server/mcp.mjs';
import { PKG } from './helpers/tmp.mjs';

// Read-only tools: they return state and change nothing in the vault or on the bus.
const READ_ONLY = [
  'memev_session_start', 'memev_recall', 'memev_why', 'memev_audit', 'memev_get', 'memev_list',
  'memev_claims', 'memev_graph', 'memev_explain', 'memev_provenance', 'memev_tournament_standings',
  'memev_doctor', 'memev_contract_status', 'memev_contract_list', 'bus_since', 'bus_tail',
  'bus_roster', 'bus_tasks', 'memev_status',
];
// Write tools: they change the vault or the bus, so a read-only connector must not be told they are safe.
const WRITE = [
  'memev_remember', 'memev_review', 'memev_checkpoint', 'memev_write', 'memev_append', 'memev_link',
  'memev_claim', 'memev_feedback', 'memev_tournament_match', 'memev_contract_draft', 'memev_contract_sign',
  'memev_contract_verify', 'memev_contract_from_request', 'memev_contract_amend', 'memev_contract_decompose',
  'bus_unread', 'bus_send', 'bus_check', 'bus_set_operator',
];

test('MEM-057 AC01: Every read-only MCP tool has annotations.readOnlyHint true and no write tool has it', () => {
  const byName = new Map(toolList().map((t) => [t.name, t]));
  const classified = [...READ_ONLY, ...WRITE];
  assert.equal(new Set(classified).size, classified.length, 'a tool is in both lists');
  assert.deepEqual([...byName.keys()].sort(), [...classified].sort(), 'every tool is classified as read-only or write');
  for (const name of READ_ONLY) {
    const t = byName.get(name);
    assert.ok(t, `${name} is in the tool list`);
    assert.equal(t.annotations?.readOnlyHint, true, `${name} is read-only: readOnlyHint must be true`);
  }
  for (const name of WRITE) {
    const t = byName.get(name);
    assert.ok(t, `${name} is in the tool list`);
    assert.equal(t.annotations?.readOnlyHint, false, `${name} is a write tool: readOnlyHint must not be true`);
  }
});

test('MEM-057 AC02: CLOUD.md has the plan matrix naming Plus and Business', () => {
  const md = fs.readFileSync(path.join(PKG, 'docs', 'CLOUD.md'), 'utf8');
  assert.match(md, /Plus/, 'the matrix names the Plus plan');
  assert.match(md, /Business/, 'the matrix names the Business plan');
  assert.match(md, /claude\.ai/, 'the matrix covers claude.ai');
  assert.match(md, /\d{4}-\d{2}-\d{2}/, 'the matrix carries the date it was checked');
});
