// SPDX-License-Identifier: Apache-2.0
// SO-F-04: federation membership and policy. A relationship names both parties, the scope, the purpose, the expiry, how it is
// revoked and the policy version both accepted; a policy document says per data class which actions are allowed; the evaluation
// function maps (subject, scope, action, class) to allow or deny with the rule id and denies by default; a personal scope or vault is
// never a party. Two sandbox nodes establish a relationship, exchange one permitted contribution, refuse one outside the scope,
// revoke, and refuse everything after, including a queued contribution. Test names start with the id the contract's checks select on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG, cleanup } from './helpers/tmp.mjs';
import { sandboxNode, identityDoc, contribute } from './helpers/federation-node.mjs';
import { Admission } from '../src/engine/federation/admission.mjs';
import * as membership from '../src/engine/federation/membership.mjs';
import * as policyModule from '../src/engine/federation/policy.mjs';

after(cleanup);

const M = membership;
const P = policyModule;
const ORG_A = { type: 'organisation', id: 'org-a' };
const ORG_B = { type: 'organisation', id: 'org-b' };
const SHARED = { type: 'project', id: 'proj-shared' };
const OTHER = { type: 'project', id: 'proj-other' };
const T0 = Date.parse('2026-11-01T09:00:00Z');
const T1 = Date.parse('2026-11-01T10:00:00Z');
const T2 = Date.parse('2026-11-01T11:00:00Z');
const iso = (t) => new Date(t).toISOString();
const SECRET = 'PAYLOAD-MARKER-4b8e21';

const POLICY = {
  schema: 'memev-policy/1', id: 'pol-1', version: '2026-11-01.1',
  classes: {
    internal: { discover: true, read: true, replicate: true, compute: false, retain: true, export: false, recovery: { rpo_seconds: 900, rto_seconds: 3600 } },
    restricted: { discover: true, read: false, replicate: false, compute: false, retain: false, export: false, recovery: { rpo_seconds: 60, rto_seconds: 600 } },
  },
};
const REL = () => ({
  schema: 'memev-membership/1', id: 'rel-1',
  parties: [{ node: 'node-a', scope: ORG_A, accepted_at: iso(T0) }, { node: 'node-b', scope: ORG_B, accepted_at: iso(T0) }],
  scope: SHARED, purpose: 'joint delivery of the shared project', expires: '2027-06-30T00:00:00Z',
  revocation: { by: 'either_party', revoked_at: null, revoked_by: null }, policy_version: POLICY.version,
});
const clone = (o) => JSON.parse(JSON.stringify(o));
const REQ = (over = {}) => ({ subject: 'agent:writer', scope: SHARED, action: 'replicate', class: 'internal', ...over });
const evaluate = (req, { rels = [REL()], policy = POLICY, at = T1 } = {}) => P.evaluate(req, { relationships: rels, policy, at });

// ---- AC02: the relationship record, the policy document, the validators

test('SO-F-04 AC02: the relationship record names both parties, the scope, the purpose, the expiry, the revocation and the accepted policy version', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PKG, 'docs/schemas/membership-v1.json'), 'utf8'));
  assert.equal(schema.schema, 'memev-membership/1');
  assert.deepEqual(Object.keys(schema.properties).sort(), [...M.RELATIONSHIP_FIELDS].sort());
  assert.deepEqual([...schema.required].sort(), [...M.RELATIONSHIP_FIELDS].sort());
  assert.deepEqual(M.RELATIONSHIP_FIELDS, ['expires', 'id', 'parties', 'policy_version', 'purpose', 'revocation', 'schema', 'scope']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(M.validateRelationship(REL()), { ok: true, errors: [] });
  assert.deepEqual(M.validateRelationship({ ...REL(), revocation: { by: 'proposer', revoked_at: iso(T2), revoked_by: 'node-a' } }), { ok: true, errors: [] });
});

test('SO-F-04 AC02: the validator refuses a relationship that is missing a part, malformed, or has a personal scope or vault as a party', () => {
  const bad = [
    ['a personal scope as a party', (r) => { r.parties[1].scope = { type: 'personal', id: 'personal' }; }, /personal/],
    ['a personal scope as the shared scope', (r) => { r.scope = { type: 'personal', id: 'personal' }; }, /personal/],
    ['the same node on both sides', (r) => { r.parties[1].node = 'node-a'; }, /party|node/],
    ['one party only', (r) => { r.parties.pop(); }, /two parties/],
    ['no purpose', (r) => { r.purpose = ''; }, /purpose/],
    ['no expiry', (r) => { delete r.expires; }, /expires/],
    ['an expiry that is not a time', (r) => { r.expires = 'soon'; }, /expires/],
    ['an expiry before the acceptance', (r) => { r.expires = '2026-10-01T00:00:00Z'; }, /expires/],
    ['no policy version', (r) => { r.policy_version = ''; }, /policy_version/],
    ['a revocation rule that does not exist', (r) => { r.revocation.by = 'anyone'; }, /revocation/],
    ['a revocation by a node that is not a party', (r) => { r.revocation = { by: 'either_party', revoked_at: iso(T2), revoked_by: 'node-z' }; }, /revoked_by/],
    ['a revocation time with no revoker', (r) => { r.revocation.revoked_at = iso(T2); }, /revoked/],
    ['an unknown field', (r) => { r.extra = 1; }, /extra/],
    ['a wrong schema', (r) => { r.schema = 'memev-membership/2'; }, /schema/],
    ['a bad scope type', (r) => { r.scope = { type: 'galaxy', id: 'x' }; }, /scope/],
    ['a party that names a personal vault', (r) => { r.parties[0].vault = 'personal'; }, /vault/],
  ];
  for (const [what, mutate, re] of bad) {
    const r = REL(); mutate(r);
    const v = M.validateRelationship(r);
    assert.equal(v.ok, false, what);
    assert.match(v.errors.join(' '), re, what);
  }
  assert.equal(M.validateRelationship(null).ok, false);
  assert.equal(M.validateRelationship('x').ok, false);
});

test('SO-F-04 AC02: two parties establish a relationship by proposing and accepting, and an unaccepted one is not established', () => {
  const p = M.proposeRelationship({ id: 'rel-2', proposer: { node: 'node-a', scope: ORG_A }, counterparty: { node: 'node-b', scope: ORG_B }, scope: SHARED, purpose: 'joint delivery', expires: '2027-06-30T00:00:00Z', revocable_by: 'either_party', policy_version: POLICY.version }, { at: T0 });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.record.parties.map((x) => [x.node, x.accepted_at]), [['node-a', iso(T0)], ['node-b', null]]);
  assert.equal(M.validateRelationship(p.record).ok, true);
  assert.equal(M.relationshipState(p.record, T1), 'proposed');
  assert.equal(M.acceptRelationship(p.record, { node: 'node-z', at: T1 }).ok, false, 'only a named party accepts');
  const a = M.acceptRelationship(p.record, { node: 'node-b', at: T1 });
  assert.equal(a.ok, true);
  assert.equal(M.relationshipState(a.record, T1), 'active');
  assert.equal(M.proposeRelationship({ id: 'rel-3', proposer: { node: 'node-a', scope: { type: 'personal', id: 'personal' } }, counterparty: { node: 'node-b', scope: ORG_B }, scope: SHARED, purpose: 'x', expires: '2027-06-30T00:00:00Z', policy_version: POLICY.version }, { at: T0 }).ok, false, 'a personal scope never proposes');
});

test('SO-F-04 AC02: the policy document states per data class whether each of the six actions is allowed, with recovery objectives, and the validator accepts the fixture', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PKG, 'docs/schemas/policy-v1.json'), 'utf8'));
  assert.equal(schema.schema, 'memev-policy/1');
  assert.deepEqual(P.POLICY_ACTIONS, ['discover', 'read', 'replicate', 'compute', 'retain', 'export']);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['classes', 'id', 'schema', 'version']);
  assert.deepEqual(Object.keys(schema.properties.classes.additionalProperties.properties).sort(), [...P.POLICY_ACTIONS, 'recovery'].sort());
  assert.deepEqual(schema.properties.classes.additionalProperties.properties.recovery.required.sort(), ['rpo_seconds', 'rto_seconds']);
  assert.equal(schema.properties.classes.propertyNames === undefined || typeof schema.properties.classes.propertyNames === 'object', true, 'the class list is open');
  assert.deepEqual(P.validatePolicy(POLICY), { ok: true, errors: [] });
  const bad = [
    ['an action left out', (p) => { delete p.classes.internal.export; }, /export/],
    ['an action that is not a flag', (p) => { p.classes.internal.read = 'yes'; }, /read/],
    ['an unknown action', (p) => { p.classes.internal.delete = true; }, /delete/],
    ['no recovery objectives', (p) => { delete p.classes.internal.recovery; }, /recovery/],
    ['a negative objective', (p) => { p.classes.internal.recovery.rpo_seconds = -1; }, /rpo_seconds/],
    ['a fractional objective', (p) => { p.classes.internal.recovery.rto_seconds = 1.5; }, /rto_seconds/],
    ['no version', (p) => { p.version = ''; }, /version/],
    ['no classes', (p) => { p.classes = {}; }, /class/],
    ['a class name with spaces', (p) => { p.classes['two words'] = clone(p.classes.internal); }, /class/],
    ['a wrong schema', (p) => { p.schema = 'memev-policy/2'; }, /schema/],
  ];
  for (const [what, mutate, re] of bad) {
    const p = clone(POLICY); mutate(p);
    const v = P.validatePolicy(p);
    assert.equal(v.ok, false, what);
    assert.match(v.errors.join(' '), re, what);
  }
  assert.equal(P.validatePolicy(undefined).ok, false);
});

// ---- AC03: the evaluation function

test('SO-F-04 AC03: the evaluation function maps (subject, scope, action, class) to allow or deny with the rule id', () => {
  const a = evaluate(REQ());
  assert.equal(a.decision, 'allow');
  assert.equal(a.rule, 'allow:pol-1:internal:replicate');
  assert.equal(a.relationship, 'rel-1');
  const d = evaluate(REQ({ action: 'compute' }));
  assert.equal(d.decision, 'deny');
  assert.equal(d.rule, 'deny.action');
  assert.equal(evaluate(REQ({ class: 'restricted', action: 'read' })).rule, 'deny.action');
  assert.equal(evaluate(REQ({ class: 'restricted', action: 'discover' })).decision, 'allow');
  for (const r of [a, d]) assert.ok(typeof r.rule === 'string' && r.rule.length > 0 && typeof r.reason === 'string');
});

test('SO-F-04 AC03: the evaluation function denies when no rule matches', () => {
  const cases = [
    ['no relationship at all', { rels: [] }, REQ(), 'deny.no_relationship'],
    ['a scope no relationship covers', {}, REQ({ scope: OTHER }), 'deny.no_relationship'],
    ['a class the policy does not list', {}, REQ({ class: 'secret' }), 'deny.no_rule'],
    ['an action the policy does not know', {}, REQ({ action: 'delete' }), 'deny.bad_request'],
    ['a policy version the relationship did not accept', { policy: { ...clone(POLICY), version: '2099.1' } }, REQ(), 'deny.policy_version'],
    ['a personal scope', {}, REQ({ scope: { type: 'personal', id: 'personal' } }), 'deny.personal_scope'],
    ['a subject that is not a subject id', {}, REQ({ subject: 'somebody' }), 'deny.bad_request'],
    ['a missing request', {}, undefined, 'deny.bad_request'],
    ['a missing policy', { policy: null }, REQ(), 'deny.bad_request'],
    ['a relationship that is not valid', { rels: [{ ...REL(), purpose: '' }] }, REQ(), 'deny.no_relationship'],
  ];
  for (const [what, opts, req, rule] of cases) {
    const r = evaluate(req, opts);
    assert.equal(r.decision, 'deny', what);
    assert.equal(r.rule, rule, what);
  }
});

test('SO-F-04 AC03: an expired relationship and a revoked one deny, and only from their time', () => {
  const rel = REL();
  rel.expires = iso(T2);
  assert.equal(evaluate(REQ(), { rels: [rel], at: T2 - 1 }).decision, 'allow');
  assert.equal(evaluate(REQ(), { rels: [rel], at: T2 }).rule, 'deny.expired');
  assert.equal(evaluate(REQ(), { rels: [rel], at: T2 + 86400000 }).rule, 'deny.expired');
  const gone = REL();
  gone.revocation = { by: 'either_party', revoked_at: iso(T2), revoked_by: 'node-b' };
  assert.equal(evaluate(REQ(), { rels: [gone], at: T2 - 1 }).decision, 'allow', 'before the revocation it held');
  assert.equal(evaluate(REQ(), { rels: [gone], at: T2 }).rule, 'deny.revoked');
  const both = REL(); both.expires = iso(T1 - 1000); both.revocation = { by: 'either_party', revoked_at: iso(T1 - 500), revoked_by: 'node-a' };
  assert.equal(evaluate(REQ(), { rels: [both], at: T1 }).rule, 'deny.revoked', 'revoked is named before expired');
  const early = REL(); early.parties[1].accepted_at = iso(T2);
  assert.equal(evaluate(REQ(), { rels: [early], at: T1 }).rule, 'deny.not_established');
  // a second, live relationship for the same scope still allows
  const second = { ...REL(), id: 'rel-9' };
  assert.equal(evaluate(REQ(), { rels: [gone, second], at: T2 + 1 }).relationship, 'rel-9');
});

test('SO-F-04 AC03: a personal scope is refused whatever a relationship says, and the evaluation never throws', () => {
  const sneaky = REL(); sneaky.scope = { type: 'personal', id: 'personal' };
  assert.equal(evaluate(REQ({ scope: sneaky.scope }), { rels: [sneaky] }).rule, 'deny.personal_scope');
  for (const junk of [null, undefined, 1, 'x', [], { subject: {} }, { subject: 'agent:a', scope: 1, action: [], class: {} }]) {
    assert.equal(P.evaluate(junk, { relationships: [REL()], policy: POLICY, at: T1 }).decision, 'deny');
  }
  assert.equal(P.evaluate(REQ(), undefined).decision, 'deny');
  assert.equal(P.evaluate(REQ(), { relationships: 'x', policy: POLICY, at: T1 }).decision, 'deny');
});

// ---- AC04: two sandbox nodes, the real admission, signature path and operation log

const rejected = (log) => [...log.iterate()].filter((r) => r.type === 'federation.rejected');
const admitted = (log) => [...log.iterate()].filter((r) => r.type === 'federation.admitted');

function twoNodes() {
  const a = sandboxNode('a');
  const b = sandboxNode('b');
  // node B knows the remote writer and its public key through its own identity document, and holds the shared scope
  const identity = identityDoc([a.key], [SHARED, OTHER]);
  const bring = () => {
    const book = new M.RelationshipBook({ log: b.log });
    const gate = P.relationshipGate({ book, policy: POLICY, now: () => b.now });
    const admission = new Admission({ log: b.log, identity, scope: SHARED, policy: { accept: [{ scope: SHARED, classifications: ['internal', 'restricted'] }, { scope: OTHER, classifications: ['internal'] }] }, external: gate });
    return { book, admission };
  };
  b.now = T1;
  return { a, b, ...bring(), bring };
}

test('SO-F-04 AC04: two nodes establish a scoped relationship, exchange one permitted contribution and refuse one outside the scope', () => {
  const { a, b, book, admission } = twoNodes();
  const outbox = [];
  // before any relationship: refused by the relationship gate, ahead of the node's own two steps
  outbox.push(contribute(a.key, { node: 'node-a', seq: 1, scope: SHARED }));
  const none = admission.admit(outbox.shift(), { at: b.now });
  assert.equal(none.ok, false);
  assert.equal(none.step, 'external');
  assert.equal(none.code, 'deny.no_relationship');
  // the two nodes establish: A proposes, B accepts, both nodes hold the accepted record
  const p = M.proposeRelationship({ id: 'rel-1', proposer: { node: 'node-a', scope: ORG_A }, counterparty: { node: 'node-b', scope: ORG_B }, scope: SHARED, purpose: 'joint delivery of the shared project', expires: '2027-06-30T00:00:00Z', revocable_by: 'either_party', policy_version: POLICY.version }, { at: T0 });
  assert.equal(book.add(p.record).code, 'not_established', 'a proposal waiting for the other party is not held');
  const acc = M.acceptRelationship(p.record, { node: 'node-b', at: T0 });
  assert.equal(acc.ok, true);
  assert.equal(book.add(acc.record).ok, true);
  assert.equal(book.add(acc.record).ok, false, 'a record is added once');
  // one permitted contribution goes from A's outbox to B's admission
  outbox.push(contribute(a.key, { node: 'node-a', seq: 2, scope: SHARED, payload: { note: SECRET } }));
  const ok = admission.admit(outbox.shift(), { at: b.now });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(admitted(b.log).length, 1);
  assert.equal(admitted(b.log)[0].data.envelope.payload.note, SECRET);
  // one outside the scope is refused by the relationship, with nothing of its payload in the log
  outbox.push(contribute(a.key, { node: 'node-a', seq: 3, scope: OTHER, payload: { note: `${SECRET}-other` } }));
  const out = admission.admit(outbox.shift(), { at: b.now });
  assert.equal(out.ok, false);
  assert.equal(out.step, 'external');
  assert.equal(out.code, 'deny.no_relationship');
  // one in the scope but of a class the policy does not allow to replicate
  outbox.push(contribute(a.key, { node: 'node-a', seq: 4, scope: SHARED, classification: 'restricted', payload: { note: `${SECRET}-restricted` } }));
  const cls = admission.admit(outbox.shift(), { at: b.now });
  assert.equal(cls.code, 'deny.action');
  assert.equal(admitted(b.log).length, 1);
  assert.ok(!JSON.stringify(rejected(b.log)).includes(SECRET), 'a refusal keeps nothing of the payload');
  assert.deepEqual(rejected(b.log).map((r) => r.data.code), ['deny.no_relationship', 'deny.no_relationship', 'deny.action']);
});

test('SO-F-04 AC04: after revocation every contribution is refused, a queued one included, and a restart does not forget the revocation', () => {
  const { a, b, book, admission, bring } = twoNodes();
  const p = M.proposeRelationship({ id: 'rel-1', proposer: { node: 'node-a', scope: ORG_A }, counterparty: { node: 'node-b', scope: ORG_B }, scope: SHARED, purpose: 'joint delivery', expires: '2027-06-30T00:00:00Z', revocable_by: 'either_party', policy_version: POLICY.version }, { at: T0 });
  assert.equal(book.add(M.acceptRelationship(p.record, { node: 'node-b', at: T0 }).record).ok, true);
  assert.equal(admission.admit(contribute(a.key, { node: 'node-a', seq: 1, scope: SHARED }), { at: b.now }).ok, true);
  // A signs two more and holds them in its outbox
  const queued = [contribute(a.key, { node: 'node-a', seq: 2, scope: SHARED }), contribute(a.key, { node: 'node-a', seq: 3, scope: SHARED })];
  // A revokes; B is told and records it
  const refused = book.revoke('rel-1', { by: 'node-z', at: T2 });
  assert.equal(refused.ok, false, 'only a party revokes');
  assert.equal(admission.admit(queued[0], { at: T1 }).ok, true, 'before the revocation it still held');
  b.now = T2;
  const rv = book.revoke('rel-1', { by: 'node-a', at: T2 });
  assert.equal(rv.ok, true, JSON.stringify(rv));
  assert.equal(book.revoke('rel-1', { by: 'node-b', at: T2 + 1000 }).ok, false, 'a revoked relationship stays revoked at its first time');
  const afterQueued = admission.admit(queued[1], { at: T2 });
  assert.equal(afterQueued.ok, false);
  assert.equal(afterQueued.code, 'deny.revoked');
  const fresh = admission.admit(contribute(a.key, { node: 'node-a', seq: 4, scope: SHARED }), { at: T2 });
  assert.equal(fresh.code, 'deny.revoked');
  assert.equal(admitted(b.log).length, 2);
  // a restart: the log is opened again and the book and the admission are made again from it
  b.reopen();
  const again = bring();
  assert.equal(again.book.get('rel-1').revocation.revoked_by, 'node-a');
  assert.equal(M.relationshipState(again.book.get('rel-1'), T2), 'revoked');
  assert.equal(again.admission.admit(queued[1], { at: T2 }).code, 'deny.revoked');
  assert.equal(again.book.add(REL()).ok, false, 'the old record cannot be added again to undo the revocation');
  assert.equal(admitted(b.log).length, 2);
});

test('SO-F-04 AC04: the relationship and policy modules open no connection and start no process', () => {
  for (const f of ['membership.mjs', 'policy.mjs']) {
    const src = fs.readFileSync(path.join(PKG, 'src/engine/federation', f), 'utf8');
    assert.ok(Object.keys(f === 'membership.mjs' ? M : P).length > 0, `${f} exports something`);
    for (const banned of ['child_process', 'node:net', 'node:http', 'node:https', 'node:dgram', 'node:dns', 'fetch(']) assert.ok(!src.includes(banned), `${f} must not use ${banned}`);
  }
});
