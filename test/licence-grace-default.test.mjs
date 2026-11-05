// SPDX-License-Identifier: Apache-2.0
// Paid licences are issued with a 3-day grace period after the paid period ends (owner decision,
// 5 Nov 2026); a licence that states no grace period still gets 14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ISSUED_GRACE_DAYS, issuedGraceDays, signLicense, verifyLicense } from '../src/engine/license.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');

test('the grace period a licence is issued with is 3 days unless --grace names another', () => {
  assert.equal(ISSUED_GRACE_DAYS, 3);
  assert.equal(issuedGraceDays(), 3);
  assert.equal(issuedGraceDays(null), 3);
  assert.equal(issuedGraceDays('7'), 7);
});

test('a development licence signed without --grace carries 3 grace days and goes past grace on day 4', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-licgrace-'));
  try {
    const dev = (...a) => spawnSync(process.execPath, [path.join(here, '..', 'scripts', 'license-dev.mjs'), ...a], { encoding: 'utf8' });
    const kg = dev('keygen', '--out', dir);
    assert.equal(kg.status, 0, kg.stderr);
    const { kid, public_key: pub, private_key_file: keyFile } = JSON.parse(kg.stdout);
    const signed = dev('sign', '--key', keyFile, '--tier', 'personal_more', '--seats', '3', '--iat', '2026-10-01', '--exp', '2026-11-01');
    assert.equal(signed.status, 0, signed.stderr);
    const lic = JSON.parse(signed.stdout);
    assert.equal(lic.grace_days, 3);
    const keys = { [kid]: pub };
    assert.equal(verifyLicense(lic, { keys, now: Date.parse('2026-11-03T12:00:00Z') }).state, 'grace');
    assert.equal(verifyLicense(lic, { keys, now: Date.parse('2026-11-06T12:00:00Z') }).state, 'expired');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the vendor issuing script takes its grace period from issuedGraceDays', () => {
  const src = read('../scripts/license/issue.mjs');
  assert.match(src, /grace_days: issuedGraceDays\(arg\('grace'\)\)/);
  assert.doesNotMatch(src, /arg\('grace', 14\)/);
});

test('a licence that states no grace period still gets 14 days, as before', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const lic = signLicense({ v: 1, lid: 'lic_nograce1', tier: 'personal_more', services: ['merge'], seats: 3, iat: '2026-10-01', exp: '2026-11-01' }, pem, 't1');
  assert.equal(verifyLicense(lic, { keys, now: Date.parse('2026-11-10T12:00:00Z') }).state, 'grace');
});
