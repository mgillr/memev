// SPDX-License-Identifier: Apache-2.0
// PG-04.1 WP04-02: the canonical operation envelope, version 1. One record shape with deterministic serialisation, a
// content hash that covers every field including the optional extension block, a wire-compatibility policy that is
// pinned by a fingerprint, and a hash of the merge contract that is refused on a mismatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENVELOPE_SCHEMA, ENVELOPE_FIELDS, VERIFICATION_STATUSES, DECODERS, EnvelopeError,
  canonicalize, buildEnvelope, validateEnvelope, encodeEnvelope, decodeEnvelope, contentHash,
  mergeContractHash, checkMergeContract, requireMergeContract, compareEnvelopes,
} from '../src/engine/envelope.mjs';
import { compareRecords } from '../src/engine/oplog.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/engine/envelope.mjs'), 'utf8');

// The pinned values below were computed outside the module, with a separate canonical-JSON writer, so a change to the
// module cannot move them by accident.
const PIN_MERGE_CONTRACT_HASH = 'cc830c58a00d6b2c1c67ea96d96e98f68e85f4d6e7cbc54dd986f2814b911c5d';
const PIN_CONTENT_HASH = '26b671f3399d84fcb74e0adf5abad4ac4090c6e1a56bdd83e85fbb9b8018652a';
const PIN_CONTENT_HASH_WITH_EXTENSION = '2858d8d0564f4893ac83dba0fda5e82c64339067dd20c0c8ef2b2b81d18cd512';
const PIN_FIELDS_FINGERPRINT = 'bfa0d253db251d903ba96317ca754420d447dd433486f9602e2f536d8a24566a';

const MERGE_CONTRACT = { strategy: 'last-writer', mapping_version: 'map-1', policy: { retain: '30d', max_depth: 3 } };
const FIXED = () => ({
  origin: { identity: 'person-01', node: 'node-01' },
  op_id: 'op-0001',
  deps: ['op-0000'],
  hlc: '1761990000000.0001',
  project: 'proj-1',
  object: 'task-1',
  type: 'dispatch.requested',
  payload: { resource: 'repo-1', n: 2, ok: true, note: 'h\u00e9llo', nothing: null },
  authorisation: [{ kind: 'role-binding', ref: 'rb-1' }],
  contract_ref: 'policy-1',
  merge_contract: MERGE_CONTRACT,
  verification_status: 'none',
});
const sha = (s) => import('node:crypto').then((c) => c.createHash('sha256').update(s).digest('hex'));

test('envelope compat v1: the pinned fingerprint of a fixed envelope does not change', () => {
  assert.equal(mergeContractHash(MERGE_CONTRACT), PIN_MERGE_CONTRACT_HASH);
  const env = buildEnvelope(FIXED());
  assert.equal(env.schema, 'memev-envelope/1');
  assert.equal(env.content_hash, PIN_CONTENT_HASH);
  assert.equal(contentHash(env), PIN_CONTENT_HASH);
  assert.deepEqual(validateEnvelope(env), { ok: true, errors: [] });
  const withExt = buildEnvelope({ ...FIXED(), extension: { z: [1, 2, { b: 1, a: 2 }], a: 'x' } });
  assert.equal(withExt.content_hash, PIN_CONTENT_HASH_WITH_EXTENSION);
});

test('envelope compat v1: the field list of version 1 does not change', async () => {
  assert.deepEqual([...ENVELOPE_FIELDS], [...ENVELOPE_FIELDS].sort());
  assert.equal(await sha(JSON.stringify(ENVELOPE_FIELDS)), PIN_FIELDS_FINGERPRINT);
  assert.ok(Object.isFrozen(ENVELOPE_FIELDS) && Object.isFrozen(DECODERS) && Object.isFrozen(VERIFICATION_STATUSES));
  // the nine fields of the contract are all there, as is the one optional block
  for (const f of ['origin', 'op_id', 'deps', 'project', 'object', 'type', 'payload', 'authorisation', 'contract_ref', 'content_hash', 'verification_status', 'extension']) assert.ok(ENVELOPE_FIELDS.includes(f), f);
});

test('envelope compat: a format change needs a new version and keeps the old decoder', () => {
  const env = buildEnvelope(FIXED());
  assert.deepEqual(Object.keys(DECODERS), [ENVELOPE_SCHEMA]);
  // a version nobody has registered is refused, never read as the nearest one
  const v2 = { ...env, schema: 'memev-envelope/2' };
  assert.throws(() => decodeEnvelope(JSON.stringify(v2)), (e) => e instanceof EnvelopeError && e.code === 'unsupported_version');
  assert.throws(() => decodeEnvelope(JSON.stringify({ ...env, schema: 'memev-envelope/1.1' })), (e) => e.code === 'unsupported_version');
  // a changed field set under the same version is refused too: it needs a new version
  assert.throws(() => decodeEnvelope(JSON.stringify({ ...env, brand_new: 1 })), (e) => e instanceof EnvelopeError && e.code === 'bad_envelope');
  // when a later version is added, the version 1 decoder stays and still reads a version 1 record to the same bytes
  const later = Object.freeze({ ...DECODERS, 'memev-envelope/2': (raw) => ({ ...raw, decoded_as: 2 }) });
  assert.equal(decodeEnvelope(encodeEnvelope(env), later).content_hash, PIN_CONTENT_HASH);
  assert.equal(encodeEnvelope(decodeEnvelope(encodeEnvelope(env), later)), encodeEnvelope(env));
  assert.equal(decodeEnvelope(JSON.stringify(v2), later).decoded_as, 2);
  // the version is a field of the hashed record, so the same content under another version is another hash
  assert.notEqual(contentHash(v2), contentHash(env));
});

test('envelope compat: the change log in docs/OPERATION-ENVELOPE.md lists every decodable version and the pinned fingerprint', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/OPERATION-ENVELOPE.md'), 'utf8');
  const log = doc.split(/^## Change log\s*$/m)[1] || '';
  assert.ok(log.length > 0, 'the page has a Change log section');
  for (const v of Object.keys(DECODERS)) assert.ok(log.includes(v), `${v} is in the change log`);
  assert.ok(doc.includes(PIN_CONTENT_HASH), 'the pinned fingerprint of the fixed envelope is on the page');
  assert.ok(doc.includes(PIN_FIELDS_FINGERPRINT), 'the fingerprint of the field list is on the page');
});

test('envelope merge contract: a mismatch is refused with a signal and never merged silently', () => {
  const local = mergeContractHash(MERGE_CONTRACT);
  const same = buildEnvelope(FIXED());
  assert.deepEqual(checkMergeContract(same, local), { ok: true });
  assert.equal(requireMergeContract(same, local), same);
  const other = mergeContractHash({ ...MERGE_CONTRACT, mapping_version: 'map-2' });
  const remote = buildEnvelope({ ...FIXED(), merge_contract: { ...MERGE_CONTRACT, mapping_version: 'map-2' } });
  const res = checkMergeContract(remote, local);
  assert.deepEqual(res, { ok: false, signal: 'merge_contract_mismatch', op_id: 'op-0001', expected: local, got: other });
  assert.throws(() => requireMergeContract(remote, local), (e) => {
    assert.ok(e instanceof EnvelopeError);
    assert.equal(e.code, 'merge_contract_mismatch');
    assert.deepEqual(e.signal, res);
    return true;
  });
  // an envelope with the hash removed, or edited by hand, is refused as well: no path reads it as "the same contract"
  const { merge_contract_hash: gone, ...bare } = remote; void gone;
  assert.equal(validateEnvelope(bare).ok, false);
  assert.equal(checkMergeContract(bare, local).ok, false);
  assert.equal(checkMergeContract({ ...same, merge_contract_hash: other }, local).ok, false);
  assert.equal(validateEnvelope({ ...same, merge_contract_hash: other }).ok, false, 'an edited hash no longer matches the content hash');
  assert.equal(checkMergeContract(same, 'not-a-hash').ok, false);
  assert.equal(checkMergeContract(same, undefined).ok, false);
});

test('envelope merge contract: the hash covers the strategy, the mapping version and the policy fields', () => {
  const base = mergeContractHash(MERGE_CONTRACT);
  assert.notEqual(mergeContractHash({ ...MERGE_CONTRACT, strategy: 'set-union' }), base);
  assert.notEqual(mergeContractHash({ ...MERGE_CONTRACT, mapping_version: 'map-2' }), base);
  assert.notEqual(mergeContractHash({ ...MERGE_CONTRACT, policy: { retain: '30d', max_depth: 4 } }), base);
  assert.notEqual(mergeContractHash({ ...MERGE_CONTRACT, policy: { retain: '30d' } }), base);
  // key order never matters
  assert.equal(mergeContractHash({ policy: { max_depth: 3, retain: '30d' }, mapping_version: 'map-1', strategy: 'last-writer' }), base);
  for (const bad of [null, {}, { strategy: '', mapping_version: 'm', policy: {} }, { strategy: 's', mapping_version: 'm' }, { strategy: 's', mapping_version: 'm', policy: [] }, { strategy: 's', mapping_version: 'm', policy: { x: undefined } }]) {
    assert.throws(() => mergeContractHash(bad), (e) => e instanceof EnvelopeError && e.code === 'bad_merge_contract', JSON.stringify(bad));
  }
});

test('envelope extension: an extension block round-trips unchanged and is covered by the content hash', () => {
  const ext = { z: [1, 2, { b: 1, a: 2 }], a: 'x', deep: { n: null, t: true, s: 'h\u00e9llo' } };
  const env = buildEnvelope({ ...FIXED(), extension: ext });
  assert.deepEqual(env.extension, ext);
  const back = decodeEnvelope(encodeEnvelope(env));
  assert.deepEqual(back.extension, ext, 'the block comes back unchanged');
  assert.equal(encodeEnvelope(back), encodeEnvelope(env), 'and to the same bytes');
  assert.equal(back.content_hash, env.content_hash);
  // covered by the hash: a changed, added or removed block moves it
  const plain = buildEnvelope(FIXED());
  assert.notEqual(env.content_hash, plain.content_hash);
  assert.notEqual(buildEnvelope({ ...FIXED(), extension: { ...ext, a: 'y' } }).content_hash, env.content_hash);
  assert.equal(buildEnvelope({ ...FIXED(), extension: { a: 'x', deep: ext.deep, z: ext.z } }).content_hash, env.content_hash, 'key order inside the block does not matter');
  // and an edit of the block that keeps the old hash is refused
  assert.equal(validateEnvelope({ ...env, extension: { ...ext, a: 'y' } }).ok, false);
  assert.equal(validateEnvelope({ ...plain, extension: ext }).ok, false);
  // an absent block is absent, not an empty object
  assert.ok(!('extension' in plain));
  assert.ok(!('extension' in decodeEnvelope(encodeEnvelope(plain))));
  // the block must be a plain JSON object
  for (const bad of [[], 'x', 7, null, { f() {} }, { u: undefined }, { n: NaN }, { i: Infinity }, { d: new Date(0) }, { m: new Map() }]) {
    assert.throws(() => buildEnvelope({ ...FIXED(), extension: bad }), (e) => e instanceof EnvelopeError && e.code === 'bad_envelope', String(bad));
  }
});

test('envelope extension: the module interprets no field of the extension block', () => {
  // names that other contracts give to their own fields pass through untouched and are never read
  const ext = { signature: 'sig', admission: { step: 1 }, scope: 'organisation', classification: 'internal', sequence: 7, rejected: false, hash: 'not-a-hash', schema: 'memev-envelope/9' };
  const env = buildEnvelope({ ...FIXED(), extension: ext });
  assert.deepEqual(decodeEnvelope(encodeEnvelope(env)).extension, ext);
  assert.deepEqual(validateEnvelope(env), { ok: true, errors: [] });
  // the same module source names none of those fields
  const code = SOURCE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['signature', 'admission', 'scope', 'classification', 'sequence', 'rejected']) assert.ok(!new RegExp(w, 'i').test(code), `the code does not name ${w}`);
});

test('envelope build: the serialisation is deterministic, whatever the key order', () => {
  const a = buildEnvelope(FIXED());
  const shuffled = Object.fromEntries(Object.entries(FIXED()).reverse());
  shuffled.payload = Object.fromEntries(Object.entries(shuffled.payload).reverse());
  const b = buildEnvelope(shuffled);
  assert.equal(encodeEnvelope(a), encodeEnvelope(b));
  assert.equal(a.content_hash, b.content_hash);
  const line = encodeEnvelope(a);
  assert.ok(!line.includes('\n') && !/[ \t]/.test(line.replace(/"(?:[^"\\]|\\.)*"/g, '')), 'one line, no whitespace outside strings');
  assert.deepEqual(Object.keys(JSON.parse(line)), [...Object.keys(JSON.parse(line))].sort(), 'top-level keys are sorted');
  assert.equal(canonicalize({ b: 1, a: [3, { d: 1, c: 2 }] }), '{"a":[3,{"c":2,"d":1}],"b":1}');
  assert.equal(canonicalize('\u00e9'), '"\u00e9"', 'text is written as UTF-8, not escaped');
  assert.equal(canonicalize({ '\ud83d\ude00': 1, '\uffff': 2 }), '{"\ud83d\ude00":1,"\uffff":2}', 'keys sort by UTF-16 code unit');
  for (const bad of [NaN, Infinity, undefined, () => 1, 1n, Symbol('s'), '\ud800', new Date(0), { a: undefined }, [undefined]]) {
    assert.throws(() => canonicalize(bad), (e) => e instanceof EnvelopeError && e.code === 'bad_envelope', String(bad));
  }
  const loop = {}; loop.self = loop;
  assert.throws(() => canonicalize(loop), (e) => e.code === 'bad_envelope');
  // the input is never changed
  const input = FIXED(); const copy = structuredClone(input);
  buildEnvelope(input);
  assert.deepEqual(input, copy);
});

test('envelope build: deps are sorted and de-duplicated, and a record never depends on itself', () => {
  const env = buildEnvelope({ ...FIXED(), deps: ['op-0003', 'op-0002', 'op-0003'] });
  assert.deepEqual(env.deps, ['op-0002', 'op-0003']);
  assert.throws(() => buildEnvelope({ ...FIXED(), deps: ['op-0001'] }), (e) => e.code === 'bad_envelope');
  assert.equal(validateEnvelope({ ...env, deps: ['op-0003', 'op-0002'] }).ok, false, 'unsorted deps are not canonical');
  assert.equal(validateEnvelope({ ...env, deps: ['op-0002', 'op-0002'] }).ok, false);
});

test('envelope validate: a missing, unknown or malformed field is refused with its name', () => {
  const env = buildEnvelope(FIXED());
  const errs = (e) => validateEnvelope(e).errors.join('|');
  for (const f of ENVELOPE_FIELDS.filter((x) => x !== 'extension')) {
    const { [f]: gone, ...rest } = env; void gone;
    const r = validateEnvelope(rest);
    assert.equal(r.ok, false, `without ${f}`);
    assert.match(r.errors.join('|'), new RegExp(f), `names ${f}`);
  }
  assert.match(errs({ ...env, extra: 1 }), /extra/);
  const bad = {
    origin: [{ identity: '', node: 'n' }, { identity: 'i' }, { identity: 'i', node: 'n', more: 1 }, 'x', null],
    op_id: ['', 'has space', 'x'.repeat(129), 7, null],
    hlc: ['1761990000000', '2026-11-01T00:00:00Z', 7, null],
    type: ['', 'Upper', 'a b', 7, null],
    project: ['has space', 7, ''],
    object: ['has space', 7, ''],
    authorisation: ['x', [{ kind: 'k' }], [{ kind: 'k', ref: 'r', more: 1 }], [{ kind: '', ref: 'r' }], null],
    contract_ref: ['', 7],
    merge_contract_hash: ['abc', 'Z'.repeat(64), 7, null],
    verification_status: ['done', '', 7, null],
    content_hash: ['abc', '0'.repeat(64), 7, null],
    payload: [[], 'x', 7],
    schema: ['memev-envelope/2', '', 7, null],
  };
  for (const [f, values] of Object.entries(bad)) for (const v of values) {
    const r = validateEnvelope({ ...env, [f]: v });
    assert.equal(r.ok, false, `${f} = ${JSON.stringify(v)}`);
    assert.match(r.errors.join('|'), new RegExp(f), `names ${f}`);
  }
  for (const notAnObject of [null, undefined, 'x', 7, [], true]) assert.equal(validateEnvelope(notAnObject).ok, false);
  assert.throws(() => buildEnvelope({ ...FIXED(), type: 'Not Valid' }), (e) => e instanceof EnvelopeError && e.code === 'bad_envelope' && /type/.test(e.message));
  // the nullable fields accept null, and a payload of null
  assert.equal(validateEnvelope(buildEnvelope({ ...FIXED(), project: null, object: null, contract_ref: null, payload: null })).ok, true);
  assert.throws(() => decodeEnvelope('{not json'), (e) => e instanceof EnvelopeError && e.code === 'bad_envelope');
  assert.throws(() => decodeEnvelope('[1]'), (e) => e.code === 'bad_envelope');
  assert.throws(() => decodeEnvelope({ ...env, content_hash: '0'.repeat(64) }), (e) => e.code === 'bad_envelope');
});

test('envelope verification status: only an outcome the record itself names can be verified', () => {
  assert.deepEqual([...VERIFICATION_STATUSES], ['none', 'observed', 'verified']);
  const make = (type, verification_status) => ({ ...FIXED(), type, verification_status });
  // the four kinds of the dispatch history keep apart: asked for, taken on, seen running, confirmed
  assert.equal(buildEnvelope(make('dispatch.requested', 'none')).verification_status, 'none');
  assert.equal(buildEnvelope(make('dispatch.accepted', 'none')).verification_status, 'none');
  assert.equal(buildEnvelope(make('execution.observed', 'observed')).verification_status, 'observed');
  assert.equal(buildEnvelope(make('outcome.verified', 'verified')).verification_status, 'verified');
  // a success-shaped record never claims more than its kind
  for (const [type, status] of [['dispatch.requested', 'observed'], ['dispatch.requested', 'verified'], ['dispatch.accepted', 'verified'], ['execution.observed', 'verified'], ['execution.observed', 'none'], ['outcome.verified', 'none'], ['outcome.verified', 'observed'], ['task.update', 'verified'], ['task.update', 'observed']]) {
    assert.throws(() => buildEnvelope(make(type, status)), (e) => e instanceof EnvelopeError && e.code === 'bad_envelope' && /verification_status/.test(e.message), `${type} as ${status}`);
  }
  // any other kind is not part of the four and stays unverified
  assert.equal(buildEnvelope(make('task.update', 'none')).verification_status, 'none');
  // the default is none
  const { verification_status: dropped, ...noStatus } = FIXED(); void dropped;
  assert.equal(buildEnvelope(noStatus).verification_status, 'none');
});

test('envelope order: the order is the op-log order, a clock stamp, then the node, then the id', () => {
  const mk = (hlc, node, op_id) => buildEnvelope({ ...FIXED(), hlc, op_id, deps: [], origin: { identity: 'person-01', node } });
  const list = [
    mk('1761990000000.0002', 'node-01', 'op-0001'),
    mk('1761990000000.0001', 'node-02', 'op-0002'),
    mk('1761990000000.0001', 'node-01', 'op-0003'),
    mk('1761990000001.0000', 'node-01', 'op-0004'),
    mk('1761990000000.0001', 'node-01', 'op-0000'),
  ];
  const sorted = [...list].sort(compareEnvelopes).map((e) => e.op_id);
  assert.deepEqual(sorted, ['op-0000', 'op-0003', 'op-0002', 'op-0001', 'op-0004']);
  assert.deepEqual([...list].reverse().sort(compareEnvelopes).map((e) => e.op_id), sorted, 'the same total order from any input order');
  assert.equal(compareEnvelopes(list[0], list[0]), 0);
  // the same clock-then-device rule the log applies to its own records
  for (const a of list) for (const b of list) {
    if (a.op_id === b.op_id) continue;
    const ra = { hlc: a.hlc, dev: a.origin.node, seq: 0 }, rb = { hlc: b.hlc, dev: b.origin.node, seq: 0 };
    if (compareRecords(ra, rb) !== 0) assert.equal(Math.sign(compareEnvelopes(a, b)), Math.sign(compareRecords(ra, rb)));
  }
  // the log's own sequence number stays local to a log: it is not a field of the envelope
  assert.ok(!ENVELOPE_FIELDS.includes('seq'));
});

test('envelope module: it reads no file, spawns nothing and opens no connection', () => {
  const imports = [...SOURCE.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['node:crypto']);
  assert.ok(!/\bfetch\s*\(|\bprocess\.|\bimport\s*\(|\brequire\s*\(/.test(SOURCE));
});
