// SPDX-License-Identifier: Apache-2.0
// PG-05.1 WP05-06: one real-engine round trip. Two computers change the same note differently; the core hands the three
// versions across the call-out boundary (src/engine/merge.mjs) to a provider shim, which maps the note to structured state
// and runs the real engine; the merged note comes back and both computers end up with it. The shim and the engine live
// outside this repository. Point MEMEV_ENGINE_SHIM at the shim (a program that reads one JSON line {a, b, base} on its
// standard input and prints one JSON line {text} or {refuse:true}). Without it the test is skipped and reported as not run.
// The test checks only the round trip. What the boundary does with an unusable answer is tested elsewhere.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
import { git } from '../src/engine/git.mjs';
import { signLicense } from '../src/engine/license.mjs';
import { commandProvider } from '../src/engine/merge.mjs';
import { noteToState, stateToNote } from '../src/engine/state-map.mjs';

after(cleanup);

const SHIM = process.env.MEMEV_ENGINE_SHIM || '';
const probe = SHIM && fs.existsSync(SHIM)
  ? spawnSync(SHIM, [], { input: JSON.stringify({ a: 'x\n', b: 'x\n', base: 'x\n' }) + '\n', encoding: 'utf8', timeout: 60000 })
  : null;
const present = !!probe && probe.status === 0 && /"text"/.test(String(probe.stdout));
const skip = present ? false : 'not run: the paid engine and its provider shim are not installed here (set MEMEV_ENGINE_SHIM to the shim)';

const otherGit = (root, ...args) => git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args]);
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keys = { t1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const licence = () => signLicense({ v: 1, lid: 'lic_pg051', tier: 'business', services: ['merge'], seats: 2, connectors: 0, iat: '2026-10-01', exp: null, grace_days: 14 }, pem, 't1');

test('engine round trip: a change on each of two computers merges through the real engine and both end with the same note', { skip }, () => {
  const { v, root } = newVault();
  const bare = tmpdir('remote-');
  assert.ok(git(bare, ['init', '-q', '--bare', '-b', 'main']).ok);
  git(root, ['remote', 'add', 'origin', bare]);
  assert.ok(git(root, ['push', '-q', '-u', 'origin', 'main']).ok);
  const other = path.join(tmpdir('other-'), 'work');
  assert.ok(git(path.dirname(other), ['clone', '-q', bare, other]).ok);

  const note = 'notes/roundtrip.md';
  const base = '# Plan\n\nShared line one\nShared line two\n';
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, note), base);
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'add the note']);
  assert.ok(git(root, ['push', '-q', 'origin', 'main']).ok);
  assert.ok(otherGit(other, 'pull', '-q', 'origin', 'main').ok);

  // the other computer adds one line and pushes; this computer adds a different line
  fs.writeFileSync(path.join(other, note), `${base}Added on the other computer\n`);
  otherGit(other, 'add', note); otherGit(other, 'commit', '-q', '-m', 'other change');
  assert.ok(otherGit(other, 'push', '-q', 'origin', 'main').ok);
  fs.writeFileSync(path.join(root, note), `${base}Added on this computer\n`);
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'this change']);

  v.config.merge = { provider: commandProvider(SHIM, { timeoutMs: 60000, id: 'engine-shim' }) };
  const res = syncOnce(v, { root, license: licence(), keys, at: Date.parse('2026-11-01') });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  assert.equal(res.pushed, true, 'the merged note is pushed');
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(!rec?.copy, 'the engine resolved the note, so no conflict copy is kept');

  const merged = fs.readFileSync(path.join(root, note), 'utf8');
  for (const line of ['# Plan', 'Shared line one', 'Shared line two', 'Added on this computer', 'Added on the other computer']) {
    assert.ok(merged.split('\n').includes(line), `the merged note holds: ${line}`);
  }
  // the other computer pulls the merged note and holds the same text
  assert.ok(otherGit(other, 'pull', '-q', 'origin', 'main').ok);
  assert.equal(fs.readFileSync(path.join(other, note), 'utf8'), merged, 'both computers hold the same note');
  // the merged note maps to structured state and back without loss, and its set holds both changes
  const state = noteToState(merged);
  assert.equal(stateToNote(state), merged);
  const held = new Set(Object.values(state.lines));
  assert.ok(held.has('Added on this computer') && held.has('Added on the other computer'));
  v.close();
});
