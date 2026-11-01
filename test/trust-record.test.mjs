// SPDX-License-Identifier: Apache-2.0
// PG-W-21A (WP21-01): the trust record, version 1. A grant and a revocation have a validator and a schema, and one pure
// function answers whether a subject is eligible for a purpose in a scope as of a stated time: it denies by default,
// delegation only narrows, and revocation cascades. Every choice is provisional (ADR 8 is proposed). Test names start
// with the id the contract's checks select on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG } from './helpers/tmp.mjs';

const MODULE = path.join(PKG, 'src', 'engine', 'federation', 'trust-record.mjs');
const SCHEMA_FILE = path.join(PKG, 'docs', 'schemas', 'trust-record-v1.json');

// The module does not exist on main, so it is loaded here and each test reports its own failure when it is missing.
let M = null; let loadError = null;
try { M = await import('../src/engine/federation/trust-record.mjs'); } catch (e) { loadError = e; }
const mod = () => { if (!M) throw new Error(`the trust record module does not load: ${loadError?.message}`); return M; };
const validate = (r) => mod().validateTrustRecord(r);
const evaluate = (req, ctx) => mod().evaluate(req, ctx);

const SCHEMA = 'memev-trust/1';
const ROOT = 'person:r1';
const SCOPE = { type: 'team', id: 't1' };
const START = '2026-01-10T00:00:00Z';
const EXPIRES = '2026-02-10T00:00:00Z';
const AT = '2026-01-20T00:00:00Z';
const grant = (o = {}) => ({ schema: SCHEMA, kind: 'grant', id: 'g1', subject: 'device:d1', issuer: ROOT, scope: { ...SCOPE }, purposes: ['contribute'], start: START, expires: EXPIRES, ...o });
const revocation = (o = {}) => ({ schema: SCHEMA, kind: 'revocation', id: 'v1', grant: 'g1', issuer: ROOT, time: '2026-01-25T00:00:00Z', reason: 'error', ...o });
const ask = (o = {}) => ({ subject: 'device:d1', scope: { ...SCOPE }, purpose: 'contribute', ...o });
const ctx = (records, o = {}) => ({ records, roots: [ROOT], at: AT, ...o });
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };
const deepFreeze = (x) => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(deepFreeze); } return x; };
const errorsOf = (r) => { const v = validate(r); assert.equal(v.ok, false, `expected a refusal: ${JSON.stringify(r)}`); assert.ok(Array.isArray(v.errors) && v.errors.length > 0); return v.errors; };
const names = (r, re) => assert.ok(errorsOf(r).some((e) => re.test(e)), `no error matching ${re} in ${JSON.stringify(errorsOf(r))}`);

// A root grants a depth 2 delegation to an operator, who delegates to a device.
const parentGrant = (o = {}) => grant({ id: 'p', subject: 'operator:o1', purposes: ['contribute', 'verify'], delegation: { depth: 2 }, ...o });
const childGrant = (o = {}) => grant({ id: 'c', subject: 'device:d1', issuer: 'operator:o1', delegation: { depth: 1, parent: 'p' }, ...o });

// ---- AC01: the validator

test('PG-W-21A AC01: the validator accepts a grant, a delegated grant and a revocation', () => {
  assert.deepEqual(validate(grant()), { ok: true, errors: [] });
  assert.equal(validate(grant({ evidence: ['a', 'b'], delegation: { depth: 0 } })).ok, true);
  assert.equal(validate(childGrant()).ok, true);
  assert.equal(validate(revocation()).ok, true);
  for (const reason of ['compromised', 'left', 'error', 'other']) assert.equal(validate(revocation({ reason })).ok, true, reason);
  for (const t of ['person', 'agent', 'device', 'node', 'operator', 'service']) assert.equal(validate(grant({ subject: `${t}:x1`, issuer: `${t}:y1` })).ok, true, t);
  assert.equal(validate(grant({ purposes: ['contribute', 'verify'] })).ok, true);
  assert.equal(validate(grant({ evidence: Array.from({ length: 8 }, () => 'e') })).ok, true, 'eight references are the limit');
  assert.equal(validate(grant({ evidence: ['x'.repeat(128)] })).ok, true, '128 characters are the limit');
});

test('PG-W-21A AC01: the validator refuses a record that is not an object, has no known schema or has no known kind, naming the field', () => {
  for (const bad of [null, 7, 'grant', [], undefined]) assert.equal(validate(bad).ok, false);
  names(grant({ schema: 'memev-trust/2' }), /schema/);
  names(without(grant(), 'schema'), /schema/);
  names(grant({ kind: 'delete' }), /kind/);
  names(without(grant(), 'kind'), /kind/);
  for (const f of ['id', 'subject', 'issuer', 'scope', 'purposes', 'start', 'expires']) names(without(grant(), f), new RegExp(`^${f}`));
  for (const f of ['id', 'grant', 'issuer', 'time', 'reason']) names(without(revocation(), f), new RegExp(`^${f}`));
  names(grant({ id: 'has space' }), /^id/);
  names(grant({ start: 'yesterday' }), /^start/);
  names(revocation({ time: '2026-13-45' }), /^time/);
});

test('PG-W-21A AC01: the validator refuses each of these naming the field', () => {
  names(grant({ colour: 'red' }), /unknown field.*colour/);
  names(revocation({ colour: 'red' }), /unknown field.*colour/);
  names(grant({ delegation: { depth: 1, extra: 1 } }), /unknown field.*extra/);
  names(revocation({ purposes: ['contribute'] }), /unknown field.*purposes/); // a grant field is not a revocation field
  names(grant({ grant: 'g0' }), /unknown field.*grant/);
  names(grant({ subject: 'robot:r1' }), /^subject/);
  names(grant({ subject: 'device' }), /^subject/);
  names(grant({ issuer: 'robot:r1' }), /^issuer/);
  names(revocation({ issuer: 'nobody' }), /^issuer/);
  names(grant({ scope: { type: 'personal', id: 'personal' } }), /^scope.*personal/);
  names(grant({ scope: { type: 'personal', id: 'p1' } }), /^scope.*personal/);
  names(grant({ scope: { id: 's1' } }), /^scope.*type/);
  names(grant({ scope: { type: 'galaxy', id: 's1' } }), /^scope.*type/);
  names(grant({ scope: { type: 'team' } }), /^scope.*id/);
  names(grant({ scope: 'team:t1' }), /^scope/);
  names(grant({ purposes: [] }), /^purposes/);
  names(grant({ purposes: 'contribute' }), /^purposes/);
  names(grant({ purposes: ['admin'] }), /^purposes/);
  names(grant({ purposes: ['contribute', 'read'] }), /^purposes/);
  names(without(grant(), 'expires'), /^expires/);
  names(grant({ expires: null }), /^expires/);
  names(grant({ expires: START }), /^expires.*after/);
  names(grant({ expires: '2026-01-09T00:00:00Z' }), /^expires.*after/);
  names(grant({ evidence: Array.from({ length: 9 }, () => 'e') }), /^evidence.*8/);
  names(grant({ evidence: ['x'.repeat(129)] }), /^evidence.*128/);
  names(grant({ evidence: [7] }), /^evidence/);
  names(grant({ evidence: 'a note' }), /^evidence/);
  names(grant({ delegation: { depth: -1 } }), /^delegation\.depth/);
  names(grant({ delegation: { depth: 1.5 } }), /^delegation\.depth/);
  names(grant({ delegation: { depth: '1' } }), /^delegation\.depth/);
  names(grant({ delegation: {} }), /^delegation\.depth/);
  names(grant({ delegation: { depth: 1, parent: 'no space' } }), /^delegation\.parent/);
  names(grant({ delegation: 2 }), /^delegation/);
  names(revocation({ reason: 'bored' }), /^reason/);
  names(revocation({ grant: '' }), /^grant/);
});

// ---- AC02: deny by default

test('PG-W-21A AC02: evaluation denies by default, each with its rule id', () => {
  const denies = (res, rule) => { assert.equal(res.eligible, false); assert.equal(res.rule, rule); assert.equal(typeof res.reason, 'string'); assert.ok(res.reason.length > 0); assert.ok(Array.isArray(res.chain)); };
  denies(evaluate(ask(), ctx([])), 'deny.no_records');
  denies(evaluate(ask(), ctx([grant()], { roots: [] })), 'deny.no_roots');
  denies(evaluate(ask(), ctx([grant({ issuer: 'person:stranger' })])), 'deny.untrusted_issuer');
  denies(evaluate(ask(), ctx([grant({ issuer: 'person:stranger', delegation: { depth: 0 } })])), 'deny.untrusted_issuer');
  denies(evaluate(ask({ purpose: 'verify' }), ctx([grant()])), 'deny.purpose_not_granted');
  denies(evaluate(ask({ scope: { type: 'team', id: 't2' } }), ctx([grant()])), 'deny.scope_not_granted');
  denies(evaluate(ask({ scope: { type: 'project', id: 't1' } }), ctx([grant()])), 'deny.scope_not_granted');
  denies(evaluate(ask(), ctx([grant()], { at: '2026-01-09T23:59:59Z' })), 'deny.not_yet_valid');
  denies(evaluate(ask(), ctx([grant()], { at: EXPIRES })), 'deny.expired');
  denies(evaluate(ask(), ctx([grant()], { at: '2027-01-01T00:00:00Z' })), 'deny.expired');
  for (const t of ['person', 'agent', 'device', 'node', 'operator', 'service']) denies(evaluate(ask({ subject: `${t}:nobody` }), ctx([grant()])), 'deny.no_grant');
});

test('PG-W-21A AC02: a subject that holds a grant is the only one it makes eligible, and a root is only what the caller passes', () => {
  assert.equal(evaluate(ask({ subject: 'device:d2' }), ctx([grant()])).rule, 'deny.no_grant');
  assert.equal(evaluate(ask({ subject: ROOT }), ctx([grant()])).eligible, false, 'a root is not eligible for itself');
  assert.equal(evaluate(ask({ subject: 'device:d1' }), ctx([grant()], { roots: ['person:r2'] })).rule, 'deny.untrusted_issuer', 'no default root');
  assert.equal(evaluate(ask(), ctx([grant()], { roots: ['person:r2', ROOT] })).eligible, true);
  // records that fail the validator are never honoured, and do not stop a valid one
  const broken = [without(grant({ id: 'b1' }), 'expires'), grant({ id: 'b2', purposes: ['admin'] }), null, 7, 'x', { kind: 'grant' }];
  assert.equal(evaluate(ask(), ctx(broken)).eligible, false);
  assert.equal(evaluate(ask(), ctx([...broken, grant()])).eligible, true);
  // two grants with one id are ambiguous and neither is honoured
  assert.equal(evaluate(ask(), ctx([grant(), grant({ purposes: ['verify'] })])).eligible, false);
});

test('PG-W-21A AC02: evaluation denies an invalid request with deny.bad_request', () => {
  const bad = (req, ...rest) => { const c = rest.length ? rest[0] : ctx([grant()]); const r = evaluate(req, c); assert.equal(r.eligible, false); assert.equal(r.rule, 'deny.bad_request', JSON.stringify(req)); };
  bad(null); bad(undefined); bad(7); bad('device:d1');
  bad(ask({ subject: 'robot:r1' })); bad(ask({ subject: undefined })); bad(ask({ subject: 5 }));
  bad(ask({ scope: undefined })); bad(ask({ scope: { id: 't1' } })); bad(ask({ scope: { type: 'galaxy', id: 't1' } }));
  bad(ask({ scope: { type: 'personal', id: 'personal' } }), ctx([grant({ scope: { type: 'personal', id: 'personal' } })])); // never shared
  bad(ask({ purpose: 'admin' })); bad(ask({ purpose: undefined })); bad(ask({ purpose: ['contribute'] }));
  bad(ask(), { roots: [ROOT], at: AT }); bad(ask(), { records: [grant()], at: AT }); bad(ask(), ctx([grant()], { roots: [7] })); bad(ask(), ctx([grant()], { roots: ['nobody'] }));
  bad(ask(), ctx([grant()], { at: 'tomorrow' })); bad(ask(), null); bad(ask(), 'now'); bad(ask(), []);
});

test('PG-W-21A AC02: evaluation allows one root-issued grant for its purpose, scope and live window, with the grant id in the chain', () => {
  const r = evaluate(ask(), ctx([grant()]));
  assert.equal(r.eligible, true); assert.equal(r.rule, 'allow.grant'); assert.deepEqual(r.chain, ['g1']);
  assert.equal(typeof r.reason, 'string');
  assert.equal(evaluate(ask(), ctx([grant()], { at: START })).eligible, true, 'live at the start');
  assert.equal(evaluate(ask(), ctx([grant()], { at: '2026-02-09T23:59:59Z' })).eligible, true, 'live just before the expiry');
  assert.equal(evaluate(ask({ purpose: 'verify' }), ctx([grant({ purposes: ['contribute', 'verify'] })])).eligible, true);
  assert.equal(evaluate(ask(), ctx([grant({ id: 'g0', purposes: ['verify'] }), grant({ id: 'g2', purposes: ['contribute'] })])).chain.join(), 'g2', 'the grant that fits is the one named');
  assert.equal(evaluate(ask(), ctx([grant({ start: '2026-01-10T01:00:00+01:00' })], { at: '2026-01-10T00:00:00Z' })).eligible, true, 'times compare as instants');
});

// ---- AC03: delegation only narrows

test('PG-W-21A AC03: a narrowing child of a live parent is eligible with both grant ids in the chain', () => {
  const r = evaluate(ask(), ctx([parentGrant(), childGrant()]));
  assert.equal(r.eligible, true); assert.equal(r.rule, 'allow.grant'); assert.deepEqual(r.chain, ['p', 'c']);
  const mid = grant({ id: 'm', subject: 'node:n1', issuer: 'operator:o1', delegation: { depth: 1, parent: 'p' } });
  const leaf = grant({ id: 'l', subject: 'service:s1', issuer: 'node:n1', delegation: { depth: 0, parent: 'm' } });
  const two = evaluate(ask({ subject: 'service:s1' }), ctx([parentGrant(), mid, leaf]));
  assert.equal(two.eligible, true); assert.deepEqual(two.chain, ['p', 'm', 'l']);
  assert.equal(evaluate(ask(), ctx([parentGrant(), childGrant({ purposes: ['contribute', 'verify'], expires: EXPIRES })])).eligible, true, 'the same purposes and the same expiry still narrow');
  assert.equal(evaluate(ask({ subject: 'operator:o1' }), ctx([parentGrant(), childGrant()])).eligible, true, 'the parent holder is eligible itself');
});

test('PG-W-21A AC03: a child that is wider than its parent is not honoured, with a rule naming the chain', () => {
  const only = (parentOver, childOver, rule, req = ask()) => {
    const r = evaluate(req, ctx([parentGrant(parentOver), childGrant(childOver)]));
    assert.equal(r.eligible, false, rule); assert.equal(r.rule, rule); assert.match(r.rule, /^deny\.chain\./);
    assert.ok(r.chain.includes('c'), 'the chain names the child');
  };
  only({ purposes: ['contribute'] }, { purposes: ['contribute', 'verify'] }, 'deny.chain.purposes');
  only({ purposes: ['contribute'] }, { purposes: ['verify'] }, 'deny.chain.purposes', ask({ purpose: 'verify' }));
  only({}, { scope: { type: 'team', id: 't2' } }, 'deny.chain.scope', ask({ scope: { type: 'team', id: 't2' } }));
  only({}, { scope: { type: 'project', id: 't1' } }, 'deny.chain.scope', ask({ scope: { type: 'project', id: 't1' } }));
  only({}, { expires: '2026-02-11T00:00:00Z' }, 'deny.chain.expiry');
  only({ delegation: { depth: 1 } }, { delegation: { depth: 1, parent: 'p' } }, 'deny.chain.depth');
  only({ delegation: { depth: 1 } }, { delegation: { depth: 2, parent: 'p' } }, 'deny.chain.depth');
  only({ delegation: { depth: 0 } }, { delegation: { depth: 0, parent: 'p' } }, 'deny.chain.parent_depth_zero');
  only({ delegation: { depth: 0 } }, { delegation: { depth: 5, parent: 'p' } }, 'deny.chain.parent_depth_zero');
  const noBlock = evaluate(ask(), ctx([without(parentGrant(), 'delegation'), childGrant()]));
  assert.equal(noBlock.eligible, false); assert.equal(noBlock.rule, 'deny.chain.parent_depth_zero', 'no delegation block is depth 0');
  // a wider child does not hide another valid grant of the same subject
  assert.equal(evaluate(ask(), ctx([parentGrant({ purposes: ['contribute'] }), childGrant({ purposes: ['contribute', 'verify'] }), grant({ id: 'own' })])).eligible, true);
});

test('PG-W-21A AC03: a child with no usable parent is not honoured and a chain cannot loop', () => {
  const rule = (records, req = ask(), o = {}) => { const r = evaluate(req, ctx(records, o)); assert.equal(r.eligible, false); return r.rule; };
  assert.equal(rule([childGrant()]), 'deny.chain.parent_missing');
  assert.equal(rule([parentGrant({ subject: 'operator:o2' }), childGrant()]), 'deny.chain.parent_not_issuer');
  assert.equal(rule([grant({ id: 'x', issuer: 'operator:o1', delegation: { depth: 1 } })]), 'deny.untrusted_issuer', 'a non-root issuer must name its parent');
  assert.equal(rule([grant({ id: 'self', issuer: 'device:d1', delegation: { depth: 3, parent: 'self' } })]), 'deny.chain.depth', 'a grant that names itself');
  assert.equal(rule([grant({ id: 'a', subject: 'device:d1', issuer: 'device:d2', delegation: { depth: 2, parent: 'b' } }), grant({ id: 'b', subject: 'device:d2', issuer: 'device:d1', delegation: { depth: 2, parent: 'a' } })]), 'deny.chain.depth', 'a cycle');
  // a child that starts before its parent is not honoured, whether the time asked is before or after the parent's start
  const early = [parentGrant({ start: '2026-01-15T00:00:00Z' }), childGrant({ start: '2026-01-10T00:00:00Z' })];
  assert.equal(rule(early, ask(), { at: '2026-01-12T00:00:00Z' }), 'deny.chain.start', 'asked before the parent starts');
  assert.equal(rule(early), 'deny.chain.start', 'asked after the parent has started');
  assert.equal(evaluate(ask(), ctx([parentGrant({ start: '2026-01-15T00:00:00Z' }), childGrant({ start: '2026-01-15T00:00:00Z' })])).eligible, true, 'the same start narrows');
  assert.equal(evaluate(ask(), ctx([parentGrant({ start: '2026-01-15T00:00:00Z' }), childGrant({ start: '2026-01-16T00:00:00Z' })])).eligible, true, 'a later start narrows');
  // a grant with no delegation block has depth 0: it cannot delegate, and a non-root issuer with no block holds no authority
  const plain = (o) => grant({ id: 'plain', subject: 'operator:o1', purposes: ['contribute', 'verify'], ...o });
  assert.equal(rule([without(plain({ id: 'p' }), 'delegation'), childGrant()]), 'deny.chain.parent_depth_zero', 'a parent with no delegation block cannot delegate');
  assert.equal(rule([without(grant({ issuer: 'operator:o1' }), 'delegation')]), 'deny.untrusted_issuer', 'a non-root issuer with no delegation block');
  assert.equal(rule([without(grant({ issuer: 'operator:o1' }), 'delegation'), without(plain({ id: 'p' }), 'delegation')]), 'deny.untrusted_issuer', 'a holder of a grant with no block does not make its grants honoured');
  assert.equal(evaluate(ask(), ctx([without(grant(), 'delegation')])).eligible, true, 'a root-issued grant needs no delegation block');
  // a grant that is not issued by a root and whose parent is itself not issued by a root or a live delegator is refused
  assert.equal(rule([parentGrant({ issuer: 'person:stranger' }), childGrant()]), 'deny.untrusted_issuer');
});

// ---- AC04: revocation is as-of and cascades

test('PG-W-21A AC04: a revoked grant is eligible before the revocation and ineligible at it and after', () => {
  const recs = [grant(), revocation()];
  assert.equal(evaluate(ask(), ctx(recs, { at: '2026-01-24T23:59:59Z' })).eligible, true);
  const at = evaluate(ask(), ctx(recs, { at: '2026-01-25T00:00:00Z' }));
  assert.equal(at.eligible, false); assert.equal(at.rule, 'deny.revoked');
  assert.equal(evaluate(ask(), ctx(recs, { at: '2026-02-01T00:00:00Z' })).rule, 'deny.revoked');
  assert.equal(evaluate(ask(), ctx(recs, { at: '2026-01-12T00:00:00Z' })).eligible, true, 'an earlier evaluation is unchanged');
  assert.equal(evaluate(ask(), ctx(recs.slice().reverse(), { at: '2026-02-01T00:00:00Z' })).rule, 'deny.revoked', 'record order does not matter');
  assert.equal(evaluate(ask(), ctx([grant(), revocation({ grant: 'g9' })], { at: '2026-02-01T00:00:00Z' })).eligible, true, 'a revocation of another grant is not this one');
  for (const reason of ['compromised', 'left', 'error', 'other']) assert.equal(evaluate(ask(), ctx([grant(), revocation({ reason })], { at: '2026-02-01T00:00:00Z' })).rule, 'deny.revoked');
});

test('PG-W-21A AC04: revoking a parent makes its child ineligible and revoking a child leaves the parent eligible', () => {
  const later = { at: '2026-02-01T00:00:00Z' };
  const parentRevoked = [parentGrant(), childGrant(), revocation({ id: 'v2', grant: 'p' })];
  const child = evaluate(ask(), ctx(parentRevoked, later));
  assert.equal(child.eligible, false); assert.equal(child.rule, 'deny.chain.parent_revoked');
  assert.equal(evaluate(ask(), ctx(parentRevoked, { at: '2026-01-24T00:00:00Z' })).eligible, true, 'before the revocation the child is eligible');
  assert.equal(evaluate(ask({ subject: 'operator:o1' }), ctx(parentRevoked, later)).rule, 'deny.revoked');
  const childRevoked = [parentGrant(), childGrant(), revocation({ id: 'v2', grant: 'c', issuer: 'operator:o1' })];
  assert.equal(evaluate(ask(), ctx(childRevoked, later)).rule, 'deny.revoked');
  assert.equal(evaluate(ask({ subject: 'operator:o1' }), ctx(childRevoked, later)).eligible, true, 'the parent stays eligible');
  // the cascade reaches a grandchild
  const g3 = [parentGrant(), grant({ id: 'm', subject: 'node:n1', issuer: 'operator:o1', delegation: { depth: 1, parent: 'p' } }), grant({ id: 'l', subject: 'service:s1', issuer: 'node:n1', delegation: { depth: 0, parent: 'm' } })];
  assert.equal(evaluate(ask({ subject: 'service:s1' }), ctx(g3, later)).eligible, true);
  assert.equal(evaluate(ask({ subject: 'service:s1' }), ctx([...g3, revocation({ id: 'v3', grant: 'p' })], later)).eligible, false);
});

test('PG-W-21A AC04: a revocation by a subject that is not the issuer of the grant or a root is not applied', () => {
  const later = { at: '2026-02-01T00:00:00Z' };
  assert.equal(evaluate(ask(), ctx([grant(), revocation({ issuer: 'person:stranger' })], later)).eligible, true, 'a stranger');
  assert.equal(evaluate(ask(), ctx([grant(), revocation({ issuer: 'device:d1' })], later)).eligible, true, 'the subject itself');
  assert.equal(evaluate(ask(), ctx([grant(), revocation({ issuer: 'person:r2' })], later)).eligible, true, 'a person who is not in the roots');
  assert.equal(evaluate(ask(), ctx([grant(), revocation({ issuer: 'person:r2' })], { ...later, roots: [ROOT, 'person:r2'] })).rule, 'deny.revoked', 'a second root');
  assert.equal(evaluate(ask(), ctx([parentGrant(), childGrant(), revocation({ grant: 'c', issuer: 'operator:o1' })], later)).rule, 'deny.revoked', 'the issuer of a delegated grant');
  assert.equal(evaluate(ask(), ctx([parentGrant(), childGrant(), revocation({ grant: 'c', issuer: ROOT })], later)).rule, 'deny.revoked', 'a root revokes a delegated grant');
  assert.equal(evaluate(ask(), ctx([parentGrant(), childGrant(), revocation({ grant: 'c', issuer: 'operator:o2' })], later)).eligible, true, 'an operator that did not issue it');
  assert.equal(evaluate(ask(), ctx([grant(), revocation({ reason: 'bored' })], later)).eligible, true, 'a record that fails the validator is not applied');
});

// ---- AC05: the evaluation is pure

test('PG-W-21A AC05: with frozen records, roots and request it does not throw and returns an equal result on a second call', () => {
  const records = deepFreeze([parentGrant(), childGrant(), revocation({ id: 'v2', grant: 'zz' }), grant({ id: 'g1', subject: 'device:d9' })]);
  const roots = deepFreeze([ROOT]); const request = deepFreeze(ask()); const c = deepFreeze({ records, roots, at: AT });
  const before = JSON.stringify([records, roots, request, c]);
  const a = evaluate(request, c); const b = evaluate(request, c);
  assert.deepEqual(a, b); assert.equal(a.eligible, true);
  assert.equal(JSON.stringify([records, roots, request, c]), before, 'the inputs are unchanged');
  const denied = evaluate(deepFreeze(ask({ subject: 'device:none' })), c);
  assert.deepEqual(denied, evaluate(ask({ subject: 'device:none' }), c));
  assert.doesNotThrow(() => validate(deepFreeze(grant())));
  assert.notEqual(a, b, 'a fresh result each call');
  a.chain.push('tamper'); assert.deepEqual(evaluate(request, c).chain, ['p', 'c'], 'a result is not shared state');
});

test('PG-W-21A AC05: a call with no at returns a deny with rule deny.bad_request instead of reading the clock', () => {
  const live = grant({ start: '2000-01-01T00:00:00Z', expires: '2999-01-01T00:00:00Z' });
  for (const c of [{ records: [live], roots: [ROOT] }, { records: [live], roots: [ROOT], at: undefined }, { records: [live], roots: [ROOT], at: null }, { records: [live], roots: [ROOT], at: Date.parse(AT) }, { records: [live], roots: [ROOT], at: new Date(AT) }]) {
    const r = evaluate(ask(), c); assert.equal(r.eligible, false); assert.equal(r.rule, 'deny.bad_request');
  }
  assert.equal(evaluate(ask(), { records: [live], roots: [ROOT], at: '2026-06-01T00:00:00Z' }).eligible, true);
  assert.equal(evaluate(ask(), { records: [live], roots: [ROOT] }).rule, 'deny.bad_request');
});

// Every route to a clock, a random number, a file or the process is replaced by one that records the call; the module
// is then used for every kind of decision, and none of them may be called.
function trapped(fn) {
  const calls = [];
  const saved = [];
  const trap = (obj, key, label) => {
    if (typeof obj?.[key] !== 'function') return;
    saved.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]); // undefined when the function lives on the prototype
    Object.defineProperty(obj, key, { configurable: true, writable: true, enumerable: false, value: () => { calls.push(label); throw new Error(`${label} was called`); } });
  };
  for (const k of Object.getOwnPropertyNames(fs)) if (typeof fs[k] === 'function') trap(fs, k, `fs.${k}`);
  for (const k of Object.getOwnPropertyNames(fs.promises)) if (typeof fs.promises[k] === 'function') trap(fs.promises, k, `fs.promises.${k}`);
  trap(Date, 'now', 'Date.now'); trap(performance, 'now', 'performance.now'); trap(Math, 'random', 'Math.random');
  trap(process.hrtime, 'bigint', 'process.hrtime.bigint'); trap(process, 'hrtime', 'process.hrtime'); trap(process, 'uptime', 'process.uptime'); trap(process, 'cpuUsage', 'process.cpuUsage');
  trap(globalThis, 'fetch', 'fetch'); trap(globalThis, 'setTimeout', 'setTimeout'); trap(globalThis, 'setInterval', 'setInterval'); trap(globalThis, 'queueMicrotask', 'queueMicrotask');
  const RealDate = globalThis.Date;
  // a Date built with no argument reads the clock; one built from a stated time does not
  globalThis.Date = new Proxy(RealDate, { construct(t, a, nt) { if (a.length === 0) { calls.push('new Date()'); throw new Error('new Date() was called'); } return Reflect.construct(t, a, nt); } });
  try { fn(); } finally {
    globalThis.Date = RealDate;
    for (const [obj, key, d] of saved.reverse()) { if (d) Object.defineProperty(obj, key, d); else delete obj[key]; }
  }
  return calls;
}

test('PG-W-21A AC05: no clock, random, file, network, timer or process call is made, whatever the decision', () => {
  const records = [parentGrant(), childGrant(), revocation({ id: 'v2', grant: 'zz' }), grant({ id: 'g7', subject: 'node:n7' })];
  const requests = [ask(), ask({ subject: 'node:nobody' }), ask({ purpose: 'verify' }), ask({ subject: 'node:n7' }), ask({ subject: 7 })];
  const results = [];
  const calls = trapped(() => {
    for (const q of requests) for (const at of [AT, '2026-03-01T00:00:00Z', undefined]) {
      results.push(evaluate(q, { records, roots: [ROOT], at }));
      results.push(evaluate(q, { records: [], roots: [ROOT], at }));
    }
    for (const r of records) validate(r);
    validate({ nonsense: true });
  });
  assert.deepEqual(calls, [], 'a forbidden call was made');
  assert.ok(results.some((r) => r.eligible) && results.some((r) => !r.eligible && r.rule !== 'deny.bad_request'), 'the decisions the trap covered were real ones');
  // the trap itself works: it sees a call
  assert.deepEqual(trapped(() => { try { Math.random(); } catch { /* the trap throws */ } }), ['Math.random']);
  assert.deepEqual(trapped(() => { try { fs.readFileSync('x'); } catch { /* the trap throws */ } }), ['fs.readFileSync']);
  assert.deepEqual(trapped(() => { try { new Date(); } catch { /* the trap throws */ } }), ['new Date()']);
  assert.equal(typeof Math.random(), 'number'); assert.equal(typeof Date.now(), 'number'); assert.equal(typeof fs.readFileSync, 'function');
});

test('PG-W-21A AC05: the same inputs give deep-equal outputs on every call, and no call changes them', () => {
  const records = [parentGrant(), childGrant(), grant({ id: 'g1', subject: 'device:d9' }), revocation({ id: 'v2', grant: 'zz' }), { junk: true }];
  const roots = [ROOT]; const c = { records, roots, at: AT };
  const snapshot = JSON.stringify({ records, roots, c });
  const first = Array.from({ length: 5 }, () => evaluate(ask(), c));
  for (const r of first) assert.deepEqual(r, first[0]);
  assert.equal(JSON.stringify({ records, roots, c }), snapshot, 'records, roots and the call are unchanged');
  const q = ask(); const qs = JSON.stringify(q); evaluate(q, c); assert.equal(JSON.stringify(q), qs, 'the request is unchanged');
  const shuffled = [...records].reverse();
  assert.deepEqual(evaluate(ask(), { ...c, records: shuffled }), first[0], 'the order of the records does not matter');
  const g = grant(); const gs = JSON.stringify(g); validate(g); validate(g); assert.equal(JSON.stringify(g), gs, 'the validator does not change its input');
  assert.deepEqual(validate(g), validate(g));
});

test('PG-W-21A AC05: hostile input is a deny and never a throw', () => {
  const trap = { get id() { throw new Error('read'); } };
  for (const c of [ctx([trap]), ctx([[], {}, null, trap]), { records: 'x', roots: [ROOT], at: AT }, { records: [grant()], roots: 'x', at: AT }, ctx([grant({ scope: null, subject: {} })])]) {
    assert.doesNotThrow(() => evaluate(ask(), c));
    assert.equal(evaluate(ask(), c).eligible, false);
  }
  assert.doesNotThrow(() => validate(trap));
  assert.equal(validate(trap).ok, false);
});

// ---- AC06: the schema file

const FIELDS = (def) => Object.keys(def.properties).sort();
test('PG-W-21A AC06: docs/schemas/trust-record-v1.json parses, names schema memev-trust/1 and lists exactly the validator fields, purposes and reasons', () => {
  const s = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  assert.equal(s.$defs.grant.properties.schema.const, SCHEMA);
  assert.equal(s.$defs.revocation.properties.schema.const, SCHEMA);
  assert.equal(mod().TRUST_SCHEMA, SCHEMA);
  assert.deepEqual(FIELDS(s.$defs.grant), [...mod().GRANT_FIELDS].sort());
  assert.deepEqual(FIELDS(s.$defs.revocation), [...mod().REVOCATION_FIELDS].sort());
  assert.deepEqual(FIELDS(s.$defs.delegation), [...mod().DELEGATION_FIELDS].sort());
  assert.deepEqual([...s.$defs.grant.properties.purposes.items.enum].sort(), ['contribute', 'verify']);
  assert.deepEqual([...mod().TRUST_PURPOSES].sort(), ['contribute', 'verify']);
  assert.deepEqual([...s.$defs.revocation.properties.reason.enum].sort(), ['compromised', 'error', 'left', 'other']);
  assert.deepEqual([...mod().REVOCATION_REASONS].sort(), ['compromised', 'error', 'left', 'other']);
  assert.deepEqual([...s.$defs.grant.properties.kind.enum ?? [s.$defs.grant.properties.kind.const]], ['grant']);
  assert.deepEqual([...s.$defs.revocation.properties.kind.enum ?? [s.$defs.revocation.properties.kind.const]], ['revocation']);
  assert.equal(s.$defs.grant.additionalProperties, false); assert.equal(s.$defs.revocation.additionalProperties, false); assert.equal(s.$defs.delegation.additionalProperties, false);
  assert.deepEqual([...s.$defs.grant.required].sort(), ['expires', 'id', 'issuer', 'kind', 'purposes', 'schema', 'scope', 'start', 'subject']);
  assert.deepEqual([...s.$defs.revocation.required].sort(), ['grant', 'id', 'issuer', 'kind', 'reason', 'schema', 'time']);
  assert.deepEqual(s.$defs.delegation.required, ['depth']);
  assert.equal(s.$defs.grant.properties.evidence.maxItems, 8);
  assert.equal(s.$defs.grant.properties.evidence.items.maxLength, 128);
  assert.equal(s.$defs.grant.properties.purposes.minItems, 1);
  assert.equal(s.$defs.delegation.properties.depth.minimum, 0);
  assert.match(s.$defs.grant.properties.subject.pattern, /person\|agent\|device\|node\|operator\|service/);
  assert.equal(s.$defs.grant.properties.scope.properties.type.enum.includes('personal'), false, 'a personal scope is never shared');
});

test('PG-W-21A AC06: every field the schema lists is accepted by the validator and a field it does not list is refused', () => {
  const s = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const full = grant({ evidence: ['e'], delegation: { depth: 1, parent: 'p' } });
  assert.deepEqual(Object.keys(full).sort(), FIELDS(s.$defs.grant), 'a grant with every field is the schema');
  assert.equal(validate(full).ok, true);
  assert.deepEqual(Object.keys(revocation()).sort(), FIELDS(s.$defs.revocation));
  assert.deepEqual(Object.keys(full.delegation).sort(), FIELDS(s.$defs.delegation));
  for (const f of ['note', 'created', 'parent', 'weight', 'score']) { names({ ...full, [f]: 1 }, new RegExp(`unknown field.*${f}`)); names({ ...revocation(), [f]: 1 }, new RegExp(`unknown field.*${f}`)); }
  // a field the validator knows and the schema does not is caught here: the lists the validator uses are the ones compared above
  assert.equal(Object.isFrozen(mod().GRANT_FIELDS) && Object.isFrozen(mod().REVOCATION_FIELDS) && Object.isFrozen(mod().DELEGATION_FIELDS), true);
  for (const f of mod().GRANT_FIELDS) assert.ok(s.$defs.grant.properties[f], `grant field ${f} is in the schema`);
  for (const f of mod().REVOCATION_FIELDS) assert.ok(s.$defs.revocation.properties[f], `revocation field ${f} is in the schema`);
});

// ---- the fixed set of rule ids

const SCENARIOS = () => {
  const stranger = grant({ issuer: 'person:stranger' });
  const ch = (po, co) => [parentGrant(po), childGrant(co)];
  return [
    [ask(), ctx([grant()]), 'allow.grant'],
    [ask({ subject: 'x' }), ctx([grant()]), 'deny.bad_request'],
    [ask(), ctx([]), 'deny.no_records'],
    [ask(), ctx([grant()], { roots: [] }), 'deny.no_roots'],
    [ask({ subject: 'device:other' }), ctx([grant()]), 'deny.no_grant'],
    [ask({ scope: { type: 'team', id: 'other' } }), ctx([grant()]), 'deny.scope_not_granted'],
    [ask({ purpose: 'verify' }), ctx([grant()]), 'deny.purpose_not_granted'],
    [ask(), ctx([grant()], { at: '2025-01-01T00:00:00Z' }), 'deny.not_yet_valid'],
    [ask(), ctx([grant()], { at: '2027-01-01T00:00:00Z' }), 'deny.expired'],
    [ask(), ctx([grant(), revocation({ time: START })]), 'deny.revoked'],
    [ask(), ctx([stranger]), 'deny.untrusted_issuer'],
    [ask(), ctx([childGrant()]), 'deny.chain.parent_missing'],
    [ask(), ctx([parentGrant({ subject: 'operator:o2' }), childGrant()]), 'deny.chain.parent_not_issuer'],
    [ask(), ctx(ch({ delegation: { depth: 0 } }, {})), 'deny.chain.parent_depth_zero'],
    [ask(), ctx(ch({ delegation: { depth: 1 } }, {})), 'deny.chain.depth'],
    [ask({ scope: { type: 'team', id: 't2' } }), ctx(ch({}, { scope: { type: 'team', id: 't2' } })), 'deny.chain.scope'],
    [ask(), ctx(ch({ purposes: ['contribute'] }, { purposes: ['contribute', 'verify'] })), 'deny.chain.purposes'],
    [ask(), ctx(ch({}, { expires: '2026-03-01T00:00:00Z' })), 'deny.chain.expiry'],
    [ask(), ctx(ch({ start: '2026-01-15T00:00:00Z' }, { start: '2026-01-10T00:00:00Z' })), 'deny.chain.start'],
    [ask(), ctx([...ch({}, {}), revocation({ id: 'v2', grant: 'p', time: START })]), 'deny.chain.parent_revoked'],
  ];
};

test('PG-W-21A AC02: every decision carries a rule id from the fixed, exported set, and every id in the set is reachable', () => {
  const RULES = mod().RULES;
  assert.ok(Object.isFrozen(RULES), 'the set is frozen');
  const ids = Object.values(RULES);
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  assert.ok(ids.every((id) => /^(allow|deny)(\.[a-z_]+)+$/.test(id)), 'every id is a dotted lower-case name');
  const seen = new Set();
  for (const [req, c, want] of SCENARIOS()) {
    const r = evaluate(req, c);
    assert.equal(r.rule, want, `${want}: ${r.reason}`);
    assert.ok(ids.includes(r.rule), `${r.rule} is in the set`);
    assert.equal(r.eligible, r.rule.startsWith('allow.'));
    seen.add(r.rule);
  }
  assert.deepEqual([...seen].sort(), [...ids].sort(), 'the scenarios reach every id and no other');
  // nothing hostile or unusual can produce an id outside the set
  for (const c of [null, 5, { records: [null], roots: [ROOT], at: AT }, { records: [grant()], roots: [ROOT, 3], at: AT }, ctx([{ get id() { throw new Error('x'); } }])]) assert.ok(ids.includes(evaluate(ask(), c).rule));
  // the module writes no rule id of its own: every id it returns is one of the constants of the set
  const code = SRC().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const literals = [...code.matchAll(/'((?:allow|deny)\.[a-z_.]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(literals)].filter((x) => !ids.includes(x)), [], 'an id literal outside the set');
  assert.doesNotMatch(code, /rule:\s*[`"]|\bdeny\(\s*[`"]|`deny\./, 'no rule id is built from text');
});

// ---- AC07 to AC09: the greps of the contract, kept here so they run with the suite, and the stricter behaviour behind them

const SRC = () => fs.readFileSync(MODULE, 'utf8');
const CODE = () => SRC().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
test('PG-W-21A AC07: the module marks every choice as provisional and names the decision record', () => {
  assert.match(SRC(), /ADR 8.*PROVISIONAL|PROVISIONAL.*ADR 8/s);
  // the three choices that answer an ADR 8 question are each labelled where they are made
  const label = (re, what) => { const m = re.exec(SRC()); assert.ok(m, `${what} is in the module`); const before = SRC().slice(Math.max(0, m.index - 600), m.index + m[0].length + 200); assert.match(before, /PROVISIONAL/, `${what} is labelled PROVISIONAL near its code`); assert.match(before, /ADR 8/, `${what} names ADR 8 near its code`); };
  label(/export const TRUST_PURPOSES/, 'the two purposes');
  label(/stop\(RULES\.CHAIN_DEPTH/, 'narrowing-only delegation');
  label(/v\.issuer === g\.issuer/, 'issuer-or-root revocation');
  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  assert.match(schema.description, /PROVISIONAL/);
  assert.match(schema.$defs.grant.properties.purposes.description, /PROVISIONAL/, 'the schema labels the two purposes');
  assert.match(schema.$defs.delegation.description, /PROVISIONAL/, 'the schema labels narrowing-only delegation');
  assert.match(schema.$defs.revocation.description, /PROVISIONAL/, 'the schema labels who may revoke');
  for (const d of [schema.$defs.grant.properties.purposes.description, schema.$defs.delegation.description, schema.$defs.revocation.description]) assert.match(d, /ADR 8/);
  assert.match(fs.readFileSync(path.join(PKG, 'changelog.d', 'PG-W-21A.md'), 'utf8'), /provisional/i);
});

test('PG-W-21A AC08: the only static import is ../identity.mjs, and no import is dynamic, required, created or resolved at run time', () => {
  const code = CODE();
  const statics = [...code.matchAll(/(?:^|[;\n}])\s*(?:import\s*(?:[^;'"`]*?\sfrom\s*)?|export\s[^;'"`]*?\sfrom\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(statics, ['../identity.mjs'], 'a strict allow-list of one static import');
  assert.deepEqual(code.split('\n').filter((l) => /^import /.test(l)).length, 1, 'one import line, so the contract grep reads it');
  assert.equal((code.match(/\bimport\b/g) ?? []).length, 1, 'the word import appears once');
  for (const banned of [/\bimport\s*\(/, /\bimport\s*\.\s*meta/, /\brequire\b/, /\bcreateRequire\b/, /\bimport\.meta\.resolve\b/, /\bmodule\.require\b/, /\beval\b/, /\bFunction\s*\(/, /\bnew\s+Function\b/, /\bglobalThis\b/, /\bprocess\b/, /\bBuffer\b/, /\bWebAssembly\b/])
    assert.doesNotMatch(code, banned, String(banned));
  // the one import names exactly the two things the module takes from identity.mjs
  assert.match(code, /^import \{ SUBJECT_TYPES, validateScope \} from '\.\.\/identity\.mjs';$/m);
});

test('PG-W-21A AC09: the module names no clock, random, file, network or process call', () => {
  assert.doesNotMatch(SRC(), /Date\.now|new Date\(\)|node:fs|node:net|node:http|node:child_process|fetch\(/);
  const code = CODE();
  for (const banned of [/Date\.now/, /\bnew\s+Date\b/, /\bperformance\b/, /Math\.random/, /\bhrtime\b/, /\bcrypto\b/, /\brandom/i, /\bfetch\b/, /\bXMLHttpRequest\b/, /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b/, /\bfs\b/, /\bnet\b/, /\bhttps?\b/, /\bchild_process\b/, /\bos\b/, /\bnode:/, /\bAtomics\b|\bSharedArrayBuffer\b/, /\bconsole\b/])
    assert.doesNotMatch(code, banned, String(banned));
  assert.match(code, /Date\.parse\(/, 'a stated time is parsed, which reads no clock');
  assert.equal([...code.matchAll(/\bDate\b/g)].length, [...code.matchAll(/\bDate\.parse\b/g)].length, 'Date is used only to parse a stated time');
});

test('PG-W-21A AC08: nothing outside the tests imports the module: it has no production caller', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  const callers = ['bin', 'src', 'scripts', 'vendor'].filter((d) => fs.existsSync(path.join(PKG, d))).flatMap((d) => walk(path.join(PKG, d)))
    .filter((f) => /\.(mjs|js|cjs|json)$/.test(f) && f !== MODULE && /trust-record/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(callers.map((f) => path.relative(PKG, f)), [], 'no module, script or command names the trust record module');
  const graph = fs.readFileSync(path.join(PKG, 'docs', 'MODULES.md'), 'utf8');
  assert.ok(graph.includes('src/engine/federation/trust-record.mjs'), 'the module is on the map');
  const row = graph.split('\n').find((l) => l.includes('src/engine/federation/trust-record.mjs') && l.startsWith('|'));
  assert.ok(row, 'the module has a row on the map');
});
