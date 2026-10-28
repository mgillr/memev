// MEM-092: a sync merge the two computers could not join by itself is resolved where it is safe
// (a bus log keeps every message, a conflicting note keeps both versions) and the operator card shows it.
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

test('MEM-092 AC01: conflicting bus file auto-resolved, sync completes', () => {
  const { v, root, other } = twoComputers();
  const log = 'bus/log/host.jsonl';
  const line = (device, dseq, body) => JSON.stringify({ device, dseq, ts: '2026-10-28T00:00:00Z', from: 'seat', to: 'all', type: 'status', body }) + '\n';
  // both computers start from the same first message
  fs.mkdirSync(path.join(root, 'bus', 'log'), { recursive: true });
  fs.writeFileSync(path.join(root, log), line('host', 1, 'from host'));
  git(root, ['add', log]); git(root, ['commit', '-q', '-m', 'add bus log']);
  const p0 = git(root, ['push', '-q', 'origin', 'main']);
  assert.ok(p0.ok, `push: ${p0.err}`);
  // the other computer pulls, appends its message, and pushes
  const pl = otherGit(other, 'pull', '-q', 'origin', 'main');
  assert.ok(pl.ok, `other pull: ${pl.err}`);
  fs.appendFileSync(path.join(other, log), line('other', 1, 'from the other computer'));
  otherGit(other, 'add', log); otherGit(other, 'commit', '-q', '-m', 'other computer message');
  const p1 = otherGit(other, 'push', '-q', 'origin', 'main');
  assert.ok(p1.ok, `other push: ${p1.err}`);
  // this computer appends a different message to the same log
  fs.appendFileSync(path.join(root, log), line('host', 2, 'from this computer'));
  git(root, ['add', log]); git(root, ['commit', '-q', '-m', 'this computer message']);
  // the sync fetches the other computer's message, the merge conflicts, and the resolver keeps every line
  const res = syncOnce(v, { root });
  assert.equal(res.error, null, `sync should complete: ${res.error}`);
  assert.equal(res.pushed, true, 'the resolved merge is pushed');
  assert.ok(res.conflicts?.some((c) => c.path === log), 'the bus file is recorded as a conflict');
  const merged = fs.readFileSync(path.join(root, log), 'utf8').split('\n').filter(Boolean);
  assert.equal(merged.length, 3, `every message from both computers is kept: ${merged.join(' | ')}`);
  for (const body of ['from host', 'from the other computer', 'from this computer']) assert.ok(merged.some((l) => l.includes(body)), `kept: ${body}`);
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
  // the other computer pulls, rewrites the note, and pushes
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
  assert.ok(res.conflicts?.some((c) => c.path === note), 'the note is recorded as a conflict');
  const merged = fs.readFileSync(path.join(root, note), 'utf8');
  assert.ok(merged.includes('Version C'), 'this computer\'s version is kept');
  assert.ok(merged.includes('Version B'), 'the other computer\'s version is kept');
  assert.ok(merged.includes('both versions kept'), 'the note says both versions are kept');
  // the operator card shows the conflict from the sync job state
  process.env.MEMEV_ROOT = root;
  try {
    const rendered = renderCard({ operator: true });
    assert.ok(rendered.includes('Sync conflicts'), 'the operator card shows the conflict');
    assert.ok(rendered.includes(note), 'the operator card names the file');
  } finally { delete process.env.MEMEV_ROOT; }
  v.close();
});

test('MEM-092 AC03: non-operator cards do not show conflict', () => {
  const { v, root } = twoComputers();
  recordConflicts(root, { at: new Date().toISOString(), files: [{ path: 'notes/test-note.md', kind: 'note', how: 'kept both versions' }] });
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
