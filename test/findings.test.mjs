// SO-F-09: the finding model. A finding is a graph claim with source links, affected entities and
// owners, scope and time context and a confidence. Evidence alone caps it at theory; fact needs a
// person's event or a verification record. Dismissal, correction and adjudication are events, and a
// reader only ever sees what the source's scope lets them read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as graphModule from '../src/engine/graph.mjs';
import { resolveRequest } from '../src/engine/identity.mjs';

const { Graph } = graphModule;
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
const make = (over) => { const g = new Graph(); g.applyOp(op('claim.finding', finding(over))); return g; };
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
    const r = new Graph().admitFinding(finding(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.errors.join(' '), re, JSON.stringify(over));
  }
  assert.equal(new Graph().admitFinding(finding()).ok, true);
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
  g.applyOp(op('claim.finding.verify', { id: 'f_one', by: SESSION, record: { kind: 'outcome.verified', event: 'evt-900', result: 'pass' } }));
  assert.equal(status(g, 'f_one'), 'theory');
  const hist = g.claims.get('f_one').finding.history;
  assert.deepEqual(hist.map((h) => [h.kind, h.effective]), [['adjudicate', false], ['verify', false]], 'both are recorded and neither takes effect');
  // a verification that did not pass is not a verification
  g.applyOp(op('claim.finding.verify', { id: 'f_one', by: VERIFIER, record: { kind: 'outcome.verified', event: 'evt-901', result: 'fail' } }));
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
  h.applyOp(op('claim.finding.verify', { id: 'f_two', by: VERIFIER, record: { kind: 'outcome.verified', event: 'evt-902', result: 'pass' } }));
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
  const r = g.admitFinding(same);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'dismissed');
  assert.equal(r.of, 'f_one');
  g.applyOp(op('claim.finding', same));
  assert.equal(g.claims.has('f_again'), false, 'the graph does not take it back in on replay either');
  // the source set is compared as a set
  const two = [{ event: 'evt-101', version: 3, scope: TEAM_A }, { event: 'evt-102', version: 1, scope: TEAM_A }];
  const h = make({ sources: two });
  h.applyOp(op('claim.finding.dismiss', { id: 'f_one', by: PERSON }));
  assert.equal(h.admitFinding(finding({ id: 'f_x', sources: [two[1], two[0]] })).code, 'dismissed');
  // a new version of a source, or a different source, is new evidence and may be raised
  assert.equal(g.admitFinding(finding({ id: 'f_v4', sources: [{ event: 'evt-101', version: 4, scope: TEAM_A }] })).ok, true);
  assert.equal(g.admitFinding(finding({ id: 'f_other', sources: [{ event: 'evt-777', version: 3, scope: TEAM_A }] })).ok, true);
  assert.equal(g.admitFinding(finding({ id: 'f_more', sources: [...same.sources, { event: 'evt-102', version: 1, scope: TEAM_A }] })).ok, true);
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
  const reader = { ok: true, subject: { id: PERSON, type: 'person' }, scope: TEAM_A };
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
const readerFor = (scope) => ({ ok: true, subject: { id: 'person:reader', type: 'person' }, scope });

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
  assert.deepEqual(list.map((f) => f.id), ['f_one']);
  assert.ok(!JSON.stringify(list).includes('evt-secret-77') && !JSON.stringify(list).includes(MARK));
  assert.deepEqual(g.listFindings(readerFor({ type: 'team', id: 'team-c' })), []);
  assert.deepEqual(g.listFindings(null), []);
});

test('SO-F-09 AC03: the reader comes from the identity model, and a reader from another scope is held out', () => {
  const g = mixed();
  const identity = (scope) => ({ id: 'tok1', identity_scope: scope, subject: { id: 'person:reader', type: 'person', owner: 'person:reader' } });
  const asA = resolveRequest(identity(TEAM_A), { target: TEAM_A });
  assert.equal(asA.ok, true);
  const v = g.viewFinding('f_one', asA);
  assert.equal(v.withheld, true);
  assert.ok(!JSON.stringify(v).includes('evt-secret-77'));
  const asB = resolveRequest(identity(TEAM_B), { target: TEAM_B });
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

test('SO-F-09 AC03: an entity or owner tied to the finding as a whole (source null) is hidden from a partial view and shown in a full one', () => {
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
  const refused = g.admitFinding(same);
  assert.equal(refused.code, 'dismissed');
  assert.ok(!('of' in refused), 'no id of the dismissed finding');
  assert.ok(!JSON.stringify(refused).includes('f_one'));
  const elsewhere = finding({ id: 'f_b', scope: TEAM_B, sources: [{ event: 'evt-101', version: 3, scope: TEAM_B }] });
  assert.equal(g.admitFinding(elsewhere).ok, true, 'the same event and version in another scope is not blocked');
  g.applyOp(op('claim.finding', elsewhere));
  assert.ok(g.claims.has('f_b'), 'and replay takes it in');
  g.applyOp(op('claim.finding.dismiss', { id: 'f_b', by: PERSON }));
  assert.equal(g.admitFinding(finding({ id: 'f_b2', scope: TEAM_B, sources: [{ event: 'evt-101', version: 3, scope: TEAM_B }] })).code, 'dismissed', 'each scope has its own dismissal');
});
