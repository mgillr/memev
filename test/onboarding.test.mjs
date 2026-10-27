// The end of init: apps load Memev when a session starts, so init closes with one restart line per connected app.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { RESTART } from '../src/cli/clients.mjs';

after(() => cleanup());

test('MEM-009 AC02: Every connected client id has a restart line; apps that were not connected have none', () => {
  const sb = sandbox();
  try {
    for (const d of ['.claude', '.cursor', '.codex']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
    const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(r.code, 0, r.out + r.err);
    const finish = r.out.slice(r.out.lastIndexOf('Finish: restart these apps'));
    assert.ok(r.out.includes('Finish: restart these apps'), r.out);
    const connected = Object.keys(JSON.parse(fs.readFileSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'clients-state.json'), 'utf8')).connected);
    assert.deepEqual(connected.sort(), ['claude-code', 'codex', 'cursor']);
    assert.equal(finish.trim().split('\n').length - 1, connected.length, `one line per connected app\n${finish}`);
    for (const [id, line] of Object.entries(RESTART)) {
      const n = finish.split('\n').filter((l) => l.trim() === `→ ${line}`).length;
      assert.equal(n, connected.includes(id) ? 1 : 0, `${id}: ${connected.includes(id) ? 'one restart line' : 'no restart line'}\n${finish}`);
    }
    assert.match(finish, /Start a new Claude Code session/);
    assert.match(finish, /Open a new Cursor chat/);
    assert.doesNotMatch(finish, /Gemini|Claude Desktop|Windsurf|VS Code|Zed/);
  } finally { sb.stop(); }
});

test('init with no app to connect prints no restart block', () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.out.includes('Finish: restart these apps'), false, r.out);
  } finally { sb.stop(); }
});
