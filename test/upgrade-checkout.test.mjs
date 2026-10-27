// memev upgrade prints whatever checkout URL the vault config holds.
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers/cli.mjs';
import { cleanup, PKG } from './helpers/tmp.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { command } from '../src/cli/upgrade.mjs';

after(() => cleanup());

function setUrl(root, url) {
  const file = path.join(root, '.memev', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.checkout = { url };
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

test('MEM-064 AC03: memev upgrade prints the checkout URL taken from config, not hardcoded', async () => {
  const sb = sandbox();
  initVault(sb.root, { template: path.join(PKG, 'templates', 'vault') });
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    setUrl(sb.root, 'https://pay.example/one');
    assert.equal(await command('upgrade', [], {}, { root: sb.root, env: sb.env }), 0);
    assert.equal(lines.join('\n'), 'https://pay.example/one');
    lines.length = 0;
    setUrl(sb.root, 'https://pay.example/two');
    assert.equal(await command('upgrade', [], {}, { root: sb.root, env: sb.env }), 0);
    assert.equal(lines.join('\n'), 'https://pay.example/two');
  } finally {
    console.log = orig;
  }
  const src = fs.readFileSync(path.join(PKG, 'src', 'cli', 'upgrade.mjs'), 'utf8');
  assert.equal(src.includes('https://pay.example/one'), false);
  assert.equal(src.includes('https://pay.example/two'), false);
});
