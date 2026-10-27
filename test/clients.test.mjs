import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, connectAll, disconnect, detect } from '../src/cli/clients.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

function fixtureHome() {
  const home = tmpdir('home-');
  const w = (rel, body) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
  const files = {
    claudeJson: w('.claude.json', JSON.stringify({ numStartups: 42, theme: 'dark', mcpServers: { other: { command: 'other-server', args: ['--x'] } }, projects: { '/w': { allowedTools: ['Bash'] } } }, null, 4)),
    claudeSettings: w('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }], Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }] } })),
    claudeMd: w('.claude/CLAUDE.md', '# My rules\n\nAlways use tabs.\n'),
    codexToml: w('.codex/config.toml', 'model = "some-model"\n\n[mcp_servers.other]\ncommand = "other"\n'),
    cursorMcp: w('.cursor/mcp.json', '{"mcpServers":{"gh":{"url":"https://example.com/mcp"}}}'),
    gemini: w('.gemini/settings.json', '{"theme":"Default"}'),
  };
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  return { home, env, files };
}
const snap = (files) => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));

test('connect merges into existing configs, keeps every other key, and is idempotent', () => {
  const { home, env, files } = fixtureHome();
  const launcher = '/opt/memev/bin/memev';
  const res = connectAll({ env, launcher });
  assert.deepEqual(res.map((r) => `${r.id}:${r.status}`).sort(), ['claude-code:added', 'codex:added', 'cursor:added', 'gemini-cli:added']);
  const cj = JSON.parse(fs.readFileSync(files.claudeJson, 'utf8'));
  assert.equal(cj.numStartups, 42); assert.ok(cj.mcpServers.other); assert.deepEqual(cj.mcpServers.memev.args, ['mcp', '--client', 'claude-code']);
  const cs = JSON.parse(fs.readFileSync(files.claudeSettings, 'utf8'));
  assert.deepEqual(cs.permissions, { allow: ['Bash(ls:*)'] });
  assert.equal(cs.hooks.PreToolUse[0].hooks[0].command, 'guard.sh');
  assert.equal(cs.hooks.Stop.length, 2, 'the user Stop hook stays next to ours');
  assert.match(cs.hooks.SessionStart[0].matcher, /compact/);
  for (const ev of ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'Stop']) assert.ok(cs.hooks[ev].some((g) => g.hooks.some((h) => / hook /.test(h.command))), ev);
  assert.match(fs.readFileSync(files.claudeMd, 'utf8'), /^# My rules\n\nAlways use tabs\.\n\n<!-- memev:start -->/);
  assert.match(fs.readFileSync(files.codexToml, 'utf8'), /\[mcp_servers\.other\][\s\S]*\[mcp_servers\.memev\]/);
  assert.ok(fs.existsSync(path.join(home, '.codex', 'hooks.json')));
  assert.ok(JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8')).hooks.sessionStart);
  const before = snap(files);
  const again = connectAll({ env, launcher });
  assert.ok(again.every((r) => r.status === 'already'));
  assert.deepEqual(snap(files), before, 'a second connect changes nothing');
});

test('disconnect restores every file byte for byte and removes files Memev created', () => {
  const { home, env, files } = fixtureHome();
  const original = snap(files);
  connectAll({ env, launcher: '/opt/memev/bin/memev' });
  for (const c of detect(env).filter((x) => x.connected)) disconnect(c.id, { env });
  assert.deepEqual(snap(files), original);
  for (const created of ['.codex/hooks.json', '.cursor/hooks.json', '.codex/AGENTS.md', '.gemini/GEMINI.md']) assert.equal(fs.existsSync(path.join(home, created)), false, created);
});

test('when the user edited a file after connect, disconnect removes only Memev entries', () => {
  const { env, files } = fixtureHome();
  connect('claude-code', { env, launcher: '/opt/memev/bin/memev' });
  const cs = JSON.parse(fs.readFileSync(files.claudeSettings, 'utf8')); cs.model = 'opus'; fs.writeFileSync(files.claudeSettings, JSON.stringify(cs));
  fs.appendFileSync(files.claudeMd, '\nNew rule added later.\n');
  disconnect('claude-code', { env });
  const after = JSON.parse(fs.readFileSync(files.claudeSettings, 'utf8'));
  assert.equal(after.model, 'opus');
  assert.equal(JSON.stringify(after).includes(' hook '), false);
  assert.equal(after.hooks.Stop[0].hooks[0].command, 'notify.sh');
  const md = fs.readFileSync(files.claudeMd, 'utf8');
  assert.ok(md.includes('New rule added later.')); assert.ok(!md.includes('memev:start'));
});

test('a config with comments is never rewritten; it is reported for a manual step', () => {
  const { env, files } = fixtureHome();
  fs.writeFileSync(files.cursorMcp, '// my servers\n{"mcpServers":{}}\n');
  const before = fs.readFileSync(files.cursorMcp);
  const r = connect('cursor', { env, launcher: '/x/memev' });
  assert.equal(r.status, 'needs-manual');
  assert.deepEqual(fs.readFileSync(files.cursorMcp), before);
});

test('re-detection connects a newly installed app but not one the user disconnected', () => {
  const { home, env } = fixtureHome();
  connectAll({ env, launcher: '/x/memev' });
  disconnect('cursor', { env });
  fs.mkdirSync(path.join(home, '.codeium', 'windsurf'), { recursive: true });
  const r = connectAll({ env, launcher: '/x/memev' });
  assert.deepEqual(r.filter((x) => x.status === 'added').map((x) => x.id), ['windsurf']);
  assert.equal(detect(env).find((c) => c.id === 'cursor').connected, false);
});
