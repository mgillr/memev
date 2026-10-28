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
  const agentsMd = w('.config/opencode/AGENTS.md', '# My rules\n\nAlways use tabs.\n');
  const original = { opencodeJson: fs.readFileSync(opencodeJson), agentsMd: fs.readFileSync(agentsMd) };
  const res = connectAll({ env, launcher: '/x/memev', platform: 'linux' });
  const r = res.find((x) => x.id === 'opencode');
  assert.equal(r.status, 'added');
  assert.equal(detect(env).find((c) => c.id === 'opencode').connected, true);
  const cfg = JSON.parse(fs.readFileSync(opencodeJson, 'utf8'));
  assert.equal(cfg.theme, 'dark');
  assert.ok(cfg.mcp.other, 'the user server stays');
  assert.deepEqual(cfg.mcp.memev, { type: 'local', command: '/x/memev', args: ['mcp', '--client', 'opencode'], enabled: true });
  assert.match(fs.readFileSync(agentsMd, 'utf8'), /^# My rules\n\nAlways use tabs\.\n\n<!-- memev:start -->/);
  const d = disconnect('opencode', { env });
  assert.deepEqual(d.results.map((x) => x.action), ['restored', 'restored']);
  assert.deepEqual(fs.readFileSync(opencodeJson), original.opencodeJson, 'opencode.json is back to its original bytes');
  assert.deepEqual(fs.readFileSync(agentsMd), original.agentsMd, 'AGENTS.md is back to its original bytes');
});

test('MEM-044 AC02: with a fake Copilot CLI config dir, init connects Copilot CLI and disconnect restores its files', () => {
  const { env, w } = fixtureHome();
  const mcpJson = w('.copilot/mcp.json', JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', args: ['start'] } } }, null, 2));
  const agentsMd = w('.copilot/AGENTS.md', '# Copilot rules\n\nBe brief.\n');
  const original = { mcpJson: fs.readFileSync(mcpJson), agentsMd: fs.readFileSync(agentsMd) };
  const res = connectAll({ env, launcher: '/x/memev', platform: 'linux' });
  const r = res.find((x) => x.id === 'copilot-cli');
  assert.equal(r.status, 'added');
  assert.equal(detect(env).find((c) => c.id === 'copilot-cli').connected, true);
  const cfg = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
  assert.ok(cfg.mcpServers.gh, 'the user server stays');
  assert.deepEqual(cfg.mcpServers.memev, { command: '/x/memev', args: ['mcp', '--client', 'copilot-cli'] });
  assert.match(fs.readFileSync(agentsMd, 'utf8'), /^# Copilot rules\n\nBe brief\.\n\n<!-- memev:start -->/);
  const d = disconnect('copilot-cli', { env });
  assert.deepEqual(d.results.map((x) => x.action), ['restored', 'restored']);
  assert.deepEqual(fs.readFileSync(mcpJson), original.mcpJson, 'mcp.json is back to its original bytes');
  assert.deepEqual(fs.readFileSync(agentsMd), original.agentsMd, 'AGENTS.md is back to its original bytes');
});
