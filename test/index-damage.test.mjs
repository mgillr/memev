// SPDX-License-Identifier: Apache-2.0
// Damaged or foreign state, as a partial restore or a failing disk leaves it. Whatever the files hold: a start is not stopped and does not hang, recall never
// answers from a damaged generation (no junk, no wrong path, no empty answer that reads as nothing recorded), and the notes rebuild it.
// The attack table this follows is in the kill report on this branch. `reseal` puts the sums right after the damage, for the checks that must hold with no help from a sum.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Vault, initVault } from '../src/engine/vault.mjs';
import { SegIndex } from '../src/engine/segment-index.mjs';
import { SEG_FILES } from '../src/engine/segment.mjs';
import { NoteState } from '../src/engine/notestate.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { createServer } from '../src/server/http.mjs';
import { TokenStore } from '../src/engine/tokens.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEG_SRC = pathToFileUrl(path.join(PKG, 'src/engine/segment.mjs'));
function pathToFileUrl(p) { return new URL(`file://${p}`).href; }
const ME = { id: 'me', agent: 'tester', scopes: ['read', 'write', 'admin'], paths: ['**'] };
const OPTS = { git: false, fsync: false };
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const fresh = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-damage-')); made.push(root); initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: 47991 }); return root; };
const open = (root, extra = {}) => new Vault(root, { ...OPTS, ...extra }).open();
const until = async (fn, ms = 30000) => { const hold = setInterval(() => {}, 50); try { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); } return false; } finally { clearInterval(hold); } };
const WORD = (i) => `uniqword${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26)]}x`;
const COUNT = 60; const CHECK = [1, 7, 8, 11, 17, 21, 33, 40];
/** A stopped vault whose notes are all in the segment. */
function seeded(n = COUNT) {
  const root = fresh(); const v = open(root);
  for (let i = 0; i < n; i++) v.write(ME, { path: `notes/n${i}.md`, body: `# Note ${i}\nthe body holds ${WORD(i)} and common words alpha beta\n\n## Part\nmore text here\n` });
  v.close();
  // a save over the fold's size starts a fold of its own and a compact then waits on nothing, so the compact gets a vault with nothing unsaved
  const again = open(root); again.compact(); again.close(); return root;
}
const segDir = (root) => path.join(root, '.memev/index.seg');
const genDir = (root) => path.join(segDir(root), `gen-${fs.readFileSync(path.join(segDir(root), 'CURRENT'), 'utf8')}`);
const F = (root, name) => path.join(genDir(root), name);
const cut = (f) => { const b = fs.readFileSync(f); fs.writeFileSync(f, b.subarray(0, b.length >> 1)); };
const junk = (f) => { const b = fs.readFileSync(f); let s = 7; for (let i = 0; i < b.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; b[i] = s & 255; } fs.writeFileSync(f, b); };
const editHead = (root, fn) => { const j = JSON.parse(fs.readFileSync(F(root, 'head.json'), 'utf8')); fn(j); fs.writeFileSync(F(root, 'head.json'), JSON.stringify(j)); };
const names = (root, fn) => { const f = F(root, 'names.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j)); };
/** The sums and head made to agree with whatever is on the disk now: damage only the structure of the files can show. */
function reseal(root) {
  const h = JSON.parse(fs.readFileSync(F(root, 'head.json'), 'utf8')); delete h.self;
  for (const f of SEG_FILES) { const b = fs.readFileSync(F(root, f)); h.sizes[f] = b.length; h.sums[f] = crypto.createHash('sha256').update(b).digest('hex'); }
  h.self = crypto.createHash('sha256').update(JSON.stringify(h)).digest('hex'); fs.writeFileSync(F(root, 'head.json'), JSON.stringify(h));
}
/** A word's line says another word, and every order and count still holds: without a check of the line, that word just stops being found. */
function changeWord(root) {
  const f = F(root, 'dict.txt'); const lines = fs.readFileSync(f, 'utf8').split('\n'); const at = CHECK.map((i) => lines.findIndex((l) => l.startsWith(`${WORD(i)}\t`))).find((k) => k % 64 !== 0);
  const to = lines[at].replace('x\t', 'y\t'); assert.ok(lines[at - 1] < to && to < lines[at + 1], 'the change keeps the order'); lines[at] = to; fs.writeFileSync(f, lines.join('\n'));
}
const fullTable = (f) => { const b = fs.readFileSync(f); const nb = b.readUInt32LE(0); for (let i = 0; i < nb; i++) b.writeUInt32LE(1, (2 + i) * 4); fs.writeFileSync(f, b); };

/**
 * Every answer is the right note or says the index is rebuilding, on two starts in a row, and once any rebuild has landed every word is found.
 * Both the error's code and the note's own path and word are checked, so an answer from a damaged generation has nowhere to hide.
 */
async function everyAnswerRightOrRefused(root, label) {
  for (const round of [1, 2]) {
    const v = open(root);
    try {
      for (const i of CHECK) {
        const want = `notes/n${i}.md`;
        let hits; try { hits = v.recall(ME, { query: WORD(i), log: false, all_projects: true }); } catch (e) { assert.equal(e.code, 'index_rebuilding', `${label}: ${e.stack}`); continue; }
        assert.ok(hits.some((h) => h.path === want), `${label} round ${round}: no hit for ${WORD(i)}, got ${JSON.stringify(hits.map((h) => h.path))}`);
        for (const h of hits) { assert.equal(h.path, want, `${label}: another note's path`); assert.ok(String(h.snippet).includes(WORD(i)), `${label}: junk snippet ${h.snippet}`); assert.equal(h.heading, `Note ${i}`, `${label}: junk heading`); }
      }
      v.index.stats(); // what no recall read yet, such as the table of paths
      assert.ok(await until(() => v.index.state().state === 'ok'), `${label}: the rebuild did not land`);
      for (const i of CHECK) assert.deepEqual(v.recall(ME, { query: WORD(i), log: false, all_projects: true }).map((h) => h.path), [`notes/n${i}.md`], `${label} after the rebuild`);
      assert.equal(v.index.stats().notes, v.allNotes().length, `${label}: status counts what can be found`);
    } finally { v.close(); }
  }
}

const DAMAGE = {
  'dict.txt half': (r) => cut(F(r, 'dict.txt')), 'dict.txt empty': (r) => fs.writeFileSync(F(r, 'dict.txt'), ''), 'dict.txt random': (r) => junk(F(r, 'dict.txt')),
  'dict.txt random, resealed': (r) => { junk(F(r, 'dict.txt')); reseal(r); },
  'ids.bin half': (r) => cut(F(r, 'ids.bin')), 'ids.bin random': (r) => junk(F(r, 'ids.bin')), 'ids.bin random, resealed': (r) => { junk(F(r, 'ids.bin')); reseal(r); },
  'tfs.bin half': (r) => cut(F(r, 'tfs.bin')), 'names.json reversed': (r) => names(r, (j) => { j.paths.reverse(); }), 'names.json reversed, resealed': (r) => { names(r, (j) => { j.paths.reverse(); }); reseal(r); },
  'names.json empty': (r) => names(r, (j) => { j.paths = []; j.projects = []; }), 'names.json wrong type': (r) => fs.writeFileSync(F(r, 'names.json'), JSON.stringify({ paths: 5, projects: 'x' })), 'names.json wrong type, resealed': (r) => { fs.writeFileSync(F(r, 'names.json'), JSON.stringify({ paths: 5, projects: 'x' })); reseal(r); },
  'names.json a path outside the vault': (r) => { names(r, (j) => { j.paths[0] = '../../../../etc/passwd'; }); reseal(r); },
  'head.json with only version and order': (r) => editHead(r, (j) => { for (const k of Object.keys(j)) if (k !== 'version' && k !== 'endian') delete j[k]; }), 'head.json of an older version': (r) => fs.writeFileSync(F(r, 'head.json'), JSON.stringify({ version: 4, endian: os.endianness() })),
  'head.json sparse wrong type': (r) => editHead(r, (j) => { j.sparse = 5; }), 'head.json n 1e13': (r) => editHead(r, (j) => { j.n = 1e13; }), 'head.json n 3': (r) => editHead(r, (j) => { j.n = 3; }), 'head.json n -1': (r) => editHead(r, (j) => { j.n = -1; }),
  'head.json sparse offset 1e15': (r) => editHead(r, (j) => { j.sparse = [['a', 1e15]]; }), 'head.json dictBytes 1e12': (r) => editHead(r, (j) => { j.dictBytes = 1e12; }), 'head.json null': (r) => fs.writeFileSync(F(r, 'head.json'), 'null'), 'head.json cut': (r) => cut(F(r, 'head.json')),
  'meta.jsonl half': (r) => cut(F(r, 'meta.jsonl')), 'meta.jsonl random': (r) => junk(F(r, 'meta.jsonl')), 'meta.jsonl random, resealed': (r) => { junk(F(r, 'meta.jsonl')); reseal(r); },
  'cols.bin half': (r) => cut(F(r, 'cols.bin')), 'cols.bin random': (r) => junk(F(r, 'cols.bin')), 'cols.bin random, resealed': (r) => { junk(F(r, 'cols.bin')); reseal(r); },
  'heads.bin half': (r) => cut(F(r, 'heads.bin')), 'heads.bin random': (r) => junk(F(r, 'heads.bin')), 'dict.txt one word changed, still in order': (r) => changeWord(r), 'heads.bin gone': (r) => fs.rmSync(F(r, 'heads.bin')), 'bypath.bin half': (r) => cut(F(r, 'bypath.bin')), 'bypath.bin full': (r) => fullTable(F(r, 'bypath.bin')), 'bypath.bin random': (r) => junk(F(r, 'bypath.bin')),
  'bypath.bin full, resealed': (r) => { fullTable(F(r, 'bypath.bin')); reseal(r); }, 'bypath.bin random, resealed': (r) => { junk(F(r, 'bypath.bin')); reseal(r); },
};
for (const [label, hurt] of Object.entries(DAMAGE)) {
  test(`${label}: recall is right or says it is rebuilding, and the notes rebuild it`, async () => { const root = seeded(); hurt(root); await everyAnswerRightOrRefused(root, label); });
}

test('the control: a sound vault answers every word on both starts, with nothing rebuilt', async () => {
  const root = seeded(); const gen = genDir(root); await everyAnswerRightOrRefused(root, 'control');
  assert.equal(genDir(root), gen, 'a sound generation stays'); assert.equal(fs.existsSync(path.join(root, '.memev/index.damage.json')), false);
});

test('a file cut short, or a head changed in any field, is found by the start itself: recall has nothing to refuse', async () => {
  for (const name of SEG_FILES) {
    const root = seeded(12); cut(F(root, name)); const v = open(root); assert.match(v.status().index.damage?.why || '', new RegExp(name.replace('.', '\\.')), `${name}: said at the start`); assert.equal(v.index.state().state, 'ok');
    assert.deepEqual(v.recall(ME, { query: WORD(1), log: false, all_projects: true }).map((h) => h.path), ['notes/n1.md'], name); v.close();
  }
  for (const [field, value] of [['totalLen', 1], ['terms', 0], ['headBytes', 0], ['sums', {}], ['n', 3]]) {
    const root = seeded(12); editHead(root, (j) => { j[field] = value; }); const v = open(root); assert.match(v.status().index.damage?.why || '', /head\.json/, field); v.close();
  }
  const root = seeded(12); editHead(root, (j) => { j.totalLen += 1; }); const v = open(root); assert.match(v.status().index.damage?.why || '', /head\.json differs from its checksum/, 'a change no other check could see'); v.close();
});

test('a start reads no segment file whole and hashes none of the big ones', () => {
  const root = seeded(); const seen = []; const real = fs.readFileSync; fs.readFileSync = function counted(f, ...a) { if (typeof f === 'string' && SEG_FILES.some((x) => f.endsWith(x))) seen.push(path.basename(f)); return real.call(this, f, ...a); };
  let v; try { v = open(root); } finally { fs.readFileSync = real; } v.close();
  assert.deepEqual(seen, [], 'an open that reads the index whole costs its size at every start');
});

test('damage that keeps a file\'s size and every shape is found by the sweep, and by doctor: named, rebuilt, and said in status', async () => {
  const flip = (f, at = 0.5) => { const b = fs.readFileSync(f); const i = Math.floor(b.length * at); b[i] = b[i] === 0x31 ? 0x32 : b[i] === 1 ? 2 : (b[i] ^ 1); fs.writeFileSync(f, b); };
  for (const [name, at] of [['tfs.bin', 0], ['ids.bin', 0.5], ['dict.txt', 0.97], ['meta.jsonl', 0.5]]) {
    const root = seeded(); flip(F(root, name), at);
    let v = open(root); const sw = v.startSweep(); assert.ok(await until(() => sw.state !== 'running' && v.index.state().state === 'ok'), `${name}: the rebuild did not land`);
    assert.equal(sw.index_files, 'damaged', name); const s = v.status(); assert.match(s.index.damage.why, new RegExp(name.replace('.', '\\.')), name); assert.equal(s.index.state, 'ok');
    for (const i of CHECK) assert.deepEqual(v.recall(ME, { query: WORD(i), log: false, all_projects: true }).map((h) => h.path), [`notes/n${i}.md`], `${name} after the sweep`);
    const c = fileChecks({ root, vault: v }).find((x) => x.id === 'index-files'); assert.equal(c.status, 'warn', 'doctor says it happened'); assert.match(c.detail, new RegExp(name.replace('.', '\\.'))); v.close();
    const root2 = seeded(); flip(F(root2, name), at); v = open(root2); const checks = fileChecks({ root: root2, vault: v }); const d = checks.find((x) => x.id === 'index-files'); assert.equal(d.status, 'fail', `doctor finds ${name}`); assert.match(d.detail, /rebuilding/);
    assert.equal(fs.existsSync(path.join(segDir(root2), 'CURRENT')), false, 'a generation found damaged is not named any more, so a kill now means a rebuild'); assert.ok(await until(() => v.index.state().state === 'ok')); v.close();
  }
});

test('a generation with nothing wrong passes the sweep and doctor, with nothing rebuilt', async () => {
  const root = seeded(); const gen = genDir(root); const v = open(root); const sw = v.startSweep(); assert.ok(await until(() => sw.state !== 'running'));
  assert.equal(sw.index_files, 'ok'); assert.equal(fileChecks({ root, vault: v }).find((x) => x.id === 'index-files').status, 'ok'); assert.equal(v.status().index.damage, null); v.close(); assert.equal(genDir(root), gen);
});

test('a limited token never sees a snippet under another note\'s path', async () => {
  const root = fresh(); let v = open(root);
  v.write(ME, { path: 'public/a.md', body: '# P\npublic words about thewordone\n' }); v.write(ME, { path: 'secret/z.md', body: '# S\nsecret words about thewordone\n' }); v.compact(); v.close();
  const limited = { id: 'l', agent: 'l', scopes: ['read'], paths: ['public/**'] };
  for (const sealed of [false, true]) {
    if (sealed) { v = open(root); v.close(); }
    names(root, (j) => { const a = j.paths.indexOf('public/a.md'), b = j.paths.indexOf('secret/z.md'); [j.paths[a], j.paths[b]] = [j.paths[b], j.paths[a]]; }); if (sealed) reseal(root);
    v = open(root);
    try { const hits = v.recall(limited, { query: 'thewordone', log: false, all_projects: true }); for (const h of hits) assert.ok(!/secret/.test(h.snippet) && h.path === 'public/a.md', `leaked: ${JSON.stringify(h)}`); } catch (e) { assert.equal(e.code, 'index_rebuilding'); }
    assert.ok(await until(() => v.index.state().state === 'ok')); const after = v.recall(limited, { query: 'thewordone', log: false, all_projects: true }); assert.deepEqual(after.map((h) => h.path), ['public/a.md']); assert.ok(!/secret/.test(after[0].snippet)); v.close();
  }
});

test('a write while the index is rebuilding reaches recall when it lands, and is not lost by a stop before that', async () => {
  const root = seeded(); fs.writeFileSync(F(root, 'names.json'), JSON.stringify({ paths: [], projects: [] }).padEnd(fs.statSync(F(root, 'names.json')).size)); const v = open(root);
  assert.throws(() => v.recall(ME, { query: WORD(1), log: false, all_projects: true }), (e) => e.code === 'index_rebuilding');
  assert.throws(() => v.recall(ME, { query: WORD(1), log: false, all_projects: true }), (e) => e.code === 'index_rebuilding', 'and every recall after it until the rebuild lands: never an empty answer');
  v.write(ME, { path: 'notes/during.md', body: '# D\nduringword written while it rebuilds\n' }); v.append(ME, { path: 'notes/n2.md', text: '\n## More\nduringappendword here\n' }); v.delete(ME, { path: 'notes/n3.md' });
  assert.ok(v.remember(ME, { text: 'A decision worth keeping about the rebuild window and the worker', kind: 'decision' }), 'a memory is not refused for want of an index');
  assert.ok(await until(() => v.index.state().state === 'ok'), 'the rebuild landed');
  assert.deepEqual(v.recall(ME, { query: 'duringword', log: false, all_projects: true }).map((h) => h.path), ['notes/during.md']); assert.deepEqual(v.recall(ME, { query: 'duringappendword', log: false, all_projects: true }).map((h) => h.path), ['notes/n2.md']); assert.equal(v.recall(ME, { query: WORD(3), log: false, all_projects: true }).length, 0); v.close();
  const v2 = open(root); assert.deepEqual(v2.recall(ME, { query: 'duringword', log: false, all_projects: true }).map((h) => h.path), ['notes/during.md']); assert.equal(v2.recall(ME, { query: WORD(3), log: false, all_projects: true }).length, 0); v2.close();
  const root2 = seeded(); fs.writeFileSync(F(root2, 'cols.bin'), Buffer.alloc(fs.statSync(F(root2, 'cols.bin')).size)); const v3 = open(root2); assert.throws(() => v3.recall(ME, { query: WORD(1), log: false, all_projects: true }), (e) => e.code === 'index_rebuilding'); v3.close();
  const v4 = open(root2); assert.deepEqual(v4.recall(ME, { query: WORD(1), log: false, all_projects: true }).map((h) => h.path), ['notes/n1.md'], 'a stop in mid rebuild: the next start builds it'); v4.close();
});

test('a write that lands after the rebuild has read the notes is not lost when it serves', async () => {
  const root = seeded(1500); fs.writeFileSync(F(root, 'cols.bin'), Buffer.alloc(fs.statSync(F(root, 'cols.bin')).size)); const v = open(root);
  assert.throws(() => v.recall(ME, { query: WORD(1), log: false, all_projects: true }), (e) => e.code === 'index_rebuilding');
  // the worker walks the notes first and only then opens its files, so a file there means the walk is behind it
  assert.ok(await until(() => fs.existsSync(path.join(segDir(root), `gen-${v.index.lastGen}`, 'meta.jsonl')), 20000), 'the worker started');
  assert.equal(v.index.state().state, 'rebuilding', 'the rebuild ended already, so this proved nothing');
  v.write(ME, { path: 'zzz/late.md', body: '# L\nlatewordone written behind the walk\n' }); v.write(ME, { path: 'notes/n5.md', body: '# N\nrewrittenword replaces it\n' }); v.delete(ME, { path: 'notes/n6.md' });
  assert.ok(await until(() => v.index.state().state === 'ok'), 'the rebuild landed'); assert.equal(v.status().index.damage.state, 'rebuilt');
  assert.deepEqual(v.recall(ME, { query: 'latewordone', log: false, all_projects: true }).map((h) => h.path), ['zzz/late.md']); assert.deepEqual(v.recall(ME, { query: 'rewrittenword', log: false, all_projects: true }).map((h) => h.path), ['notes/n5.md']); assert.equal(v.recall(ME, { query: WORD(5), log: false, all_projects: true }).length, 0, 'the old text is gone'); assert.equal(v.recall(ME, { query: WORD(6), log: false, all_projects: true }).length, 0, 'the delete stands'); v.close();
});

test('a fold does not carry damage across: it stops at the sums and the notes rebuild the index', async () => {
  const root = seeded(); const b = fs.readFileSync(F(root, 'tfs.bin')); b[0] = b[0] === 2 ? 3 : 2; fs.writeFileSync(F(root, 'tfs.bin'), b); const was = genDir(root);
  const v = open(root); v.write(ME, { path: 'notes/late.md', body: '# L\nlateword in the overlay\n' }); v.index.save();
  const hold = setInterval(() => {}, 50); try { await v.index.foldSoon(); } finally { clearInterval(hold); }
  assert.notEqual(v.status().index.damage, null, 'the fold found it'); assert.match(v.status().index.damage.why, /tfs\.bin/); assert.ok(await until(() => v.index.state().state === 'ok'));
  const now = genDir(root); assert.notEqual(now, was); assert.deepEqual(v.recall(ME, { query: 'lateword', log: false, all_projects: true }).map((h) => h.path), ['notes/late.md']); assert.deepEqual(v.recall(ME, { query: WORD(5), log: false, all_projects: true }).map((h) => h.path), ['notes/n5.md']); v.close();
  const h = JSON.parse(fs.readFileSync(path.join(now, 'head.json'), 'utf8')); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(now, 'tfs.bin'))).digest('hex'), h.sums['tfs.bin']);
});

test('memev compact on a damaged generation rebuilds rather than folding it', () => {
  const root = seeded(); const b = fs.readFileSync(F(root, 'tfs.bin')); b[0] = b[0] === 2 ? 3 : 2; fs.writeFileSync(F(root, 'tfs.bin'), b);
  const v = open(root); v.write(ME, { path: 'notes/late.md', body: '# L\nlateword in the overlay\n' }); v.index.save(); v.compact(); assert.match(v.status().index.damage.why, /tfs\.bin/); v.close();
  const v2 = open(root); assert.deepEqual(v2.recall(ME, { query: 'lateword', log: false, all_projects: true }).map((h) => h.path), ['notes/late.md']); v2.close();
});

test('a table with no empty bucket ends the probe: the serving thread cannot be held by file contents', () => {
  const root = seeded(); fullTable(F(root, 'bypath.bin')); reseal(root);
  // in a child with a limit: without the bound this does not fail, it never ends
  const code = `const { Seg } = await import(${JSON.stringify(SEG_SRC)}); const s = new Seg(${JSON.stringify(genDir(root))}); s.cols(); s.byPath = (() => { const fs = process.getBuiltinModule('node:fs'); const b = fs.readFileSync(s.dir + '/bypath.bin'); const u = new Uint8Array(b).buffer; return new Uint32Array(u); })(); try { s.ordinalsOf('no/such/note.md'); console.log('ended'); } catch (e) { console.log(e.code); }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20000 }); assert.equal(r.signal, null, 'the probe did not end'); assert.equal(r.stdout.trim(), 'index_rebuilding', r.stderr);
});

test('a real daemon on a damaged table answers, finds it, rebuilds, and says so', { skip: process.platform === 'win32' }, async () => {
  const root = seeded(); fullTable(F(root, 'bypath.bin'));
  const c = spawn(process.execPath, [path.join(PKG, 'src/server/main.mjs'), '--root', root, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MEMEV_NO_SERVICE: '1' } }); let err = ''; c.stderr.on('data', (d) => { err += d; });
  try {
    assert.ok(await until(() => err.includes('sweep done') && err.includes('rebuilt'), 60000), `no rebuild: ${err}`); assert.match(err, /damaged \(bypath\.bin/); assert.match(err, /index files damaged/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.memev/index.damage.json'), 'utf8')).state, 'rebuilt');
  } finally { c.kill('SIGTERM'); await new Promise((r) => c.once('exit', r)); }
  const v = open(root); assert.deepEqual(v.recall(ME, { query: WORD(9), log: false, all_projects: true }).map((h) => h.path), ['notes/n9.md']); v.close();
});




const claimDir = (root, g) => path.join(segDir(root), `gen-${g}`);
test('a folder a live process is writing is left by any opener; a dead writer\'s, or one nobody claims, goes', async () => {
  const root = seeded(12); const file = path.join(root, '.memev/index.jsonl'); const keep = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' }); await new Promise((r) => keep.once('spawn', r));
  try {
    const live = claimDir(root, 90), dead = claimDir(root, 91), none = claimDir(root, 92);
    for (const d of [live, dead, none]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'cols.bin'), 'x'); }
    fs.writeFileSync(path.join(live, 'writing'), String(keep.pid)); fs.writeFileSync(path.join(dead, 'writing'), '2147483000');
    const ix = new SegIndex(file); assert.equal(ix.load(), true); assert.ok(await until(() => !fs.existsSync(dead) && !fs.existsSync(none)), 'a leftover goes'); assert.equal(fs.existsSync(live), true, 'a live writer keeps its folder'); assert.ok(ix.lastGen >= 92, 'the numbers are never used again'); ix._closeFiles();
  } finally { keep.kill('SIGKILL'); }
});

test('an opener beside a running fold does not pull it from under the fold: the fold lands', async () => {
  const root = seeded(1500); const file = path.join(root, '.memev/index.jsonl'); const ix = new SegIndex(file); assert.equal(ix.load(), true); ix.update('notes/x.md', '# x\nxword here\n', { mtime: 1 }); ix.save(); const was = ix.gen;
  const running = ix.foldSoon(); assert.ok(running, 'a fold started'); let inside = 0, done = false; running.finally(() => { done = true; });
  const hold = setInterval(() => {}, 50);
  try { while (!done) { const other = new SegIndex(file); assert.equal(other.load(), true); other._closeFiles(); if (!done) inside++; await new Promise((r) => setTimeout(r, 1)); } } finally { clearInterval(hold); }
  assert.ok(inside > 0, 'no opener landed inside the fold, so this proved nothing'); assert.equal(ix.foldError, undefined, `the fold failed: ${ix.foldError?.message}`); assert.ok(ix.gen > was, 'the fold landed'); assert.equal(ix.query('xword').length, 1);
  assert.equal(fs.existsSync(path.join(ix._dir(ix.gen), 'writing')), false, 'a published generation is no longer claimed'); ix._closeFiles();
});

/** A process that looks like a daemon to `ps`: its script is named server/main.mjs. */
function stubDaemon(root, ms = 30000) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-stub-')); made.push(d); const f = path.join(d, 'server', 'main.mjs'); fs.mkdirSync(path.dirname(f)); fs.writeFileSync(f, `setTimeout(() => {}, ${ms});`); return spawn(process.execPath, [f, '--root', root], { stdio: 'ignore', detached: true }); }


test('a stale daemon.loading naming a live process that is no daemon holds nothing up and stops nothing', { skip: process.platform === 'win32' }, async () => {
  const { loadingPid, stopDaemon, whyNotRunning } = await import('../src/cli/daemon.mjs'); const root = seeded(12); const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' }); await new Promise((r) => other.once('spawn', r));
  try {
    fs.writeFileSync(path.join(root, '.memev/daemon.loading'), JSON.stringify({ pid: other.pid })); assert.equal(loadingPid(root), null); assert.doesNotMatch(String(await whyNotRunning(root)), /loading/);
    const v = open(root); v.close();
    fs.writeFileSync(path.join(root, '.memev/daemon.json'), JSON.stringify({ pid: other.pid, port: 1 })); fs.writeFileSync(path.join(root, '.memev/daemon.lock'), String(other.pid));
    await stopDaemon(root); assert.ok(process.kill(other.pid, 0), 'memev stop killed a process that is not a daemon'); assert.equal(other.exitCode, null);
    fs.writeFileSync(path.join(root, '.memev/daemon.lock'), String(other.pid)); const r = spawn(process.execPath, [path.join(PKG, 'src/server/main.mjs'), '--root', root, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MEMEV_NO_SERVICE: '1' } }); let err = ''; r.stderr.on('data', (d) => { err += d; });
    try { assert.ok(await until(() => err.includes('serving') || r.exitCode !== null, 30000), err); assert.match(err, /serving/, 'a lock naming another program does not stop a start'); } finally { r.kill('SIGTERM'); await new Promise((x) => r.once('exit', x)); }
  } finally { other.kill('SIGKILL'); }
});

test('doctor reports a load that has stopped moving, rather than skipping it', { skip: process.platform === 'win32' }, async () => {
  const { loadState, whyNotRunning } = await import('../src/cli/daemon.mjs'); const { allChecks } = await import('../src/cli/doctor.mjs'); const root = seeded(12); const stub = stubDaemon(root); await new Promise((r) => stub.once('spawn', r));
  try {
    const f = path.join(root, '.memev/daemon.loading'); fs.writeFileSync(f, JSON.stringify({ pid: stub.pid, started: new Date().toISOString() }));
    let c = (await allChecks({ root, env: process.env })).find((x) => x.id === 'loading'); assert.equal(c?.status, 'warn', 'a load moving now is not a failure'); assert.equal(loadState(root).stalled, false); assert.match(await whyNotRunning(root), /still loading/);
    const old = new Date(Date.now() - 3600e3); fs.utimesSync(f, old, old);
    c = (await allChecks({ root, env: process.env })).find((x) => x.id === 'loading'); assert.equal(c?.status, 'fail'); assert.match(c.detail, /has not moved/); assert.equal(loadState(root).stalled, true); assert.match(await whyNotRunning(root), /memev restart/);
  } finally { stub.kill('SIGKILL'); }
});

test('a load moves its file as it goes, so one that is working is not taken for one that stopped', () => {
  const root = fresh(); for (let i = 0; i < 40; i++) { fs.mkdirSync(path.join(root, 'notes'), { recursive: true }); fs.writeFileSync(path.join(root, `notes/f${i}.md`), `# f\nbody ${i}\n`); }
  let ticks = 0; const real = Date.now; let at = real(); Date.now = () => { at += 400; return at; }; let v; try { v = open(root, { onProgress: () => { ticks++; } }); } finally { Date.now = real; } v.close(); assert.ok(ticks >= 10, `only ${ticks} reports over a first import`);
});

const caseInsensitive = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-Case-')); made.push(d); fs.writeFileSync(path.join(d, 'AbC'), 'x'); return fs.existsSync(path.join(d, 'abc')); };


test('a linked index folder or generation folder is not used or written through', { skip: process.platform === 'win32' }, async () => {
  for (const which of ['index.seg', 'generation', 'empty index.seg']) {
    const root = seeded(12); const out = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-out-')); made.push(out); const copy = path.join(out, 'copy'); const from = which === 'generation' ? genDir(root) : segDir(root); const to = from;
    if (which === 'empty index.seg') fs.mkdirSync(copy); else fs.cpSync(from, copy, { recursive: true }); fs.rmSync(from, { recursive: true }); fs.symlinkSync(copy, to);
    const list = () => { const o = {}; for (const e of fs.readdirSync(copy, { recursive: true })) { const f = path.join(copy, e); if (fs.statSync(f).isFile()) o[e] = fs.readFileSync(f).toString('base64'); } return o; }; const before = list();
    const v = open(root); v.write(ME, { path: 'new/x.md', body: '# N\nnewwordx here\n' }); v.index.save(); assert.deepEqual(v.recall(ME, { query: WORD(1), log: false, all_projects: true }).map((h) => h.path), ['notes/n1.md'], which); assert.equal(fs.lstatSync(segDir(root)).isSymbolicLink(), false, `${which}: a link stayed`); v.close();
    assert.deepEqual(list(), before, `${which}: written through`);
  }
});

test('a token limited to some paths gets counts only for what the sweep found outside them', async () => {
  const root = fresh(); let v = open(root); v.write(ME, { path: 'secret/acquisition-of-acme.md', body: '# Deal\nthe secret body\n' }); v.write(ME, { path: 'secret/gone.md', body: '# G\ngone\n' }); v.write(ME, { path: 'public/a.md', body: '# P\npublic\n' }); v.write(ME, { path: 'public/changed.md', body: '# P\nsame size body\n' }); v.close();
  const T = 1700000000; for (const f of ['secret/acquisition-of-acme.md', 'public/changed.md']) fs.utimesSync(path.join(root, f), T, T); v = open(root, { ignoreCtime: true }); v.close();
  for (const [f, from, to] of [['secret/acquisition-of-acme.md', 'secret', 'tamper'], ['public/changed.md', 'same', 'edit']]) { const p = path.join(root, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to)); fs.utimesSync(p, T, T); }
  fs.rmSync(path.join(root, 'secret/gone.md')); fs.mkdirSync(path.join(root, 'secret/gone.md'));
  const tok = new TokenStore(path.join(root, '.memev/tokens.json')).issue({ agent: 'limited', scopes: ['read'], paths: ['public/**'] }).token; const whole = new TokenStore(path.join(root, '.memev/tokens.json')).issue({ agent: 'whole', scopes: ['read'], paths: ['**'] }).token;
  v = open(root, { ignoreCtime: true }); const s = v.startSweep(); assert.ok(await until(() => s.state !== 'running')); assert.equal(s.changed, 2);
  const server = createServer(v); await new Promise((r) => server.listen(0, '127.0.0.1', r)); const { port } = server.address();
  const get = async (t) => (await fetch(`http://127.0.0.1:${port}/v1/status`, { headers: { authorization: `Bearer ${t}` } })).json();
  const mcp = async (t) => (await (await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_status', arguments: {} } }) })).json()).result.structuredContent;
  try {
    for (const view of [await get(tok), await mcp(tok)]) {
      assert.deepEqual(view.sweep.found.map((x) => x.path), ['public/changed.md']); assert.equal(view.sweep.found_elsewhere, 1); assert.deepEqual(view.sweep.missing_notes, []); assert.equal(view.sweep.missing_elsewhere, 1); assert.equal(view.sweep.changed, 2, 'counts stay');
      assert.doesNotMatch(JSON.stringify(view), /secret\/|acquisition/, 'no path outside the token, in any field');
    }
    for (const view of [await get(whole), await mcp(whole)]) { assert.deepEqual(view.sweep.found.map((x) => x.path).sort(), ['public/changed.md', 'secret/acquisition-of-acme.md']); assert.deepEqual(view.sweep.missing_notes, [{ path: 'secret/gone.md', reason: 'it is a folder' }]); assert.equal(view.sweep.found_elsewhere, 0); }
  } finally { server.close(); v.close(); }
});

test('the sweep does not follow a linked folder to a file outside the vault', { skip: process.platform === 'win32' }, async () => {
  const root = fresh(); let v = open(root); v.write(ME, { path: 'dir/inner.md', body: '# I\ninner words\n' }); v.close();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-out-')); made.push(out); fs.writeFileSync(path.join(out, 'inner.md'), '# I\nsome other text outside\n'); fs.rmSync(path.join(root, 'dir'), { recursive: true }); fs.symlinkSync(out, path.join(root, 'dir'));
  v = open(root); const s = v.startSweep(); assert.ok(await until(() => s.state !== 'running')); assert.equal(s.differs, 0, 'a file outside was opened and hashed'); assert.deepEqual(s.missing_notes.filter((x) => x.path === 'dir/inner.md'), [{ path: 'dir/inner.md', reason: 'a folder on the way is a link' }]); v.close();
});

test('the real daemon names what its sweep could not read in its log line', { skip: process.platform === 'win32' }, async () => {
  const root = fresh(); let v = open(root); v.write(ME, { path: 'notes/gone.md', body: '# G\ngone\n' }); v.close(); fs.rmSync(path.join(root, 'notes/gone.md')); fs.mkdirSync(path.join(root, 'notes/gone.md'));
  const c = spawn(process.execPath, [path.join(PKG, 'src/server/main.mjs'), '--root', root, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MEMEV_NO_SERVICE: '1' } }); let err = ''; c.stderr.on('data', (d) => { err += d; });
  try { assert.ok(await until(() => err.includes('sweep done'), 60000), err); assert.match(err, /1 not readable: notes\/gone\.md \(it is a folder\)/); } finally { c.kill('SIGTERM'); await new Promise((r) => c.once('exit', r)); }
});

test('the prompt hook says the index is rebuilding, not that nothing was recorded', async () => {
  const root = seeded(12); fs.writeFileSync(F(root, 'cols.bin'), Buffer.alloc(fs.statSync(F(root, 'cols.bin')).size)); const v = open(root); const server = createServer(v); await new Promise((r) => server.listen(0, '127.0.0.1', r)); const { port } = server.address();
  const tok = new TokenStore(path.join(root, '.memev/tokens.json')).issue({ agent: 'hook', scopes: ['read', 'write'], paths: ['**'] }).token;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/recall`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: WORD(1) }) }); const j = await r.json(); assert.equal(r.status, 200); assert.equal(j.rebuilding, true); assert.match(j.text, /rebuilt from the notes/);
    assert.ok(await until(() => v.index.state().state === 'ok')); const m = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_recall', arguments: { query: WORD(1) } } }) }); const mj = await m.json(); assert.match(JSON.stringify(mj.result.structuredContent), /notes\/n1\.md/);
  } finally { server.close(); v.close(); }
});

test('an index worker failure is said in status and doctor, not left as a rebuild that never ends', async () => {
  const root = seeded(12); fs.writeFileSync(F(root, 'cols.bin'), Buffer.alloc(fs.statSync(F(root, 'cols.bin')).size)); const v = open(root); const real = v.index.rebuildFromNotes; v.index.rebuildFromNotes = () => Promise.reject(new Error('the disk is full'));
  assert.throws(() => v.recall(ME, { query: WORD(1), log: false, all_projects: true }), (e) => e.code === 'index_rebuilding'); assert.ok(await until(() => /failed/.test(v.status().index.damage?.state || ''))); assert.match(v.status().index.damage.state, /the disk is full/); v.index.rebuildFromNotes = real; v.close();
  const v2 = open(root); assert.deepEqual(v2.recall(ME, { query: WORD(1), log: false, all_projects: true }).map((h) => h.path), ['notes/n1.md'], 'the next start builds it'); v2.close();
});
