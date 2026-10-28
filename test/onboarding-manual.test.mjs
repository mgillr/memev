// When Memev cannot edit an app's config, the checklist says why and names the file, and memev connect <app> --print
// prints exactly what to paste by hand, changing nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

after(() => cleanup());
const BROKEN = '{\n  "theme": "One Dark",\n'; // saved half-way through an edit
function brokenZed() {
  const sb = sandbox();
  const file = path.join(sb.home, '.config', 'zed', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, BROKEN);
  return { sb, file };
}

test('MEM-043 AC01: an app whose config cannot be edited shows the reason and the file path in the checklist', () => {
  const { sb, file } = brokenZed();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only']);
    const zed = init.out.split('\n').filter((l) => /\bZed\b/.test(l) && !/Finish|restart/i.test(l));
    assert.equal(zed.length, 1, init.out);
    assert.ok(zed[0].includes(file), `the file path: ${zed[0]}`);
    assert.match(zed[0], /is not valid JSON with comments \(PropertyNameExpected at offset \d+\)/, 'the reason');
    assert.match(zed[0], /memev connect zed --print shows what to paste by hand/);
    assert.equal(fs.readFileSync(file, 'utf8'), BROKEN, 'the file is left as it was');
    // checking again later says the same
    assert.ok(sb.run(['onboarding']).out.split('\n').some((l) => /\bZed\b/.test(l) && l.includes(file)));
  } finally { sb.stop(); }
});

test('MEM-043 AC02: memev connect <app> --print prints the exact snippet for that app, and pasting it connects the app', () => {
  const { sb, file } = brokenZed();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const p = sb.run(['connect', 'zed', '--print']);
    assert.equal(p.code, 0, p.out + p.err);
    assert.match(p.out, /^Zed: what Memev adds, to paste by hand\. Nothing was changed\./);
    const at = p.out.indexOf(`In ${file}, merge this into the JSON object that is there:\n`);
    assert.ok(at > 0, p.out);
    const snippet = JSON.parse(p.out.slice(p.out.indexOf('{', at)));
    assert.deepEqual(Object.keys(snippet), ['context_servers']);
    assert.deepEqual(snippet.context_servers.memev.args, ['mcp', '--client', 'zed']);
    assert.equal(fs.readFileSync(file, 'utf8'), BROKEN, 'printing changes nothing');
    // the person repairs the file and pastes the snippet: Memev then finds itself there, exactly as it would write it
    fs.writeFileSync(file, `${JSON.stringify({ theme: 'One Dark', ...snippet }, null, 2)}\n`);
    assert.match(sb.run(['connect', 'zed']).out, /Zed: already connected/);
    // an app with several files gets each one, and the flag may come first
    const cc = sb.run(['connect', '--print', 'claude-code']);
    assert.equal(cc.code, 0, cc.out + cc.err);
    for (const f of ['.claude.json', path.join('.claude', 'settings.json'), path.join('.claude', 'CLAUDE.md')]) assert.ok(cc.out.includes(`In ${path.join(sb.home, f)}, `), `${f}:\n${cc.out}`);
    assert.match(cc.out, /"UserPromptSubmit"/);
  } finally { sb.stop(); }
});
