import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { command } from '../src/cli/clients.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

// A home where VS Code is found and connectable, and Zed is found but its settings.json cannot be parsed.
function fixture() {
  const home = tmpdir('home-');
  const xdg = path.join(home, '.config');
  const cfg = path.join(xdg, 'memev');
  const w = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
  w(path.join(xdg, 'Code', 'User', 'mcp.json'), '{}');
  w(path.join(xdg, 'zed', 'settings.json'), 'this is not json');
  const launcher = path.join(cfg, 'bin', 'memev');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(launcher, '#!/bin/sh\n');
  return { env: { HOME: home, XDG_CONFIG_HOME: xdg, MEMEV_CONFIG_DIR: cfg } };
}

test('MEM-091 AC01: memev connect zed with an unparsable settings.json exits 1', async () => {
  const { env } = fixture();
  const code = await command('connect', ['zed'], {}, { env });
  assert.equal(code, 1);
});

test('MEM-091 AC02: memev connect all still exits 0 when one app needs manual steps and others connected', async () => {
  const { env } = fixture();
  const code = await command('connect', [], {}, { env });
  assert.equal(code, 0);
});
