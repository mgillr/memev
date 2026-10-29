// The merge engine is a paid add-on that a licence may carry, and it is a separate, externally
// licensed component that is never in this repository. These tests cover the entitlement for it
// and the keep-both fallback that runs when no engine is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineAllowed, can, CORE_FEATURES, PAID_FEATURES, mergeProvider, resolveMerge } from '../src/engine/entitlements.mjs';

test('MEM-130 AC01: engineAllowed is true for a paid licence with the merge service in valid or grace, true for a trial only in valid, and false for the rest', () => {
  assert.equal(engineAllowed({ state: 'valid', services: ['merge'] }), true, 'paid, merge service, valid');
  assert.equal(engineAllowed({ state: 'grace', services: ['merge'] }), true, 'paid, merge service, grace');
  assert.equal(engineAllowed({ state: 'valid', services: ['merge'], trial: true }), true, 'trial, merge service, valid');
  assert.equal(engineAllowed({ state: 'grace', services: ['merge'], trial: true }), false, 'trial, merge service, grace');
  assert.equal(engineAllowed({ state: 'valid', services: ['sync'] }), false, 'no merge service');
  assert.equal(engineAllowed({ state: 'valid', services: [] }), false, 'empty services');
  assert.equal(engineAllowed({ state: 'none', services: ['merge'] }), false, 'none');
  assert.equal(engineAllowed({ state: 'invalid', services: ['merge'] }), false, 'invalid');
  assert.equal(engineAllowed({ state: 'not_yet_valid', services: ['merge'] }), false, 'not_yet_valid');
  assert.equal(engineAllowed({ state: 'expired', services: ['merge'] }), false, 'expired');
  assert.equal(engineAllowed(null), false, 'no licence');
});

test('MEM-130 AC02: can(merge_engine) is false on the free tier, CORE_FEATURES is unchanged, and the engine is only in PAID_FEATURES', () => {
  assert.equal(can('merge_engine'), false, 'the engine is not a core feature');
  assert.deepEqual(CORE_FEATURES, ['vault', 'recall', 'graph', 'contracts', 'doctor', 'local_clients', 'own_tunnel', 'git_backup', 'cloud_connectors'], 'CORE_FEATURES is unchanged');
  assert.ok(PAID_FEATURES.includes('merge_engine'), 'the engine is a paid feature');
  assert.ok(!CORE_FEATURES.includes('merge_engine'), 'the engine is not in the core');
});

test('MEM-130 AC06: with no engine installed the provider is null and the keep-both default runs', () => {
  assert.equal(mergeProvider(), null, 'no engine installed, so no provider');
  const r = resolveMerge('alpha', 'beta');
  assert.equal(r.keepBoth, true, 'the default keeps both sides');
  assert.ok(r.text.includes('alpha'), 'the first side is kept');
  assert.ok(r.text.includes('beta'), 'the second side is kept');
});
