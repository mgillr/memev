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
      else { const out = path.join(root, '.memev', 'outside.md'); fs.writeFileSync(out, '# x\nOutside Entity here\n'); fs.rmSync(file); fs.symlinkSync(out, file); }
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

test('the journal folds on a worker, a crash in the fold replays cleanly, and the next start sees the same records', async () => {
  const root = fresh(); let v = open(root);
  for (let i = 0; i < 40; i++) v.write(ME, { path: `notes/f${i}.md`, body: `# f${i}\nFold Entity${i} Name here\n` });
  v.close(); v = open(root);
  for (let i = 0; i < 12; i++) v.append(ME, { path: 'notes/f1.md', text: `## Added ${i}\nsome Appended Thing and Other Name here\n` });
  const jf = path.join(root, '.memev', 'notes.journal'); v.notes.flush(); const lines = fs.readFileSync(jf, 'utf8');
  v.notes.foldAt = () => 10; v.write(ME, { path: 'notes/one.md', body: '# one\nOne More\n' }); v.notes.flush();
  assert.ok(await until(() => !fs.existsSync(`${jf}.old`) && !v.notes.folding), 'the fold ended');
  v.write(ME, { path: 'notes/after.md', body: '# after\nAfter Fold here\n' });
  v.close();
  const { readState } = await import('../src/engine/notestate.mjs'); const clean = readState(path.join(root, '.memev'));
  assert.ok(lines.includes('["a","notes/f1.md"'), 'the control: the journal holds appends, the lines a second replay could double');
  fs.writeFileSync(`${jf}.old`, `${lines.split('\n').filter((l) => /^\["[ea]"/.test(l)).join('\n')}\n`); // a crash after the fold's rename and before it removed the old journal: the same appends come again
  const onceMore = readState(path.join(root, '.memev')).recs.get('notes/f1.md');
  assert.ok(clean.recs.get('notes/f1.md').secs.length >= 12, 'the control: the appends are in the record');
  assert.ok(!onceMore || onceMore.secs.length === clean.recs.get('notes/f1.md').secs.length, 'appended sections are never doubled; at worst the record goes and the note is read');
  fs.rmSync(`${jf}.old`, { force: true });
  const live = graphOf(open(root));
  for (const f of ['notes.state', 'notes.journal']) fs.rmSync(path.join(root, '.memev', f), { force: true });
  const full = graphOf(open(root));
  assert.deepEqual(live, full); assert.ok(full.entities.some((e) => e[0] === 'after-fold'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('the real daemon runs the sweep behind its start and reports it', async () => {
  const root = fresh(); const file = settled(root, { ignoreCtime: true }); void file;
  const c = spawn(process.execPath, [path.join(PKG, 'src/server/main.mjs'), '--root', root, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; c.stderr.on('data', (d) => { err += d; });
  let saw; try { saw = await until(() => err.includes('sweep done'), 120000); } finally { c.kill('SIGTERM'); await new Promise((r) => c.once('exit', r)); }
  assert.ok(saw, `the sweep log line: ${err}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('memev start leaves a daemon that says it is loading, and stops one that says nothing', async () => {
  const { startDaemon, stopDaemon, loadingPid } = await import('../src/cli/daemon.mjs');
  const root = fresh();
  // named as the daemon is, because a pid in that file that is some other program is no daemon (see index-damage.test.mjs)
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-stub-')); fs.mkdirSync(path.join(stubDir, 'server'));
  const stub = (say) => (exe, args, o) => { const f = path.join(stubDir, 'server', 'main.mjs'); fs.writeFileSync(f, `${say ? `(await import('node:fs')).writeFileSync(${JSON.stringify(path.join(root, '.memev', 'daemon.loading'))}, JSON.stringify({ pid: process.pid }));` : ''} setTimeout(() => {}, 60000);`); return spawn(process.execPath, [f, '--root', root], { detached: true, stdio: 'ignore', env: o.env }); };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let child; const keep = (f) => (...a) => { child = f(...a); return child; };
  assert.equal(await startDaemon(root, { quiet: true, waitMs: 700, spawn: keep(stub(true)) }), false);
  await new Promise((r) => setTimeout(r, 500)); assert.ok(alive(child.pid), 'a loading daemon is left to finish'); assert.equal(loadingPid(root), child.pid);
  let spawned = 0; assert.equal(await startDaemon(root, { quiet: true, waitMs: 300, spawn: (...a) => { spawned++; return stub(false)(...a); } }), false); assert.equal(spawned, 0, 'no second daemon while one loads');
  await stopDaemon(root); assert.ok(await until(() => !alive(child.pid), 6000), 'memev stop reaches a daemon that is still loading');
  assert.equal(loadingPid(root), null);
  assert.equal(await startDaemon(root, { quiet: true, waitMs: 400, spawn: keep(stub(false)) }), false);
  assert.ok(await until(() => !alive(child.pid), 3000), 'the control: one that does not say so is stopped, as before');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a hard kill during the first import loses nothing and doubles nothing', async () => {
  const root = fresh(); const N = 3000;
  for (let i = 0; i < N; i++) { const d = path.join(root, 'notes', `d${i % 50}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `n${i}.md`), `# n${i}\nsome words about note ${i}\n${'filler words here '.repeat(150)}\n`); }
  const script = `import { Vault } from ${JSON.stringify(path.join(PKG, 'src/engine/vault.mjs'))}; new Vault(${JSON.stringify(root)}, { git: false }).open(); process.stdout.write('opened');`;
  const c = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  let opened = false; c.stdout.on('data', () => { opened = true; });
  const seg = path.join(root, '.memev/oplog/seg-000001.jsonl');
  // killed once the import is under way and not finished
  const started = await until(() => { try { return fs.statSync(seg).size > 2000; } catch { return false; } }, 60000);
  c.kill('SIGKILL'); await new Promise((r) => c.once('exit', r));
  assert.ok(started && !opened, 'the kill landed inside the import; otherwise this test proves nothing');
  const killedAt = fs.statSync(seg).size;
  const v = new Vault(root, { git: false }).open();
  const seen = new Map(); for (const rec of v.log.iterate()) if (rec.path?.startsWith('notes/')) seen.set(rec.path, (seen.get(rec.path) || 0) + 1);
  assert.equal(seen.size, N, 'every note is in the log'); assert.ok([...seen.values()].every((n) => n === 1), 'once each');
  assert.equal(v.log.verify().ok, true); assert.ok(fs.statSync(seg).size > killedAt);
  assert.equal(v.index.stats().notes >= N, true, 'and in recall');
  v.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('a close with nothing new writes nothing, and a snapshot of the old form still opens', () => {
  const root = fresh(); let v = open(root); v.write(ME, { path: 'notes/c.md', body: '# c\nClose Entity\n' }); v.close();
  v = open(root); v.close();
  const files = ['graph.json', 'oplog/manifest.json', 'notes.state'].map((f) => path.join(root, '.memev', f)); const times = () => files.map((f) => fs.statSync(f).mtimeMs);
  const before = times(); v = open(root); v.close(); assert.deepEqual(times(), before);
  // a few records after the last snapshot replay on open, heads included
  v = open(root); v.write(ME, { path: 'notes/d.md', body: '# d\nnew words\n' }); const head = v.log.heads.get('notes/d.md'); v.close();
  v = open(root); assert.deepEqual(v.log.heads.get('notes/d.md'), head); assert.equal(v.log.verify().ok, true); const seq = v.log.seq; v.close();
  // version 1 kept its heads as an object
  const snapF = path.join(root, '.memev/oplog/snapshot.json'); const heads = {}; v = open(root); for (const [p, h] of v.log.heads) heads[p] = h; const off = v.log.active.bytes; v.close();
  fs.writeFileSync(snapF, JSON.stringify({ version: 1, seq, hlc: null, active: { name: 'seg-000001.jsonl', offset: off }, heads }));
  v = open(root); assert.deepEqual(v.log.heads.get('notes/d.md'), head); assert.equal(v.log.seq, seq); v.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('converting an old index gives the same segment, byte for byte, as loading it whole', async () => {
  const { RecallIndex } = await import('../src/engine/index.mjs'); const { writeSeg, overlayDocs } = await import('../src/engine/segment.mjs'); const { convertOldIndex } = await import('../src/engine/segment-index.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-convert-')); const file = path.join(dir, 'index.jsonl'); const idx = new RecallIndex(file);
  for (let i = 0; i < 60; i++) idx.update(`notes/n${i % 40}.md`, `# Head ${i}\nProject: p${i % 3}\nwords about cache layer number ${i} and more ${i % 5}\n\n## Second\nreview-by: 2027-01-01\nother words here\n`, { mtime: '2026-01-01T00:00:00.000Z' });
  idx.dirty = true; idx.save();
  const whole = new RecallIndex(file); assert.equal(whole.load(), true); writeSeg(path.join(dir, 'a'), overlayDocs(whole));
  assert.equal(convertOldIndex(file, path.join(dir, 'b')), true);
  for (const f of fs.readdirSync(path.join(dir, 'a'))) assert.ok(fs.readFileSync(path.join(dir, 'a', f)).equals(fs.readFileSync(path.join(dir, 'b', f))), f);
  // the control: a changed line changes the result, and a file of another version or a broken one is refused, for a rebuild
  const text = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, text.replace('"len":', '"len":1'));
  assert.equal(convertOldIndex(file, path.join(dir, 'c')), true); assert.equal(fs.readFileSync(path.join(dir, 'a', 'cols.bin')).equals(fs.readFileSync(path.join(dir, 'c', 'cols.bin'))), false);
  fs.writeFileSync(file, text.replace('"version":3', '"version":2')); assert.equal(convertOldIndex(file, path.join(dir, 'd')), false);
  fs.writeFileSync(file, `${text.slice(0, -10)}\n`); assert.equal(convertOldIndex(file, path.join(dir, 'e')), false); assert.equal(fs.existsSync(path.join(dir, 'e')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a first run that indexes while it imports gives the recall a rebuild gives', () => {
  const root = fresh();
  for (let i = 0; i < 80; i++) { const d = path.join(root, 'notes', `d${i % 7}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `n${i}.md`), `# note ${i}\nProject: p${i % 3}\nwords cache layer ${i % 4} deploy Big Service\n\n## Second ${i}\nmore words retry queue ${i % 5}\n`); }
  const QS = ['cache layer', 'deploy', 'retry queue 3', 'second 40', 'big service', 'p1 words'];
  const answers = (v) => QS.map((q) => v.recall(ME, { query: q, log: false, limit: 10 }));
  let v = open(root); assert.ok(v.imported.length >= 80); const first = answers(v); const firstGraph = graphOf(v); v.close();
  const idx = path.join(root, '.memev'); for (const f of fs.readdirSync(idx)) if (/^(index|notes\.)/.test(f)) fs.rmSync(path.join(idx, f), { recursive: true, force: true });
  v = open(root); assert.equal(v.imported.length, 0); const rebuilt = answers(v); assert.deepEqual(first, rebuilt); assert.deepEqual(firstGraph, graphOf(v));
  assert.ok(first.some((a) => a.length)); v.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('the graph taken in behind the start reads the same as taken in at once, whichever reader or write comes first', () => {
  const root = fresh(); let v = open(root);
  for (let i = 0; i < 25; i++) v.write(ME, { path: `notes/c${i}.md`, body: entityBody(`Note Number${i}`) });
  v.close();
  const copy = `${root}-copy`; fs.cpSync(root, copy, { recursive: true });
  v = open(root); const eager = open(copy); eager.graph.finish();
  assert.ok(v.graph.pending.size > 0, 'the control: the work really is left for later');
  assert.equal(v.graph._entities.size, 0);
  const ns = (x) => x.graph.neighbours('big-service', 50);
  // recall on a graph not taken in yet, and on one part taken in, gives the same related names and finishes nothing
  const hits = (x) => x.recall(ME, { query: 'big service', log: false, limit: 10 }).map((h) => [h.path, h.heading, h.related]);
  const want = hits(eager); assert.ok(want.some((h) => h[2].length)); assert.deepEqual(hits(v), want); assert.ok(v.graph.pending.size > 0, 'recall made nothing finish');
  v.graph.step(0); assert.ok(v.graph.pending.size > 0); assert.deepEqual(hits(v), want);
  assert.deepEqual(ns(v), ns(eager)); assert.deepEqual(v.graph.stats(), eager.graph.stats()); assert.deepEqual(graphOf(v), graphOf(eager));
  v.close(); eager.close();
  // edits while waiting
  const a = open(root), b = open(copy); b.graph.finish();
  for (const x of [a, b]) { x.write(ME, { path: 'notes/c1.md', body: '# one\nBig Service and Other Thing here\n' }); x.delete(ME, { path: 'notes/c2.md' }); x.append(ME, { path: 'notes/c3.md', text: '\n## Extra\nBig Service with Other Thing\n' }); }
  assert.ok(a.graph.pending.size > 0);
  const sorted = (l) => [...l].sort((x, y) => (x.entity < y.entity ? -1 : 1));
  assert.deepEqual(sorted(ns(a)), sorted(ns(b))); assert.equal(a.graph.stats().co_occurrences, b.graph.stats().co_occurrences);
  // an append to a note still waiting joins it in its place, so one entity's list of sections can differ in order until the next start, which sorts them; the contents agree
  const bySet = (g) => ({ ...g, entities: g.entities.map((e) => [e[0], e[1], e[2], [...e[3]].sort()]) });
  assert.deepEqual(bySet(graphOf(a)), bySet(graphOf(b)));
  a.close(); b.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(copy, { recursive: true, force: true });
});

test('a segment built straight from notes is the segment the overlay would have written', async () => {
  const { RecallIndex } = await import('../src/engine/index.mjs'); const { writeSeg, overlayDocs } = await import('../src/engine/segment.mjs'); const { SegIndex } = await import('../src/engine/segment-index.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-build-')); const notes = []; for (let i = 0; i < 50; i++) notes.push([`notes/n${i}.md`, `# Head ${i}\nProject: P${i % 3}\nwords about cache layer ${i} and more ${i % 5}\n\n## Second\nreview-by: 2027-01-0${1 + (i % 9)}\nflags: a, b\nother words here\n`]);
  const idx = new RecallIndex(path.join(dir, 'x.jsonl')); for (const [p, b] of notes) idx.update(p, b); writeSeg(path.join(dir, 'a'), overlayDocs(idx));
  const seg = new SegIndex(path.join(dir, 'index.jsonl')); seg.buildFrom(notes);
  const built = path.join(dir, 'index.seg', 'gen-1'); for (const f of fs.readdirSync(path.join(dir, 'a'))) assert.ok(fs.readFileSync(path.join(dir, 'a', f)).equals(fs.readFileSync(path.join(built, f))), f);
  assert.ok(seg.query('cache layer', { limit: 3 }).length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
