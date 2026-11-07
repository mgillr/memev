import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connectAll, disconnect, detect } from '../src/cli/clients.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

function fixtureHome() {
  const home = tmpdir('home-');
  const w = (rel, body) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  return { home, env, w };
}

test('MEM-044 AC01: with a fake ~/.config/opencode, init connects OpenCode and disconnect restores its files', () => {
  const { env, w } = fixtureHome();
  const opencodeJson = w('.config/opencode/opencode.json', JSON.stringify({ theme: 'dark', mcp: { other: { type: 'local', command: ['other', 'serve'], enabled: true } } }, null, 2));
  const mdFile = w('.config/opencode/AGENTS.md', '# My rules\n\nAlways use tabs.\n');
  const original = { opencodeJson: fs.readFileSync(opencodeJson), mdFile: fs.readFileSync(mdFile) };
  const res = connectAll({ env, launcher: '/x/memev', platform: 'linux' });
  const r = res.find((x) => x.id === 'opencode');
  assert.equal(r.status, 'added');
  assert.equal(detect(env).find((c) => c.id === 'opencode').connected, true);
  const cfg = JSON.parse(fs.readFileSync(opencodeJson, 'utf8'));
  assert.equal(cfg.theme, 'dark');
  assert.ok(cfg.mcp.other, 'the user server stays');
  assert.deepEqual(cfg.mcp.memev, { type: 'local', command: ['/x/memev', 'mcp', '--client', 'opencode'], enabled: true });
  assert.match(fs.readFileSync(mdFile, 'utf8'), /^# My rules\n\nAlways use tabs\.\n\n<!-- memev:start -->/);
  const d = disconnect('opencode', { env });
  assert.deepEqual(d.results.map((x) => x.action), ['restored', 'restored']);
  assert.deepEqual(fs.readFileSync(opencodeJson), original.opencodeJson, 'opencode.json is back to its original bytes');
  assert.deepEqual(fs.readFileSync(mdFile), original.mdFile, 'the rules file is back to its original bytes');
});

test('MEM-044 AC02: with a fake Copilot CLI config dir, init connects Copilot CLI and disconnect restores its files', () => {
  const { env, w } = fixtureHome();
  const mcpJson = w('.copilot/mcp-config.json', JSON.stringify({ mcpServers: { gh: { type: 'local', command: 'gh-mcp', args: ['start'], tools: ['*'] } } }, null, 2));
  const instructions = w('.copilot/copilot-instructions.md', '# Copilot rules\n\nBe brief.\n');
  const original = { mcpJson: fs.readFileSync(mcpJson), instructions: fs.readFileSync(instructions) };
  const res = connectAll({ env, launcher: '/x/memev', platform: 'linux' });
  const r = res.find((x) => x.id === 'copilot-cli');
  assert.equal(r.status, 'added');
  assert.equal(detect(env).find((c) => c.id === 'copilot-cli').connected, true);
  const cfg = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
  assert.ok(cfg.mcpServers.gh, 'the user server stays');
  assert.deepEqual(cfg.mcpServers.memev, { type: 'local', command: '/x/memev', args: ['mcp', '--client', 'copilot-cli'], tools: ['*'] });
  assert.match(fs.readFileSync(instructions, 'utf8'), /^# Copilot rules\n\nBe brief\.\n\n<!-- memev:start -->/);
  const d = disconnect('copilot-cli', { env });
  assert.deepEqual(d.results.map((x) => x.action), ['restored', 'restored']);
  assert.deepEqual(fs.readFileSync(mcpJson), original.mcpJson, 'mcp-config.json is back to its original bytes');
  assert.deepEqual(fs.readFileSync(instructions), original.instructions, 'copilot-instructions.md is back to its original bytes');
});

test('MEM-044 AC02: Copilot CLI honours COPILOT_HOME', () => {
  const { env, w } = fixtureHome();
  const customDir = path.join(env.HOME, 'copilot-custom');
  fs.mkdirSync(customDir, { recursive: true });
  const mcpJson = path.join(customDir, 'mcp-config.json');
  fs.writeFileSync(mcpJson, JSON.stringify({ mcpServers: {} }, null, 2));
  const original = fs.readFileSync(mcpJson);
  const res = connectAll({ env: { ...env, COPILOT_HOME: customDir }, launcher: '/x/memev', platform: 'linux' });
  const r = res.find((x) => x.id === 'copilot-cli');
  assert.equal(r.status, 'added');
  const cfg = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
  assert.deepEqual(cfg.mcpServers.memev, { type: 'local', command: '/x/memev', args: ['mcp', '--client', 'copilot-cli'], tools: ['*'] });
  assert.match(fs.readFileSync(path.join(customDir, 'copilot-instructions.md'), 'utf8'), /<!-- memev:start -->/);
  const d = disconnect('copilot-cli', { env: { ...env, COPILOT_HOME: customDir } });
  assert.deepEqual(d.results.map((x) => x.action), ['restored', 'removed']);
  assert.equal(fs.existsSync(path.join(customDir, 'copilot-instructions.md')), false, 'the created instructions file is removed');
  assert.deepEqual(fs.readFileSync(mcpJson), original, 'mcp-config.json is back to its original bytes');
});

test('MEM-044 AC01: OpenCode skips its rules file when the Claude rules file exists and the OpenCode one is missing', () => {
  const { env, w } = fixtureHome();
  w('.claude/CLAUDE.md', '# Rules\n\nBe safe.\n');
  const opencodeJson = w('.config/opencode/opencode.json', JSON.stringify({ mcp: {} }, null, 2));
  const res = connectAll({ env, launcher: '/x/memev', platform: 'linux' });
  const r = res.find((x) => x.id === 'opencode');
  assert.equal(r.status, 'added');
  const cfg = JSON.parse(fs.readFileSync(opencodeJson, 'utf8'));
  assert.deepEqual(cfg.mcp.memev, { type: 'local', command: ['/x/memev', 'mcp', '--client', 'opencode'], enabled: true });
  assert.equal(fs.existsSync(path.join(env.HOME, '.config', 'opencode', 'AGENTS.md')), false, 'the OpenCode rules file is not created');
  assert.ok(r.notes && r.notes.some((n) => /MCP instructions/.test(n)), 'a line says the protocol arrives through the MCP instructions');
  const d = disconnect('opencode', { env });
  assert.deepEqual(d.results.map((x) => x.action), ['restored']);
});

test('SR-2.09.2 T1: with a fake ~/.grok, init connects Grok Build under its own client id and disconnect restores config.toml', () => {
  const { env, w } = fixtureHome();
  const toml = w('.grok/config.toml', 'model = "grok-4"\n\n[mcp_servers.other]\ncommand = "other"\n');
  const original = fs.readFileSync(toml);
  const res = connectAll({ env, launcher: '/x/memev', platform: 'linux' });
  const r = res.find((x) => x.id === 'grok');
  assert.equal(r.status, 'added');
  assert.equal(r.name, 'Grok Build');
  assert.equal(detect(env).find((c) => c.id === 'grok').connected, true);
  const after1 = fs.readFileSync(toml, 'utf8');
  assert.match(after1, /\[mcp_servers\.other\][\s\S]*\[mcp_servers\.memev\]\ncommand = "\/x\/memev"\nargs = \["mcp", "--client", "grok"\]/);
  assert.equal((after1.match(/\[mcp_servers\.memev\]/g) || []).length, 1, 'one memev table');
  const d = disconnect('grok', { env });
  assert.deepEqual(d.results.map((x) => x.action), ['restored']);
  assert.deepEqual(fs.readFileSync(toml), original, 'config.toml is back to its original bytes');
});

test('SR-2.09.2 T1: a Grok Build config.toml that already has its own memev table is left as it is, and says so', () => {
  const { env, w } = fixtureHome();
  const toml = w('.grok/config.toml', '[mcp_servers.memev]\ncommand = "mine"\n');
  const original = fs.readFileSync(toml);
  const r = connectAll({ env, launcher: '/x/memev', platform: 'linux' }).find((x) => x.id === 'grok');
  assert.deepEqual(fs.readFileSync(toml), original);
  assert.match(JSON.stringify(r), /already has a \[mcp_servers\.memev\] table/);
});
