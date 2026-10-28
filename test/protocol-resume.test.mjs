// Session start after a compaction or on resume: the resume card only, never the protocol again, and nothing at all on
// resume when the context already holds an unchanged card.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { PROTOCOL } from '../src/engine/card.mjs';

let sb;
const contextOf = (out) => { const j = JSON.parse(out || '{}'); return j.hookSpecificOutput?.additionalContext ?? ''; };
const start = (session, source) => contextOf(sb.hook('session-start', { session_id: session, source }, 'claude-code', ['--project', 'billing']).out);
const CARD = '[Memev resume card]';
before(() => {
  sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
});
after(() => { sb.stop(); cleanup(); });

test('MEM-114 AC02: A compact or resume session-start sends no protocol text', () => {
  assert.ok(start('ac02', 'startup').includes(PROTOCOL), 'a startup sends it');
  const compact = start('ac02', 'compact');
  assert.ok(compact.includes(CARD), 'a compaction sends the card');
  assert.equal(compact.includes(PROTOCOL), false, 'but not the protocol');
  assert.equal(start('ac02-other', 'resume').includes(PROTOCOL), false, 'a resume never sends the protocol');
});

test('MEM-114 AC03: An unchanged card is not sent again in the same session; a changed card is', () => {
  assert.ok(start('ac03', 'startup').includes(CARD));
  assert.equal(start('ac03', 'resume'), '', 'resumed with the same state: the context already holds the card');
  // the state changes: a checkpoint for this project
  assert.equal(sb.run(['checkpoint', '--project', 'billing', '--task', 'invoice export', '--doing', 'adding the index', '--done', 'reproduced the timeout']).code, 0);
  const changed = start('ac03', 'resume');
  assert.ok(changed.includes(CARD) && changed.includes('adding the index'), `a changed card is sent:\n${changed}`);
  assert.equal(start('ac03', 'resume'), '', 'and once sent, not again');
  // after a compaction the context no longer holds it, so the card comes back
  assert.ok(start('ac03', 'compact').includes(CARD));
});

test('MEM-114 AC04: A fresh startup or clear still sends the card', () => {
  const first = start('ac04', 'startup');
  assert.ok(first.includes(CARD) && first.includes(PROTOCOL));
  const clear = start('ac04', 'clear');
  assert.ok(clear.includes(CARD), 'a clear sends the card');
  assert.ok(clear.includes(PROTOCOL), 'and the rules, since the context is empty again');
  assert.ok(start('ac04-new', 'startup').includes(CARD), 'a new session gets it');
});
