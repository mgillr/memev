// SPDX-License-Identifier: Apache-2.0
// The fast start's promises: it trusts a stat only as far as a stat can be trusted, the background sweep finds what a stat cannot show,
// and the graph it restores is the graph a full read of the notes gives. Each test holds its own control, so a test that cannot
// fail shows up as a failed control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Vault, initVault } from '../src/engine/vault.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ME = { id: 'me', agent: 'tester', scopes: ['read', 'write'], paths: ['**'] };
const SECOND = 1700000000; // a whole second survives utimes exactly; a time read from a stat loses its nanoseconds on the way back
const OPTS = { git: false, fsync: false };
const fresh = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-notestate-')); initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: 47990 }); return root; };
const open = (root, extra = {}) => new Vault(root, { ...OPTS, ...extra }).open();
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };
/** A hard kill, as far as one process can show it: nothing a close would write gets written. */
const abandon = (v) => { clearTimeout(v._ist); v.commits.flush?.(); try { fs.closeSync(v.log.fd); } catch {} v.log.fd = null; };
const graphOf = (v) => ({ entities: [...v.graph.entities.values()].map((e) => [e.id, e.name, e.kind, [...e.sections]]).sort(), sections: [...v.graph.sectionEnts.entries()].sort(), notes: [...v.graph.notesSections.entries()].sort(), lists: [...v.graph.noteEnts.entries()].sort(), cooc: [...v.graph.cooc.entries()].sort() });

/** Same bytes count, same modified time to the nanosecond: returns both stats so the test checks its own premise. */
function editKeepingSizeAndTime(file, from, to) {
  const before = fs.statSync(file, { bigint: true });
  const body = fs.readFileSync(file, 'utf8'); assert.ok(body.includes(from)); assert.equal(from.length, to.length);
  fs.writeFileSync(file, body.replace(from, to)); fs.utimesSync(file, SECOND, SECOND);
  return { before, after: fs.statSync(file, { bigint: true }) };
}
/** A note whose saved stat holds the whole second: written, the time set, then one start and stop so the record takes it. */
function settled(root, extra = {}) {
  let v = open(root, extra); v.write(ME, { path: 'notes/b.md', body: '# b\nthe marker abcdefgh sits here\n' }); v.close();
  fs.utimesSync(path.join(root, 'notes/b.md'), SECOND, SECOND);
  v = open(root, extra); v.close();
  return path.join(root, 'notes/b.md');
}

test('an edit that keeps size and modified time is found at the start, because the changed time moved', () => {
  const root = fresh(); const file = settled(root);
  const { before, after } = editKeepingSizeAndTime(file, 'abcdefgh', 'ijklmnop');
  assert.equal(after.size, before.size); assert.equal(after.mtimeNs, before.mtimeNs); assert.notEqual(after.ctimeNs, before.ctimeNs);
  const v = open(root);
  assert.deepEqual(v.imported, ['notes/b.md']);
  v.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('where the changed time cannot help, the start misses the edit and the sweep finds it, with the time it took', async () => {
  const root = fresh(); const file = settled(root, { ignoreCtime: true });
  const { before, after } = editKeepingSizeAndTime(file, 'abcdefgh', 'ijklmnop');
  assert.equal(after.size, before.size); assert.equal(after.mtimeNs, before.mtimeNs);
  const v = open(root, { ignoreCtime: true });
  // the control: this is the gap. Without the sweep the log still holds the old text, so the rest of this test can fail.
  assert.deepEqual(v.imported, []);
  assert.equal(v.recall(ME, { query: 'ijklmnop', log: false }).length, 0);
  const seqBefore = v.log.heads.get('notes/b.md').seq;
  const s = v.startSweep();
  assert.ok(await until(() => s.state !== 'running'), 'the sweep ended');
  assert.equal(s.state, 'done'); assert.equal(s.error, null); assert.equal(s.changed, 1);
  assert.equal(s.found[0].path, 'notes/b.md'); assert.ok(s.found[0].ms >= 0 && s.found[0].ms <= s.cycle_ms);
  assert.ok(v.log.heads.get('notes/b.md').seq > seqBefore, 'the edit is in the log');
  const hit = v.recall(ME, { query: 'ijklmnop', log: false }); assert.ok(JSON.stringify(hit).includes('notes/b.md'), 'recall finds the new text');
  assert.equal(v.status().sweep.changed, 1);
  v.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('a sweep over notes that all match changes nothing, and a write during it is not taken for an outside edit', async () => {
  const root = fresh(); let v = open(root);
  for (let i = 0; i < 400; i++) v.write(ME, { path: `notes/s${i}.md`, body: `# s${i}\nsome words here\n` });
  const seq = v.log.seq; const s = v.startSweep();
  v.write(ME, { path: 'notes/s1.md', body: '# s1\nchanged by a write\n' });
  assert.ok(await until(() => s.state !== 'running')); assert.equal(s.state, 'done'); assert.equal(s.changed, 0, JSON.stringify(s.found));
  assert.equal(v.log.seq, seq + 1); assert.ok(s.hashed >= 400);
  v.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('an outside edit made while the daemon runs is found at the next start', () => {
  const root = fresh(); let v = open(root);
  v.write(ME, { path: 'notes/live.md', body: '# live\nbefore words\n' });
  fs.writeFileSync(path.join(root, 'notes/live.md'), '# live\nafter words edited in an editor\n');
  v.close(); // a save taken here must not vouch for bytes Memev did not write
  v = open(root);
  assert.deepEqual(v.imported, ['notes/live.md']);
  v.close(); fs.rmSync(root, { recursive: true, force: true });
});

const entityBody = (name) => `# ${name}\nProject: Alpha\nThe Big Service talks to \`cache-layer\` and [[Other Note]] #ops\n\n## Second\nSmall Words and Big Service again\n\n## Second\nA repeat heading with Third Thing\n\n## Plain\nnothing of note here at all\n`;

test('the restored graph is the graph a full read gives, after writes, appends, deletes and outside changes', () => {
  const root = fresh(); let v = open(root);
  for (let i = 0; i < 30; i++) v.write(ME, { path: `notes/g${i}.md`, body: entityBody(`Note Number${i}`) });
  v.append(ME, { path: 'notes/g3.md', text: '\n## Added Later\nFresh Entity Name here\n' });
  v.write(ME, { path: 'notes/g4.md', body: '# rewritten\nOnly Thing here\n' });
  v.delete(ME, { path: 'notes/g5.md' });
  v.close();
  fs.writeFileSync(path.join(root, 'notes/g6.md'), '# edited\nOutside Editor wrote this\n');
  fs.rmSync(path.join(root, 'notes/g7.md')); // no logged delete: rebuilt from the log, as before
  v = open(root); const restored = graphOf(v); v.close();
  assert.ok(restored.entities.length > 5);
  for (const f of ['notes.state', 'notes.journal']) fs.rmSync(path.join(root, '.memev', f), { force: true });
  v = open(root); const full = graphOf(v); v.close();
  assert.deepEqual(restored, full);
  // the control: a record that lies is taken at its word when its stat matches, so the comparison above can tell
  const f = path.join(root, '.memev', 'notes.state');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/"Big Service"/g, '"Wrong Name"'));
  v = open(root); const lied = graphOf(v); v.close();
  assert.notDeepEqual(lied, full);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a note that left while stopped leaves the restored graph', () => {
  for (const how of ['logged delete, then a hard kill', 'moved to the archive', 'replaced by a link']) {
    const root = fresh(); let v = open(root);
    v.write(ME, { path: 'notes/keep.md', body: '# keep\nKeep Entity here\n' });
    v.write(ME, { path: 'work/sessions/gone.md', body: '# gone\nGone Entity here\n' });
    v.close();
    v = open(root); assert.ok(v.graph.entities.has('gone-entity'), `${how}: the control, it starts in the graph`);
    const file = path.join(root, 'work/sessions/gone.md');
    if (how === 'logged delete, then a hard kill') { v.delete(ME, { path: 'work/sessions/gone.md' }); abandon(v); }
    else {
      v.close();
      if (how === 'moved to the archive') { fs.mkdirSync(path.join(root, 'work/archive/sessions'), { recursive: true }); fs.renameSync(file, path.join(root, 'work/archive/sessions/gone.md')); }
      else { const out = path.join(root, '..', `${path.basename(root)}-outside.md`); fs.writeFileSync(out, '# x\nOutside Entity here\n'); fs.rmSync(file); fs.symlinkSync(out, file); }
    }
    v = open(root);
    assert.equal(v.graph.entities.has('gone-entity'), false, how);
    assert.equal(v.graph.notesSections.has('work/sessions/gone.md'), false, how);
    assert.equal(v.graph.entities.has('outside-entity'), false, `${how}: a link is never followed`);
    assert.ok(v.graph.entities.has('keep-entity'), how);
    v.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a link in a folder on the way to a note is still refused on the fast path', () => {
  const root = fresh(); let v = open(root);
  v.write(ME, { path: 'notes/sub/n.md', body: '# n\nInside Entity here\n' }); v.close();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-outside-'));
  fs.writeFileSync(path.join(outside, 'n.md'), '# n\nOutside Entity here\n');
  fs.rmSync(path.join(root, 'notes/sub'), { recursive: true }); fs.symlinkSync(outside, path.join(root, 'notes/sub'));
  v = open(root);
  assert.equal(v.graph.entities.has('outside-entity'), false);
  assert.equal(fs.readFileSync(path.join(outside, 'n.md'), 'utf8'), '# n\nOutside Entity here\n', 'nothing was rebuilt through the link');
  v.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
});

test('a torn, garbled or missing state file only costs a read', () => {
  const root = fresh(); let v = open(root);
  v.write(ME, { path: 'notes/t.md', body: '# t\nTorn Entity here\n' }); v.close();
  v = open(root); const good = graphOf(v); v.append(ME, { path: 'notes/t.md', text: '\n## More\nNext Entity here\n' }); v.close();
  const j = path.join(root, '.memev', 'notes.journal');
  fs.writeFileSync(j, `${fs.readFileSync(j, 'utf8').slice(0, -20)}`); // a torn tail: the append's record is lost
  v = open(root); assert.ok(v.graph.entities.has('more-next-entity'), 'torn journal'); v.close();
  fs.writeFileSync(path.join(root, '.memev', 'notes.state'), 'not a state file at all\n'); fs.rmSync(j, { force: true });
  v = open(root); assert.ok(v.graph.entities.has('torn-entity'), 'garbled base'); v.close();
  assert.ok(good.entities.length);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the state files are private', () => {
  const root = fresh(); let v = open(root); v.write(ME, { path: 'notes/p.md', body: '# p\nPrivate Entity\n' }); v.close();
  v = open(root); v.append(ME, { path: 'notes/p.md', text: '\n## More\nOther Entity\n' }); v.close();
  if (process.platform !== 'win32') for (const f of ['notes.state', 'notes.journal']) assert.equal(fs.statSync(path.join(root, '.memev', f)).mode & 0o077, 0, f);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the journal folds on a worker and the next start sees the same records', async () => {
  const root = fresh(); let v = open(root);
  for (let i = 0; i < 40; i++) v.write(ME, { path: `notes/f${i}.md`, body: `# f${i}\nFold Entity${i} Name here\n` });
  v.notes.foldAt = () => 10; v.notes.flush();
  assert.ok(await until(() => !fs.existsSync(path.join(root, '.memev', 'notes.journal.old')) && !v.notes.folding), 'the fold ended');
  v.write(ME, { path: 'notes/after.md', body: '# after\nAfter Fold here\n' });
  v.close(); const live = graphOf(open(root));
  for (const f of ['notes.state', 'notes.journal']) fs.rmSync(path.join(root, '.memev', f), { force: true });
  const full = graphOf(open(root));
  assert.deepEqual(live, full); assert.ok(full.entities.some((e) => e[0] === 'after-fold'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('the real daemon runs the sweep behind its start and reports it', async () => {
  const root = fresh(); const file = settled(root, { ignoreCtime: true }); void file;
  const c = spawn(process.execPath, [path.join(PKG, 'src/server/main.mjs'), '--root', root, '--port', '47991'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; c.stderr.on('data', (d) => { err += d; });
  let saw; try { saw = await until(() => err.includes('sweep done'), 15000); } finally { c.kill('SIGTERM'); await new Promise((r) => c.once('exit', r)); }
  assert.ok(saw, `the sweep log line: ${err}`);
  fs.rmSync(root, { recursive: true, force: true });
});
