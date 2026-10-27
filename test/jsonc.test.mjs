// Settings files with comments (JSONC) are edited in place: Memev's entry goes in and comes out again, and every
// comment, blank line and the layout of the rest of the file stay as they were.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { connect, disconnect, platformDirs } from '../src/cli/clients.mjs';
import { changeJsonc, parseJsonc } from '../src/engine/jsonc.mjs';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';

after(cleanup);
const LAUNCHER = '/opt/memev/bin/memev';
const comments = (text) => text.split('\n').filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l) || /\/\/ /.test(l));
function sandbox() {
  const home = tmpdir('jsonc-home-');
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  return { home, env, write: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; } };
}
const zedFile = (home, env) => path.join(process.platform === 'darwin' ? path.join(home, '.config') : platformDirs(env).appData, 'zed', 'settings.json');
// what Zed writes for a new user: a comment header, then a few settings, one of them with a trailing comment
const ZED = `// Zed settings
//
// For information on how to configure Zed, see the Zed
// documentation: https://zed.dev/docs/configuring-zed
{
  "ui_font_size": 16, // a bit larger
  /* the editor font */
  "buffer_font_size": 15,
  "context_servers": {
    // a server I already use
    "other": { "source": "custom", "command": "other-server" },
  },
}
`;

test('MEM-042 AC01: Connecting Zed to a settings.json that starts with comments succeeds and every original comment line is still present', () => {
  const { home, env, write } = sandbox();
  const f = write(zedFile(home, env), ZED);
  const r = connect('zed', { env, launcher: LAUNCHER });
  assert.equal(r.status, 'added', JSON.stringify(r));
  const text = fs.readFileSync(f, 'utf8');
  for (const line of comments(ZED)) assert.ok(text.includes(line), `still there: ${line}`);
  const j = parseJsonc(text);
  assert.deepEqual(j.context_servers.memev, { source: 'custom', command: LAUNCHER, args: ['mcp', '--client', 'zed'] });
  assert.deepEqual(j.context_servers.other, { source: 'custom', command: 'other-server' }, 'the other server is kept');
  assert.equal(j.ui_font_size, 16);
  // only Memev's lines are new: every original line is still there, in order
  const kept = ZED.split('\n'); let at = 0;
  for (const line of text.split('\n')) if (line === kept[at]) at++;
  assert.equal(at, kept.length, 'the original lines are all present, in their order');
  assert.equal(connect('zed', { env, launcher: LAUNCHER }).status, 'already', 'a second connect changes nothing');
});

test('MEM-042 AC02: Disconnect restores the original bytes when the file was not edited since', () => {
  const { home, env, write } = sandbox();
  const f = write(zedFile(home, env), ZED);
  const before = fs.readFileSync(f);
  assert.equal(connect('zed', { env, launcher: LAUNCHER }).status, 'added');
  assert.notDeepEqual(fs.readFileSync(f), before);
  assert.deepEqual(disconnect('zed', { env }).results.map((x) => x.action), ['restored']);
  assert.deepEqual(fs.readFileSync(f), before, 'byte for byte');
  // edited since: Memev takes only its own entry out, and the person's edit and every comment stay
  connect('zed', { env, launcher: LAUNCHER });
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"buffer_font_size": 15', '"buffer_font_size": 17'));
  disconnect('zed', { env });
  const left = fs.readFileSync(f, 'utf8');
  assert.equal(left, ZED.replace('"buffer_font_size": 15', '"buffer_font_size": 17'), 'exactly the edited file, without Memev');
});

test('MEM-042 AC03: The same works for Gemini CLI and VS Code settings with comments', () => {
  const { home, env, write } = sandbox();
  const gemini = write(path.join(home, '.gemini', 'settings.json'), `{
  // my Gemini settings
  "theme": "Default",
  "hooks": {
    "SessionStart": [
      // a hook of my own
      { "matcher": "*", "hooks": [{ "type": "command", "command": "echo hello" }] }
    ]
  }
}
`);
  const vscode = write(path.join(platformDirs(env).appData, 'Code', 'User', 'mcp.json'), `{
\t// servers for VS Code
\t"servers": {
\t\t"github": { "type": "http", "url": "https://example.com/mcp" }, // the GitHub one
\t},
}
`);
  const before = { gemini: fs.readFileSync(gemini, 'utf8'), vscode: fs.readFileSync(vscode, 'utf8') };
  for (const id of ['gemini-cli', 'vscode']) assert.equal(connect(id, { env, launcher: LAUNCHER }).status, 'added', id);
  const g = fs.readFileSync(gemini, 'utf8'); const v = fs.readFileSync(vscode, 'utf8');
  for (const line of comments(before.gemini)) assert.ok(g.includes(line), line);
  for (const line of comments(before.vscode)) assert.ok(v.includes(line), line);
  const gj = parseJsonc(g); const vj = parseJsonc(v);
  assert.equal(gj.hooks.SessionStart[0].hooks[0].command, 'echo hello', 'the own hook stays first');
  assert.ok(gj.hooks.SessionStart.some((x) => x.hooks.some((h) => / hook session-start --client gemini-cli/.test(h.command))));
  assert.deepEqual(gj.mcpServers.memev.args, ['mcp', '--client', 'gemini-cli']);
  assert.deepEqual(vj.servers.github, { type: 'http', url: 'https://example.com/mcp' });
  assert.deepEqual(vj.servers.memev.args, ['mcp', '--client', 'vscode']);
  assert.match(v, /\n\t\t"memev": \{\n\t\t\t"type": "stdio"/, 'inserted with the file\'s own tabs');
  // edited since connect, so disconnect removes only Memev's entries: what is left is the original text
  fs.appendFileSync(gemini, '\n'); fs.appendFileSync(vscode, '\n');
  for (const id of ['gemini-cli', 'vscode']) disconnect(id, { env });
  assert.equal(fs.readFileSync(gemini, 'utf8'), `${before.gemini}\n`);
  assert.equal(fs.readFileSync(vscode, 'utf8'), `${before.vscode}\n`);
});

test('a file that is not valid even with comments is never rewritten and is reported for a manual step', () => {
  const { home, env, write } = sandbox();
  const f = write(zedFile(home, env), '// half written\n{ "ui_font_size": 16, \n');
  const before = fs.readFileSync(f);
  const r = connect('zed', { env, launcher: LAUNCHER });
  assert.equal(r.status, 'needs-manual'); assert.match(r.reason, /not valid JSON with comments/);
  assert.deepEqual(fs.readFileSync(f), before);
  assert.throws(() => changeJsonc('// a list\n[1, 2]\n', (j) => j), /not a JSON object/);
});

test('the vendored JSONC parser is jsonc-parser 3.3.1 as published, with only the recorded changes', () => {
  const dir = path.join(PKG, 'vendor', 'jsonc');
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  const pins = [...readme.matchAll(/^([0-9a-f]{64})  (\S+\.js)$/gm)];
  assert.equal(pins.length, 6, 'a checksum for each vendored file');
  for (const [, sum, file] of pins) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    assert.match(lines[0], /^\/\/ Vendored from jsonc-parser 3\.3\.1/, `${file} says it was changed`);
    // undo the two recorded changes: the first line, and the .js on relative imports
    const upstream = lines.slice(1).join('\n').replace(/from '(\.\/[^']+)\.js'/g, "from '$1'");
    assert.equal(crypto.createHash('sha256').update(upstream).digest('hex'), sum, `${file} matches the published file`);
  }
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE.md'), 'utf8'), /The MIT License/);
});
