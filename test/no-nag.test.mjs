// The no-nag principles, enforced by tests: Memev never talks about plans, prices, trials or
// upgrades in the context it hands an AI, a plan-limit message stays one line with one command and
// no countdown, and every single-computer feature works with no licence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { seatPolicy, readOnlyReason, CORE_FEATURES, can, limitsFor } from '../src/engine/entitlements.mjs';

let sb;
const contextOf = (out) => { const j = JSON.parse(out || '{}'); return j.hookSpecificOutput?.additionalContext ?? ''; };
before(() => {
  sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
});
after(() => { sb.stop(); cleanup(); });

// The words a plan, price, trial or upgrade message would carry. The vault is kept free of them, so
// any hit comes from Memev itself, not from what the person recorded.
const NAG = /\b(plans?|prices?|trial|upgrades?)\b/i;
const assertClean = (text, where) => assert.equal(NAG.test(text), false, `${where} carries plan text: ${String(text).match(NAG)}`);

test('MEM-086 AC01: No hook, resume card or MCP tool output contains plan, price, trial or upgrade text', async () => {
  // a little clean state so the card and recall have something to show
  assert.equal(sb.run(['checkpoint', '--project', 'billing', '--task', 'invoice export', '--doing', 'adding the index', '--done', 'reproduced the timeout']).code, 0);
  // the four hooks: their stdout is what reaches the AI context
  for (const e of ['session-start', 'prompt', 'pre-compact', 'stop']) {
    const payload = e === 'prompt' ? { session_id: 'nag01', prompt: 'how do I export the invoice' } : { session_id: 'nag01' };
    const r = sb.hook(e, payload, 'codex');
    assert.equal(r.code, 0, `${e} hook failed: ${r.err}`);
    assertClean(r.out, `${e} hook output`);
  }
  // the resume card on its own: what session-start puts in context
  assertClean(contextOf(sb.hook('session-start', { session_id: 'nag01-card', source: 'clear' }, 'codex').out), 'resume card');
  // the MCP tools an app calls: their text is what reaches the AI context
  const m = mcpClient(sb, 'codex');
  try {
    await m.request('initialize', { protocolVersion: '2025-06-18' });
    const calls = [
      ['memev_session_start', { task: 'export the invoice', project: 'billing' }],
      ['memev_recall', { query: 'invoice export', project: 'billing' }],
      ['memev_remember', { text: 'The deploy runs on the staging host at night.', kind: 'fact', project: 'billing', force: true }],
      ['memev_status', {}],
      ['memev_doctor', {}],
      ['memev_list', {}],
      ['memev_contract_status', {}],
      ['bus_roster', {}],
    ];
    for (const [name, args] of calls) {
      const r = await m.tool(name, args);
      assert.ok(!r.isError, `${name} errored: ${JSON.stringify(r)}`);
      const text = (r.content || []).map((c) => c.text).join('\n') + '\n' + JSON.stringify(r.structuredContent ?? {});
      assertClean(text, `MCP ${name} output`);
    }
  } finally { await m.close(); }
});

// A plan message is what Memev says when the plan limits an action: the reason enrollment is
// refused, a note about the licence, or why a computer may only read. The principle: one line,
// no countdown, and a message that tells the person what to do names exactly one memev command.
const COUNTDOWN = /\b(expires|ends)\s+in\b/i;
const COUNTDOWN2 = /\b\d+\s+(day|days|hour|hours|minute|minutes|week|weeks|month|months)\b[^.]*\b(left|remaining|to go|before|until)\b/i;
const isCountdown = (s) => COUNTDOWN.test(s) || COUNTDOWN2.test(s);
const memevCommands = (s) => (s.match(/\bmemev [a-z][a-z_-]*/g) || []);
const assertShape = (label, msg) => {
  assert.equal(typeof msg, 'string', `${label}: a plan message is given`);
  assert.equal(msg.includes('\n'), false, `${label}: the plan message is a single line`);
  assert.equal(isCountdown(msg), false, `${label}: no countdown (${msg})`);
  assert.ok(memevCommands(msg).length <= 1, `${label}: at most one memev command (${msg})`);
};
const assertCommand = (label, msg) => {
  assertShape(label, msg);
  assert.equal(memevCommands(msg).length, 1, `${label}: exactly one memev command (${msg})`);
};

test('MEM-086 AC02: Every plan message is a single line containing one memev command and no countdown', () => {
  // the two enrollment refusals: the licence is expired, or the seat count is reached
  const expired = seatPolicy({ license: { state: 'expired', exp: '2026-01-01' }, devices: [] });
  const seats = seatPolicy({ license: { state: 'valid', seats: 1, tier: 'free' }, devices: [] });
  assert.equal(expired.can_enroll, false, 'an expired licence refuses enrollment');
  assert.equal(seats.can_enroll, false, 'a full seat count refuses enrollment');
  assertCommand('expired licence', expired.reason);
  assertCommand('full seat count', seats.reason);
  // a licence in grace still allows enrollment, so the reason is null and the notes carry the
  // message: one line, no day count, exactly one memev command
  const grace = seatPolicy({ license: { state: 'grace', exp: '2026-01-01', days_left: 3, seats: 4, tier: 'personal' }, devices: [] });
  assert.equal(grace.reason, null, 'a licence in grace refuses nothing, so no reason');
  const graceNote = 'The licence expired on 2026-01-01 and is in its grace period. Renew it with `memev license install <file>`; after that no computer can be added and added computers can only read.';
  assert.deepEqual(grace.notes, [graceNote], 'the grace note is the only note and names the renewal command');
  assertCommand('grace note', grace.notes[0]);
  // with no licence at all, an added computer may only read: the note and the per-computer
  // reason stay one line with no countdown
  const laptop = { id: 'd1', kind: 'remote-computer', status: 'active', label: 'laptop', created: '2026-01-01' };
  const nolicense = seatPolicy({ license: null, devices: [laptop] });
  assert.equal(nolicense.can_enroll, false, 'with no licence the second computer is refused');
  assertCommand('no licence, full count', nolicense.reason);
  assert.deepEqual(nolicense.notes, ['1 computer can read but not write (laptop): there is no valid licence.'], 'the read-only note says why');
  for (const n of nolicense.notes) assertShape('read-only note', n);
  assertShape('read-only reason', readOnlyReason(nolicense, laptop));
});

test('MEM-086 AC03: Every single-computer feature works with no licence', async () => {
  // no core feature is gated behind a licence: the free tier grants all of them
  assert.ok(CORE_FEATURES.length > 0, 'the core features are listed');
  for (const f of CORE_FEATURES) assert.equal(can(f), true, `core feature ${f} is free`);
  // the free tier is one computer, and nothing on it is capped
  const lim = limitsFor(null);
  assert.equal(lim.tier, 'free');
  assert.equal(lim.computers, 1);
  // with no licence installed, the vault reports the free tier and that this computer is never limited
  const s = sb.run(['license', 'status']);
  assert.equal(s.code, 0, s.out + s.err);
  assert.match(s.out, /free tier/i);
  assert.match(s.out, /never limited/i);
  // and a core feature actually works on this computer with no licence: remember and recall
  const m = mcpClient(sb, 'codex');
  try {
    await m.request('initialize', { protocolVersion: '2025-06-18' });
    const saved = await m.tool('memev_remember', { text: 'The invoice export reads the billing schema, never the legacy table.', kind: 'fact', project: 'billing', force: true });
    assert.ok(!saved.isError, JSON.stringify(saved));
    const rec = await m.tool('memev_recall', { query: 'which table does the invoice export read', project: 'billing' });
    assert.match(JSON.stringify(rec.structuredContent), /billing schema/i);
  } finally { await m.close(); }
});
