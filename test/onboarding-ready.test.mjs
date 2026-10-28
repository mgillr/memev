// The end of init leads with what matters: Ready (the apps that now share one memory), at most two steps that need
// you (restart the apps, choose the lead), and everything that can wait under 'Later, optional'.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { print } from '../src/cli/onboarding.mjs';

after(() => cleanup());
function init(apps) {
  const sb = sandbox();
  for (const d of apps) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
  const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
  sb.stop();
  assert.equal(r.code, 0, r.out + r.err);
  const out = r.out; const later = out.indexOf('\nLater, optional\n'); const finish = out.indexOf('\nFinish: restart these apps');
  assert.ok(later > 0 && finish > later, `the sections come in order:\n${out}`);
  return { out, before: out.slice(0, later), later: out.slice(later, finish), finish: out.slice(finish) };
}
const steps = (out) => Number(/^(\d+) step\(s\) need you/m.exec(out)?.[1] || 0);

test("MEM-076 AC02: Backup, cloud and login service appear only under 'Later, optional'", () => {
  const s = init(['.claude', '.cursor']);
  for (const step of ['Backup to your own private GitHub repository', 'Cloud AI apps', 'Start at login']) {
    assert.match(s.later, new RegExp(`^  \\S ${step}`, 'm'), `${step} is under Later, optional`);
    assert.equal(s.before.includes(step), false, `${step} is not in Setup or the steps that need you`);
    assert.equal(s.finish.includes(step), false, `${step} is not in the Finish block`);
  }
});

test('a fresh init leads with Ready, then at most two steps that need you, then Later, optional', () => {
  const s = init(['.claude', '.cursor']);
  assert.match(s.before, /\nReady: Claude Code and Cursor share one memory\.\n/);
  assert.equal(steps(s.out), 2, s.out);
  assert.match(s.before, /→ Apps: restart them as listed under Finish below/);
  assert.match(s.before, /→ Lead AI: no lead AI chosen yet/);
  assert.ok(s.out.indexOf('Ready:') < s.out.indexOf('step(s) need you'), 'Ready comes first');
  // an app's own extra step (Codex asks to trust its hooks once) belongs to the apps step, not a step of its own
  const c = init(['.claude', '.cursor', '.codex']);
  assert.equal(steps(c.out), 2, c.out);
  assert.match(c.before, /→ Apps: restart them as listed under Finish below, and\n {4}→ Codex CLI: one step: /);
});

test('a failed step means Not ready, and still at most the steps that need you', () => {
  const lines = []; const log = console.log; console.log = (s) => lines.push(s);
  try {
    print([
      { status: 'succeeded', step: 'Vault', detail: '/v' },
      { status: 'failed', step: 'Memev running', detail: 'port 7787 in use (memev doctor)' },
      { status: 'added', step: 'Claude Code', detail: 'MCP', app: 'claude-code' },
      { status: 'needs-manual', step: 'Lead AI', detail: 'no lead AI chosen yet' },
      { status: 'needs-manual', step: 'Backup to your own private GitHub repository', detail: 'memev github setup' },
    ]);
  } finally { console.log = log; }
  const out = lines.join('\n');
  assert.match(out, /Not ready: Memev running \(memev doctor says why\)\./);
  assert.doesNotMatch(out, /\nReady:/);
  assert.equal(steps(out), 2);
  assert.ok(out.indexOf('Backup to your own') > out.indexOf('Later, optional'));
});
