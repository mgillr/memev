// SPDX-License-Identifier: Apache-2.0
// A paid licence issued without naming its services can run the paid engine, whichever issuing
// script made it, and `license remove` says what removing it does to the other computers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { signLicense, ISSUED_SERVICES, issuedServices, TIER_NAMES } from '../src/engine/license.mjs';
import { engineAllowed } from '../src/engine/merge.mjs';
import { seatPolicy, TIERS } from '../src/engine/entitlements.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');
const NOW = Date.parse('2026-11-05');

test('the default services a licence is issued with include merge', () => {
  assert.deepEqual([...ISSUED_SERVICES], ['sync', 'backup', 'relay', 'merge']);
  assert.ok(Object.isFrozen(ISSUED_SERVICES));
  assert.deepEqual(issuedServices(), ['sync', 'backup', 'relay', 'merge']);
  assert.deepEqual(issuedServices(null), ['sync', 'backup', 'relay', 'merge']);
  assert.deepEqual(issuedServices('sync, relay'), ['sync', 'relay'], 'a named list is used as named');
  const copy = issuedServices(); copy.pop();
  assert.deepEqual([...ISSUED_SERVICES], ['sync', 'backup', 'relay', 'merge'], 'the default cannot be changed through a returned list');
});

test('every paid tier in the tier table carries merge; free and federated do not', () => {
  for (const id of TIER_NAMES) if (TIERS[id]) assert.ok(TIERS[id].services.includes('merge'), `${id} carries merge`);
  assert.ok(!TIERS.free.services.includes('merge'));
  assert.ok(!TIERS.federated.services.includes('merge'));
});

test('a development licence signed without --services passes the engine gate; one signed with the old default does not', () => {
  // license-dev signs with today's date, so this judges at today, and a fixed date here would fail once today had passed it
  const EXP = new Date(Date.now() + 365 * 86400e3).toISOString().slice(0, 10);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-licdev-'));
  try {
    const dev = (...a) => spawnSync(process.execPath, [path.join(here, '..', 'scripts', 'license-dev.mjs'), ...a], { encoding: 'utf8' });
    const kg = dev('keygen', '--out', dir);
    assert.equal(kg.status, 0, kg.stderr);
    const { kid, public_key: pub, private_key_file: keyFile } = JSON.parse(kg.stdout);
    const keys = { [kid]: pub };
    const signed = dev('sign', '--key', keyFile, '--tier', 'personal_more', '--seats', '3', '--exp', EXP);
    assert.equal(signed.status, 0, signed.stderr);
    const lic = JSON.parse(signed.stdout);
    assert.deepEqual(lic.services, ['sync', 'backup', 'relay', 'merge']);
    assert.equal(engineAllowed(lic, { now: Date.now(), keys }), true);
    const old = JSON.parse(dev('sign', '--key', keyFile, '--tier', 'personal_more', '--seats', '3', '--exp', EXP, '--services', 'sync,backup,relay').stdout);
    assert.equal(engineAllowed(old, { now: Date.now(), keys }), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the vendor issuing script takes its services from issuedServices', () => {
  const src = read('../scripts/license/issue.mjs');
  assert.match(src, /services: issuedServices\(arg\('services'\)\)/);
  assert.doesNotMatch(src, /'sync,backup,relay'\)/);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const lic = signLicense({ v: 1, lid: 'lic_default01', tier: 'business', services: issuedServices(), seats: 5, iat: '2026-11-01', exp: '2027-11-01', grace_days: 14 }, pem, 't1');
  assert.equal(engineAllowed(lic, { now: NOW, keys }), true);
});

test('license remove says the other computers keep reading and stop writing, as the seat policy does', () => {
  assert.match(read('../src/cli/licensing.mjs'), /licence removed; this computer keeps Personal, and computers added to this vault can still read but can no longer write/);
  assert.doesNotMatch(read('../src/cli/licensing.mjs'), /nothing changes for Personal/);
  const devices = [{ id: 'd1', kind: 'remote-computer', pubkey: 'k1', status: 'active', created: '2026-11-02' }];
  const p = seatPolicy({ license: null, devices });
  assert.equal(p.writable.has('d1'), false);
  assert.deepEqual(p.read_only, ['d1']);
});
