// SO-F-09: the finding model. A finding is a graph claim with source links, affected entities and
// owners, scope and time context and a confidence. Evidence alone caps it at theory; fact needs a
// person's event or a verification record. Dismissal, correction and adjudication are events, and a
// reader only ever sees what the source's scope lets them read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as graphModule from '../src/engine/graph.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as identityModule from '../src/engine/identity.mjs';
import { PKG } from './helpers/tmp.mjs';

const { Graph } = graphModule;
// The identity module is read as a namespace, and each use checks the export is there, so a base without it fails on an assertion
// instead of failing to load the file.
const identityFn = (name) => { assert.equal(typeof identityModule[name], 'function', `identity.mjs exports ${name}`); return identityModule[name]; };
const method = (g, name) => { assert.equal(typeof g[name], 'function', `Graph has ${name}`); return g[name].bind(g); };
const bind = (g, ...a) => method(g, 'bindFindingEvent')(...a);
const admit = (g, ...a) => method(g, 'admitFinding')(...a);
const resolveRequest = (...a) => identityFn('resolveRequest')(...a);
const resolveActor = (...a) => identityFn('resolveActor')(...a);
const isResolvedActor = (...a) => identityFn('isResolvedActor')(...a);
const FINDING_EVENTS = graphModule.FINDING_EVENTS || [];
const TEAM_A = { type: 'team', id: 'team-a' };
const TEAM_B = { type: 'team', id: 'team-b' };
const PERSON = 'person:owner';
const SESSION = 'agent:stub-session';
const VERIFIER = 'service:checker';

let seq = 0;
const op = (type, data, who = {}) => ({ seq: ++seq, ts: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString(), type, agent: who.agent || 'owner', client: who.client || null, data });

const finding = (over = {}) => ({
  id: 'f_one', by: SESSION,
  subject: 'checkout service', predicate: 'is blocked by', object: 'payments migration',
  sources: [{ event: 'evt-101', version: 3, scope: TEAM_A, path: 'notes/checkout.md', excerpt: 'checkout waits on the payments migration' }],
  entities: [{ id: 'ent-payments', source: 0 }],
  owners: [{ subject: 'person:lead', source: 0 }],
  scope: TEAM_A, context: { from: '2026-10-01T00:00:00Z', to: null }, confidence: 0.6,
  ...over,
});
const make = (over) => {
  const g = new Graph(); const f = finding(over);
  g.applyOp(op('claim.finding', f));
  assert.ok(g.claims.get(f.id)?.finding, 'a claim.finding operation makes a finding');
  return g;
};
const evidence = (g, id, stance, strength, source) => g.applyOp(op('claim', { id, subject: g.claims.get(id).subject, predicate: g.claims.get(id).predicate, object: g.claims.get(id).object, stance, strength, path: null, text: null, source }));
const status = (g, id) => Graph.assess(g.claims.get(id)).status;

test('SO-F-09 AC01: a finding is a graph claim with its source events and versions, entities, owners, scope, time context and confidence', () => {
  const g = make();
  const c = g.claims.get('f_one');
  assert.ok(c, 'the finding is stored as a claim in the graph');
  assert.equal(c.subject, 'checkout service');
  assert.deepEqual(c.evidence, []);
  assert.deepEqual(c.finding.sources.map((s) => [s.event, s.version]), [['evt-101', 3]]);
  assert.deepEqual(c.finding.entities, [{ id: 'ent-payments', source: 0 }]);
  assert.deepEqual(c.finding.owners, [{ subject: 'person:lead', source: 0 }]);
  assert.deepEqual(c.finding.scope, TEAM_A);
  assert.deepEqual(c.finding.context, { from: '2026-10-01T00:00:00Z', to: null });
  assert.equal(c.finding.confidence, 0.6);
  assert.equal(c.status, 'conjecture');
  // each missing or malformed part is named and the finding is refused
  const bad = [
    [{ sources: [] }, /source/], [{ sources: [{ event: 'e', version: 0, scope: TEAM_A }] }, /version/],
    [{ sources: [{ event: '', version: 1, scope: TEAM_A }] }, /event/], [{ confidence: 1.5 }, /confidence/],
    [{ scope: { type: 'galaxy', id: 'x' } }, /scope/], [{ context: { from: 'yesterday' } }, /context/],
    [{ owners: [{ subject: 'nobody', source: 0 }] }, /owner/], [{ entities: [{ id: 'e', source: 4 }] }, /entit/],
    [{ by: 'nobody' }, /by/], [{ subject: '' }, /subject/],
  ];
  for (const [over, re] of bad) {
    const r = admit(new Graph(), finding(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.errors.join(' '), re, JSON.stringify(over));
  }
  assert.equal(admit(new Graph(), finding()).ok, true);
});

test('SO-F-09 AC01: evidence alone never takes a finding past theory, while an ordinary claim keeps the promotion rule', () => {
  const g = make();
  g.applyOp(op('claim', { id: 'c_plain', subject: 'cache', predicate: 'causes', object: 'stale reads', stance: 'support', strength: 0.9, path: null, text: null, source: 'a' }));
  for (const s of ['a', 'b', 'c', 'd']) {
    evidence(g, 'f_one', 'support', 0.95, s);
    g.applyOp(op('claim', { id: 'c_plain', subject: 'cache', predicate: 'causes', object: 'stale reads', stance: 'support', strength: 0.95, path: null, text: null, source: s }));
  }
  const plain = Graph.assess(g.claims.get('c_plain'));
  assert.equal(plain.status, 'fact', 'the same evidence makes an ordinary claim a fact');
  const a = Graph.assess(g.claims.get('f_one'));
  assert.ok(a.support >= 0.85 && a.sources >= 2, 'the evidence is strong enough for a fact');
  assert.equal(a.status, 'theory');
  assert.equal(a.capped, true);
  assert.equal(g.claims.get('f_one').status, 'theory', 'the stored status is the capped one');
  assert.ok(!('capped' in plain) || plain.capped !== true);
});

test('SO-F-09 AC01: contested and refuted findings stand as the graph derives them; only promotion to fact is capped', () => {
  const g = make();
  for (const s of ['a', 'b']) evidence(g, 'f_one', 'support', 0.8, s);
  for (const s of ['c', 'd']) evidence(g, 'f_one', 'oppose', 0.8, s);
  assert.equal(status(g, 'f_one'), 'contested');
  const h = make({ id: 'f_two' });
  for (const s of ['a', 'b', 'c']) evidence(h, 'f_two', 'oppose', 0.9, s);
  assert.equal(status(h, 'f_two'), 'refuted');
});

test('SO-F-09 AC01: a stub session cannot promote a finding by status op, adjudication, verification or evidence', () => {
  const g = make();
  for (const s of ['a', 'b', 'c']) evidence(g, 'f_one', 'support', 0.95, s);
  // the session writes a status change straight to the log
  g.applyOp(op('claim.status', { id: 'f_one', from: 'theory', to: 'fact' }, { agent: 'session', client: 'stub-session' }));
  assert.equal(status(g, 'f_one'), 'theory');
  assert.equal(g.claims.get('f_one').status, 'theory');
  // the session adjudicates and verifies under its own agent subject
  g.applyOp(op('claim.finding.adjudicate', { id: 'f_one', by: SESSION, outcome: 'confirm', why: 'looks right' }));
  g.applyOp(op('claim.finding.verify', { id: 'f_one', by: SESSION, record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } }));
  assert.equal(status(g, 'f_one'), 'theory');
  const hist = g.claims.get('f_one').finding.history;
  assert.deepEqual(hist.map((h) => [h.kind, h.effective]), [['adjudicate', false], ['verify', false]], 'both are recorded and neither takes effect');
  // a verification that did not pass is not a verification
  g.applyOp(op('claim.finding.verify', { id: 'f_one', by: VERIFIER, record: { kind: 'outcome.verified', event: 'evt-101', result: 'fail' } }));
  assert.equal(status(g, 'f_one'), 'theory');
});

test('SO-F-09 AC01: a person\'s adjudication or a passing verification record promotes a finding to fact, and a person can refute it', () => {
  const g = make();
  assert.equal(status(g, 'f_one'), 'conjecture');
  g.applyOp(op('claim.finding.adjudicate', { id: 'f_one', by: PERSON, outcome: 'confirm', why: 'I checked the plan' }));
  assert.equal(status(g, 'f_one'), 'fact');
  assert.equal(g.claims.get('f_one').status, 'fact');
  assert.equal(g.claims.get('f_one').history.at(-1).to, 'fact');
  const h = make({ id: 'f_two' });
  h.applyOp(op('claim.finding.verify', { id: 'f_two', by: VERIFIER, record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } }));
  assert.equal(status(h, 'f_two'), 'fact');
  const r = make({ id: 'f_three' });
  r.applyOp(op('claim.finding.adjudicate', { id: 'f_three', by: PERSON, outcome: 'reject', why: 'not so' }));
  assert.equal(status(r, 'f_three'), 'refuted');
});

test('SO-F-09 AC01: a finding is rebuilt identically from its operations and from a saved snapshot', () => {
  const ops = [
    op('claim.finding', finding()),
    op('claim', { id: 'f_one', subject: 'checkout service', predicate: 'is blocked by', object: 'payments migration', stance: 'support', strength: 0.95, path: null, text: null, source: 'a' }),
    op('claim', { id: 'f_one', subject: 'checkout service', predicate: 'is blocked by', object: 'payments migration', stance: 'support', strength: 0.95, path: null, text: null, source: 'b' }),
    op('claim.finding.correct', { id: 'f_one', by: PERSON, changes: { object: 'billing migration' }, why: 'wrong target' }),
    op('claim.finding.adjudicate', { id: 'f_one', by: PERSON, outcome: 'confirm', why: 'ok' }),
  ];
  const live = new Graph(); for (const o of ops) live.applyOp(o);
  const replay = new Graph(); for (const o of ops) replay.applyOp(o);
  assert.deepEqual([...replay.claims.values()], [...live.claims.values()]);
  const snap = JSON.parse(JSON.stringify([...live.claims.values()]));
  const restored = new Graph(); for (const c of snap) restored.claims.set(c.id, c);
  assert.deepEqual(Graph.assess(restored.claims.get('f_one')), Graph.assess(live.claims.get('f_one')));
  assert.deepEqual(restored.claims.get('f_one').finding, live.claims.get('f_one').finding);
  assert.equal(live.claims.get('f_one').status, 'fact');
});

test('SO-F-09 AC02: dismissal, correction and adjudication are events with a named actor, and an event for no finding changes nothing', () => {
  assert.deepEqual([...FINDING_EVENTS].sort(), ['claim.finding.adjudicate', 'claim.finding.correct', 'claim.finding.dismiss', 'claim.finding.verify']);
  const g = make();
  const before = JSON.stringify([...g.claims.values()]);
  for (const [type, data] of [
    ['claim.finding.dismiss', { id: 'f_none', by: PERSON }],
    ['claim.finding.correct', { id: 'f_none', by: PERSON, changes: { object: 'x' } }],
    ['claim.finding.adjudicate', { id: 'f_none', by: PERSON, outcome: 'confirm' }],
  ]) g.applyOp(op(type, data));
  assert.equal(JSON.stringify([...g.claims.values()]), before);
  // an event with no valid actor is refused by the check and ignored by the graph
  for (const [type, data] of [
    ['claim.finding.dismiss', { id: 'f_one' }], ['claim.finding.dismiss', { id: 'f_one', by: 'nobody' }],
    ['claim.finding.adjudicate', { id: 'f_one', by: PERSON, outcome: 'maybe' }],
    ['claim.finding.correct', { id: 'f_one', by: PERSON, changes: {} }],
  ]) {
    assert.equal(g.checkFindingEvent(type, data).ok, false, `${type} ${JSON.stringify(data)}`);
    g.applyOp(op(type, data));
  }
  assert.equal(g.claims.get('f_one').finding.history.length, 0);
  assert.equal(g.claims.get('f_one').finding.dismissed, null);
  assert.equal(g.checkFindingEvent('claim.finding.dismiss', { id: 'f_one', by: PERSON, why: 'noise' }).ok, true);
});

test('SO-F-09 AC02: a dismissed finding does not recur for the same sources and versions', () => {
  const g = make();
  g.applyOp(op('claim.finding.dismiss', { id: 'f_one', by: PERSON, why: 'known and accepted' }));
  assert.ok(g.claims.get('f_one').finding.dismissed, 'dismissed is recorded on the finding');
  const same = finding({ id: 'f_again', sources: [{ event: 'evt-101', version: 3, scope: TEAM_A }], subject: 'checkout', predicate: 'waits on', object: 'payments' });
  const r = admit(g, same);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'dismissed');
  assert.ok(!('of' in r));
  g.applyOp(op('claim.finding', same));
  assert.equal(g.claims.has('f_again'), false, 'the graph does not take it back in on replay either');
  // the source set is compared as a set
  const two = [{ event: 'evt-101', version: 3, scope: TEAM_A }, { event: 'evt-102', version: 1, scope: TEAM_A }];
  const h = make({ sources: two });
  h.applyOp(op('claim.finding.dismiss', { id: 'f_one', by: PERSON }));
  assert.equal(admit(h, finding({ id: 'f_x', sources: [two[1], two[0]] })).code, 'dismissed');
  // a new version of a source, or a different source, is new evidence and may be raised
  assert.equal(admit(g, finding({ id: 'f_v4', sources: [{ event: 'evt-101', version: 4, scope: TEAM_A }] })).ok, true);
  assert.equal(admit(g, finding({ id: 'f_other', sources: [{ event: 'evt-777', version: 3, scope: TEAM_A }] })).ok, true);
  assert.equal(admit(g, finding({ id: 'f_more', sources: [...same.sources, { event: 'evt-102', version: 1, scope: TEAM_A }] })).ok, true);
});

test('SO-F-09 AC02: a corrected finding carries each correction in its history, and provenance cannot be corrected', () => {
  const g = make();
  g.applyOp(op('claim.finding.correct', { id: 'f_one', by: PERSON, changes: { object: 'billing migration', confidence: 0.8 }, why: 'wrong system' }));
  const c = g.claims.get('f_one');
  assert.equal(c.object, 'billing migration');
  assert.equal(c.finding.confidence, 0.8);
  assert.equal(c.finding.history.length, 1);
  const h = c.finding.history[0];
  assert.equal(h.kind, 'correct');
  assert.equal(h.by, PERSON);
  assert.equal(h.why, 'wrong system');
  assert.deepEqual(h.changed, { object: { from: 'payments migration', to: 'billing migration' }, confidence: { from: 0.6, to: 0.8 } });
  assert.equal(h.effective, true);
  g.applyOp(op('claim.finding.correct', { id: 'f_one', by: PERSON, changes: { predicate: 'waits for' } }));
  assert.deepEqual(c.finding.history.map((x) => x.kind), ['correct', 'correct'], 'history is appended in order');
  assert.deepEqual(c.finding.history[1].changed, { predicate: { from: 'is blocked by', to: 'waits for' } });
  for (const changes of [{ scope: TEAM_B }, { sources: [] }, { id: 'f_z' }, { confidence: 2 }]) {
    assert.equal(g.checkFindingEvent('claim.finding.correct', { id: 'f_one', by: PERSON, changes }).ok, false, JSON.stringify(changes));
  }
  assert.deepEqual(c.finding.scope, TEAM_A);
  assert.equal(c.finding.history.length, 2);
});

test('SO-F-09 AC02: a dismissed finding is out of the default listing and stays in the record', () => {
  const g = make();
  g.applyOp(op('claim.finding', finding({ id: 'f_keep', sources: [{ event: 'evt-200', version: 1, scope: TEAM_A }] })));
  g.applyOp(op('claim.finding.dismiss', { id: 'f_one', by: PERSON, why: 'noise' }));
  const reader = readerFor(TEAM_A);
  assert.deepEqual(g.listFindings(reader).map((f) => f.id), ['f_keep']);
  assert.deepEqual(g.listFindings(reader, { includeDismissed: true }).map((f) => f.id).sort(), ['f_keep', 'f_one']);
  assert.ok(g.claims.has('f_one'));
});

// ---- AC03: a reader sees only what the source's scope allows -------------------------------------
const MARK = 'quarterly-layoff-plan-zebra';
const mixed = (over = {}) => make({
  sources: [
    { event: 'evt-101', version: 3, scope: TEAM_A, path: 'notes/checkout.md', excerpt: 'checkout waits on the payments migration' },
    { event: 'evt-secret-77', version: 9, scope: TEAM_B, path: `hr/${MARK}.md`, excerpt: `the ${MARK} names the billing owners` },
  ],
  subject: `staffing ${MARK}`, object: 'billing team',
  entities: [{ id: 'ent-payments', source: 0 }, { id: `ent-${MARK}`, source: 1 }],
  owners: [{ subject: 'person:lead', source: 0 }, { subject: 'person:hr-head', source: 1 }],
  ...over,
});
// a reader is a credential resolved by the graph: an organisational token that names its subject, held against the scope it reaches for
const tokenFor = (scope, subject = { id: 'person:reader', type: 'person', owner: 'person:reader' }) => ({ id: 'tok1', agent: 'reader-app', identity_scope: scope, subject });
const readerFor = (scope) => resolveActor(tokenFor(scope), { target: scope });

test('SO-F-09 AC03: a finding shown to a subject without permission names neither the record nor its content', () => {
  const g = mixed();
  g.applyOp(op('claim.finding.correct', { id: 'f_one', by: PERSON, changes: { object: `the ${MARK} cohort` }, why: `see ${MARK}` }));
  const v = g.viewFinding('f_one', readerFor(TEAM_A));
  assert.ok(v, 'the reader can reach the finding scope');
  const text = JSON.stringify(v);
  for (const secret of ['evt-secret-77', MARK, 'hr/', 'hr-head', 'names the billing owners', '"version":9']) assert.ok(!text.includes(secret), `view leaks ${secret}`);
  assert.equal(v.withheld, true);
  assert.equal(v.statement, null);
  assert.equal(v.hidden_sources, 1);
  assert.deepEqual(v.sources.map((s) => s.event), ['evt-101']);
  assert.deepEqual(v.entities.map((e) => e.id), ['ent-payments']);
  assert.deepEqual(v.owners.map((o) => o.subject), ['person:lead']);
  assert.ok(v.history.length === 1 && v.history[0].kind === 'correct' && !('why' in v.history[0]) && !('changed' in v.history[0]));
  assert.ok(!('evidence' in v));
  // the serialised graph is untouched by viewing
  assert.ok(JSON.stringify(g.claims.get('f_one')).includes('evt-secret-77'));
});

test('SO-F-09 AC03: a reader who may read every source sees the statement and the sources in full, and a reader outside the scope sees nothing', () => {
  const g = make();
  const full = g.viewFinding('f_one', readerFor(TEAM_A));
  assert.equal(full.withheld, false);
  assert.deepEqual(full.statement, { subject: 'checkout service', predicate: 'is blocked by', object: 'payments migration' });
  assert.deepEqual(full.sources.map((s) => [s.event, s.version, s.path]), [['evt-101', 3, 'notes/checkout.md']]);
  assert.equal(full.hidden_sources, 0);
  assert.equal(g.viewFinding('f_one', readerFor(TEAM_B)), null);
  assert.equal(g.viewFinding('f_nonexistent', readerFor(TEAM_B)), null, 'a missing finding and a forbidden one look the same');
  assert.equal(g.viewFinding('f_one', { ok: false }), null);
  assert.equal(g.viewFinding('f_one', null), null);
});

test('SO-F-09 AC03: a listing leaves out findings in scopes the reader cannot reach and does not count them', () => {
  const g = mixed();
  g.applyOp(op('claim.finding', finding({ id: 'f_b', scope: TEAM_B, sources: [{ event: 'evt-b1', version: 1, scope: TEAM_B }], subject: `b ${MARK}` })));
  const list = g.listFindings(readerFor(TEAM_A));
  assert.equal(list.length, 1, 'the finding in team B is not there, and not counted');
  assert.equal(list[0].withheld, true);
  assert.ok(!JSON.stringify(list).includes('evt-secret-77') && !JSON.stringify(list).includes(MARK));
  assert.deepEqual(g.listFindings(readerFor({ type: 'team', id: 'team-c' })), []);
  assert.deepEqual(g.listFindings(null), []);
});

test('SO-F-09 AC03: the reader comes from the identity model, and a reader from another scope is held out', () => {
  const g = mixed();
  const identity = tokenFor;
  const asA = resolveActor(identity(TEAM_A), { target: TEAM_A });
  assert.equal(asA.ok, true);
  assert.equal(g.viewFinding('f_one', resolveRequest(identity(TEAM_A), { target: TEAM_A })), null, 'what resolveRequest returns is a plain object, not a reader');
  const v = g.viewFinding('f_one', asA);
  assert.equal(v.withheld, true);
  assert.ok(!JSON.stringify(v).includes('evt-secret-77'));
  const asB = resolveActor(identity(TEAM_B), { target: TEAM_B });
  assert.equal(asB.ok, true);
  assert.equal(g.viewFinding('f_one', asB), null, 'the finding scope is team A, so a team B reader does not reach it');
});

// ---- review response: behaviour the first version got wrong --------------------------------------
const MARK_ID = `f_${MARK}`;

test('SO-F-09 AC01: a verification record counts only when it names one of the finding\'s own source events', () => {
  const g = make();
  const nonexistent = { id: 'f_one', by: 'service:fake', record: { kind: 'outcome.verified', event: 'evt-does-not-exist', result: 'pass' } };
  assert.equal(g.checkFindingEvent('claim.finding.verify', nonexistent).ok, false, 'the check refuses it');
  g.applyOp(op('claim.finding.verify', nonexistent));
  assert.equal(status(g, 'f_one'), 'conjecture', 'a verification of an event the finding does not rest on makes no fact');
  assert.equal(g.claims.get('f_one').finding.history.length, 0);
  const real = { id: 'f_one', by: VERIFIER, record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } };
  assert.equal(g.checkFindingEvent('claim.finding.verify', real).ok, true);
  g.applyOp(op('claim.finding.verify', real));
  assert.equal(status(g, 'f_one'), 'fact');
});

test('SO-F-09 AC03: a reader that did not come from the identity model is refused', () => {
  const g = make();
  for (const forged of [{ ok: true, scope: TEAM_A }, { ok: true, subject: { id: 'person:owner', type: 'person' }, scope: TEAM_A }, { ok: true, subject: { id: 'person:owner', type: 'person', owner: 'person:owner' }, scope: TEAM_A, credential: 'tok1' }]) {
    assert.equal(g.viewFinding('f_one', forged), null, JSON.stringify(forged));
    assert.deepEqual(g.listFindings(forged), []);
  }
});

test('SO-F-09 AC03: a partial view withholds the id, status, capped flag, confidence, context and the outcome of decisions', () => {
  const g = mixed({ id: MARK_ID });
  for (const s of ['a', 'b']) evidence(g, MARK_ID, 'support', 0.95, s);
  g.applyOp(op('claim.finding.adjudicate', { id: MARK_ID, by: PERSON, outcome: 'confirm', why: `ok ${MARK}` }));
  const v = g.viewFinding(MARK_ID, readerFor(TEAM_A));
  assert.ok(v && v.withheld === true);
  for (const k of ['id', 'status', 'capped', 'confidence', 'context', 'dismissed', 'statement']) assert.equal(v[k], null, `${k} is withheld`);
  assert.ok(!JSON.stringify(v).includes(MARK), 'the caller-chosen id does not appear');
  assert.deepEqual(v.history.map((h) => Object.keys(h).sort()), [['kind', 'seq', 'ts']], 'only that a decision of some kind was made');
  const list = g.listFindings(readerFor(TEAM_A));
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(MARK));
  // a reader who may read every source still gets all of it
  const full = make({ id: MARK_ID });
  const f = full.viewFinding(MARK_ID, readerFor(TEAM_A));
  assert.equal(f.id, MARK_ID);
  assert.equal(f.status, 'conjecture');
  assert.equal(f.confidence, 0.6);
  assert.deepEqual(f.context, { from: '2026-10-01T00:00:00Z', to: null });
});

test('SO-F-09.2 D4: an entity or owner tied to the finding as a whole (source null) is hidden from a partial view and a listing, and shown in a full one', () => {
  const g = make({
    sources: [
      { event: 'evt-101', version: 3, scope: TEAM_A, path: 'notes/checkout.md' },
      { event: 'evt-secret-77', version: 9, scope: TEAM_B, path: `hr/${MARK}.md` },
    ],
    entities: [{ id: 'ent-payments', source: 0 }, { id: `ent-whole-${MARK}`, source: null }],
    owners: [{ subject: 'person:lead', source: 0 }, { subject: 'person:whole-hr-head', source: null }],
  });
  const partial = g.viewFinding('f_one', readerFor(TEAM_A));
  assert.equal(partial.withheld, true);
  assert.deepEqual(partial.entities.map((e) => e.id), ['ent-payments']);
  assert.deepEqual(partial.owners.map((o) => o.subject), ['person:lead']);
  assert.ok(!JSON.stringify(partial).includes('whole'));
  const listed = g.listFindings(readerFor(TEAM_A));
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].entities.map((e) => e.id), ['ent-payments']);
  assert.ok(!JSON.stringify(listed).includes('whole'), 'a listing shows neither');
  const one = make({
    entities: [{ id: 'ent-payments', source: 0 }, { id: 'ent-whole', source: null }],
    owners: [{ subject: 'person:lead', source: 0 }, { subject: 'person:whole-head', source: null }],
  });
  const full = one.viewFinding('f_one', readerFor(TEAM_A));
  assert.deepEqual(full.entities.map((e) => e.id), ['ent-payments', 'ent-whole']);
  assert.deepEqual(full.owners.map((o) => o.subject), ['person:lead', 'person:whole-head']);
});

test('SO-F-09 AC01: a verification does not override a person\'s decision, and a person\'s confirmation over strong opposition is marked overridden', () => {
  const verifyPass = (id) => op('claim.finding.verify', { id, by: VERIFIER, record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } });
  const g = make();
  g.applyOp(op('claim.finding.adjudicate', { id: 'f_one', by: PERSON, outcome: 'reject', why: 'not so' }));
  g.applyOp(verifyPass('f_one'));
  assert.equal(status(g, 'f_one'), 'refuted', 'a service verification does not turn a person\'s rejection into a fact');
  assert.deepEqual(g.claims.get('f_one').finding.history.map((h) => [h.kind, h.effective]), [['adjudicate', true], ['verify', false]]);
  g.applyOp(op('claim.finding.adjudicate', { id: 'f_one', by: PERSON, outcome: 'confirm', why: 'second look' }));
  assert.equal(status(g, 'f_one'), 'fact', 'a person can change their own decision');
  const h = make({ id: 'f_two' });
  h.applyOp(verifyPass('f_two'));
  h.applyOp(op('claim.finding.adjudicate', { id: 'f_two', by: PERSON, outcome: 'reject' }));
  assert.equal(status(h, 'f_two'), 'refuted', 'a person after a verification decides');
  const o = make({ id: 'f_three' });
  for (const s of ['a', 'b', 'c']) evidence(o, 'f_three', 'oppose', 0.95, s);
  assert.equal(status(o, 'f_three'), 'refuted');
  o.applyOp(op('claim.finding.adjudicate', { id: 'f_three', by: PERSON, outcome: 'confirm', why: 'I know better' }));
  const a = Graph.assess(o.claims.get('f_three'));
  assert.equal(a.status, 'fact', 'a person\'s confirmation stands');
  assert.ok(a.opposition > 0.99);
  assert.equal(a.overridden, 'refuted', 'and says which evidence status it overrode');
  assert.equal(Graph.assess(make({ id: 'f_four' }).claims.get('f_four')).overridden, undefined);
});

test('SO-F-09 AC02: a dismissal holds only in the scope it was made in, and the refusal does not name the dismissed finding', () => {
  const g = make();
  g.applyOp(op('claim.finding.dismiss', { id: 'f_one', by: PERSON, why: 'noise' }));
  const same = finding({ id: 'f_again' });
  const refused = admit(g, same);
  assert.equal(refused.code, 'dismissed');
  assert.ok(!('of' in refused), 'no id of the dismissed finding');
  assert.ok(!JSON.stringify(refused).includes('f_one'));
  const elsewhere = finding({ id: 'f_b', scope: TEAM_B, sources: [{ event: 'evt-101', version: 3, scope: TEAM_B }] });
  assert.equal(admit(g, elsewhere).ok, true, 'the same event and version in another scope is not blocked');
  g.applyOp(op('claim.finding', elsewhere));
  assert.ok(g.claims.has('f_b'), 'and replay takes it in');
  g.applyOp(op('claim.finding.dismiss', { id: 'f_b', by: PERSON }));
  assert.equal(admit(g, finding({ id: 'f_b2', scope: TEAM_B, sources: [{ event: 'evt-101', version: 3, scope: TEAM_B }] })).code, 'dismissed', 'each scope has its own dismissal');
});

// ---- the credential-bound entry points -------------------------------------------------------------
const PERSON_TOKEN = (scope, id = 'person:lead') => tokenFor(scope, { id, type: 'person', owner: id });
const bound = (g, reader, type, fields) => { const r = bind(g, reader, type, fields); if (r.ok) g.applyOp(op(r.type, r.data)); return r; };

test('SO-F-09.2 D3c: resolveActor resolves a personal-scope agent to agent:<name> owned by person:owner, never to person:owner, and leaves resolveRequest as it was', () => {
  const org = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  assert.equal(org.ok, true);
  assert.equal(org.subject.id, 'person:lead');
  assert.deepEqual(org.scope, TEAM_A);
  assert.ok(Object.isFrozen(org) && Object.isFrozen(org.subject) && Object.isFrozen(org.scope));
  // a token with no identity scope resolves to the owner person in resolveRequest, agents included; here it is the agent it names
  assert.deepEqual(resolveRequest({ id: 'tok2', agent: 'claude-session' }), { ok: true, subject: { id: 'person:owner', type: 'person', owner: 'person:owner' }, scope: { type: 'personal', id: 'personal' }, credential: 'tok2' }, 'resolveRequest is as it was');
  assert.equal(resolveActor({ id: 'tok2', agent: 'claude-session' }).owner, 'person:owner');
  const personal = resolveActor({ id: 'tok2', agent: 'claude-session' });
  assert.equal(resolveRequest({ id: 'tok2', agent: 'claude-session' }).subject.id, 'person:owner', 'the identity model maps it to the owner');
  assert.equal(personal.subject.id, 'agent:claude-session');
  assert.equal(personal.subject.type, 'agent');
  assert.equal(resolveActor({ id: 'tok3', agent: 'a b' }).ok, false, 'an agent name that makes no subject id is refused');
  const bind = resolveActor({ role: 'reviewer', principal: 'lead' }, { scope: TEAM_A, target: TEAM_A });
  assert.equal(bind.ok, true);
  assert.equal(bind.subject.id, 'agent:reviewer');
  assert.equal(bind.subject.owner, 'person:lead');
  assert.deepEqual(bind.scope, TEAM_A);
  // one or the other, a scope mismatch and a revoked subject are refused with the identity model's code
  assert.equal(resolveActor({}).ok, false);
  assert.equal(resolveActor(null).code, 'no_identity');
  assert.equal(resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_B }).code, 'scope_mismatch');
  assert.equal(resolveActor({ role: 'reviewer', principal: 'lead' }, { scope: TEAM_A, target: TEAM_B }).code, 'scope_mismatch');
  assert.equal(resolveActor({ ...PERSON_TOKEN(TEAM_A), subject: { id: 'person:lead', type: 'person', owner: 'person:lead', revoked_at: '2020-01-01T00:00:00Z' } }).code, 'revoked');
});

test('SO-F-09.2 D3a: bindFindingEvent takes by from the credential and ignores the caller\'s, so a forged person does not make a fact', () => {
  const g = make();
  const agent = resolveActor({ id: 'tok2', agent: 'stub-session', identity_scope: TEAM_A, subject: { id: 'agent:stub-session', type: 'agent', owner: 'person:lead', role: 'worker' } }, { target: TEAM_A });
  const adj = bound(g, agent, 'claim.finding.adjudicate', { id: 'f_one', by: 'person:forged', outcome: 'confirm', why: 'trust me' });
  assert.equal(adj.ok, true);
  assert.equal(adj.data.by, 'agent:stub-session', 'the forged person is replaced');
  assert.equal(status(g, 'f_one'), 'conjecture');
  const ver = bound(g, agent, 'claim.finding.verify', { id: 'f_one', by: 'service:fake', record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } });
  assert.equal(ver.data.by, 'agent:stub-session');
  assert.equal(status(g, 'f_one'), 'conjecture', 'an agent\'s verification does nothing');
  assert.deepEqual(g.claims.get('f_one').finding.history.map((h) => [h.kind, h.by, h.effective]), [['adjudicate', 'agent:stub-session', false], ['verify', 'agent:stub-session', false]]);
  // the same call under a person credential is the real thing
  const lead = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  bound(g, lead, 'claim.finding.adjudicate', { id: 'f_one', by: 'agent:someone-else', outcome: 'confirm' });
  assert.equal(g.claims.get('f_one').finding.history.at(-1).by, 'person:lead');
  assert.equal(status(g, 'f_one'), 'fact');
  // a personal-scope token is an agent too, never the owner person
  const h = make({ id: 'f_two', scope: { type: 'personal', id: 'personal' }, sources: [{ event: 'evt-101', version: 3, scope: { type: 'personal', id: 'personal' } }] });
  const tok = resolveActor({ id: 'tok9', agent: 'editor' });
  bound(h, tok, 'claim.finding.adjudicate', { id: 'f_two', by: 'person:owner', outcome: 'confirm' });
  assert.equal(h.claims.get('f_two').finding.history[0].by, 'agent:editor');
  assert.equal(status(h, 'f_two'), 'conjecture');
});

test('SO-F-09 AC01: bindFindingEvent checks the finding exists in a scope the credential reaches, and a verification names a source event', () => {
  const g = make();
  const lead = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  const other = resolveActor(PERSON_TOKEN(TEAM_B), { target: TEAM_B });
  const missing = bind(g, lead, 'claim.finding.dismiss', { id: 'f_none' });
  const forbidden = bind(g, other, 'claim.finding.dismiss', { id: 'f_one' });
  assert.equal(missing.code, 'not_found');
  assert.equal(forbidden.code, 'not_found', 'a finding in a scope the credential does not reach looks like a missing one');
  assert.equal(bind(g, other, 'claim.finding.adjudicate', { id: 'f_one', outcome: 'confirm' }).code, 'not_found');
  assert.equal(bind(g, lead, 'claim.finding.verify', { id: 'f_one', record: { kind: 'outcome.verified', event: 'evt-nope', result: 'pass' } }).code, 'invalid');
  assert.equal(bind(g, lead, 'claim.finding.verify', { id: 'f_one', record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } }).ok, true);
  assert.equal(bind(g, lead, 'claim.finding.adjudicate', { id: 'f_one', outcome: 'maybe' }).code, 'invalid');
  assert.equal(bind(g, lead, 'claim.finding.shrug', { id: 'f_one' }).code, 'invalid');
  for (const bad of [null, {}, { ok: true, subject: { id: 'person:owner', type: 'person' }, scope: TEAM_A }, resolveRequest(tokenFor(TEAM_A), { target: TEAM_A })]) {
    assert.equal(bind(g, bad, 'claim.finding.dismiss', { id: 'f_one' }).code, 'no_credential');
    assert.equal(bind(g, bad, 'claim.finding', finding({ id: 'f_x' })).code, 'no_credential');
  }
  assert.equal(g.claims.get('f_one').finding.history.length, 0, 'nothing was applied');
});

test('SO-F-09 AC01: bindFindingEvent takes the raiser from the credential, holds it to the finding\'s scope and still applies the dismissal rule', () => {
  const g = new Graph();
  const lead = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  const r = bind(g, lead, 'claim.finding', finding({ by: 'person:forged' }));
  assert.equal(r.ok, true);
  assert.equal(r.type, 'claim.finding');
  assert.equal(r.data.by, 'person:lead');
  g.applyOp(op(r.type, r.data));
  assert.equal(g.claims.get('f_one').finding.raised_by, 'person:lead');
  assert.equal(bind(g, lead, 'claim.finding', finding({ id: 'f_b', scope: TEAM_B })).code, 'scope_mismatch', 'a team A credential does not raise a finding in team B');
  assert.equal(bind(g, lead, 'claim.finding', finding({ id: 'f_one' })).code, 'exists');
  assert.equal(bind(g, lead, 'claim.finding', finding({ id: 'f_bad', confidence: 3 })).code, 'invalid');
  bound(g, lead, 'claim.finding.dismiss', { id: 'f_one' });
  assert.equal(bind(g, lead, 'claim.finding', finding({ id: 'f_again' })).code, 'dismissed');
});

test('SO-F-09 AC03: a status filter and the dismissed filter of a listing do not give away what a partial view withholds', () => {
  const g = mixed();
  g.applyOp(op('claim.finding', finding({ id: 'f_keep', sources: [{ event: 'evt-200', version: 1, scope: TEAM_A }] })));
  for (const s of ['a', 'b']) evidence(g, 'f_one', 'support', 0.8, s);
  g.applyOp(op('claim.finding.adjudicate', { id: 'f_one', by: PERSON, outcome: 'confirm' }));
  g.applyOp(op('claim.finding.dismiss', { id: 'f_one', by: PERSON }));
  const reader = readerFor(TEAM_A);
  const sizes = (o) => g.listFindings(reader, o).length;
  assert.equal(sizes({}), 2, 'the withheld one is listed, whether or not it was dismissed');
  assert.equal(sizes({ includeDismissed: true }), 2);
  assert.equal(sizes({ status: 'fact' }), 1, 'only the withheld one is left: a fact would show as one');
  assert.equal(sizes({ status: 'refuted' }), 1, 'and it is there for every other status too');
  assert.equal(g.listFindings(reader, { status: 'refuted' })[0].withheld, true);
});

test('SO-F-09 AC04: the page says who counts is a credential, what is unbuilt, and what is provisional', () => {
  const read = (...p) => { const f = path.join(PKG, ...p); assert.ok(fs.existsSync(f), `${p.join('/')} exists`); return fs.readFileSync(f, 'utf8'); };
  const page = read('docs', 'ORGANISATIONAL-INTELLIGENCE.md');
  const log = read('changelog.d', 'SO-F-09.md');
  for (const re of [
    /resolveActor/, /bindFindingEvent/, /FINDING_AUTHORITY/, /sets it from the resolved credential/, /ignores any `by`/, /unbuilt/i,
    /as trusted as the log/, /does not authenticate a credential/,
    /ADR 5/, /SO-A-05/, /provisional/i, /dismiss/, /permanent/, /opposition/, /overridden/,
  ]) assert.match(page, re);
  assert.ok(!/never from what a session says about itself/.test(page), 'the sentence that contradicted the `by` paragraph is gone');
  assert.match(page, /no command issues a service or an operator subject yet/i);
  assert.ok(!/cannot be issued yet/.test(page), 'TokenStore.issue accepts those subjects, so the page does not say they cannot be issued');
  assert.match(page, /a person acting in the personal scope needs a token that carries a person subject/i);
  assert.match(page, /must be closed before any writer calls `bindFindingEvent`/);
  assert.ok(!/^Planned\. The finding model/m.test(page), 'the finding model section says built and tested');
  assert.match(page, /Built and tested as a data model/);
  assert.match(log, /resolveActor/);
  assert.match(log, /FINDING_AUTHORITY/);
  assert.match(log, /provisional/i);
});

test('SO-F-09 AC02: the finding\'s own scope is part of the dismissal key, apart from the scopes of its sources', () => {
  const g = make();
  g.applyOp(op('claim.finding.dismiss', { id: 'f_one', by: PERSON }));
  const src = [{ event: 'evt-101', version: 3, scope: TEAM_A }];
  assert.equal(admit(g, finding({ id: 'f_a2', sources: src })).code, 'dismissed');
  assert.equal(admit(g, finding({ id: 'f_b2', scope: TEAM_B, sources: src })).ok, true, 'the same sources raised in another finding scope');
  assert.notEqual(Graph.findingKey(src, TEAM_A), Graph.findingKey(src, TEAM_B));
  assert.equal(Graph.findingKey(src, TEAM_A), Graph.findingKey([{ event: 'evt-101', version: 3 }], TEAM_A), 'a source with no scope has the finding\'s');
});

test('SO-F-09.2 D3c: a personal-scope credential that names the person subject resolves to a person, and what resolveActor returns is the only reader', () => {
  const PERSONAL = { type: 'personal', id: 'personal' };
  const p = resolveActor({ id: 'tok5', agent: 'cli', identity_scope: PERSONAL, subject: { id: 'person:owner', type: 'person', owner: 'person:owner' } }, { target: PERSONAL });
  assert.equal(p.ok, true);
  assert.equal(p.subject.id, 'person:owner');
  assert.equal(isResolvedActor(p), true);
  assert.equal(isResolvedActor({ ...p }), false, 'a copy of the same shape is not one');
  assert.equal(isResolvedActor(resolveRequest({ id: 'tok5', agent: 'cli' })), false);
  assert.equal(resolveActor({ id: 'tok5', agent: 'cli', identity_scope: PERSONAL, subject: { id: 'person:owner', type: 'person', owner: 'person:other' } }).ok, false, 'a subject that does not validate is refused');
  assert.equal(resolveActor({ id: 'tok5', agent: 'cli' }, { target: TEAM_A }).code, 'scope_mismatch');
});

test('SO-F-09.2 D3b: a verification through bindFindingEvent with a forged service or person by leaves a finding at theory with no decision, and an unresolved credential records nothing', () => {
  const g = make();
  const agent = resolveActor({ id: 'tok2', agent: 'stub-session' }, { target: { type: 'personal', id: 'personal' } });
  const h = make({ scope: { type: 'personal', id: 'personal' }, sources: [{ event: 'evt-101', version: 3, scope: { type: 'personal', id: 'personal' } }] });
  for (const forged of ['service:x', 'person:x']) {
    const r = bound(h, agent, 'claim.finding.verify', { id: 'f_one', by: forged, record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } });
    assert.equal(r.ok, true);
    assert.equal(r.data.by, 'agent:stub-session', 'the caller\'s by is dropped from the logged data');
  }
  assert.equal(status(h, 'f_one'), 'conjecture');
  assert.equal(h.claims.get('f_one').finding.decision, null);
  assert.ok(h.claims.get('f_one').finding.history.every((x) => x.effective === false && x.by === 'agent:stub-session'));
  const unresolved = resolveActor({ id: 'tok3', agent: 'a b' });
  assert.equal(unresolved.ok, false);
  const before = g.claims.get('f_one').finding.history.length;
  const r = bound(g, unresolved, 'claim.finding.verify', { id: 'f_one', by: 'service:x', record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } });
  assert.equal(r.code, 'no_credential');
  assert.equal(g.claims.get('f_one').finding.history.length, before);
});

test('SO-F-09.2 D3d: through bindFindingEvent a person credential\'s confirmation and a service credential\'s passing verification make a fact, with by set from the credential', () => {
  const lead = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  const svc = resolveActor({ id: 'tok7', agent: 'checker', identity_scope: TEAM_A, subject: { id: 'service:checker', type: 'service', owner: 'person:lead' } }, { target: TEAM_A });
  assert.equal(svc.ok, true);
  const g = make();
  bound(g, lead, 'claim.finding.adjudicate', { id: 'f_one', by: 'agent:liar', outcome: 'confirm' });
  assert.equal(status(g, 'f_one'), 'fact');
  assert.equal(g.claims.get('f_one').finding.decision.by, 'person:lead');
  const h = make();
  bound(h, svc, 'claim.finding.verify', { id: 'f_one', by: 'person:liar', record: { kind: 'outcome.verified', event: 'evt-101', result: 'pass' } });
  assert.equal(status(h, 'f_one'), 'fact');
  assert.equal(h.claims.get('f_one').finding.decision.by, 'service:checker');
});

test('SO-F-09.2 D5: who may adjudicate, verify and dismiss are one frozen provisional table, and an agent or a service cannot dismiss', () => {
  const A = graphModule.FINDING_AUTHORITY;
  assert.ok(A && typeof A === 'object', 'graph.mjs exports FINDING_AUTHORITY');
  assert.deepEqual(A.adjudicate.subjects, ['person']);
  assert.deepEqual(A.adjudicate.outcomes, ['confirm', 'reject']);
  assert.deepEqual(A.verify.subjects, ['person', 'operator', 'service']);
  assert.deepEqual(A.dismiss.subjects, ['person', 'operator']);
  for (const k of ['adjudicate', 'verify', 'dismiss']) assert.equal(A[k].provisional, true);
  assert.match(A.provisional, /ADR 5/);
  assert.match(A.provisional, /SO-A-05/);
  assert.ok(Object.isFrozen(A) && Object.isFrozen(A.adjudicate) && Object.isFrozen(A.adjudicate.subjects) && Object.isFrozen(A.adjudicate.outcomes) && Object.isFrozen(A.verify.subjects) && Object.isFrozen(A.dismiss) && Object.isFrozen(A.dismiss.subjects));
  assert.throws(() => { A.dismiss.subjects.push('agent'); });
  assert.throws(() => { A.dismiss = {}; });
});

test('SO-F-09.2 D6: a dismissal by an agent or a service changes nothing and the finding stays raisable, while one by a person or an operator takes effect and blocks it', () => {
  // straight through the log, with no credential in the way: this part needs only the finding model and the dismissal rule
  const again = () => finding({ id: 'f_again' });
  for (const by of ['agent:stub-session', 'service:checker', 'device:laptop', 'node:n1']) {
    const g = make();
    g.applyOp(op('claim.finding.dismiss', { id: 'f_one', by, why: 'not wanted' }));
    const f = g.claims.get('f_one').finding;
    assert.deepEqual(f.history.map((h) => [h.kind, h.by, h.effective]), [['dismiss', by, false]], `${by}: recorded as not effective`);
    assert.equal(f.dismissed, null, `${by} did not dismiss it`);
    assert.equal(admit(g, again()).ok, true, `${by}: a finding on the same sources and versions can still be raised`);
  }
  for (const by of ['person:lead', 'operator:ops']) {
    const g = make();
    g.applyOp(op('claim.finding.dismiss', { id: 'f_one', by, why: 'not wanted' }));
    const f = g.claims.get('f_one').finding;
    assert.equal(f.history.at(-1).effective, true, `${by}: it took effect`);
    assert.equal(f.dismissed?.by, by);
    assert.equal(admit(g, again()).code, 'dismissed', `${by}: the same sources and versions cannot be raised again`);
  }
  // and through the credential-bound entry point
  const lead = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  const agent = resolveActor({ id: 'tok2', agent: 'stub-session', identity_scope: TEAM_A, subject: { id: 'agent:stub-session', type: 'agent', owner: 'person:lead', role: 'worker' } }, { target: TEAM_A });
  const svc = resolveActor({ id: 'tok7', agent: 'checker', identity_scope: TEAM_A, subject: { id: 'service:checker', type: 'service', owner: 'person:lead' } }, { target: TEAM_A });
  const ops = resolveActor({ id: 'tok8', agent: 'ops', identity_scope: TEAM_A, subject: { id: 'operator:ops', type: 'operator', owner: 'person:lead' } }, { target: TEAM_A });
  for (const r of [lead, agent, svc, ops]) assert.equal(r.ok, true);
  const listed = (g) => g.listFindings(readerFor(TEAM_A)).length;

  // an agent subject and a service subject: recorded as not effective, nothing else
  for (const [who, actor, by] of [['agent', agent, 'agent:stub-session'], ['service', svc, 'service:checker']]) {
    const g = make();
    const r = bound(g, actor, 'claim.finding.dismiss', { id: 'f_one', by: 'person:forged', why: 'not wanted' });
    assert.equal(r.ok, true, `the ${who} event is accepted and recorded`);
    const f = g.claims.get('f_one').finding;
    assert.deepEqual(f.history.map((h) => [h.kind, h.by, h.effective]), [['dismiss', by, false]], `${who}: the history says it did not take effect`);
    assert.equal(f.dismissed, null, `${who}: the finding is not dismissed`);
    assert.equal(g.viewFinding('f_one', readerFor(TEAM_A)).dismissed, false);
    assert.equal(listed(g), 1, `${who}: it stays in the default listing`);
    assert.equal(admit(g, again()).ok, true, `${who}: a finding on the same sources and versions can still be raised`);
  }
  // a person subject and an operator subject: it takes effect, leaves the listing and blocks the same sources and versions
  for (const [who, actor, by] of [['person', lead, 'person:lead'], ['operator', ops, 'operator:ops']]) {
    const g = make();
    bound(g, actor, 'claim.finding.dismiss', { id: 'f_one', by: 'agent:forged', why: 'not wanted' });
    const f = g.claims.get('f_one').finding;
    assert.equal(f.history.at(-1).effective, true, `${who}: it took effect`);
    assert.equal(f.dismissed.by, by);
    assert.equal(g.viewFinding('f_one', readerFor(TEAM_A)).dismissed, true);
    assert.equal(listed(g), 0, `${who}: it leaves the default listing`);
    assert.equal(admit(g, again()).code, 'dismissed', `${who}: the same sources and versions cannot be raised again`);
    assert.equal(admit(g, finding({ id: 'f_new', sources: [{ event: 'evt-101', version: 4, scope: TEAM_A }] })).ok, true, 'a new version is new evidence');
  }
});

// ---- re-review: what a partial view still gave away, the dismissal key, and the checks of the entry point -------------------
test('SO-F-09 AC03: a partial view of a decided finding does not say that the decision overrode the evidence', () => {
  const g = mixed();
  for (const s of ['a', 'b', 'c']) evidence(g, 'f_one', 'oppose', 0.95, s);
  g.applyOp(op('claim.finding.adjudicate', { id: 'f_one', by: PERSON, outcome: 'confirm', why: 'I know better' }));
  const a = Graph.assess(g.claims.get('f_one'));
  assert.equal(a.status, 'fact');
  assert.equal(a.overridden, 'refuted', 'the finding is decided over strong opposition');
  const v = g.viewFinding('f_one', readerFor(TEAM_A));
  assert.equal(v.withheld, true);
  assert.equal(v.overridden, null);
  assert.equal(v.status, null);
  assert.equal(v.dismissed, null);
  assert.ok(!/refuted|"fact"|confirm|reject|"theory"/.test(JSON.stringify(v)), 'nothing in the partial view says what the decision overrode');
  const listed = g.listFindings(readerFor(TEAM_A))[0];
  assert.equal(listed.overridden, null);
  assert.deepEqual(listed.history.map((h) => Object.keys(h).sort()), [['kind', 'seq', 'ts']]);
});

test('SO-F-09 AC02: the scope of a source is part of the dismissal key, apart from the finding\'s own scope', () => {
  const g = make();
  bound(g, resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A }), 'claim.finding.dismiss', { id: 'f_one' });
  const inA = [{ event: 'evt-101', version: 3, scope: TEAM_A }];
  const inB = [{ event: 'evt-101', version: 3, scope: TEAM_B }];
  assert.notEqual(graphModule.Graph.findingKey(inA, TEAM_A), graphModule.Graph.findingKey(inB, TEAM_A), 'the same event and version in another scope is another source');
  assert.equal(admit(g, finding({ id: 'f_same', sources: inA })).code, 'dismissed');
  assert.equal(admit(g, finding({ id: 'f_other', sources: inB })).ok, true, 'a dismissal on a source in team A does not block the same event read in team B');
});

test('SO-F-09 AC01: bindFindingEvent copies the data before it checks it, and returns the copy it checked', () => {
  const g = make();
  const lead = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  // an object that names a source event on the first read and another on every later read
  let reads = 0;
  const record = { kind: 'outcome.verified', result: 'pass', get event() { reads += 1; return reads === 1 ? 'evt-101' : 'evt-nope'; } };
  const input = { id: 'f_one', record };
  const r = bind(g, lead, 'claim.finding.verify', input);
  assert.equal(r.ok, true, 'the copy names evt-101, which the finding rests on');
  assert.equal(r.data.record.event, 'evt-101');
  assert.notEqual(r.data.record, record, 'the operation holds a copy, not the caller\'s object');
  assert.equal(g.checkFindingEvent(r.type, r.data).ok, true, 'and what is returned is what was checked');
  input.record = { kind: 'outcome.verified', result: 'fail', event: 'evt-nope' };
  assert.equal(r.data.record.event, 'evt-101', 'a later change to the caller\'s object does not reach it');
  const fields = { ...finding({ id: 'f_copy' }), sources: [{ event: 'evt-101', version: 3, scope: TEAM_A }] };
  const raised = bind(new Graph(), lead, 'claim.finding', fields);
  assert.equal(raised.ok, true);
  assert.notEqual(raised.data.sources, fields.sources);
  assert.equal(bind(g, lead, 'claim.finding.dismiss', { id: 'f_one', why: 10n }).code, 'invalid', 'data that is not plain data is refused');
});

test('SO-F-09 AC03: a reader who can see only some sources gets the same refusal for a withheld source event as for one that does not exist', () => {
  const g = mixed();
  const lead = resolveActor(PERSON_TOKEN(TEAM_A), { target: TEAM_A });
  const verify = (event) => bind(g, lead, 'claim.finding.verify', { id: 'f_one', record: { kind: 'outcome.verified', event, result: 'pass' } });
  const withheld = verify('evt-secret-77');
  const missing = verify('evt-nope');
  assert.equal(withheld.ok, false);
  assert.deepEqual(withheld, missing, 'the answer does not tell a withheld event from one that is not there');
  assert.deepEqual(withheld.errors, ['record.event must be one of the source events the finding rests on']);
  assert.equal(verify('evt-101').ok, true, 'a source event the reader may read is accepted');
  // a reader that may read every source can name any of them
  const all = make({ sources: [{ event: 'evt-101', version: 3, scope: TEAM_A }, { event: 'evt-202', version: 1, scope: TEAM_A }] });
  assert.equal(bind(all, lead, 'claim.finding.verify', { id: 'f_one', record: { kind: 'outcome.verified', event: 'evt-202', result: 'pass' } }).ok, true);
});
