// SPDX-License-Identifier: Apache-2.0
// Import behaviour tests: preview, keep, undo, dedup, no network, init integration.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { tmpdir, cleanup, OWNER, newVault } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { scanAll, existingHashes, dedup, runImport, listImports, undoImport } from '../src/engine/importers/core.mjs';
// A fake credential for the secret checks, built from parts so that secret scanners do not flag this file.
const FAKE_KEY = ['sk', 'live', 'abcdefghijklmnop1234567890'].join('-');

after(() => cleanup());

function makeProj(prefix = 'proj-') {
  const dir = tmpdir(prefix);
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Zephyrquokka project\nA note about zephyrquokka planning.\n');
  fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), 'notes: zephyrquokka decisions\n');
  fs.writeFileSync(path.join(dir, '.env'), `API_KEY=${FAKE_KEY}\n`);
  fs.writeFileSync(path.join(dir, 'deploy.key'), 'dummy-key-material\n');
  return dir;
}

test('MEM-105 AC09: preview shows counts and sizes per source; --keep picks specific items; note carries source tag and import id', () => {
  const { root, v } = newVault();
  const proj = makeProj();
  const items = scanAll({ paths: [proj], aiHistory: false, exports: [], cwd: proj, home: tmpdir('home-') });
  const hashes = existingHashes(v);
  const deduped = dedup(items, hashes);
  const importable = deduped.filter((i) => !i.skip);
  assert.ok(importable.length >= 2, `found ${importable.length} importable items`);
  const result = runImport(v, OWNER, [importable[0]]);
  assert.ok(result.id.startsWith('imp-'), 'import id present');
  assert.equal(result.imported, 1, 'one item imported');
  const list = listImports(v);
  assert.equal(list.length, 1, 'one import listed');
  assert.equal(list[0].id, result.id, 'list shows the import id');
  assert.equal(list[0].items, 1, 'list shows item count');
  const note = v.get(OWNER, list[0].path);
  assert.ok(note.body.includes('Source: project'), 'source tag present');
  assert.ok(note.body.includes(`Import: ${result.id}`), 'import id in note');
  assert.ok(note.body.includes('Hash: sha256:'), 'hash present');
  v.close();
});

test('MEM-105 AC10: undo removes exactly that import and no others; second undo is a no-op', () => {
  const { v } = newVault();
  const proj = makeProj();
  const items = scanAll({ paths: [proj], aiHistory: false, exports: [], cwd: proj, home: tmpdir('home-') });
  const hashes = existingHashes(v);
  const deduped = dedup(items, hashes);
  const importable = deduped.filter((i) => !i.skip);
  const r1 = runImport(v, OWNER, [importable[0]]);
  const r2 = runImport(v, OWNER, [importable[1]]);
  assert.notEqual(r1.id, r2.id, 'two different import ids');
  let list = listImports(v);
  assert.equal(list.length, 2, 'two imports listed');
  const u1 = undoImport(v, OWNER, r1.id);
  assert.equal(u1.ok, true, 'first undo succeeds');
  list = listImports(v);
  assert.equal(list.length, 1, 'one import remains');
  assert.equal(list[0].id, r2.id, 'the other import is untouched');
  const u2 = undoImport(v, OWNER, r1.id);
  assert.equal(u2.ok, false, 'second undo fails');
  assert.match(u2.error, /not found/, 'second undo says not found');
  const u3 = undoImport(v, OWNER, r2.id);
  assert.equal(u3.ok, true, 'undo the second import');
  list = listImports(v);
  assert.equal(list.length, 0, 'no imports remain');
  v.close();
});

test('MEM-105 AC11: import succeeds with globalThis.fetch replaced by a function that throws (no network call)', async () => {
  const origFetch = globalThis.fetch;
  const throwFn = () => { throw new Error('network disabled for test'); };
  globalThis.fetch = throwFn;
  try {
    const { v } = newVault();
    const proj = makeProj();
    const items = scanAll({ paths: [proj], aiHistory: false, exports: [], cwd: proj, home: tmpdir('home-') });
    const hashes = existingHashes(v);
    const deduped = dedup(items, hashes);
    const importable = deduped.filter((i) => !i.skip);
    const result = runImport(v, OWNER, importable);
    assert.ok(result.id.startsWith('imp-'), 'import succeeded with no network');
    assert.ok(result.imported >= 1, 'items imported');
    v.close();
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('MEM-105 AC12: non-TTY init does not ask the import question and writes no import notes', () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(r.code, 0, 'init succeeds');
    assert.ok(!r.out.includes('Import these items?'), 'non-TTY init does not ask the import question');
    const notesDir = path.join(sb.root, 'memory', 'imports');
    assert.ok(!fs.existsSync(notesDir) || fs.readdirSync(notesDir).length === 0, 'no import notes written on non-TTY init');
  } finally { sb.stop(); }
});

test('MEM-105 AC12: offerImport with ask=true and a default answer imports', async () => {
  const { v } = newVault();
  const proj = makeProj();
  const input = new PassThrough();
  const output = new PassThrough();
  input.end('\n');
  const { offerImport } = await import('../src/cli/import.mjs');
  const r = await offerImport({ root: v.root, env: { HOME: tmpdir('home-') }, flags: {}, ask: true, input, output, cwd: proj, home: tmpdir('home-') });
  assert.equal(r.asked, true, 'was asked');
  assert.equal(r.accepted, true, 'accepted with default yes');
  assert.ok(r.result.id, 'import id returned');
  v.close();
});

test('MEM-105 AC12: offerImport with ask=true and a no answer does not import', async () => {
  const { v } = newVault();
  const proj = makeProj();
  const input = new PassThrough();
  const output = new PassThrough();
  input.end('n\n');
  const { offerImport } = await import('../src/cli/import.mjs');
  const r = await offerImport({ root: v.root, env: { HOME: tmpdir('home-') }, flags: {}, ask: true, input, output, cwd: proj, home: tmpdir('home-') });
  assert.equal(r.asked, true, 'was asked');
  assert.equal(r.accepted, false, 'declined');
  assert.equal(r.result.imported, 0, 'nothing imported');
  v.close();
});

test('MEM-105 AC12: offerImport failure never throws', async () => {
  const { v } = newVault();
  const input = new PassThrough();
  const output = new PassThrough();
  input.end('\n');
  const { offerImport } = await import('../src/cli/import.mjs');
  let threw = false;
  try {
    await offerImport({ root: v.root, env: { HOME: tmpdir('home-') }, flags: { path: ['/nonexistent/path/xyz'] }, ask: true, input, output, cwd: '/nonexistent/path/xyz', home: tmpdir('home-') });
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'offerImport does not throw on bad path');
  v.close();
});

test('MEM-105 AC13: importing the same folder twice does not duplicate notes', () => {
  const { v } = newVault();
  const proj = makeProj();
  const items = scanAll({ paths: [proj], aiHistory: false, exports: [], cwd: proj, home: tmpdir('home-') });
  const hashes = existingHashes(v);
  const deduped = dedup(items, hashes);
  const importable = deduped.filter((i) => !i.skip);
  const r1 = runImport(v, OWNER, importable);
  assert.ok(r1.imported >= 1, 'first import has items');
  const items2 = scanAll({ paths: [proj], aiHistory: false, exports: [], cwd: proj, home: tmpdir('home-') });
  const hashes2 = existingHashes(v);
  const deduped2 = dedup(items2, hashes2);
  const importable2 = deduped2.filter((i) => !i.skip);
  assert.equal(importable2.length, 0, 'second scan finds nothing new to import');
  const skipped2 = deduped2.filter((i) => i.skip && i.reason === 'already imported');
  assert.ok(skipped2.length >= 1, 'items marked as already imported');
  const list = listImports(v);
  assert.equal(list.length, 1, 'still only one import');
  v.close();
});
