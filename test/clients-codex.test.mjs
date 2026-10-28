// Codex config.toml: Memev must never write a second [mcp_servers.memev] table. When the user already
// has one, connect leaves it exactly as-is (and says so), and disconnect never touches it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, disconnect } from '../src/cli/clients.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
after(cleanup);

const tables = (t) => (t.match(/^\[mcp_servers\.memev\]/gm) || []).length;

test('MEM-049 AC01: init leaves exactly one [mcp_servers.memev] table when the user already has one', () => {
  const sb = sandbox();
  const toml = path.join(sb.home, '.codex', 'config.toml');
  const original = '[mcp_servers.memev]\ncommand = "x"\n';
  try {
    fs.mkdirSync(path.dirname(toml), { recursive: true });
    fs.writeFileSync(toml, original);
    const r = sb.run(['init', '--port', String(sb.port)]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(fs.existsSync(path.join(sb.home, '.codex', 'hooks.json')), 'codex was connected, so the toml edit ran');
    const after = fs.readFileSync(toml, 'utf8');
    assert.equal(tables(after), 1, 'exactly one [mcp_servers.memev] table remains');
    assert.equal(after, original, 'the user table is left byte for byte');
  } finally { sb.stop(); }
});

test('MEM-049 AC02: disconnect leaves a user-added [mcp_servers.memev] table untouched', () => {
  const home = tmpdir('home-');
  const toml = path.join(home, '.codex', 'config.toml');
  const original = 'model = "m"\n\n[mcp_servers.memev]\ncommand = "x"\n';
  fs.mkdirSync(path.dirname(toml), { recursive: true });
  fs.writeFileSync(toml, original);
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  const launcher = '/opt/memev/bin/memev';
  connect('codex', { env, launcher });
  assert.equal(fs.readFileSync(toml, 'utf8'), original, 'connect left the user table as-is');
  disconnect('codex', { env });
  const after = fs.readFileSync(toml, 'utf8');
  assert.equal(after, original, 'disconnect left the user table untouched');
  assert.equal(tables(after), 1, 'still exactly one [mcp_servers.memev] table');
});
