// Connecting Cursor leaves one step that only the user can do, so the checklist says it: check Settings → MCP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

after(() => cleanup());

test('MEM-096 AC01: connecting Cursor adds a checklist note naming Settings and MCP', () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(path.join(sb.home, '.cursor'), { recursive: true });
    const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(r.code, 0, r.out + r.err);
    const m = /→ Cursor: one step: (.+)/.exec(r.out);
    assert.ok(m, `the checklist has a Cursor note:\n${r.out}`);
    assert.match(m[1], /Settings/, `the note names Settings:\n${m[1]}`);
    assert.match(m[1], /MCP/, `the note names MCP:\n${m[1]}`);
  } finally { sb.stop(); }
});
