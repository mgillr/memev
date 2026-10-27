// doctor names both vault ids when a second Memev is running on this computer.
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

after(() => cleanup());

function idsOf(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.memev', 'config.json'), 'utf8')).vault_id;
}

test('MEM-021 AC01: doctor shows a warning naming both vault ids when a second local vault is running', () => {
  const sb = sandbox({ ports: 2 });
  const other = path.join(sb.home, 'other-vault');
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--no-connect']).code, 0);
    assert.equal(sb.run(['init', '--root', other, '--port', String(sb.port + 1), '--no-connect']).code, 0);
    const mine = idsOf(sb.root);
    const theirs = idsOf(other);
    const doc = sb.run(['doctor']);
    assert.match(doc.out, /two vaults on this computer/, doc.out);
    assert.match(doc.out, new RegExp(mine));
    assert.match(doc.out, new RegExp(theirs));
  } finally {
    sb.run(['stop', '--root', other]);
    sb.stop();
  }
});

test('MEM-021 AC02: doctor shows no such warning with a single vault', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--no-connect']).code, 0);
    const doc = sb.run(['doctor']);
    assert.equal(doc.code, 0, doc.out);
    assert.equal(/two vaults on this computer/.test(doc.out), false, doc.out);
  } finally { sb.stop(); }
});
