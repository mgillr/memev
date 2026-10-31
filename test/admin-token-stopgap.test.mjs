// Issue 282: the vault's admin token is not a device, so removing or rotating a device never takes it away, the last live
// admin token is never revoked, and rotating the admin token keeps .memev/admin.json in step. The vault runs without git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { TokenStore } from '../src/engine/tokens.mjs';
after(cleanup);

const adminOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.memev', 'admin.json'), 'utf8'));
const liveAdmins = (v) => v.tokens.list().filter((t) => t.scopes.includes('admin') && !t.revoked);

test('issue 282: a new vault does not list its admin token as a device', () => {
  const { root, v } = newVault({ git: false });
  try {
    const { id } = adminOf(root);
    v.devices.migrate(v.tokens);
    assert.equal(v.devices.list().some((d) => d.token_id === id), false, 'the admin token was registered as a device');
  } finally { v.close(); }
});

test('issue 282: an admin device left by an earlier version can be neither removed nor rotated, and the admin token keeps working', () => {
  const { root, v } = newVault({ git: false });
  try {
    const { id, token } = adminOf(root);
    // what the earlier migrate wrote: the admin token as a local client labelled owner
    const d = v.devices._add({ kind: 'local-client', label: 'owner', tokenId: id, inferred: true }); v.devices.save();
    assert.throws(() => v.devices.remove(v.tokens, d.id), /admin credential/);
    assert.throws(() => v.devices.revoke(v.tokens, 'owner'), /admin credential/);
    assert.throws(() => v.devices.rotate(v.tokens, d.id), /admin credential/);
    assert.ok(v.tokens.verify(token), 'the admin token stopped working');
    assert.equal(liveAdmins(v).length, 1);
  } finally { v.close(); }
});

test('issue 282: the last live admin token is never revoked; with a second one, the first can go', () => {
  const { root, v } = newVault({ git: false });
  try {
    const { id } = adminOf(root);
    assert.throws(() => v.tokens.revoke(id), /only admin token/);
    assert.equal(liveAdmins(v).length, 1, 'the admin token was revoked');
    const second = v.tokens.issue({ agent: 'spare', scopes: ['read', 'write', 'admin'], ttlDays: 0 });
    assert.equal(v.tokens.revoke(id), true, 'with a second admin token the first could not be revoked');
    assert.throws(() => v.tokens.revoke(second.id), /only admin token/);
    assert.equal(liveAdmins(v).length, 1);
  } finally { v.close(); }
});

test('issue 282: memev token rotate on the admin token writes the new secret into admin.json, with no expiry', () => {
  const { root, v } = newVault({ git: false });
  const { id, token: oldToken } = adminOf(root);
  v.close();
  const home = tmpdir('home-');
  const r = spawnSync(process.execPath, [path.join(PKG, 'bin', 'memev.mjs'), 'token', 'rotate', id], {
    env: { PATH: process.env.PATH, HOME: home, MEMEV_ROOT: root, MEMEV_CONFIG_DIR: path.join(home, 'cfg'), MEMEV_NO_SERVICE: '1' }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `token rotate failed: ${r.stderr}`);
  const after = adminOf(root);
  assert.equal(after.id, id);
  assert.notEqual(after.token, oldToken, 'admin.json still holds the old secret');
  const tokens = JSON.parse(fs.readFileSync(path.join(root, '.memev', 'tokens.json'), 'utf8')).tokens;
  assert.equal(tokens[id].expires, null, 'the rotated admin token got an expiry');
  assert.equal(tokens[id].revoked, false);
  const ts = new TokenStore(path.join(root, '.memev', 'tokens.json'));
  assert.ok(ts.verify(after.token), 'the secret in admin.json does not verify');
  assert.equal(ts.verify(oldToken), null, 'the old admin secret still verifies');
});

test('issue 282 follow-up: rotating the admin token leaves admin.json private and asks for no cloud link to be pasted again', () => {
  const { root, v } = newVault({ git: false });
  const { id } = adminOf(root);
  v.close();
  const file = path.join(root, '.memev', 'admin.json');
  // a temp file left by an interrupted rotate, readable by others: the new admin.json must not inherit its mode
  fs.writeFileSync(`${file}.tmp`, '{}', { mode: 0o644 }); fs.chmodSync(`${file}.tmp`, 0o644);
  const home = tmpdir('home-');
  const r = spawnSync(process.execPath, [path.join(PKG, 'bin', 'memev.mjs'), 'token', 'rotate', id], {
    env: { PATH: process.env.PATH, HOME: home, MEMEV_ROOT: root, MEMEV_CONFIG_DIR: path.join(home, 'cfg'), MEMEV_NO_SERVICE: '1' }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `token rotate failed: ${r.stderr}`);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'admin.json is readable by others after the rotate');
  assert.doesNotMatch(r.stdout, /pasted again|memev cloud url/, 'the admin token is never pasted into a cloud app, so the rotate must not ask for it');
  assert.match(r.stdout, /admin\.json holds the new secret/);
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'the temp file an earlier rotate left, which may hold an admin secret, is still on disk');
});
