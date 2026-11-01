// Issue 256: engine code that writes the vault with its own file calls never writes through a symbolic link. The bus refuses
// a write when a link is on the way from the vault root (its seats, log, pulse and lead record), the session-start lead mark
// skips it, and the sync neither writes the address record or the writers record through a link nor resolves a conflict
// whose path goes through one. The vaults run without git; the conflict case uses a plain git repository.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { markLeadAsked } from '../src/engine/bus.mjs';
import { publishAddressRecord, writerCheck, resolveConflicts, ADDRESS_FILE, WRITERS_DIR } from '../src/cli/sync.mjs';
import { git } from '../src/engine/git.mjs';
after(cleanup);

const skip = process.platform === 'win32' && 'symbolic links need privileges on Windows';
// a folder of its own for each case, outside the vault: a shared name beside the vault could meet another test's folder
const outsideDir = (root, name) => tmpdir(`outside-${name}-`);
const listing = (d) => fs.readdirSync(d).sort();
function busVault() {
  const { root, v } = newVault({ git: false });
  const host = v.devices.get(v.devices.hostId);
  const local = (client) => ({ identity: { scopes: ['read', 'write'], paths: ['**'] }, client, device: host, local: true });
  v.bus.send(local('codex'), { type: 'hello', body: 'hi', seat: 'codex@host' });
  return { root, v, host, local };
}
const relink = (target, at) => { fs.rmSync(at, { recursive: true, force: true }); fs.symlinkSync(target, at); };

test('issue 256: the bus refuses to write its seats, log, pulse or lead record through a link', { skip }, () => {
  { // a linked seats folder: a new seat is refused and nothing lands outside
    const { root, v, host } = busVault();
    const out = outsideDir(root, 'seats'); relink(out, path.join(root, 'bus', 'seats'));
    assert.throws(() => v.bus.register({ client: 'gemini', device: host }), (e) => e.code === 'bad_path');
    assert.deepEqual(listing(out), [], 'a seat file was written outside the vault');
    v.close();
  }
  { // a linked message log: a post is refused and the outside file is unchanged
    const { root, v, host, local } = busVault();
    const out = outsideDir(root, 'log'); const target = path.join(out, 'other.jsonl'); fs.writeFileSync(target, 'ORIGINAL\n');
    relink(target, path.join(root, 'bus', 'log', `${host.id}.jsonl`));
    assert.throws(() => v.bus.send(local('codex'), { type: 'status', body: 'through the link', seat: 'codex@host' }), (e) => e.code === 'bad_path');
    assert.equal(fs.readFileSync(target, 'utf8'), 'ORIGINAL\n', 'the bus appended to a file outside the vault');
    v.close();
  }
  { // a linked pulse folder: a heartbeat is refused and nothing lands outside
    const { root, v, local } = busVault();
    const out = outsideDir(root, 'pulse'); relink(out, path.join(root, 'bus', 'pulse'));
    assert.throws(() => v.bus.unread(local('codex'), { seat: 'codex@host' }), (e) => e.code === 'bad_path');
    assert.deepEqual(listing(out), [], 'a pulse file was written outside the vault');
    v.close();
  }
  { // a linked lead record: setting the lead is refused, the session-start mark skips it, and the outside file is unchanged
    const { root, v } = busVault();
    const out = outsideDir(root, 'op'); const target = path.join(out, 'op.json'); fs.writeFileSync(target, '{"seat":null}\n');
    relink(target, path.join(root, 'bus', 'operator.json'));
    assert.throws(() => v.bus.setOperator('codex@host'), (e) => e.code === 'bad_path');
    assert.doesNotThrow(() => markLeadAsked(root));
    assert.equal(fs.readFileSync(target, 'utf8'), '{"seat":null}\n', 'the lead record outside the vault was rewritten');
    v.close();
  }
});

test('issue 256: the sync writes neither the address record nor the writers record through a link', { skip }, () => {
  const { root, v } = newVault({ git: false });
  const out = outsideDir(root, 'sync'); const target = path.join(out, 'address.json'); fs.writeFileSync(target, 'ORIGINAL\n');
  fs.symlinkSync(target, path.join(root, ADDRESS_FILE));
  const r = publishAddressRecord(root, 'https://vault.example.invalid');
  assert.equal(r.committed, false); assert.ok(r.skipped, 'the address record was not reported as skipped');
  assert.equal(fs.readFileSync(target, 'utf8'), 'ORIGINAL\n', 'the address record was written outside the vault');
  const wout = outsideDir(root, 'writers'); fs.symlinkSync(wout, path.join(root, WRITERS_DIR));
  const w = writerCheck(v, { root });
  assert.ok(w.skipped, 'the writers record was not reported as skipped');
  assert.deepEqual(listing(wout), [], 'a writers record was written outside the vault');
  v.close();
});

test('issue 256: a conflict whose path goes through a link is not resolved, and nothing is written through it', { skip }, () => {
  const root = tmpdir('conflict-');
  const g = (...a) => { const r = git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a]); return r; };
  assert.ok(g('init', '-q', '-b', 'main').ok);
  fs.mkdirSync(path.join(root, 'notes')); fs.writeFileSync(path.join(root, 'notes', 'a.md'), 'base\n');
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 'other'); fs.writeFileSync(path.join(root, 'notes', 'a.md'), 'theirs\n'); g('commit', '-q', '-am', 'theirs');
  g('checkout', '-q', 'main'); fs.writeFileSync(path.join(root, 'notes', 'a.md'), 'ours\n'); g('commit', '-q', '-am', 'ours');
  assert.equal(g('merge', '-q', 'other').ok, false, 'the merge should conflict');
  const out = outsideDir(root, 'notes'); fs.writeFileSync(path.join(out, 'a.md'), 'OUTSIDE\n');
  fs.renameSync(path.join(root, 'notes'), path.join(root, 'notes-real')); fs.symlinkSync(out, path.join(root, 'notes'));
  const r = resolveConflicts(root, null, {});
  assert.equal(r.ok, false, 'a conflict through a link was resolved');
  assert.match(String(r.error), /symbolic link/);
  assert.deepEqual(listing(out), ['a.md'], 'a conflict copy was written outside the vault');
  assert.equal(fs.readFileSync(path.join(out, 'a.md'), 'utf8'), 'OUTSIDE\n', 'the note outside the vault was rewritten');
});
