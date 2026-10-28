// MEM-092: a sync merge the two computers could not join by itself is resolved where it is safe
// (a bus log keeps every message with unique ids, a conflicting note keeps both versions as
// separate whole files) and the operator card shows it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { syncOnce, readConflicts, recordConflicts } from '../src/cli/sync.mjs';
import { renderCard } from '../src/engine/card.mjs';
import { git } from '../src/engine/git.mjs';

after(cleanup);

// The other computer's clone commits as a plain test user, since it has no vault of its own.
const otherGit = (root, ...args) => git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args]);

// Two computers sharing one bare backup: the vault on `root` and a plain clone the other computer pushes from.
function twoComputers() {
  const { v, root } = newVault();
  const bare = tmpdir('remote-');
  const b = git(bare, ['init', '-q', '--bare', '-b', 'main']);
  assert.ok(b.ok, `bare init: ${b.err}`);
  git(root, ['remote', 'add', 'origin', bare]);
  const p = git(root, ['push', '-q', '-u', 'origin', 'main']);
  assert.ok(p.ok, `first push: ${p.err}`);
  const other = tmpdir('other-');
  const c = git(other, ['clone', '-q', bare, path.join(other, 'work')]);
  assert.ok(c.ok, `clone: ${c.err}`);
  return { v, root, other: path.join(other, 'work') };
}

// A bus message line, the shape the bus writes: the id is derived from the device and the dseq.
const line = (device, dseq, body) => JSON.stringify({ id: `${device.slice(0, 8)}-${dseq}`, device, dseq, ts: '2026-10-28T00:00:00Z', from: 'seat', to: 'all', type: 'status', body }) + '\n';

test('MEM-092 AC01: conflicting bus file auto-resolved, sync completes', () => {
  const { v, root, other } = twoComputers();
  const log = 'bus/log/dev_samedev0.jsonl';
  // one device id on two computers, as with a copied config: both append dseq 2 with different bodies
  fs.mkdirSync(path.join(root, 'bus', 'log'), { recursive: true });
  fs.writeFileSync(path.join(root, log), line('dev_samedev0', 1, 'first'));
  git(root, ['add', log]); git(root, ['commit', '-q', '-m', 'add bus log']);
  const p0 = git(root, ['push', '-q', 'origin', 'main']);
  assert.ok(p0.ok, `push: ${p0.err}`);
  const pl = otherGit(other, 'pull', '-q', 'origin', 'main');
  assert.ok(pl.ok, `other pull: ${pl.err}`);
  fs.appendFileSync(path.join(other, log), line('dev_samedev0', 2, 'from the other computer'));
  otherGit(other, 'add', log); otherGit(other, 'commit', '-q', '-m', 'other computer message');
  const p1 = otherGit(other, 'push', '-q', 'origin', 'main');
  assert.ok(p1.ok, `other push: ${p1.err}`);
  // this computer appends its own dseq 2 to the same device log
  fs.appendFileSync(path.join(root, log), line('dev_samedev0', 2, 'from this computer'));
  git(root, ['add', log]); git(root, ['commit', '-q', '-m', 'this computer message']);
  // the sync fetches the other computer's message, the merge conflicts, and the resolver keeps every message
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  assert.equal(res.pushed, true, 'the resolved merge is pushed');
  const rec = res.conflicts?.find((c) => c.path === log);
  assert.ok(rec, 'the bus file is recorded as a conflict');
  assert.equal(rec.renumbered?.length, 1, 'the duplicate dseq is renumbered and recorded');
  const msgs = fs.readFileSync(path.join(root, log), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(msgs.length, 3, `every message from both computers is kept: ${JSON.stringify(msgs)}`);
  for (const body of ['first', 'from the other computer', 'from this computer']) assert.ok(msgs.some((m) => m.body === body), `kept: ${body}`);
  const ids = msgs.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, `every message id is unique: ${ids.join(', ')}`);
  const dseqs = msgs.map((m) => m.dseq);
  for (let i = 1; i < dseqs.length; i++) assert.ok(dseqs[i] > dseqs[i - 1], `dseq strictly increases per device: ${dseqs.join(', ')}`);
  assert.ok(readConflicts(root)?.files?.includes(log), 'the conflict is in the sync job state');
  v.close();
});

test('MEM-092 AC02: conflicting note keeps both versions, operator card shows conflict', () => {
  const { v, root, other } = twoComputers();
  // a note outside memory/ and work/, so the union merge driver does not join it by itself
  const note = 'notes/test-note.md';
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, note), '# Note\n\nVersion A\n');
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'add note']);
  const p0 = git(root, ['push', '-q', 'origin', 'main']);
  assert.ok(p0.ok, `push: ${p0.err}`);
  const pl = otherGit(other, 'pull', '-q', 'origin', 'main');
  assert.ok(pl.ok, `other pull: ${pl.err}`);
  fs.writeFileSync(path.join(other, note), '# Note\n\nVersion B\n');
  otherGit(other, 'add', note); otherGit(other, 'commit', '-q', '-m', 'other version');
  const p1 = otherGit(other, 'push', '-q', 'origin', 'main');
  assert.ok(p1.ok, `other push: ${p1.err}`);
  // this computer rewrites the same note differently
  fs.writeFileSync(path.join(root, note), '# Note\n\nVersion C\n');
  git(root, ['add', note]); git(root, ['commit', '-q', '-m', 'this version']);
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  const rec = res.conflicts?.find((c) => c.path === note);
  assert.ok(rec, 'the note is recorded as a conflict');
  assert.ok(rec.copy, 'the record names the conflict copy');
  // this computer's version stays at the path, the other's is kept whole next to it, each exactly as committed
  assert.equal(fs.readFileSync(path.join(root, note), 'utf8'), '# Note\n\nVersion C\n', "this computer's version is kept at the path");
  assert.equal(fs.readFileSync(path.join(root, rec.copy), 'utf8'), '# Note\n\nVersion B\n', "the other computer's version is kept whole in the copy");
  for (const f of [note, rec.copy]) assert.ok(!/^(<<<<<<<|=======|>>>>>>>)/m.test(fs.readFileSync(path.join(root, f), 'utf8')), `no conflict markers left in ${f}`);
  // the operator card shows the conflict and names both files
  process.env.MEMEV_ROOT = root;
  try {
    const rendered = renderCard({ operator: true });
    assert.ok(rendered.includes('Sync conflicts'), 'the operator card shows the conflict');
    assert.ok(rendered.includes(note), 'the operator card names the note');
    assert.ok(rendered.includes(rec.copy), 'the operator card names the conflict copy');
  } finally { delete process.env.MEMEV_ROOT; }
  // a later, unrelated clean sync keeps the record while the conflict copy is still there
  otherGit(other, 'pull', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(other, 'notes', 'other.md'), 'x\n');
  otherGit(other, 'add', 'notes/other.md'); otherGit(other, 'commit', '-q', '-m', 'unrelated');
  const p2 = otherGit(other, 'push', '-q', 'origin', 'main');
  assert.ok(p2.ok, `push: ${p2.err}`);
  const res2 = syncOnce(v, { root });
  assert.equal(res2.error, null, `the clean sync completes: ${res2.error}`);
  assert.ok(readConflicts(root)?.files?.includes(note), 'a clean sync keeps the conflict record');
  v.close();
});

test('MEM-092 AC03: non-operator cards do not show conflict', () => {
  const { v, root } = twoComputers();
  recordConflicts(root, { at: new Date().toISOString(), files: ['notes/test-note.md'], conflicts: [{ path: 'notes/test-note.md', kind: 'note', how: 'kept both versions as separate files', copy: 'notes/test-note.conflict-2026-10-28.md' }] });
  assert.ok(readConflicts(root)?.files?.length, 'a conflict is on record');
  process.env.MEMEV_ROOT = root;
  try {
    const rendered = renderCard({ operator: false });
    assert.ok(!rendered.includes('Sync conflicts'), 'a non-operator card does not show the conflict');
    const bare = renderCard({});
    assert.ok(!bare.includes('Sync conflicts'), 'a card with no operator flag does not show it either');
  } finally { delete process.env.MEMEV_ROOT; }
  v.close();
});
