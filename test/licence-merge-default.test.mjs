// SPDX-License-Identifier: Apache-2.0
// A paid licence issued with the default services can run the paid engine, and `license remove`
// says what removing it does to the other computers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { signLicense, ISSUED_SERVICES } from '../src/engine/license.mjs';
import { engineAllowed } from '../src/engine/merge.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const NOW = Date.parse('2026-11-05');
const paid = (services) => signLicense({ v: 1, lid: 'lic_default01', tier: 'personal_more', services, seats: 3, iat: '2026-11-01', exp: '2027-11-01', grace_days: 14 }, pem, 't1');

test('the services a licence is issued with by default include merge', () => {
  assert.ok(ISSUED_SERVICES.includes('merge'));
  assert.deepEqual([...ISSUED_SERVICES], ['sync', 'backup', 'relay', 'merge']);
  assert.ok(Object.isFrozen(ISSUED_SERVICES));
});

test('a paid licence with the default services may call the engine; the old default could not', () => {
  assert.equal(engineAllowed(paid([...ISSUED_SERVICES]), { now: NOW, keys }), true);
  assert.equal(engineAllowed(paid(['sync', 'backup', 'relay']), { now: NOW, keys }), false);
});

test('issue.mjs takes its default services from ISSUED_SERVICES, not a list of its own', () => {
  const src = read('../scripts/license/issue.mjs');
  assert.match(src, /arg\('services', ISSUED_SERVICES\.join\(','\)\)/);
  assert.doesNotMatch(src, /arg\('services', 'sync,backup,relay'\)/);
});

test('license remove says the other computers keep reading and stop writing, as the seat policy does', () => {
  assert.match(read('../src/cli/licensing.mjs'), /licence removed; this computer keeps Personal, and computers added to this vault can still read but can no longer write/);
  assert.doesNotMatch(read('../src/cli/licensing.mjs'), /nothing changes for Personal/);
  const devices = [{ id: 'd1', kind: 'remote-computer', status: 'active', created: '2026-11-02' }];
  assert.equal(seatPolicy({ license: null, devices }).writable.has('d1'), false);
});
