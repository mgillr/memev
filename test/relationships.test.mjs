// SO-A-04: milestones, deliverables and work packages as store entities, the eleven link types as events with stable ids,
// stale markers that follow a change to scope, provenance and freshness on every projection, and progress derived from the
// model. Each test name starts with the criterion it covers, which is how the contract's verifier finds it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../src/engine/project-store.mjs';
import { LINK_TYPES, validateLink, addEntity, link, changeSource, impact, staleOf, clearStale, project, confirmProjection, progress } from '../src/engine/relationships.mjs';
import { runWork } from '../src/cli/work.mjs';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
after(cleanup);

const TYPES = ['scope-to-milestone', 'milestone-to-plan', 'milestone-to-deliverable', 'deliverable-to-work-package', 'work-package-to-task', 'task-to-dependency', 'task-to-artifact', 'task-to-check', 'task-to-evidence', 'blocker-to-work', 'permission-to-resource'];

const open = (dir) => new ProjectStore(dir, { id: 'p', fsync: false }).open();
const fresh = () => { const dir = tmpdir('rel-'); return { dir, store: open(dir) }; };
const task = (store, id, status = 'READY', extra = {}) => store.append({ type: 'task.upserted', entity: { kind: 'task', id, data: { title: `task ${id}`, project: 'p', status, scope_version: 1, ...extra } } });
const evidence = (store, id, taskId) => store.append({ type: 'evidence.upserted', entity: { kind: 'evidence', id, data: { task_id: taskId, criterion: 'c1' } } });
const ref = (kind, id) => ({ kind, id });

// scope S1 -> milestone M1 -> plan P1 and deliverable D1 -> work package W1 -> tasks T1, T2, T5; T2 depends on T1;
// T1 has an artifact, a check and evidence E1 and an approval AP1; scope S2 -> M2 -> D2 -> W2 -> T4; T3 is linked to nothing.
function graph() {
  const { dir, store } = fresh();
  for (const id of ['T1', 'T2', 'T3', 'T4', 'T5']) task(store, id);
  evidence(store, 'E1', 'T1');
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'AP1', data: { task_id: 'T1', state: 'pending' } } });
  for (const [kind, id] of [['milestone', 'M1'], ['deliverable', 'D1'], ['work_package', 'W1'], ['milestone', 'M2'], ['deliverable', 'D2'], ['work_package', 'W2']]) addEntity(store, kind, { title: `${kind} ${id}` }, id);
  const L = (link_type, from, to) => { const r = link(store, { link_type, from, to, actor: 'planner' }); assert.equal(r.ok, true, `${link_type}: ${r.reason}`); return r; };
  L('scope-to-milestone', ref('scope', 'S1'), ref('milestone', 'M1'));
  L('milestone-to-plan', ref('milestone', 'M1'), ref('plan', 'P1'));
  L('milestone-to-deliverable', ref('milestone', 'M1'), ref('deliverable', 'D1'));
  L('deliverable-to-work-package', ref('deliverable', 'D1'), ref('work_package', 'W1'));
  for (const t of ['T1', 'T2', 'T5']) L('work-package-to-task', ref('work_package', 'W1'), ref('task', t));
  L('task-to-dependency', ref('task', 'T2'), ref('task', 'T1'));
  L('task-to-artifact', ref('task', 'T1'), ref('artifact', 'src/a.js'));
  L('task-to-check', ref('task', 'T1'), ref('check', 'chk1'));
  L('task-to-evidence', ref('task', 'T1'), ref('evidence', 'E1'));
  L('scope-to-milestone', ref('scope', 'S2'), ref('milestone', 'M2'));
  L('milestone-to-deliverable', ref('milestone', 'M2'), ref('deliverable', 'D2'));
  L('deliverable-to-work-package', ref('deliverable', 'D2'), ref('work_package', 'W2'));
  L('work-package-to-task', ref('work_package', 'W2'), ref('task', 'T4'));
  L('blocker-to-work', ref('blocker', 'B1'), ref('task', 'T3'));
  L('permission-to-resource', ref('permission', 'PM1'), ref('resource', 'RS1'));
  return { dir, store };
}
const keyOf = (d) => `${d.kind}:${d.id}`;

test('SO-A-04 AC01: the schema file lists the eleven link types and the store validates milestone, deliverable and work package entities', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PKG, 'docs/schemas/relationships-v1.json'), 'utf8'));
  assert.deepEqual(Object.keys(schema.link_types), TYPES);
  assert.deepEqual([...LINK_TYPES], TYPES);
  for (const t of TYPES) { assert.ok(schema.link_types[t].from.length && schema.link_types[t].to.length, t); }
  const { dir, store } = fresh();
  for (const [kind, prefix] of [['milestone', 'mile'], ['deliverable', 'deliv'], ['work_package', 'wp']]) {
    assert.throws(() => store.append({ type: `${kind}.upserted`, entity: { kind, data: {} } }), /title/, `${kind} needs a title`);
    const made = addEntity(store, kind, { title: 'one' });
    assert.match(made.id, new RegExp(`^${prefix}_`), 'a generated id carries the kind prefix');
    const kept = addEntity(store, kind, { title: 'two' }, 'fixed-id');
    assert.equal(kept.id, 'fixed-id');
    assert.equal(store.snapshot(kind)[made.id].title, 'one');
  }
  store.close();
  const again = open(dir);
  assert.equal(again.snapshot('milestone')['fixed-id'].title, 'two', 'the entity and its id survive a reopen');
  assert.equal(Object.keys(again.snapshot('work_package')).length, 2);
});

test('SO-A-04 AC01: every link type is stored as an event with a stable id and an invalid link is refused', () => {
  const { dir, store } = graph();
  const links = Object.values(store.snapshot('event')).filter((e) => e.type === 'relationship.linked');
  assert.deepEqual([...new Set(links.map((e) => e.link_type))].sort(), [...TYPES].sort(), 'all eleven link types are in the store');
  const ids = links.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const again = link(store, { link_type: 'work-package-to-task', from: ref('work_package', 'W1'), to: ref('task', 'T1'), actor: 'planner' });
  assert.equal(again.ok, true);
  assert.equal(Object.values(store.snapshot('event')).filter((e) => e.type === 'relationship.linked').length, links.length, 'linking twice stores one event');
  assert.ok(ids.includes(again.id), 'the same link has the same id');
  store.close();
  const reopened = open(dir);
  const same = link(reopened, { link_type: 'work-package-to-task', from: ref('work_package', 'W1'), to: ref('task', 'T1'), actor: 'planner' });
  assert.equal(same.id, again.id, 'the id is stable across a reopen');
  // refusals
  assert.equal(link(reopened, { link_type: 'task-to-moon', from: ref('task', 'T1'), to: ref('task', 'T2') }).ok, false, 'an unknown link type');
  const wrong = link(reopened, { link_type: 'milestone-to-plan', from: ref('task', 'T1'), to: ref('plan', 'P1') });
  assert.equal(wrong.ok, false, 'a link between the wrong kinds');
  assert.match(wrong.reason, /from/);
  assert.equal(validateLink({ type: 'relationship.linked', link_type: 'task-to-artifact', from: ref('task', 'T1') }).ok, false, 'a link with no target');
  assert.throws(() => reopened.append({ type: 'task.event', entity: { kind: 'event', data: { type: 'relationship.linked', link_type: 'milestone-to-plan', from: ref('task', 'T1'), to: ref('plan', 'P1'), id: 'x' } } }), /from/, 'the store refuses an invalid link event itself');
});

test('SO-A-04 AC02: a change to a scope version marks every dependent plan, task, artifact, approval and evidence record stale, and nothing else', () => {
  const { store } = graph();
  const r = changeSource(store, { kind: 'scope', id: 'S1', version: 2, actor: 'operator', reason: 'the scope changed' });
  assert.equal(r.ok, true);
  const hit = r.markers.map((m) => keyOf(m.target)).sort();
  assert.deepEqual(hit, ['approval:AP1', 'artifact:src/a.js', 'evidence:E1', 'plan:P1', 'task:T1', 'task:T2', 'task:T5'].sort());
  for (const m of r.markers) {
    assert.ok(m.reason && m.reason.length > 5, 'each marker has a reason');
    assert.deepEqual(m.source, { kind: 'scope', id: 'S1', version: 2 });
    assert.equal(staleOf(store, m.target).reason, m.reason);
  }
  for (const untouched of [ref('task', 'T3'), ref('task', 'T4'), ref('plan', 'P2'), ref('evidence', 'E2')]) assert.equal(staleOf(store, untouched), null, keyOf(untouched));
  // a change to a requirement reaches what the requirement is linked to
  link(store, { link_type: 'scope-to-milestone', from: ref('requirement', 'R1'), to: ref('milestone', 'M2') });
  assert.deepEqual(changeSource(store, { kind: 'requirement', id: 'R1', version: 4, actor: 'operator', reason: 'the requirement changed' }).markers.map((m) => keyOf(m.target)), ['task:T4']);
});

test('SO-A-04 AC02: memev work impact lists the dependents with the reason and whether each is stale', async () => {
  const { store } = graph();
  const before = impact(store, ref('scope', 'S1'));
  assert.equal(before.dependents.length, 7);
  assert.ok(before.dependents.every((d) => d.stale === false && d.reason));
  changeSource(store, { kind: 'scope', id: 'S1', version: 2, actor: 'operator', reason: 'the scope changed' });
  const after1 = impact(store, ref('scope', 'S1'));
  assert.ok(after1.dependents.every((d) => d.stale === true));
  const o = { out: '', err: '' };
  const io = { store, out: (s) => { o.out += `${s}\n`; }, err: (s) => { o.err += `${s}\n`; } };
  assert.equal(await runWork(['impact', 'S1'], { project: 'p' }, io), 0);
  for (const id of ['P1', 'T1', 'T2', 'T5', 'src/a.js', 'AP1', 'E1']) assert.match(o.out, new RegExp(id.replace('.', '\\.')), `${id} is listed`);
  assert.doesNotMatch(o.out, /T3|T4/);
  assert.match(o.out, /stale/);
  o.out = '';
  assert.equal(await runWork(['impact', 'S1'], { project: 'p', json: true }, io), 0);
  assert.equal(JSON.parse(o.out).dependents.length, 7);
  o.out = ''; o.err = '';
  assert.equal(await runWork(['impact'], { project: 'p' }, io), 1);
});

test('SO-A-04 AC02: a stale marker clears only by a new verification or an explicit re-acceptance event', () => {
  const { dir, store } = graph();
  changeSource(store, { kind: 'scope', id: 'S1', version: 2, actor: 'operator', reason: 'the scope changed' });
  const t1 = ref('task', 'T1');
  assert.ok(staleOf(store, t1));
  // nothing else clears it: not a report, not a bare claim, not the old evidence
  assert.equal(clearStale(store, { target: t1, via: 'report', actor: 'agent' }).ok, false);
  assert.equal(clearStale(store, { target: t1, via: 'verification' }).ok, false, 'a verification names its evidence');
  assert.equal(clearStale(store, { target: t1, via: 'verification', evidence_id: 'E1' }).ok, false, 'the evidence that existed before the change is not a new verification');
  assert.equal(clearStale(store, { target: t1, via: 'verification', evidence_id: 'E-missing' }).ok, false, 'the evidence must exist');
  assert.equal(clearStale(store, { target: t1, via: 're-acceptance', actor: 'operator' }).ok, false, 're-acceptance carries a reason');
  assert.equal(clearStale(store, { target: t1, via: 're-acceptance', reason: 'checked by hand' }).ok, false, 're-acceptance names who accepted');
  assert.ok(staleOf(store, t1), 'still stale after every refusal');
  evidence(store, 'E9', 'T1');
  assert.equal(clearStale(store, { target: t1, via: 'verification', evidence_id: 'E9' }).ok, true);
  assert.equal(staleOf(store, t1), null);
  const t2 = ref('task', 'T2');
  assert.equal(clearStale(store, { target: t2, via: 're-acceptance', actor: 'operator', reason: 'the change does not touch it' }).ok, true);
  assert.equal(staleOf(store, t2), null);
  assert.ok(staleOf(store, ref('task', 'T5')), 'a marker not cleared stays');
  // the markers and their clearing are in the log, so a reopen reads the same state
  store.close();
  const again = open(dir);
  assert.equal(staleOf(again, t1), null);
  assert.ok(staleOf(again, ref('task', 'T5')));
  // a later change marks again
  const second = changeSource(again, { kind: 'scope', id: 'S1', version: 3, actor: 'operator', reason: 'the scope changed again' });
  assert.ok(second.markers.some((m) => keyOf(m.target) === 'task:T1'));
  assert.equal(staleOf(again, t1).source.version, 3);
});

test('SO-A-04 AC03: a projection carries the source event id, time, scope and plan version and freshness', () => {
  const { store } = graph();
  store.append({ type: 'project.upserted', entity: { kind: 'project', id: 'p', data: { name: 'p', scope_version: 2, plan_version: 5 } } });
  const p = project(store, 'task', 'T1');
  assert.equal(p.kind, 'task');
  assert.equal(p.id, 'T1');
  assert.equal(p.state, 'READY');
  assert.equal(typeof p.source_event_id, 'string');
  assert.equal(store.hasRecord(p.source_event_id), true, 'the source event is in the log');
  assert.ok(p.time, 'it carries the time of the source event');
  assert.equal(p.scope_version, 1, 'the task carries its own scope version');
  assert.equal(p.plan_version, 5);
  assert.equal(p.freshness, 'fresh');
  changeSource(store, { kind: 'scope', id: 'S1', version: 2, actor: 'operator', reason: 'the scope changed' });
  assert.equal(project(store, 'task', 'T1').freshness, 'stale');
  assert.equal(project(store, 'task', 'T3').freshness, 'fresh');
  assert.equal(confirmProjection(store, p).confirmed, true);
  // no plan version recorded: it is not confirmed, never a guess
  const { store: bare } = fresh();
  task(bare, 'X');
  const q = project(bare, 'task', 'X');
  assert.equal(q.plan_version, 'not confirmed');
  assert.equal(q.scope_version, 1);
});

test('SO-A-04 AC03: with the source event removed the projection says not confirmed', () => {
  const { dir, store } = fresh();
  task(store, 'ONLY');
  task(store, 'KEEP');
  const p = project(store, 'task', 'ONLY');
  assert.equal(p.state, 'READY');
  store.close();
  // remove the source event of ONLY from the log, then reopen
  const file = path.join(dir, '.memev', 'projects', 'p', 'events.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter((l) => JSON.parse(l).id !== p.source_event_id);
  assert.equal(kept.length, lines.length - 1);
  fs.writeFileSync(file, `${kept.join('\n')}\n`);
  const again = open(dir);
  const q = project(again, 'task', 'ONLY');
  assert.equal(q.state, 'not confirmed');
  assert.equal(q.freshness, 'not confirmed');
  assert.equal(q.source_event_id, null);
  assert.equal(confirmProjection(again, p).confirmed, false, 'the earlier projection no longer has its source');
  assert.equal(project(again, 'task', 'KEEP').state, 'READY', 'a task whose source event is there is still confirmed');
});

test('SO-A-04 AC04: progress derives from milestones, work packages and the verified tasks under them, and a free-text percentage changes nothing', () => {
  const { store } = graph();
  task(store, 'T1', 'VERIFIED');
  task(store, 'T2', 'VERIFYING');
  const before = progress(store);
  const m1 = before.milestones.M1;
  assert.deepEqual({ verified: m1.verified, total: m1.total, percent: m1.percent }, { verified: 1, total: 3, percent: 33 });
  assert.deepEqual(before.work_packages.W1, { verified: 1, total: 3, percent: 33 });
  assert.deepEqual(before.deliverables.D1, { verified: 1, total: 3, percent: 33 });
  assert.equal(before.milestones.M2.total, 1);
  assert.equal(before.milestones.M2.percent, 0);
  assert.equal(before.milestones.M1.tasks.includes('T3'), false, 'a task linked to no work package is in no figure');
  // a stub session says it is nearly done: as a progress event, in a report and in a note
  store.append({ type: 'task.event', entity: { kind: 'event', data: { type: 'session.reported', task_id: 'T2', percent: 90, text: 'I am 90% done' } } });
  store.append({ type: 'attempt.upserted', entity: { kind: 'attempt', id: 'att1', data: { task_id: 'T2', status: 'ok', output: '95% complete, nearly there' } } });
  task(store, 'T2', 'VERIFYING', { note: '99%', percent: 99 });
  assert.deepEqual(progress(store), before, 'no figure moved');
  // a verified task does move it
  task(store, 'T2', 'VERIFIED');
  assert.equal(progress(store).milestones.M1.verified, 2);
  assert.equal(progress(store).milestones.M1.percent, 67);
  // a milestone with no tasks has no figure to give
  addEntity(store, 'milestone', { title: 'empty' }, 'M9');
  assert.equal(progress(store).milestones.M9.percent, null);
});
