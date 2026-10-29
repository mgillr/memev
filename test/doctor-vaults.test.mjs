// doctor names both vault ids when a second Memev is running on this computer.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
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

// Tests run side by side, and doctor looks for another vault on the 99 ports above its own, where another test's daemon
// would read as a second vault. The test holds those ports with listeners of its own, which never answer as Memev.
async function holdPortsAbove(port) {
  const held = [];
  const release = () => Promise.all(held.map((s) => new Promise((r) => s.close(r))));
  for (let p = port + 1; p < Math.min(port + 100, 65536); p++) {
    const s = net.createServer((c) => c.destroy());
    if (!(await new Promise((r) => { s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => r(true)); }))) { await release(); return null; }
    held.push(s);
  }
  return release;
}

test('MEM-021 AC02: doctor shows no such warning with a single vault', async () => {
  let sb, release = null;
  for (let i = 0; i < 5 && !release; i++) { sb = sandbox(); release = await holdPortsAbove(sb.port); }
  assert.ok(release, 'the 99 ports above the vault are held for this test');
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--no-connect']).code, 0);
    const doc = sb.run(['doctor']);
    assert.equal(doc.code, 0, doc.out);
    assert.equal(/two vaults on this computer/.test(doc.out), false, doc.out);
  } finally { sb.stop(); await release(); }
});

test('MEM-021: doctor warns with the join fix when the configured backup remote belongs to a different vault', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--no-connect']).code, 0);
    const mine = idsOf(sb.root);
    // a backup whose signed address record names another vault id, pointed at as this vault's backup remote
    const otherBackup = path.join(sb.home, 'other-backup');
    fs.mkdirSync(otherBackup, { recursive: true });
    fs.writeFileSync(path.join(otherBackup, 'address.json'), JSON.stringify({ v: 1, url: 'https://example.invalid/backup', vault_id: 'other-vault-0000', at: '2026-01-01T00:00:00Z', pubkey: 'x' }));
    execFileSync('git', ['remote', 'add', 'origin', otherBackup], { cwd: sb.root, encoding: 'utf8' });
    const doc = sb.run(['doctor']);
    assert.match(doc.out, /backup belongs to a different vault/, doc.out);
    assert.match(doc.out, new RegExp(mine));
    assert.match(doc.out, /other-vault-0000/);
    assert.match(doc.out, /memev init --join/);
  } finally {
    sb.stop();
  }
});
