import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, OWNER, PKG } from './helpers/tmp.mjs';
import { sha256 } from '../src/engine/util.mjs';
import { command } from '../src/cli/compact.mjs';
import { Vault } from '../src/engine/vault.mjs';
import { git } from '../src/engine/git.mjs';
after(cleanup);

// Capture what a command writes to stdout.
async function capture(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  try { await fn(); } finally { console.log = orig; }
  return logs.join('\n');
}

const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('REV-024 AC01: memev compact --dry-run prints a size report measured from disk', async () => {
  const { root, v } = newVault();
  v.append(OWNER, { path: 'memory/notes.md', text: 'a note with some words\n' });
  v.append(OWNER, { path: `work/sessions/${day(0)}-test-s1.md`, text: 'session text\n' });
  v.close();
  const out = await capture(() => command('compact', [], { 'dry-run': true, json: true }, { root }));
  const rep = JSON.parse(out);
  assert.equal(rep.dryRun, true, 'a dry run is flagged');
  const b = rep.before;
  assert.equal(typeof b.oplog.bytes, 'number', 'op-log bytes');
  assert.equal(typeof b.oplog.segments, 'number', 'op-log segments');
  assert.equal(typeof b.journal.bytes, 'number', 'journal bytes');
  assert.equal(typeof b.journal.files, 'number', 'journal files');
  assert.equal(typeof b.index.bytes, 'number', 'index bytes');
  assert.equal(typeof b.git.bytes, 'number', 'git object bytes');
  assert.ok(b.oplog.bytes > 0, 'the op-log has bytes on disk');
  assert.ok(b.oplog.segments >= 1, 'the op-log has at least one segment');
  const human = await capture(() => command('compact', [], { 'dry-run': true }, { root }));
  for (const w of ['op-log', 'segments', 'journal', 'index', 'git']) assert.ok(human.includes(w), `the report names ${w}`);
});

test('REV-024 AC02: compact archives sealed op-log segments and the log still verifies and materializes every head', () => {
  const { root, v } = newVault({ segmentBytes: 512 });
  for (let i = 0; i < 60; i++) v.append(OWNER, { path: `memory/n${i}.md`, text: `note ${i} ${'x'.repeat(60)}\n` });
  const opsBefore = v.log.verify().ops;
  v.compact();
  const arch = path.join(root, '.memev', 'oplog', 'archive');
  assert.ok(fs.existsSync(arch), 'an archive folder is created');
  assert.ok(fs.readdirSync(arch).some((f) => f.endsWith('.jsonl')), 'sealed segments are moved into the archive');
  assert.equal(fs.readdirSync(path.join(root, '.memev', 'oplog')).filter((f) => f.endsWith('.jsonl')).length, 1, 'only the fresh active segment stays in the active log');
  const ver = v.log.verify();
  assert.equal(ver.ok, true, 'the log still verifies');
  assert.equal(ver.ops, opsBefore, 'no record is deleted');
  for (const [p, h] of v.log.heads) {
    if (h.deleted) continue;
    const c = v.materialize(p);
    assert.equal(sha256(c), h.ch, `every head still materializes: ${p}`);
  }
});

test('REV-024 AC03: journal retention moves old sessions out of the index into work/archive and get still reads them', () => {
  const { root, v } = newVault();
  const oldP = `work/sessions/${day(120)}-test-zebraquartz.md`;
  const newP = `work/sessions/${day(0)}-test-bluewhale.md`;
  fs.mkdirSync(path.join(root, 'work', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, oldP), `# Session zebraquartz\n\nzebraquartz is a rare mineral\n`);
  fs.writeFileSync(path.join(root, newP), `# Session bluewhale\n\nbluewhale is a large mammal\n`);
  v.recover();
  v.reindexAll();
  const before = v.recall(OWNER, { query: 'zebraquartz' });
  assert.ok(before.some((h) => h.path === oldP), 'recall returns the old session before compaction');
  v.compact();
  assert.ok(fs.existsSync(path.join(root, 'work', 'archive', 'sessions', path.basename(oldP))), 'the old session is moved into work/archive');
  assert.ok(!fs.existsSync(path.join(root, oldP)), 'the old session is no longer in work/sessions');
  assert.ok(fs.existsSync(path.join(root, newP)), 'the recent session stays in work/sessions');
  const after = v.recall(OWNER, { query: 'zebraquartz' });
  assert.ok(!after.some((h) => h.path === oldP), 'recall no longer returns the old session');
  const got = v.get(OWNER, oldP);
  assert.ok(got.body.includes('zebraquartz'), 'memev get still reads the retained session at its old path');
});

test('REV-024 AC04: after compaction the index and active log are smaller than before', () => {
  const { root, v } = newVault();
  fs.mkdirSync(path.join(root, 'work', 'sessions'), { recursive: true });
  for (let i = 1; i <= 365; i++) {
    const p = `work/sessions/${day(i)}-test-s${i}.md`;
    fs.writeFileSync(path.join(root, p), `# Session s${i}\n\nsynthetic session ${i} about the ${['river', 'mountain', 'harbor', 'forest'][i % 4]}\n`);
  }
  v.recover();
  v.reindexAll();
  const r = v.compact();
  assert.ok(r.before.index.bytes > r.after.index.bytes, `the index shrank (${r.before.index.bytes} -> ${r.after.index.bytes})`);
  assert.ok(r.before.oplog.activeBytes > r.after.oplog.activeBytes, `the active log shrank (${r.before.oplog.activeBytes} -> ${r.after.oplog.activeBytes})`);
});

test('REV-024 AC05: TROUBLESHOOTING documents memev compact', () => {
  const doc = fs.readFileSync(path.join(PKG, 'docs', 'TROUBLESHOOTING.md'), 'utf8');
  assert.ok(/memev\s+compact/.test(doc), 'the troubleshooting guide mentions memev compact');
  assert.ok(/dry.run/i.test(doc), 'it explains the dry run');
});

test('REV-024: compact refuses while the daemon runs, and the dry run does too, and neither changes the log', async () => {
  const { root, v } = newVault({ segmentBytes: 512 });
  for (let i = 0; i < 60; i++) v.append(OWNER, { path: `memory/n${i}.md`, text: `note ${i} ${'x'.repeat(60)}\n` });
  const oplogDir = path.join(root, '.memev', 'oplog');
  const readAll = () => ({
    manifest: fs.readFileSync(path.join(oplogDir, 'manifest.json'), 'utf8'),
    segs: fs.readdirSync(oplogDir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => fs.readFileSync(path.join(oplogDir, f), 'utf8')).join('|'),
  });
  const before = readAll();
  // Simulate a running daemon: daemon.json names a live pid (this process).
  fs.writeFileSync(path.join(root, '.memev', 'daemon.json'), JSON.stringify({ pid: process.pid, port: 7787, bind: '127.0.0.1', started: new Date().toISOString(), root }));
  try {
    let rc;
    const out1 = await capture(async () => { rc = await command('compact', [], {}, { root }); });
    assert.equal(rc, 1, 'compact refuses while the daemon runs');
    assert.ok(out1.includes('stopped vault') && out1.includes('memev stop'), `the refusal names the fix, got: ${out1}`);
    let dry;
    await capture(async () => { dry = await command('compact', [], { 'dry-run': true }, { root }); });
    assert.equal(dry, 1, 'the dry run refuses too');
  } finally {
    fs.rmSync(path.join(root, '.memev', 'daemon.json'), { force: true });
  }
  assert.deepEqual(readAll(), before, 'the manifest and segments are unchanged');
  v.close();
});

test('REV-024: journal retention moves the session files with git and commits the move, leaving the vault repo clean', () => {
  const { root, v } = newVault();
  fs.mkdirSync(path.join(root, 'work', 'sessions'), { recursive: true });
  const oldP = `work/sessions/${day(120)}-test-gitretained.md`;
  fs.writeFileSync(path.join(root, oldP), `# Session gitretained\n\ngitretained session text\n`);
  // Commit the session first so it is tracked in the vault's git repo.
  git(root, ['add', '-A', '--', oldP]);
  git(root, ['commit', '-q', '-m', 'test: add session']);
  v.recover();
  v.reindexAll();
  v.compact();
  const status = git(root, ['status', '--porcelain']).out;
  assert.equal(status, '', `the vault repo is clean after compaction, got: ${JSON.stringify(status)}`);
  const subjects = git(root, ['log', '--format=%s', '-n', '5']).out.split('\n');
  assert.ok(subjects.some((s) => /^memev: archive \d+ journal sessions$/.test(s)), `the move is committed, log: ${subjects.join(' | ')}`);
  assert.ok(fs.existsSync(path.join(root, 'work', 'archive', 'sessions', path.basename(oldP))), 'the file is in work/archive');
  const got = v.get(OWNER, oldP);
  assert.ok(got.body.includes('gitretained'), 'the retained session is still readable at its old path');
  v.close();
});
