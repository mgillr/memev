// SPDX-License-Identifier: Apache-2.0
// PG-04.1 WP04-04: the operation envelope is reachable from the real write path. Appending to the op log builds the
// envelope of the record just written, on the default path, so the envelope code has a caller outside its own tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { OpLog, recordHash } from '../src/engine/oplog.mjs';
import * as engine from '../src/engine/index.mjs';
import { buildEnvelope, validateEnvelope, mergeContractHash } from '../src/engine/envelope.mjs';
import { LOCAL_MERGE_CONTRACT, envelopeToOplogRecord } from '../src/engine/envelope-adapters.mjs';
after(cleanup);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// every module reachable from `entry` by static imports of ./ files
function reachable(entry) {
  const seen = new Set(); const todo = [path.join(ROOT, entry)];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]/gm)) todo.push(path.resolve(path.dirname(file), m[1]));
    for (const m of text.matchAll(/^\s*import\s*['"](\.[^'"]+)['"]/gm)) todo.push(path.resolve(path.dirname(file), m[1]));
  }
  return seen;
}

test('envelope wired: the entry module reaches the envelope module through the op log, and exports the builder', () => {
  const graph = reachable('src/engine/index.mjs');
  for (const f of ['oplog.mjs', 'envelope-adapters.mjs', 'envelope.mjs']) assert.ok(graph.has(path.join(ROOT, 'src/engine', f)), `index.mjs reaches ${f}`);
  assert.equal(engine.buildEnvelope, buildEnvelope, 'the entry module exports the same builder');
  const oplog = fs.readFileSync(path.join(ROOT, 'src/engine/oplog.mjs'), 'utf8');
  assert.match(oplog, /from '\.\/envelope-adapters\.mjs'/, 'the op log imports the adapter');
  assert.match(oplog, /oplogRecordToEnvelope\(/, 'the append path calls it');
});

test('envelope wired: an append builds the envelope of the record it wrote, and that envelope converts back to the record', () => {
  const log = new OpLog(tmpdir(), { fsync: false, deviceId: 'dev-aaaa1111' }).open();
  assert.equal(log.lastEnvelope, null, 'nothing yet');
  const r1 = log.append({ type: 'put', path: 'notes/a.md', agent: 'agent-one', data: { content: 'one', ch: 'c1' } });
  const e1 = log.lastEnvelope;
  assert.deepEqual(validateEnvelope(e1), { ok: true, errors: [] });
  assert.equal(e1.op_id, `oplog:${r1.hash}`);
  assert.equal(e1.merge_contract_hash, mergeContractHash(LOCAL_MERGE_CONTRACT), 'the local merge contract is the default');
  assert.deepEqual(envelopeToOplogRecord(e1), r1);
  const r2 = log.append({ type: 'append', path: 'notes/a.md', agent: 'agent-one', data: { text: 'two', ch: 'c2' } });
  assert.deepEqual(log.lastEnvelope.deps, [e1.op_id], 'the envelope of the next record depends on the one before it');
  assert.deepEqual(envelopeToOplogRecord(log.lastEnvelope), r2);
  assert.equal(log.envelopeFailures, 0);
  log.close();
});

test('envelope wired: a write through the vault reaches the envelope', () => {
  const { v } = newVault();
  try {
    const before = v.log.seq;
    v.append(OWNER, { path: 'notes/wired.md', text: '# Wired\n\nbody\n', client: 'test-app' });
    assert.ok(v.log.seq > before);
    const env = v.log.lastEnvelope;
    assert.ok(env, 'the vault write left an envelope');
    assert.deepEqual(validateEnvelope(env), { ok: true, errors: [] });
    const rec = envelopeToOplogRecord(env);
    assert.equal(rec.seq, v.log.seq);
    assert.equal(rec.path, 'notes/wired.md');
    assert.equal(recordHash(rec), rec.hash);
    assert.equal(env.origin.node, v.host.id);
  } finally { v.close(); }
});

test('envelope wired: the record on disk is unchanged, and the envelope is not written to the log', () => {
  const dir = tmpdir();
  const log = new OpLog(dir, { fsync: false, deviceId: 'dev-aaaa1111' }).open();
  const rec = log.append({ type: 'put', path: 'a.md', agent: 't', data: { content: 'x' } });
  assert.deepEqual(Object.keys(rec), ['seq', 'ts', 'type', 'path', 'agent', 'client', 'data', 'prev', 'dev', 'hlc', 'hash'], 'the record keeps its shape');
  assert.equal(log.verify().ok, true);
  log.close();
  for (const f of fs.readdirSync(dir)) if (f.startsWith('seg-') || f === 'snapshot.json' || f === 'manifest.json') assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('memev-envelope'), `${f} holds no envelope`);
  const again = new OpLog(dir, { fsync: false, deviceId: 'dev-aaaa1111' }).open();
  assert.equal(again.lastEnvelope, null, 'an envelope belongs to the append that built it');
  again.close();
});

test('envelope wired: the merge contract is the log\'s own to set, and the envelope can be turned off', () => {
  const other = { strategy: 'other', mapping_version: 'm-2', policy: { a: 1 } };
  const log = new OpLog(tmpdir(), { fsync: false, deviceId: 'dev-aaaa1111', mergeContract: other }).open();
  log.append({ type: 'put', path: 'a.md', agent: 't', data: {} });
  assert.equal(log.lastEnvelope.merge_contract_hash, mergeContractHash(other));
  log.close();
  const off = new OpLog(tmpdir(), { fsync: false, envelopes: false }).open();
  off.append({ type: 'put', path: 'a.md', agent: 't', data: {} });
  assert.equal(off.lastEnvelope, null);
  assert.equal(off.envelopeFailures, 0);
  off.close();
});

test('envelope wired: a record that cannot be an envelope is still written, and the failure is counted', () => {
  const log = new OpLog(tmpdir(), { fsync: false, deviceId: 'dev-aaaa1111' }).open();
  const ok = log.append({ type: 'put', path: 'a.md', agent: 't', data: {} });
  const odd = log.append({ type: 'Odd Type', path: 'a.md', agent: 't', data: { n: 1 } });
  assert.equal(odd.seq, ok.seq + 1, 'the write is the authority and was not refused');
  assert.equal(log.lastEnvelope, null, 'no envelope for the record that cannot have one');
  assert.equal(log.envelopeFailures, 1);
  assert.match(log.lastEnvelopeError, /type/);
  const next = log.append({ type: 'put', path: 'a.md', agent: 't', data: {} });
  assert.ok(log.lastEnvelope && log.lastEnvelope.op_id === `oplog:${next.hash}`);
  assert.equal(log.verify().ok, true);
  assert.equal([...log.iterate()].length, 3);
  log.close();
});
