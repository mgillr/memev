// SPDX-License-Identifier: Apache-2.0
// Import behaviour tests: preview, keep, undo, dedup, no network, init integration.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { tmpdir, cleanup, OWNER, newVault } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { scanAll, existingHashes, dedup, runImport, listImports, undoImport } from '../src/engine/importers/core.mjs';
import { healthy } from '../src/cli/daemon.mjs';
import { initImportPrompt } from '../src/cli/onboarding.mjs';
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

// Resolves to what p resolves to, or to 'timed out' after ms. The timer keeps the test process alive, so a read that
// never resolves fails here instead of letting the process exit as init did.
const within = (ms, p) => { let t; return Promise.race([p.finally(() => clearTimeout(t)), new Promise((res) => { t = setTimeout(() => res('timed out'), ms); })]); };
const readJsonFile = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

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

test('MEM-105 AC12: the init offer defaults to no: Enter imports nothing, and the answer is kept', async () => {
  const { v } = newVault();
  const proj = makeProj();
  const input = new PassThrough();
  const output = new PassThrough();
  input.end('\n');
  const { offerImport } = await import('../src/cli/import.mjs');
  const r = await offerImport({ root: v.root, env: { HOME: tmpdir('home-') }, flags: {}, ask: true, input, output, cwd: proj, home: tmpdir('home-') });
  assert.match(String(output.read() || ''), /Import these items\? \[y\/N\]/, 'the question shows no as the default');
  assert.equal(r.asked, true, 'was asked');
  assert.equal(r.accepted, false, 'Enter declines');
  assert.equal(r.result.imported, 0, 'nothing imported');
  assert.deepEqual(readJsonFile(path.join(v.root, '.memev', 'config.json')).import, { asked: true, accepted: false }, 'the answer is kept, so it is not asked again');
  v.close();
});

test('MEM-105 AC12: the init offer reads its answer after an earlier question paused the input, and from a line split in two chunks', async () => {
  const { v } = newVault();
  const proj = makeProj();
  const input = new PassThrough();
  const output = new PassThrough();
  readline.createInterface({ input, terminal: false }).close(); // as init's first/joining question leaves stdin: paused
  assert.equal(input.isPaused(), true, 'the input starts paused');
  input.write('y');
  setTimeout(() => input.write('es\n'), 50);
  const { offerImport } = await import('../src/cli/import.mjs');
  const r = await within(10000, offerImport({ root: v.root, env: { HOME: tmpdir('home-') }, flags: {}, ask: true, input, output, cwd: proj, home: tmpdir('home-') }));
  assert.notEqual(r, 'timed out', 'the answer was read');
  assert.equal(r.accepted, true, 'yes imports');
  assert.ok(r.result.imported >= 1, 'items imported');
  assert.equal(input.isPaused(), true, 'the input is paused again, so init can exit');
  v.close();
});

test('MEM-105 AC12: a terminal init reaches the offer through firstRun after the first question paused stdin, and y imports', async () => {
  const sb = sandbox();
  const log = console.log;
  const cwd = process.cwd();
  try {
    const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(r.code, 0, r.out);
    // with no daemon running the offer stops and starts nothing: a daemon started from this process would get its env
    sb.stop();
    const proj = makeProj();
    process.chdir(proj); // the offer reads the current folder
    const stdin = new PassThrough(); stdin.isTTY = true;
    const stdout = new PassThrough(); stdout.isTTY = true;
    readline.createInterface({ input: stdin, terminal: false }).close();
    stdin.write('y\n');
    console.log = () => {};
    const { firstRun } = await import('../src/cli/onboarding.mjs');
    const code = await within(60000, firstRun({ root: sb.root, env: sb.env, flags: { 'no-connect': true, 'no-service': true }, daemonUp: false, stdin, stdout }));
    console.log = log;
    assert.notEqual(code, 'timed out', 'init went on past the offer');
    assert.match(String(stdout.read() || ''), /Import these items\? \[y\/N\]/, 'the offer was made on the terminal');
    const items = readJsonFile(path.join(sb.root, '.memev', 'onboarding.json')).items;
    const line = items.find((i) => /History import/.test(i.step));
    assert.equal(line?.status, 'succeeded', JSON.stringify(line));
    assert.match(line.detail, /item\(s\) imported/);
    assert.deepEqual(readJsonFile(path.join(sb.root, '.memev', 'config.json')).import, { asked: true, accepted: true });
    assert.equal(stdin.isPaused(), true, 'stdin is paused again');
  } finally { console.log = log; process.chdir(cwd); sb.stop(); }
});

test('MEM-105 AC12: the question memev import asks defaults to yes, so Enter imports', async () => {
  const { root, v } = newVault();
  v.close();
  const proj = makeProj();
  const stdin = new PassThrough(); stdin.isTTY = true;
  const stdout = new PassThrough();
  stdin.end('\n');
  const { command } = await import('../src/cli/import.mjs');
  const log = console.log; console.log = () => {};
  let code;
  try { code = await within(10000, command('import', [], { path: proj }, { root, env: { HOME: tmpdir('home-') }, stdin, stdout })); } finally { console.log = log; }
  assert.equal(code, 0);
  assert.match(String(stdout.read() || ''), /Import these items\? \[Y\/n\]/, 'the question shows yes as the default');
  assert.equal(fs.readdirSync(path.join(root, 'memory', 'imports')).length, 1, 'Enter imported');
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

test('MEM-105: the import with no arguments previews the current folder and the history without stopping', async () => {
  const { root, v } = newVault();
  v.close();
  const proj = tmpdir('proj-');
  fs.writeFileSync(path.join(proj, 'README.md'), '# Bare import\nA note found by the bare import.\n');
  const home = tmpdir('home-');
  const { command } = await import('../src/cli/import.mjs');
  const cwd = process.cwd();
  const lines = [];
  const log = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  let code;
  try {
    process.chdir(proj);
    code = await command('import', [], { preview: true }, { root, env: { HOME: home } });
  } finally {
    console.log = log;
    process.chdir(cwd);
  }
  assert.equal(code, 0, 'the bare import previews and exits 0');
  assert.ok(lines.join('\n').includes('Import preview'), 'a preview is printed');
  assert.ok(lines.join('\n').includes('README.md'), 'the current folder is scanned');
});

test('MEM-105: memev import --preview, list, a refused undo and a run with nothing chosen each leave the daemon running', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    assert.ok(await healthy(sb.root), 'the daemon runs after init');
    const proj = makeProj();
    for (const args of [['import', '--path', proj, '--preview'], ['import', 'list'], ['import', 'undo', 'imp-00000000'], ['import', '--path', proj]]) {
      const r = sb.run(args);
      assert.ok(await healthy(sb.root), `the daemon is down after memev ${args.join(' ')}: ${r.out}${r.err}`);
    }
  } finally { sb.stop(); }
});

test('MEM-105 AC12: init offers the import only on a terminal and never under its --yes', () => {
  const tty = { isTTY: true }; const pipe = { isTTY: false };
  assert.deepEqual(initImportPrompt({}, { stdin: tty, stdout: tty }), { ask: true, input: tty, output: tty }, 'a terminal is asked');
  assert.deepEqual(initImportPrompt({ yes: true }, { stdin: tty, stdout: tty }), {}, 'init --yes is never asked and never imports');
  assert.deepEqual(initImportPrompt({}, { stdin: pipe, stdout: tty }), {}, 'piped input is not a terminal');
  assert.deepEqual(initImportPrompt({}, { stdin: tty, stdout: pipe }), {}, 'piped output is not a terminal');
});

test('MEM-105 AC12: init --yes or --keep never imports: off a terminal nothing is offered, and on a terminal only the answer imports', async () => {
  const { offerImport } = await import('../src/cli/import.mjs');
  for (const flags of [{ yes: true }, { keep: '1,2' }]) {
    const { v } = newVault();
    const proj = makeProj();
    const off = await offerImport({ root: v.root, env: { HOME: tmpdir('home-') }, flags, cwd: proj, home: tmpdir('home-') });
    assert.equal(off.asked, false, `${JSON.stringify(flags)} alone does not offer the import`);
    const input = new PassThrough(); const output = new PassThrough(); input.end('n\n');
    const no = await offerImport({ root: v.root, env: { HOME: tmpdir('home-') }, flags, ask: true, input, output, cwd: proj, home: tmpdir('home-') });
    assert.equal(no.accepted, false, `${JSON.stringify(flags)} does not answer the question for the person`);
    assert.equal(listImports(v).length, 0, 'nothing was imported');
    v.close();
  }
});

test('MEM-105 AC10: memev import list counts the imported items, not the headings inside them', () => {
  const { v } = newVault();
  const dir = tmpdir('headings-');
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Zephyrquokka plan\n\n### Step one\nfirst\n\n### Step two\nsecond\n\n### Step three\nthird\n');
  const items = dedup(scanAll({ paths: [dir], aiHistory: false, exports: [], cwd: dir, home: tmpdir('home-') }), existingHashes(v));
  const r = runImport(v, OWNER, items.filter((it) => !it.skip));
  assert.equal(r.imported, 1);
  assert.deepEqual(listImports(v).map((x) => x.items), [1], 'one file with three headings is one item');
  v.close();
});
