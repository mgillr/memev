// Grok Build ~/.grok/config.toml: Memev adds one stdio [mcp_servers.memev] table (command, args), never a second
// one, and disconnect takes out only its own table.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, disconnect, detect, clientDefs } from '../src/cli/clients.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

const tables = (t) => (t.match(/^\[mcp_servers\.memev\]/gm) || []).length;
const setup = (original) => {
  const home = tmpdir('home-');
  const toml = path.join(home, '.grok', 'config.toml');
  fs.mkdirSync(path.dirname(toml), { recursive: true });
  if (original !== undefined) fs.writeFileSync(toml, original);
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  return { home, toml, env };
};
const launcher = '/x/memev';

test('grok-build: found by ~/.grok, connect writes one stdio table and keeps the user tables', () => {
  const user = 'model = "grok-x"\n\n[mcp_servers.filesystem]\ncommand = "npx"\nargs = ["-y", "fs"]\n';
  const { toml, env } = setup(user);
  assert.equal(detect(env).find((c) => c.id === 'grok-build').found, true);
  connect('grok-build', { env, launcher });
  const t = fs.readFileSync(toml, 'utf8');
  assert.equal(tables(t), 1);
  assert.ok(t.startsWith(user), 'the user tables stay first and unchanged');
  assert.match(t, /\[mcp_servers\.memev\]\ncommand = "\/x\/memev"\nargs = \["mcp", "--client", "grok-build"\]\n/);
  assert.equal(detect(env).find((c) => c.id === 'grok-build').connected, true);
});

test('grok-build: a second connect leaves exactly one table', () => {
  const { toml, env } = setup('[mcp_servers.other]\ncommand = "o"\n');
  connect('grok-build', { env, launcher });
  const once = fs.readFileSync(toml, 'utf8');
  connect('grok-build', { env, launcher });
  const twice = fs.readFileSync(toml, 'utf8');
  assert.equal(tables(twice), 1);
  assert.equal(twice, once, 'the second connect changes nothing');
});

test('grok-build: disconnect removes the memev table and keeps tables the user added after connect', () => {
  const { toml, env } = setup('[mcp_servers.other]\ncommand = "o"\n');
  connect('grok-build', { env, launcher });
  fs.appendFileSync(toml, '\n[mcp_servers.later]\ncommand = "l"\n'); // edited after connect: no byte restore
  disconnect('grok-build', { env });
  const t = fs.readFileSync(toml, 'utf8');
  assert.equal(tables(t), 0);
  assert.match(t, /\[mcp_servers\.other\]\ncommand = "o"/);
  assert.match(t, /\[mcp_servers\.later\]\ncommand = "l"/);
  assert.doesNotMatch(t, /memev/);
});

test('grok-build: a user-owned [mcp_servers.memev] table is left byte for byte by connect and disconnect', () => {
  const original = '[mcp_servers.memev]\ncommand = "mine"\n';
  const { toml, env } = setup(original);
  connect('grok-build', { env, launcher });
  assert.equal(fs.readFileSync(toml, 'utf8'), original);
  disconnect('grok-build', { env });
  assert.equal(fs.readFileSync(toml, 'utf8'), original);
});

test('grok-build: with platform win32 the table runs node.exe with the runtime script first, as for Codex', () => {
  const { env } = setup();
  const defs = clientDefs(env, path.join(env.MEMEV_CONFIG_DIR, 'bin', 'memev.cmd'), 'win32');
  const body = (id) => defs.find((d) => d.id === id).edits()[0].apply('');
  const t = body('grok-build');
  const cmd = /^command = "([^"]*)"$/m.exec(t)[1];
  const args = JSON.parse(/^args = (\[.*\])$/m.exec(t)[1]);
  assert.ok(cmd.endsWith('node.exe'), cmd);
  assert.ok(args[0].endsWith('memev.mjs'), args[0]);
  assert.deepEqual(args.slice(1), ['mcp', '--client', 'grok-build']);
  assert.doesNotMatch(t, /\.(cmd|bat)\b/);
  assert.equal(t, body('codex').replace('"codex"', '"grok-build"'), 'the same launcher form as Codex');
});
