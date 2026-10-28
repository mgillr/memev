// MEM-052: contracts are opt-in. Off by default for new installs; on for existing vaults.
// `memev contracts on|off|status` controls the flag. Hooks respect it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

function fresh() {
  const sb = sandbox();
  const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  assert.equal(r.code, 0, r.err + r.out);
  return sb;
}
const configPath = (sb) => path.join(sb.root, '.memev', 'config.json');
const contractsSetting = (sb) => JSON.parse(fs.readFileSync(configPath(sb), 'utf8')).contracts?.enabled;

test('MEM-052 AC01: fresh install reports contracts off', () => {
  const sb = fresh();
  try {
    assert.equal(contractsSetting(sb), false, 'contracts.enabled is false in a fresh vault');
    const r = sb.run(['contracts', 'status']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Contracts: off/);
  } finally { sb.stop(); cleanup(); }
});

test('MEM-052 AC02: with contracts off, the prompt hook adds no nudge and the Stop hook never blocks', async () => {
  const sb = fresh();
  try {
    assert.equal(contractsSetting(sb), false);
    const wd = path.join(sb.home, 'proj'); fs.mkdirSync(wd, { recursive: true });
    const sess = 'sess-optin-1';
    const base = { session_id: sess, transcript_path: path.join(sb.home, 't.jsonl'), cwd: wd };

    // sign a contract so there is something to gate on
    const mcp = mcpClient(sb, 'claude-code');
    let contractId;
    try {
      await mcp.request('initialize', { protocolVersion: '2025-06-18' });
      const d = await mcp.tool('memev_contract_draft', {
        title: 'Opt-in test', project: 'optin', workdir: wd,
        tasks: [{ id: 'T1', title: 'a file', scope: ['**'], criteria: [{ statement: 'file exists', verifier: { type: 'file_exists', path: 'a.txt' } }] }],
      });
      assert.ok(!d.isError, JSON.stringify(d));
      contractId = d.structuredContent.id;
      const s = await mcp.tool('memev_contract_sign', { id: contractId, session: sess });
      assert.ok(!s.isError, JSON.stringify(s));
    } finally { await mcp.close(); }

    // prompt hook: no contract nudge when contracts are off
    const p = sb.hook('prompt', { ...base, prompt: 'build me a todo app with a REST API' });
    assert.equal(p.code, 0, p.err);
    const pOut = p.out ? JSON.parse(p.out).hookSpecificOutput?.additionalContext || '' : '';
    assert.ok(!pOut.includes('memev_contract_from_request'), `the prompt hook must not nudge when contracts are off:\n${p.out}`);

    // stop hook: never blocks, even with an open contract for this session
    const s = sb.hook('stop', { ...base, last_assistant_message: 'done' });
    assert.equal(s.code, 0, s.err);
    const sOut = s.out ? JSON.parse(s.out) : {};
    assert.notEqual(sOut.decision, 'block', `the Stop hook must not block when contracts are off:\n${s.out}`);
  } finally { sb.stop(); cleanup(); }
});

test('MEM-052 AC03: memev contracts on restores the nudge and the Stop gate', async () => {
  const sb = fresh();
  try {
    assert.equal(contractsSetting(sb), false);
    const on = sb.run(['contracts', 'on']);
    assert.equal(on.code, 0, on.err);
    assert.equal(contractsSetting(sb), true, 'contracts.enabled is true after memev contracts on');
    const st = sb.run(['contracts', 'status']);
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /Contracts: on/);

    const wd = path.join(sb.home, 'proj'); fs.mkdirSync(wd, { recursive: true });
    const sess = 'sess-optin-2';
    const base = { session_id: sess, transcript_path: path.join(sb.home, 't.jsonl'), cwd: wd };

    // sign a contract so there is something to gate on
    const mcp = mcpClient(sb, 'claude-code');
    let contractId;
    try {
      await mcp.request('initialize', { protocolVersion: '2025-06-18' });
      const d = await mcp.tool('memev_contract_draft', {
        title: 'Opt-in test 2', project: 'optin', workdir: wd,
        tasks: [{ id: 'T1', title: 'a file', scope: ['**'], criteria: [{ statement: 'file exists', verifier: { type: 'file_exists', path: 'a.txt' } }] }],
      });
      assert.ok(!d.isError, JSON.stringify(d));
      contractId = d.structuredContent.id;
      const s = await mcp.tool('memev_contract_sign', { id: contractId, session: sess });
      assert.ok(!s.isError, JSON.stringify(s));
    } finally { await mcp.close(); }

    // stop hook: blocks while the contract is open
    const s = sb.hook('stop', { ...base, last_assistant_message: 'done' });
    assert.equal(s.code, 0, s.err);
    const sOut = s.out ? JSON.parse(s.out) : {};
    assert.equal(sOut.decision, 'block', `the Stop hook blocks while a contract is open:\n${s.out}`);
  } finally { sb.stop(); cleanup(); }
});
