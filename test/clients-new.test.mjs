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

const restoresAll = (d) => d.results.every((x) => x.action === 'restored' || x.action === 'removed');
for (const [id, name, cfg, key, entryExtra, rules] of [
  ['kiro', 'Kiro', '.kiro/settings/mcp.json', 'mcpServers', {}, '.kiro/steering/memev.md'],
  ['cline', 'Cline', '.cline/data/settings/cline_mcp_settings.json', 'mcpServers', { disabled: false }, 'Documents/Cline/Rules/memev.md'],
  ['amp', 'Amp', '.config/amp/settings.json', 'amp.mcpServers', {}, '.config/amp/AGENTS.md'],
  ['junie', 'Junie', '.junie/mcp/mcp.json', 'mcpServers', {}, '.junie/AGENTS.md'],
]) {
  test(`SR-2.09.2 T2: with a fake ${name} config, init connects ${name} under its own client id and disconnect restores it`, () => {
    const { home, env, w } = fixtureHome();
    const file = w(cfg, JSON.stringify({ keep: 'me', [key]: { other: { command: 'other', args: [] } } }, null, 2));
    const original = fs.readFileSync(file);
    const r = connectAll({ env, launcher: '/x/memev', platform: 'linux' }).find((x) => x.id === id);
    assert.equal(r && r.status, 'added', `${id} connects`);
    assert.equal(r.name, name);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(j.keep, 'me');
    assert.ok(j[key].other, 'the user server stays');
    assert.deepEqual(j[key].memev, { command: '/x/memev', args: ['mcp', '--client', id], ...entryExtra });
    assert.match(fs.readFileSync(path.join(home, rules), 'utf8'), /<!-- memev:start -->/);
    const d = disconnect(id, { env });
    assert.ok(restoresAll(d), JSON.stringify(d.results));
    assert.deepEqual(fs.readFileSync(file), original, `${cfg} is back to its original bytes`);
    assert.equal(fs.existsSync(path.join(home, rules)), false, 'the rules file Memev made is gone');
  });
}

test('SR-2.09.2 T2: Amp uses settings.jsonc when that is the file that exists, and keeps its comments', () => {
  const { env, w } = fixtureHome();
  const file = w('.config/amp/settings.jsonc', '{\n  // my theme\n  "amp.theme": "dark"\n}\n');
  const r = connectAll({ env, launcher: '/x/memev', platform: 'linux' }).find((x) => x.id === 'amp');
  assert.equal(r.status, 'added');
  const t = fs.readFileSync(file, 'utf8');
  assert.match(t, /\/\/ my theme/);
  assert.match(t, /"amp\.mcpServers"/);
});

test('SR-2.09.2 T2: Cline follows CLINE_DATA_DIR, as Cline itself does', () => {
  const { home, env, w } = fixtureHome();
  w('.cline/keep.txt', 'x');
  const dataDir = path.join(home, 'elsewhere', 'cline-data');
  const r = connectAll({ env: { ...env, CLINE_DATA_DIR: dataDir }, launcher: '/x/memev', platform: 'linux' }).find((x) => x.id === 'cline');
  assert.equal(r.status, 'added');
  const j = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings', 'cline_mcp_settings.json'), 'utf8'));
  assert.deepEqual(j.mcpServers.memev.args, ['mcp', '--client', 'cline']);
  assert.equal(fs.existsSync(path.join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json')), false);
});

test('SR-2.09.2 T2: Goose gets a memev extension under its extensions map, with its own keys, and disconnect restores config.yaml', () => {
  const { home, env, w } = fixtureHome();
  const file = w('.config/goose/config.yaml', 'GOOSE_PROVIDER: openai\nextensions:\n  developer:\n    bundled: true\n    enabled: true\n    name: developer\n    type: builtin\n# my note\nslash_commands: []\n');
  const original = fs.readFileSync(file);
  const r = connectAll({ env, launcher: '/x/memev', platform: 'linux' }).find((x) => x.id === 'goose');
  assert.equal(r && r.status, 'added');
  const t = fs.readFileSync(file, 'utf8');
  assert.match(t, /^extensions:\n  # memev:start\n  memev:\n    type: stdio\n    name: memev\n    enabled: true\n    cmd: "\/x\/memev"\n    args: \["mcp", "--client", "goose"\]\n    envs: \{\}\n    env_keys: \[\]\n    timeout: 300\n  # memev:end\n  developer:/m);
  assert.match(t, /# my note\nslash_commands: \[\]/);
  assert.match(fs.readFileSync(path.join(home, '.config', 'goose', '.goosehints'), 'utf8'), /<!-- memev:start -->/);
  disconnect('goose', { env });
  assert.deepEqual(fs.readFileSync(file), original, 'config.yaml is back to its original bytes');
});

test('SR-2.09.2 T2: Goose with no extensions key gets the key inside the markers, and loses it again on disconnect', () => {
  const { env, w } = fixtureHome();
  const file = w('.config/goose/config.yaml', 'GOOSE_PROVIDER: openai\n');
  const original = fs.readFileSync(file);
  connectAll({ env, launcher: '/x/memev', platform: 'linux' });
  assert.match(fs.readFileSync(file, 'utf8'), /# memev:start\nextensions:\n  memev:\n/);
  disconnect('goose', { env });
  assert.deepEqual(fs.readFileSync(file), original);
});

test('SR-2.09.2 T2: Continue gets a memev item in its mcpServers list at the list\'s own indent, and disconnect restores config.yaml', () => {
  const { env, w } = fixtureHome();
  const file = w('.continue/config.yaml', 'name: Local\nversion: 1.0.0\nschema: v1\nmcpServers:\n- name: sqlite\n  type: stdio\n  command: npx\n');
  const original = fs.readFileSync(file);
  const r = connectAll({ env, launcher: '/x/memev', platform: 'linux' }).find((x) => x.id === 'continue');
  assert.equal(r && r.status, 'added');
  assert.match(fs.readFileSync(file, 'utf8'), /^mcpServers:\n# memev:start\n- name: memev\n  type: stdio\n  command: "\/x\/memev"\n  args: \["mcp", "--client", "continue"\]\n# memev:end\n- name: sqlite/m);
  disconnect('continue', { env });
  assert.deepEqual(fs.readFileSync(file), original);
});

test('SR-2.09.2 T2: Continue with mcpServers written inline as [] is left as it is, with a note', () => {
  const { env, w } = fixtureHome();
  const file = w('.continue/config.yaml', 'name: Local\nversion: 1.0.0\nschema: v1\nmcpServers: []\n');
  const original = fs.readFileSync(file);
  const r = connectAll({ env, launcher: '/x/memev', platform: 'linux' }).find((x) => x.id === 'continue');
  assert.deepEqual(fs.readFileSync(file), original);
  assert.match(JSON.stringify(r), /written inline/);
});
