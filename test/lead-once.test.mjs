// The lead question is asked once, in the first fresh session after setup, with that session's own seat
// suggested. Every other session gets one quiet line that says the person was already asked.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { setupBus } from '../src/cli/bus-cli.mjs';
import { LEAD_NEEDED, LEAD_ASKED_LINE } from '../src/engine/bus.mjs';

after(() => cleanup());
const contextOf = (out) => { const j = JSON.parse(out || '{}'); return j.hookSpecificOutput?.additionalContext ?? j.additional_context ?? ''; };
const leadLines = (text) => text.split('\n').filter((l) => l.startsWith('[Memev bus]') && /lead/i.test(l));

// no terminal: init as an app runs it, then fresh session starts from three apps; operator.json is never touched here
function noTerminalStarts() {
  const sb = sandbox();
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  const start = (client, id, source = 'startup') => contextOf(sb.hook('session-start', { session_id: id, source }, client).out);
  return { sb, setup: start('claude-code', 'first'), second: start('cursor', 'second'), third: start('codex', 'third', 'clear') };
}

test('MEM-077 AC01: after the first fresh session asks, the other apps get one quiet line and no question', () => {
  const { sb, setup, second, third } = noTerminalStarts();
  try {
    assert.ok(setup.includes(LEAD_NEEDED), 'the first fresh session after setup is asked');
    assert.equal(typeof JSON.parse(fs.readFileSync(path.join(sb.root, 'bus', 'operator.json'), 'utf8')).asked, 'string', 'the hook records that it asked');
    for (const [name, text] of [['cursor', second], ['codex', third]]) {
      assert.ok(!text.includes(LEAD_NEEDED), `${name} gets no question`);
      assert.deepEqual(leadLines(text), [`[Memev bus] ${LEAD_ASKED_LINE}`], `${name} gets exactly one quiet line`);
      assert.match(LEAD_ASKED_LINE, /do not ask again/, 'the line tells the app not to ask again');
    }
  } finally { sb.stop(); }
});

test('MEM-077 AC02: with no terminal, the setup session is asked with its own seat suggested', () => {
  const { sb, setup, second } = noTerminalStarts();
  try {
    assert.match(setup, /\[Memev bus\] Suggested: claude-code@host \(/, 'the setup session names its own seat as the suggestion');
    assert.doesNotMatch(second, /Suggested:/, 'only the setup session carries the suggestion');
  } finally { sb.stop(); }
});

test('MEM-077 AC02: on a terminal, init suggests the seat running setup', async () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(sb.home, '.claude.json'), '{}\n');
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const input = new PassThrough(); input.end('1\n');
    const output = new PassThrough(); let shown = ''; output.on('data', (d) => { shown += d; });
    const r = await setupBus({ root: sb.root, env: { CLAUDECODE: '1' }, clients: ['claude-code'], ask: true, input, output });
    assert.equal(r.ok, true, r.problems.join(';'));
    assert.equal(r.operator, 'claude-code@host');
    assert.match(shown, /claude-code@host \(running this setup\)/);
  } finally { sb.stop(); }
});
