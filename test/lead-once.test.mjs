// The lead question is asked once, at setup. Other sessions get a quiet line, not the question.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

after(() => cleanup());
const contextOf = (out) => { const j = JSON.parse(out || '{}'); return j.hookSpecificOutput?.additionalContext ?? j.additional_context ?? ''; };

test('MEM-077 AC01: the lead question is asked once at setup, and other sessions get a quiet line with no question', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const start = (id) => contextOf(sb.hook('session-start', { session_id: id, source: 'startup' }).out);
    // the setup session (first fresh start) gets the question
    assert.match(start('setup-session'), /No lead AI is set/);
    // the setup session has now asked; other sessions get a quiet line, not the question
    const f = path.join(sb.root, 'bus', 'operator.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), asked: '2026-10-27T12:00:00.000Z' }));
    const other = start('other-session');
    assert.doesNotMatch(other, /No lead AI is set/);
    assert.doesNotMatch(other, /Ask the user which AI should lead/);
  } finally { sb.stop(); }
});
