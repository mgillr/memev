import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, disconnect } from '../src/cli/clients.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

function fixtureHome({ withSettings = true } = {}) {
  const home = tmpdir('home-');
  const w = (rel, body) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
  const files = {
    claudeJson: w('.claude.json', JSON.stringify({ numStartups: 42, mcpServers: { other: { command: 'other-server', args: ['--x'] } } }, null, 4)),
    claudeMd: w('.claude/CLAUDE.md', '# My rules\n\nAlways use tabs.\n'),
  };
  if (withSettings) files.claudeSettings = w('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }, null, 2));
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  return { home, env, files };
}
const settingsPath = (env) => path.join(env.HOME, '.claude', 'settings.json');

test('MEM-051 AC01: connect claude-code --allow-tools adds mcp__memev; disconnect removes it', () => {
  const { env } = fixtureHome({ withSettings: false }); // no settings.json yet, as on a fresh install
  const launcher = '/x/memev';
  connect('claude-code', { env, launcher, allowTools: true });
  const after = fs.readFileSync(settingsPath(env), 'utf8');
  assert.match(after, /mcp__memev/, 'mcp__memev is written into settings.json');
  assert.ok(JSON.parse(after).permissions.allow.includes('mcp__memev'), 'mcp__memev is in permissions.allow after a consented connect');
  disconnect('claude-code', { env });
  assert.equal(fs.existsSync(settingsPath(env)), false, 'the file Memev created is gone, so mcp__memev is gone, on disconnect');
});

test('MEM-051 AC02: without consent, permissions.allow is not changed', () => {
  const { env, files } = fixtureHome({ withSettings: true });
  const launcher = '/x/memev';
  connect('claude-code', { env, launcher }); // no allowTools: no consent
  const cs = JSON.parse(fs.readFileSync(files.claudeSettings, 'utf8'));
  assert.deepEqual(cs.permissions.allow, ['Bash(ls:*)'], 'without consent permissions.allow is exactly as it was');
  assert.equal(cs.permissions.allow.includes('mcp__memev'), false, 'no mcp__memev is added without consent');
});

test('a consented connect keeps the user\'s own allow entries, and a later user edit is kept on disconnect', () => {
  const { env, files } = fixtureHome({ withSettings: true });
  const launcher = '/x/memev';
  connect('claude-code', { env, launcher, allowTools: true });
  let cs = JSON.parse(fs.readFileSync(files.claudeSettings, 'utf8'));
  assert.ok(cs.permissions.allow.includes('Bash(ls:*)'), 'the user entry stays next to mcp__memev');
  assert.ok(cs.permissions.allow.includes('mcp__memev'));
  // the user edits the file after connect, so disconnect cannot restore the backup
  cs.model = 'opus';
  fs.writeFileSync(files.claudeSettings, JSON.stringify(cs, null, 2));
  disconnect('claude-code', { env });
  const after = JSON.parse(fs.readFileSync(files.claudeSettings, 'utf8'));
  assert.equal(after.model, 'opus', 'the user edit made after connect stays');
  assert.deepEqual(after.permissions.allow, ['Bash(ls:*)'], 'only the Memev tool entry is removed, the user entry stays');
});
