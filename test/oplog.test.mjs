import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OpLog } from '../src/engine/oplog.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

test('appends, rolls, snapshots and replays with every record intact', () => {
  const dir = tmpdir();
  let log = new OpLog(dir, { segmentBytes: 4096, snapshotEvery: 50, fsync: false }).open();
  const written = [];
  for (let i = 0; i < 400; i++) written.push(log.append({ type: 'append', path: `n${i % 7}.md`, agent: 't', data: { text: `line ${i} ${'x'.repeat(i % 40)}\n` } }));
  assert.ok(log.stats().segments > 3, 'rolled into several segments');
  log.close();
  log = new OpLog(dir, { segmentBytes: 4096, fsync: false }).open();
  assert.equal(log.seq, 400);
  const back = [...log.iterate()];
  assert.equal(back.length, 400);
  assert.deepEqual(back.map((r) => r.hash), written.map((r) => r.hash));
  assert.deepEqual([...log.iterate({ path: 'n3.md' })].map((r) => r.seq), written.filter((r) => r.path === 'n3.md').map((r) => r.seq));
  assert.equal(log.verify().ok, true);
  log.close();
});

test('a torn last line from a crash is dropped and the log continues', () => {
  const dir = tmpdir();
  let log = new OpLog(dir, { fsync: false }).open();
  for (let i = 0; i < 5; i++) log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: `v${i}` } });
  log.close();
  const seg = path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith('seg-')));
  fs.appendFileSync(seg, '{"seq":6,"type":"put","pa');
  log = new OpLog(dir, { fsync: false }).open();
  assert.equal(log.seq, 5);
  log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: 'v5' } });
  assert.equal([...log.iterate()].length, 6);
  assert.equal(log.verify().ok, true);
  log.close();
});

test('verify catches an edited sealed segment', () => {
  const dir = tmpdir();
  const log = new OpLog(dir, { segmentBytes: 1024, fsync: false }).open();
  for (let i = 0; i < 60; i++) log.append({ type: 'append', path: 'a.md', agent: 't', data: { text: `entry ${i}\n` } });
  const first = path.join(dir, 'seg-000001.jsonl');
  const body = fs.readFileSync(first, 'utf8');
  fs.writeFileSync(first, body.replace('entry 3', 'entry X'));
  const v = log.verify();
  assert.equal(v.ok, false);
  assert.ok(v.errors.length > 0);
  log.close();
});
