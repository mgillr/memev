// A big vault's snapshot no longer stops the thread inside an append. The promise stays: after a snapshot taken while writes kept
// coming, after a hard kill at any step of it, and after a stop in the middle, a reopen gives the same heads as replaying the whole log.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OpLog } from '../src/engine/oplog.mjs';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
after(cleanup);

const opts = { fsync: false, snapshotEvery: 50, snapshotSliceAt: 10 };
const put = (log, p, c) => log.append({ type: 'put', path: p, agent: 't', data: { content: c, ch: c } });
const heads = (log) => Object.fromEntries([...log.heads].sort(([a], [b]) => (a < b ? -1 : 1)));
/** The whole log replayed, no snapshot: the oracle. */
function replayed(dir) {
  const copy = `${dir}-replay`; fs.rmSync(copy, { recursive: true, force: true }); fs.cpSync(dir, copy, { recursive: true });
  fs.rmSync(path.join(copy, 'snapshot.json'), { force: true });
  const log = new OpLog(copy, { fsync: false }).open(); const h = heads(log); log.close(); return h;
}

test('the append that reaches the snapshot count returns before the snapshot is written', async () => {
  const dir = path.join(tmpdir(), 'log'); const log = new OpLog(dir, opts).open();
  for (let i = 0; i < 49; i++) put(log, `n/${i}.md`, `c${i}`);
  assert.equal(fs.existsSync(log.snapshotPath), false);
  put(log, 'n/49.md', 'c49');
  assert.equal(fs.existsSync(log.snapshotPath), false, 'the append wrote the snapshot itself, on this thread');
  assert.ok(log.snapshotting, 'no snapshot is running');
  assert.equal(log.sinceSnapshot, 0);
  await log.snapshotting;
  const snap = JSON.parse(fs.readFileSync(log.snapshotPath, 'utf8'));
  assert.equal(snap.seq, 50); assert.equal(snap.version, 2); assert.equal(snap.heads.length, 50 * 5); // the flat form: path, seq, hash, content hash, deleted
  const flat = {}; for (let i = 0; i < snap.heads.length; i += 5) flat[snap.heads[i]] = snap.heads[i + 4] ? { seq: snap.heads[i + 1], hash: snap.heads[i + 2], deleted: true } : { seq: snap.heads[i + 1], hash: snap.heads[i + 2], ch: snap.heads[i + 3] };
  assert.deepEqual(Object.fromEntries(Object.entries(flat).sort(([a], [b]) => (a < b ? -1 : 1))), heads(log));
  log.close();
});

test('writes during the snapshot: the reopened log has the same heads as a full replay, and a broken replay is caught', async () => {
  const dir = path.join(tmpdir(), 'log'); const log = new OpLog(dir, { ...opts, snapshotEvery: 3000, snapshotSliceAt: 1000 }).open();
  for (let i = 0; i < 2999; i++) put(log, `n/${i}.md`, `c${i}`);
  put(log, 'n/x.md', 'first');
  const running = log.snapshotting; assert.ok(running);
  // change old paths, add new ones and delete some while it runs, between its slices
  let more = 0;
  while (log.snapshotting) { put(log, `n/${more % 2999}.md`, `again${more}`); put(log, `late/${more}.md`, 'late'); if (more % 7 === 0) log.append({ type: 'delete', path: `n/${more % 2999}.md`, agent: 't', data: {} }); more++; await new Promise((r) => setImmediate(r)); }
  assert.ok(more > 3, `only ${more} rounds landed inside the snapshot, so this tested little`);
  const want = heads(log); const seq = log.seq;
  // a crash now: no close, the snapshot that was written stays
  fs.closeSync(log.fd); log.fd = null;
  const snap = JSON.parse(fs.readFileSync(log.snapshotPath, 'utf8'));
  assert.ok(snap.seq < seq, 'the snapshot covers everything, so no replay was tested');
  // heads alone can hide a skipped record, as a later write to the same path puts the head right: the offset itself must be a record's end
  const seg = fs.readFileSync(path.join(dir, snap.active.name)); assert.equal(seg[snap.active.offset - 1], 10, 'the snapshot offset is not at the end of a record');
  const again = new OpLog(dir, { fsync: false }).open();
  assert.equal(again.seq, seq);
  assert.deepEqual(heads(again), want);
  assert.deepEqual(again.recovered, [], 'a replay from the snapshot met part of a record');
  again.close();
  assert.deepEqual(replayed(dir), want, 'a full replay differs from the live heads');
  // the comparison can fail: a snapshot that claims to cover more than it does loses the later records
  // Built from the snapshot taken before the reopen: with enough rounds in it, the reopen's own close writes one that covers everything, and this control would then prove nothing.
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const broken = { ...snap, active: { name: manifest.segments.at(-1).name, offset: manifest.segments.at(-1).bytes } };
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(broken));
  const bad = new OpLog(dir, { fsync: false }).open();
  assert.notDeepEqual(heads(bad), want);
  bad.close();
});

const KILLED = `
const { OpLog } = await import(${JSON.stringify(path.join(PKG, 'src/engine/oplog.mjs'))});
const fs = await import('node:fs');
const log = new OpLog(process.argv[1], { fsync: false, snapshotEvery: 1500, snapshotSliceAt: 100 }).open();
let i = log.seq;
const add = () => { const p = 'n/' + (i % 6000) + '.md'; log.append({ type: 'put', path: p, agent: 't', data: { content: 'c' + i, ch: 'c' + i } }); fs.writeSync(1, p + ' ' + i + (log.snapshotting ? ' amid' : '') + '\\n'); i++; };
if (!i) for (let k = 0; k < 6000; k++) add();
const go = () => { add(); setImmediate(go); };
go();`;
test('a hard kill at any point of a running snapshot loses no acknowledged record', async () => {
  const dir = path.join(tmpdir(), 'log');
  let total = 0, killedAmid = 0;
  for (let k = 0; k < 8; k++) {
    fs.rmSync(`${dir}/snapshot.json.slices.tmp`, { force: true });
    const c = spawn(process.execPath, ['--input-type=module', '-e', KILLED, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    // wait for a record written while a snapshot is running, then kill: the kill lands at a different step of it each time
    const t = Date.now(); while (!out.slice(-4000).includes(' amid') && Date.now() - t < 30000) await new Promise((r) => setTimeout(r, 1));
    c.kill('SIGKILL'); await new Promise((r) => c.on('close', r));
    if (fs.existsSync(`${dir}/snapshot.json.slices.tmp`)) killedAmid++;
    const lines = out.split('\n').filter((l) => l.endsWith('\n') || l.length); lines.pop(); assert.ok(lines.length > 100); // the last may be cut
    const log = new OpLog(dir, { fsync: false, snapshotEvery: 1500, snapshotSliceAt: 100 }).open();
    const last = new Map(); for (const l of lines) { const [p, n] = l.split(' '); last.set(p, Number(n)); }
    for (const [p, n] of last) { const h = log.heads.get(p); assert.ok(h && h.seq > n, `${p}: acknowledged record ${n} is not in the reopened heads`); assert.equal(h.ch.startsWith('c'), true); }
    assert.deepEqual(heads(log), replayed(dir));
    total += lines.length;
    log.close();
  }
  assert.ok(total > 1000, `only ${total} records`);
  assert.ok(killedAmid > 0, 'no kill landed inside a snapshot, so this proved nothing');
  console.log(`killed inside a snapshot in ${killedAmid} of 8 runs, ${total} acknowledged records`);
});

test('a stop during a running snapshot: the close snapshot stands or the older one replays, and both give the same heads', async () => {
  const dir = path.join(tmpdir(), 'log'); const log = new OpLog(dir, opts).open();
  for (let i = 0; i < 50; i++) put(log, `n/${i}.md`, `c${i}`);
  assert.ok(log.snapshotting);
  const want = heads(log); const seq = log.seq;
  const running = log.snapshotting;
  log.close();
  await running;
  const again = new OpLog(dir, opts).open();
  assert.equal(again.seq, seq); assert.deepEqual(heads(again), want);
  again.close();
});

test('a small log keeps the snapshot inside the append, as before', () => {
  const dir = path.join(tmpdir(), 'log'); const log = new OpLog(dir, { fsync: false, snapshotEvery: 5 }).open();
  for (let i = 0; i < 5; i++) put(log, `n/${i}.md`, 'c');
  assert.equal(JSON.parse(fs.readFileSync(log.snapshotPath, 'utf8')).seq, 5);
  log.close();
});
