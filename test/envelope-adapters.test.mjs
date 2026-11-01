// SPDX-License-Identifier: Apache-2.0
// PG-04.1 WP04-03: the op-log record, the bus message and the project-store event convert to and from the operation
// envelope without loss. Each shape is taken from the real writer, so a change to a writer shows here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, newVault, cleanup } from './helpers/tmp.mjs';
import { OpLog, recordHash, compareRecords } from '../src/engine/oplog.mjs';
import { Bus } from '../src/engine/bus.mjs';
import { ProjectStore } from '../src/engine/project-store.mjs';
import {
  ENVELOPE_FIELDS, EnvelopeError, buildEnvelope, validateEnvelope, encodeEnvelope, decodeEnvelope, mergeContractHash,
  checkMergeContract, compareEnvelopes,
} from '../src/engine/envelope.mjs';
import {
  ADAPTER_SHAPES, LOCAL_MERGE_CONTRACT, shapeOfEnvelope,
  oplogRecordToEnvelope, envelopeToOplogRecord,
  busMessageToEnvelope, envelopeToBusMessage,
  projectEventToEnvelope, envelopeToProjectEvent,
} from '../src/engine/envelope-adapters.mjs';
after(cleanup);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/engine/envelope-adapters.mjs'), 'utf8');
const MC = { mergeContract: LOCAL_MERGE_CONTRACT };
const ID = { scopes: ['read', 'write'], paths: ['**'] };
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
// "without loss" is meant byte for byte: the text of the record, and so its hash, is the same after the round trip
const sameRecord = (back, rec) => { assert.deepEqual(back, rec); assert.equal(JSON.stringify(back), JSON.stringify(rec)); };
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof EnvelopeError && e.code === code, `expected ${code}`);

function opLogRecords() {
  const log = new OpLog(tmpdir(), { fsync: false, deviceId: 'dev-aaaa1111' }).open();
  const recs = [
    log.append({ type: 'put', path: 'notes/a.md', agent: 'agent-one', client: 'app-one', data: { content: 'one\n\u00e9\u4e16', ch: 'c1' } }),
    log.append({ type: 'append', path: 'notes/a.md', agent: 'agent-one', client: 'app-one', data: { text: 'two\n', ch: 'c2' } }),
    log.append({ type: 'put', path: 'notes/b with space.md', agent: 'external', client: 'importer', data: { content: 'x', ch: 'c3', external: true } }),
    log.append({ type: 'claim.status', agent: 'agent-two', data: { id: 'claim-1', from: 'open', to: 'held' } }),
    log.append({ type: 'delete', path: 'notes/a.md', agent: 'agent-one', data: {} }),
    log.append({ type: 'usage' }),
  ];
  assert.equal(log.verify().ok, true);
  log.close();
  return recs;
}

test('envelope adapters: every record of a real op log converts to an envelope and back without loss', () => {
  const recs = opLogRecords();
  for (const rec of recs) {
    const frozen = deepFreeze(structuredClone(rec));
    const env = oplogRecordToEnvelope(frozen, MC);
    assert.deepEqual(validateEnvelope(env), { ok: true, errors: [] });
    assert.equal(shapeOfEnvelope(env), 'oplog');
    const back = envelopeToOplogRecord(env);
    sameRecord(back, rec);
    assert.equal(recordHash(back), rec.hash, 'the record hash of the original still holds');
    // through the wire form as well: text, decode, record
    sameRecord(envelopeToOplogRecord(decodeEnvelope(encodeEnvelope(env))), rec);
    // the same record is the same envelope
    assert.deepEqual(oplogRecordToEnvelope(rec, MC), env);
  }
});

test('envelope adapters: an op-log record maps onto the fields of the envelope', () => {
  const [first, second, , , del] = opLogRecords();
  const e1 = oplogRecordToEnvelope(first, MC), e2 = oplogRecordToEnvelope(second, MC), e5 = oplogRecordToEnvelope(del, MC);
  assert.deepEqual(e1.origin, { identity: 'agent-one', node: 'dev-aaaa1111' });
  assert.equal(e1.hlc, first.hlc);
  assert.equal(e1.type, 'oplog.put');
  assert.equal(e1.op_id, `oplog:${first.hash}`);
  assert.deepEqual(e1.deps, []);
  assert.deepEqual(e2.deps, [e1.op_id], 'the previous record of the same note is a causal dependency');
  assert.deepEqual(e5.deps, [e2.op_id]);
  assert.equal(e1.object, e2.object, 'one note is one object');
  assert.match(e1.object, /^path:[0-9a-f]{64}$/);
  assert.equal(e1.project, null);
  assert.equal(e1.verification_status, 'none');
  assert.deepEqual(e1.authorisation, []);
  assert.equal(e1.contract_ref, null);
  assert.equal(e1.merge_contract_hash, mergeContractHash(LOCAL_MERGE_CONTRACT));
  assert.ok(!('extension' in e1));
});

test('envelope adapters: an op-log record written before the device and the clock stamp existed converts and back', () => {
  const rec = { seq: 3, ts: '2026-10-01T10:00:00.000Z', type: 'put', path: 'old.md', agent: null, client: null, data: { content: 'x' }, prev: null };
  rec.hash = recordHash(rec);
  const env = oplogRecordToEnvelope(rec, MC);
  assert.equal(env.hlc, `${String(Date.parse(rec.ts)).padStart(13, '0')}.0000`, 'the stamp the op log orders by when a record has none');
  assert.deepEqual(env.origin, { identity: 'unattributed', node: 'local' });
  sameRecord(envelopeToOplogRecord(env), rec);
  assert.ok(!('hlc' in envelopeToOplogRecord(env)) && !('dev' in envelopeToOplogRecord(env)), 'nothing is added to the record');
});

test('envelope adapters: every message of the real bus converts to an envelope and back without loss', () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.devices.hostId);
    const bus = new Bus({ root, devices: v.devices });
    bus.register({ client: 'my-app', device: host });
    bus.register({ client: 'other-app', device: host });
    const ctx = { identity: ID, client: 'other-app', device: host };
    bus.send(ctx, { to: 'all', type: 'status', body: 'hello \u00e9 \u4e16 and a "quote"' });
    bus.send(ctx, { to: 'my-app@host', type: 'task', body: 'do it', ref: 'task-77', project: 'proj-1' });
    bus.send(ctx, { to: 'my-app@host', type: 'ack', body: '', ref: 'abcd1234-1', release: true });
    const msgs = bus.all();
    assert.ok(msgs.length >= 3);
    for (const m of msgs) {
      const env = busMessageToEnvelope(deepFreeze(structuredClone(m)), MC);
      assert.deepEqual(validateEnvelope(env), { ok: true, errors: [] });
      assert.equal(shapeOfEnvelope(env), 'bus');
      sameRecord(envelopeToBusMessage(env), m);
      sameRecord(envelopeToBusMessage(decodeEnvelope(encodeEnvelope(env))), m);
      assert.deepEqual(env.origin, { identity: m.from, node: m.device });
      assert.equal(env.type, `bus.${m.type}`);
      assert.equal(env.op_id, `bus:${m.id}`);
      assert.equal(env.verification_status, 'none');
    }
    const task = busMessageToEnvelope(msgs.find((m) => m.type === 'task'), MC);
    assert.equal(task.project, 'proj-1');
    assert.equal(task.object, 'task-77');
  } finally { v.close(); }
});

test('envelope adapters: every event of a real project store converts to an envelope and back, a refused one too', () => {
  const root = tmpdir();
  const store = new ProjectStore(root, { id: 'proj-1', deviceId: 'dev-bbbb2222', fsync: false }).open();
  store.put('project', { name: 'Demo' }, { agent: 'agent-one', client: 'app-one', key: 'k-1' });
  store.put('task', { title: 'First' }, { agent: 'agent-one' });
  store.append({ type: 'task.event', entity: { kind: 'event', data: { type: 'note', text: 'seen' } } });
  assert.throws(() => store.append({ type: 'task.event', gen: 0, entity: { kind: 'event', data: { type: 'late' } } }), /stale_generation|older/);
  store.close();
  const lines = fs.readFileSync(path.join(root, '.memev', 'projects', 'proj-1', 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.some((r) => r.refused), 'the log holds a refused event');
  assert.ok(lines.length >= 4);
  for (const rec of lines) {
    const env = projectEventToEnvelope(deepFreeze(structuredClone(rec)), { ...MC, project: 'proj-1' });
    assert.deepEqual(validateEnvelope(env), { ok: true, errors: [] });
    assert.equal(shapeOfEnvelope(env), 'project_event');
    const back = envelopeToProjectEvent(env);
    sameRecord(back, rec);
    assert.equal(recordHash(back), rec.hash);
    sameRecord(envelopeToProjectEvent(decodeEnvelope(encodeEnvelope(env))), rec);
    assert.equal(env.project, 'proj-1');
    assert.equal(env.op_id, `store:${rec.id}`);
    assert.equal(env.type, `store.${rec.type}`);
    assert.equal(env.object, rec.entity?.id ?? null);
    assert.equal(env.hlc, rec.hlc);
  }
  // a store record holds no project id, so the caller says which project it came from; without it the project is null
  assert.equal(projectEventToEnvelope(lines[0], MC).project, null);
});

test('envelope adapters: the three shapes become one kind of record that the one order sorts', () => {
  const recs = opLogRecords();
  const ops = recs.map((r) => oplogRecordToEnvelope(r, MC));
  const msg = { id: 'abcd1234-1', dseq: 1, ts: new Date(Number(recs[2].hlc.slice(0, 13)) + 5).toISOString(), device: 'dev-cccc3333', from: 'my-app@host', operator: false, to: 'all', type: 'status', body: 'hi', ref: null, project: null };
  const bus = busMessageToEnvelope(msg, MC);
  const ev = projectEventToEnvelope({ seq: 1, ts: new Date().toISOString(), id: 'evt-0001', key: null, type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { title: 't' } }, agent: null, client: null, dev: 'dev-bbbb2222', hlc: `${String(Date.now() + 10_000).padStart(13, '0')}.0000`, gen: 0, redacted: false, hash: 'h' }, { ...MC, project: 'p1' });
  const all = [ev, bus, ...ops];
  const sorted = [...all].sort(compareEnvelopes);
  assert.deepEqual([...all].reverse().sort(compareEnvelopes), sorted, 'the same order from any input order');
  assert.equal(sorted.at(-1), ev);
  assert.ok(sorted.indexOf(bus) > sorted.indexOf(ops[2]), 'the order of the op log: the clock stamp first');
  for (const e of all) assert.deepEqual(Object.keys(e).filter((k) => !ENVELOPE_FIELDS.includes(k)), []);
  assert.deepEqual([...ADAPTER_SHAPES].sort(), ['bus', 'oplog', 'project_event']);
  // the log's own order is the order of the envelopes it converts to
  for (let i = 1; i < ops.length; i++) assert.equal(Math.sign(compareEnvelopes(ops[i - 1], ops[i])), Math.sign(compareRecords(recs[i - 1], recs[i])));
});

test('envelope adapters: the merge contract hash comes from the caller and is checked, never guessed', () => {
  const rec = opLogRecords()[0];
  throwsCode(() => oplogRecordToEnvelope(rec), 'bad_adapter_input');
  throwsCode(() => oplogRecordToEnvelope(rec, {}), 'bad_adapter_input');
  throwsCode(() => oplogRecordToEnvelope(rec, { mergeContractHash: 'not-a-hash' }), 'bad_adapter_input');
  const other = { strategy: 'other', mapping_version: 'm-2', policy: { a: 1 } };
  const a = oplogRecordToEnvelope(rec, { mergeContract: other });
  const b = oplogRecordToEnvelope(rec, { mergeContractHash: mergeContractHash(other) });
  assert.deepEqual(a, b);
  assert.equal(checkMergeContract(a, mergeContractHash(other)).ok, true);
  assert.equal(checkMergeContract(a, mergeContractHash(LOCAL_MERGE_CONTRACT)).signal, 'merge_contract_mismatch');
  assert.notEqual(a.content_hash, oplogRecordToEnvelope(rec, MC).content_hash);
  // the envelope keeps the hash it ran under when it is converted back and forth
  sameRecord(envelopeToOplogRecord(a), rec);
});

test('envelope adapters: an envelope that is not what the adapter wrote, or is of another shape, is refused and never half converted', () => {
  const [rec] = opLogRecords();
  const env = oplogRecordToEnvelope(rec, MC);
  const msg = { id: 'abcd1234-1', dseq: 1, ts: '2026-11-01T00:00:00.000Z', device: 'dev-cccc3333', from: 'my-app@host', operator: false, to: 'all', type: 'status', body: 'hi', ref: null, project: null };
  throwsCode(() => envelopeToBusMessage(env), 'wrong_shape');
  throwsCode(() => envelopeToProjectEvent(env), 'wrong_shape');
  throwsCode(() => envelopeToOplogRecord(busMessageToEnvelope(msg, MC)), 'wrong_shape');
  // an envelope of anyone else's: no adapter shape
  const foreign = JSON.parse(JSON.stringify(env)); delete foreign.content_hash; foreign.payload = { other: 1 };
  throwsCode(() => envelopeToOplogRecord({ ...foreign, content_hash: 'a'.repeat(64) }), 'bad_envelope');
  // a hand edit of a field is caught by the content hash
  throwsCode(() => envelopeToOplogRecord({ ...env, type: 'oplog.delete' }), 'bad_envelope');
  // a field of the envelope that no record can hold would be dropped on the way back, so it is refused
  const { schema: _s, content_hash: _c, ...fields } = env; void _s; void _c;
  for (const extra of [{ authorisation: [{ kind: 'role', ref: 'r-1' }] }, { contract_ref: 'policy-1' }, { extension: { x: 1 } }]) {
    throwsCode(() => envelopeToOplogRecord(buildEnvelope({ ...fields, ...extra })), 'lossy_conversion');
  }
  // an envelope whose mapped fields do not match its record is refused
  throwsCode(() => envelopeToOplogRecord(buildEnvelope({ ...fields, origin: { identity: 'someone-else', node: env.origin.node } })), 'lossy_conversion');
});

test('envelope adapters: a record that cannot be converted is refused with its reason, and the input is never changed', () => {
  const [rec] = opLogRecords();
  const bad = (r, code = 'bad_adapter_input') => throwsCode(() => oplogRecordToEnvelope(deepFreeze(structuredClone(r)), MC), code);
  bad({ ...rec, seq: undefined });
  bad({ ...rec, hash: undefined });
  bad({ ...rec, hash: 'short' });
  bad({ ...rec, ts: 'yesterday', hlc: undefined });
  bad({ ...rec, hlc: 'x' });
  bad({ ...rec, type: 'Bad Type' }, 'bad_envelope');
  bad({ ...rec, agent: 'a\u0000b' }, 'bad_envelope');
  bad(null);
  bad([rec]);
  bad('text');
  throwsCode(() => busMessageToEnvelope({ id: 'x y', dseq: 1, ts: '2026-11-01T00:00:00.000Z', device: 'd', from: 's', type: 'status' }, MC), 'bad_envelope');
  throwsCode(() => busMessageToEnvelope({ id: 'a-1', dseq: 1, ts: 'nope', device: 'd', from: 's', type: 'status' }, MC), 'bad_adapter_input');
  throwsCode(() => projectEventToEnvelope({ type: 'task.upserted' }, MC), 'bad_adapter_input');
  throwsCode(() => projectEventToEnvelope({ seq: 1, ts: '2026-11-01T00:00:00.000Z', id: 'evt-1', type: 'task.upserted', hash: 'h' }, { ...MC, project: 'has/slash' }), 'bad_adapter_input');
});

test('envelope adapters: the four kinds of the dispatch history stay apart, and no conversion promotes one', () => {
  const kinds = ['dispatch.requested', 'dispatch.accepted', 'execution.observed', 'outcome.verified'];
  const envs = kinds.map((type, i) => projectEventToEnvelope({ seq: i + 1, ts: '2026-11-01T00:00:00.000Z', id: `evt-${i}`, key: null, type, entity: { kind: 'event', id: `evt-${i}`, data: { type } }, agent: null, client: null, dev: 'dev-bbbb2222', hlc: `1793000000000.000${i}`, gen: i, redacted: false, hash: `h${i}` }, MC));
  assert.equal(new Set(envs.map((e) => e.type)).size, 4, 'four kinds, four types');
  for (const [i, e] of envs.entries()) {
    assert.equal(e.type, `store.${kinds[i]}`);
    assert.equal(e.verification_status, 'none', 'a record of the store is never recorded as observed or verified by its name alone');
    assert.equal(envelopeToProjectEvent(e).type, kinds[i]);
  }
});

test('envelope adapters: the adapters add no scope, no stream and no field of the envelope that is not on the list', () => {
  assert.ok(!/classification|per-scope|scope_stream/i.test(SOURCE));
  const rec = opLogRecords()[0];
  const env = oplogRecordToEnvelope(rec, MC);
  assert.deepEqual(Object.keys(env).sort(), ENVELOPE_FIELDS.filter((f) => f !== 'extension'));
  assert.deepEqual(Object.keys(env.payload).sort(), ['record_text', 'shape']);
});

test('envelope adapters: the module imports only the envelope module and a hash helper, and touches no file or network', () => {
  const imports = [...SOURCE.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['./envelope.mjs', './util.mjs']);
  assert.ok(!/\bfetch\s*\(|\bprocess\.|\bimport\s*\(|\brequire\s*\(|child_process/.test(SOURCE));
});
