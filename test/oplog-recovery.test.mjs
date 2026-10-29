// REV-003: op-log recovery keeps every good record. A torn or unreadable line in the middle of a
// segment must not end the log or delete the valid records after it; only a torn tail (a partial
// last line with no newline) is truncated, and only after the good prefix has been read.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OpLog, recordHash } from '../src/engine/oplog.mjs';
import { now } from '../src/engine/util.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

// A record that verifies against itself: the hash covers every field except the hash.
const rec = (seq, path, content) => {
  const r = { seq, ts: now(), type: 'put', path, agent: 't', client: null, data: { content }, prev: null };
  r.hash = recordHash(r);
  return r;
};
const lineOf = (r) => `${JSON.stringify(r)}\n`;
const segFile = (dir) => path.join(dir, 'seg-000001.jsonl');
const openLog = (dir) => new OpLog(dir, { fsync: false }).open();

test('REV-003 AC01: a torn line followed by valid records does not end the log', () => {
  const dir = tmpdir();
  let log = openLog(dir);
  const a = log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: 'one' } });
  log.close();
  // hand-built segment: good record, a torn line, then two more valid records
  fs.appendFileSync(segFile(dir), '{this is not json at all\n');
  const b = rec(2, 'b.md', 'two');
  const c = rec(3, 'c.md', 'three');
  fs.appendFileSync(segFile(dir), lineOf(b) + lineOf(c));
  const before = fs.statSync(segFile(dir)).size;
  log = openLog(dir);
  assert.equal(log.seq, 3, 'every valid record after the torn line is kept');
  assert.deepEqual([...log.iterate()].map((r) => r.seq), [1, 2, 3]);
  assert.equal(log.heads.get('b.md').seq, 2);
  assert.equal(log.heads.get('c.md').seq, 3);
  assert.equal(fs.statSync(segFile(dir)).size, before, 'nothing is truncated: the torn line and the records after it all stay');
  const v = log.verify();
  assert.equal(v.ops, 3, 'every kept record is counted');
  assert.deepEqual(v.errors, ['seg-000001.jsonl: unreadable record'], 'the only fault is the reported torn line, and no record is dropped');
  assert.ok(log.recovered.some((m) => /unreadable record/.test(m)), 'the bad line is reported');
  log.close();
});

test('REV-003 AC02: a trailing partial line with no newline is truncated and the records before it are intact', () => {
  const dir = tmpdir();
  let log = openLog(dir);
  log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: 'one' } });
  log.append({ type: 'put', path: 'b.md', agent: 't', data: { content: 'two' } });
  log.close();
  const torn = '{"seq":3,"type":"put","path":"c.md","data":{"cont';
  fs.appendFileSync(segFile(dir), torn);
  const before = fs.statSync(segFile(dir)).size;
  assert.ok(before > 0 && !fs.readFileSync(segFile(dir)).toString('utf8').endsWith('\n'));
  log = openLog(dir);
  assert.equal(log.seq, 2, 'the torn tail is not a record');
  assert.equal(fs.statSync(segFile(dir)).size, before - Buffer.byteLength(torn), 'only the trailing fragment is truncated');
  assert.equal(fs.readFileSync(segFile(dir)).toString('utf8').endsWith('\n'), true);
  assert.deepEqual([...log.iterate()].map((r) => r.seq), [1, 2]);
  assert.equal(log.heads.get('a.md').seq, 1);
  assert.equal(log.heads.get('b.md').seq, 2);
  assert.equal(log.verify().ok, true);
  // the log continues where the good prefix ended
  const d = log.append({ type: 'put', path: 'c.md', agent: 't', data: { content: 'three' } });
  assert.equal(d.seq, 3);
  assert.equal([...log.iterate()].length, 3);
  assert.equal(log.verify().ok, true);
  log.close();
});

test('REV-003 AC03: iterate() over a segment with an unreadable line yields the readable records and does not throw', () => {
  const dir = tmpdir();
  let log = openLog(dir);
  const a = log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: 'one' } });
  log.close();
  const bad = '{this line cannot be parsed';
  const b = rec(2, 'b.md', 'two');
  fs.appendFileSync(segFile(dir), bad + '\n' + lineOf(b));
  log = openLog(dir);
  let recs;
  assert.doesNotThrow(() => { recs = [...log.iterate()]; }, 'iterate does not throw on an unreadable line');
  assert.deepEqual(recs.map((r) => r.seq), [1, 2], 'the readable records are yielded');
  const v = log.verify();
  assert.equal(v.ok, false, 'verify() still flags the unreadable line');
  assert.ok(v.errors.some((e) => /unreadable record/.test(e)));
  assert.equal(v.ops, 2, 'verify counts the readable records only');
  log.close();
});

test('REV-003 AC04: append() checks the byte count writeSync returns and never records a short write as committed', () => {
  const dir = tmpdir();
  const log = openLog(dir);
  const real = fs.writeSync;
  let called = 0;
  fs.writeSync = (fd, data, ...rest) => {
    if (typeof data === 'string' && data.endsWith('\n') && data.includes('"seq"')) { called++; return Buffer.byteLength(data) - 1; }
    return real(fd, data, ...rest);
  };
  try {
    assert.throws(() => log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: 'one' } }), /short write/);
  } finally { fs.writeSync = real; }
  assert.equal(called, 1);
  assert.equal(log.seq, 0, 'the short write is not recorded');
  assert.equal(log.heads.size, 0);
  assert.equal(log.active.bytes, 0, 'the manifest does not count the short write');
  assert.equal(fs.statSync(segFile(dir)).size, 0, 'nothing is committed to the segment');
  // a full write still works after the failed one
  const ok = log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: 'one' } });
  assert.equal(ok.seq, 1);
  assert.equal(log.seq, 1);
  assert.equal(log.active.bytes, Buffer.byteLength(JSON.stringify(ok)) + 1);
  assert.equal(log.verify().ok, true);
  log.close();
});
