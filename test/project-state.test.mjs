// SPDX-License-Identifier: Apache-2.0
// SO-04-A: the project and task state machine, the derived project status and the invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TASK_STATES, PROJECT_STATUSES, TRANSITIONS,
  transition, EventLog, amendScope, projectStatus,
  applyUpdate, reassign, eligibleForDispatch, pause, requestCancellation, resume,
} from '../src/engine/project-state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = TASK_STATES;
const P = PROJECT_STATUSES;
const ctx = (over = {}) => ({
  actor: 'tester', time: 1000, reason: 'test', correlationId: 'corr-1',
  lease: { taskId: 't1', state: 'active', expiresAt: 9999 }, now: 1000,
  tasksById: {}, evidence: [], policy: {}, ...over,
});
const task = (state, over = {}) => ({ id: 't1', state, scope: [], scopeVersion: 1, criteria: [], dependsOn: [], ...over });

test('SO-04-A AC01: the module exports the eleven task states and the seven project statuses', () => {
  assert.deepEqual(Object.values(TASK_STATES), ['PROPOSED', 'ACCEPTED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'PAUSED', 'VERIFYING', 'VERIFIED', 'FAILED', 'CONFLICTED', 'CANCELLED']);
  assert.deepEqual(Object.values(PROJECT_STATUSES), ['DRAFT', 'ACTIVE', 'PAUSED', 'NEEDS_ATTENTION', 'VERIFYING', 'COMPLETE', 'CANCELLED']);
});

test('SO-04-A AC01: every state pair is walked against the one table, and each illegal pair is refused with a reason code', () => {
  for (const from of Object.values(S)) {
    for (const to of Object.values(S)) {
      const t = task(from);
      const r = transition(t, to, ctx());
      const allowed = (TRANSITIONS[from] ?? []).includes(to);
      if (allowed) {
        assert.equal(r.ok, true, `${from} -> ${to} is in the table and must pass`);
        assert.equal(r.task.state, to);
        assert.notEqual(r.task, t, 'a new record comes back');
        assert.equal(t.state, from, 'the input is never mutated');
      } else {
        assert.equal(r.ok, false, `${from} -> ${to} is not in the table and must be refused`);
        assert.ok(r.code, 'the refusal carries a reason code');
        assert.match(r.reason, /.+/);
      }
    }
  }
});

test('SO-04-A AC01: transition returns a new record and never mutates its input', () => {
  const t = Object.freeze(task(S.PROPOSED));
  const r = transition(t, S.ACCEPTED, ctx());
  assert.equal(r.ok, true);
  assert.notEqual(r.task, t);
  assert.equal(r.task.state, S.ACCEPTED);
  assert.equal(t.state, S.PROPOSED);
});

test('SO-04-A AC01: docs/PROJECTS.md lists the same task states and project statuses', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'PROJECTS.md'), 'utf8');
  const section = (title) => {
    const start = text.indexOf(`## ${title}`);
    assert.ok(start >= 0, `the page has a ${title} section`);
    const end = text.indexOf('\n## ', start + 1);
    return text.slice(start, end === -1 ? undefined : end);
  };
  const names = (s) => [...s.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]);
  assert.deepEqual([...names(section('Task states'))].sort(), Object.values(S).sort());
  assert.deepEqual([...names(section('Project statuses'))].sort(), Object.values(P).sort());
});

test('SO-04-A AC02: READY is refused while a dependency is not VERIFIED, and a CANCELLED one only where the policy allows', () => {
  const t = task(S.ACCEPTED, { dependsOn: ['t2'] });
  let r = transition(t, S.READY, ctx({ tasksById: { t2: task(S.IN_PROGRESS, { id: 't2' }) } }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'DEP_NOT_VERIFIED');
  r = transition(t, S.READY, ctx({ tasksById: { t2: task(S.CANCELLED, { id: 't2' }) } }));
  assert.equal(r.ok, false, 'a CANCELLED dependency is refused without the policy');
  r = transition(t, S.READY, ctx({ tasksById: { t2: task(S.CANCELLED, { id: 't2' }) }, policy: { allowCancelledDeps: true } }));
  assert.equal(r.ok, true, 'the policy allows the CANCELLED dependency');
  r = transition(t, S.READY, ctx({ tasksById: { t2: task(S.VERIFIED, { id: 't2' }) } }));
  assert.equal(r.ok, true);
});

test('SO-04-A AC02: IN_PROGRESS requires a live lease reference', () => {
  const t = task(S.READY);
  let r = transition(t, S.IN_PROGRESS, ctx({ lease: undefined }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_LIVE_LEASE');
  r = transition(t, S.IN_PROGRESS, ctx({ lease: { taskId: 't1', state: 'expired', expiresAt: 1 } }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_LIVE_LEASE');
  r = transition(t, S.IN_PROGRESS, ctx({ lease: { taskId: 'other', state: 'active', expiresAt: 9999 } }));
  assert.equal(r.ok, false, 'a lease for another task does not count');
  assert.equal(r.code, 'NO_LIVE_LEASE');
  r = transition(t, S.IN_PROGRESS, ctx());
  assert.equal(r.ok, true);
});

test('SO-04-A AC02: VERIFIED needs evidence for every mandatory criterion bound to the current scope version and artifact hash; a report alone is refused', () => {
  const t = task(S.VERIFYING, { criteria: [{ id: 'c1', mandatory: true }], artifactHash: 'h1' });
  let r = transition(t, S.VERIFIED, ctx({ report: { text: 'the work is done' } }));
  assert.equal(r.ok, false, 'an agent report is not evidence');
  assert.equal(r.code, 'NO_EVIDENCE');
  assert.equal(r.task.state, S.VERIFYING, 'the task stays VERIFYING');
  r = transition(t, S.VERIFIED, ctx({ evidence: [{ taskId: 't1', criterion: 'c1', scopeVersion: 1, artifactHash: 'h0' }] }));
  assert.equal(r.ok, false, 'evidence bound to an old artifact hash is refused');
  r = transition(t, S.VERIFIED, ctx({ evidence: [{ taskId: 't1', criterion: 'c1', scopeVersion: 0, artifactHash: 'h1' }] }));
  assert.equal(r.ok, false, 'evidence bound to an old scope version is refused');
  r = transition(t, S.VERIFIED, ctx({ evidence: [{ taskId: 't1', criterion: 'c1', scopeVersion: 1, artifactHash: 'h1' }] }));
  assert.equal(r.ok, true);
  assert.equal(r.task.state, S.VERIFIED);
});

test('SO-04-A AC03: every transition record carries actor, time, reason, previous state, new state, scope version, correlation id and evidence references', () => {
  const t = task(S.VERIFYING, { scopeVersion: 3, artifactHash: 'h', criteria: [{ id: 'c1', mandatory: true }] });
  const r = transition(t, S.VERIFIED, ctx({ correlationId: 'corr-9', evidence: [{ taskId: 't1', criterion: 'c1', scopeVersion: 3, artifactHash: 'h' }] }));
  assert.equal(r.ok, true);
  const rec = r.record;
  assert.equal(rec.actor, 'tester');
  assert.equal(rec.time, 1000);
  assert.equal(rec.reason, 'test');
  assert.equal(rec.from, S.VERIFYING);
  assert.equal(rec.to, S.VERIFIED);
  assert.equal(rec.scopeVersion, 3);
  assert.equal(rec.correlationId, 'corr-9');
  assert.ok(Array.isArray(rec.evidence), 'evidence references are on the record');
});

test('SO-04-A AC03: a record missing any field is refused naming the field', () => {
  for (const f of ['actor', 'time', 'reason', 'correlationId']) {
    const c = ctx();
    delete c[f];
    const r = transition(task(S.PROPOSED), S.ACCEPTED, c);
    assert.equal(r.ok, false, f);
    assert.equal(r.code, 'MISSING_FIELD');
    assert.match(r.reason, new RegExp(f));
  }
});

test('SO-04-A AC03: the event id is unique and the log is append-only', () => {
  const log = new EventLog();
  const a = log.append({ type: 'transition', from: 'PROPOSED', to: 'ACCEPTED' });
  const b = log.append({ type: 'transition', from: 'ACCEPTED', to: 'READY' });
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.entry.id, b.entry.id, 'event ids are unique');
  const dup = log.append({ id: a.entry.id, type: 'transition' });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'DUPLICATE_EVENT_ID');
  assert.equal(log.size, 2, 'the refused append added nothing');
  assert.ok(Object.isFrozen(a.entry), 'a record is frozen once appended');
  assert.throws(() => { a.entry.type = 'tampered'; });
  assert.deepEqual(log.entries().map((e) => e.id), [a.entry.id, b.entry.id]);
});

test('SO-04-A AC04: amendScope bumps the version, returns the affected tasks and evidence, marks the evidence stale and replans the affected VERIFIED and VERIFYING tasks', () => {
  const project = {
    id: 'p1', scopeVersion: 1,
    tasks: [
      { id: 't1', state: S.VERIFIED, scope: ['a.md'], scopeVersion: 1 },
      { id: 't2', state: S.VERIFYING, scope: ['b.md'], scopeVersion: 1 },
      { id: 't3', state: S.IN_PROGRESS, scope: ['a.md', 'c.md'], scopeVersion: 1 },
      { id: 't4', state: S.READY, scope: ['d.md'], scopeVersion: 1 },
    ],
    evidence: [
      { id: 'e1', taskId: 't1', criterion: 'c', scopeVersion: 1, artifactHash: 'h', stale: false },
      { id: 'e2', taskId: 't2', criterion: 'c', scopeVersion: 1, artifactHash: 'h', stale: false },
      { id: 'e3', taskId: 't3', criterion: 'c', scopeVersion: 1, artifactHash: 'h', stale: false },
      { id: 'e4', taskId: 't4', criterion: 'c', scopeVersion: 1, artifactHash: 'h', stale: false },
    ],
  };
  const { project: next, affected } = amendScope(project, { paths: ['a.md', 'b.md'] });
  assert.equal(next.scopeVersion, 2, 'the scope version is bumped');
  const byId = Object.fromEntries(next.tasks.map((t) => [t.id, t]));
  assert.equal(byId.t1.state, S.ACCEPTED, 'an affected VERIFIED task moves back to ACCEPTED');
  assert.match(byId.t1.replanReason, /replan/i);
  assert.equal(byId.t2.state, S.ACCEPTED, 'an affected VERIFYING task moves back to ACCEPTED');
  assert.match(byId.t2.replanReason, /replan/i);
  assert.equal(byId.t3.state, S.IN_PROGRESS, 'an affected in-flight task keeps its state');
  assert.equal(byId.t4.state, S.READY, 'an unaffected task keeps its state');
  assert.deepEqual(next.tasks.map((t) => t.id), ['t1', 't2', 't3', 't4'], 'task ids are kept');
  const ev = Object.fromEntries(next.evidence.map((e) => [e.id, e]));
  assert.equal(ev.e1.stale, true);
  assert.equal(ev.e2.stale, true);
  assert.equal(ev.e3.stale, true);
  assert.equal(ev.e4.stale, false, 'unaffected evidence stays live');
  assert.deepEqual(affected.tasks.map((t) => t.id).sort(), ['t1', 't2', 't3']);
  assert.deepEqual(affected.evidence.map((e) => e.id).sort(), ['e1', 'e2', 'e3']);
  assert.equal(project.scopeVersion, 1, 'the input project is not mutated');
  assert.equal(project.tasks[0].state, S.VERIFIED);
});

test('SO-04-A AC05: projectStatus derives DRAFT, ACTIVE, PAUSED, NEEDS_ATTENTION, VERIFYING, COMPLETE and CANCELLED over a fixture', () => {
  const T = (state, over = {}) => ({ id: state, state, ...over });
  assert.equal(projectStatus([], {}), P.DRAFT);
  assert.equal(projectStatus([T(S.PROPOSED)], {}), P.DRAFT, 'no accepted task means DRAFT');
  assert.equal(projectStatus([T(S.ACCEPTED)], {}), P.ACTIVE);
  assert.equal(projectStatus([T(S.IN_PROGRESS)], { paused: true }), P.PAUSED);
  assert.equal(projectStatus([T(S.BLOCKED)], {}), P.NEEDS_ATTENTION);
  assert.equal(projectStatus([T(S.CONFLICTED)], {}), P.NEEDS_ATTENTION);
  assert.equal(projectStatus([T(S.READY)], { pendingApproval: true }), P.NEEDS_ATTENTION);
  assert.equal(projectStatus([T(S.READY), T(S.VERIFYING)], {}), P.VERIFYING);
  assert.equal(projectStatus([T(S.VERIFIED)], {}), P.COMPLETE);
  assert.equal(projectStatus([T(S.VERIFIED), T(S.CANCELLED, { cancelReason: 'superseded' })], {}), P.COMPLETE);
  assert.equal(projectStatus([T(S.CANCELLED)], {}), P.ACTIVE, 'a CANCELLED task without a recorded reason is not COMPLETE');
  assert.equal(projectStatus([T(S.VERIFIED)], { cancelled: true }), P.CANCELLED);
});

test('SO-04-A AC05: the same input twice gives the same output', () => {
  const fixture = Object.freeze([Object.freeze({ id: 'a', state: S.READY }), Object.freeze({ id: 'b', state: S.VERIFYING })]);
  const flags = Object.freeze({});
  assert.deepEqual(projectStatus(fixture, flags), projectStatus(fixture, flags));
  assert.equal(projectStatus(fixture, flags), P.VERIFYING);
});

test('SO-04-A AC06: two updates from different sources on the same version produce CONFLICTED with a conflict record', () => {
  const e0 = { id: 'e1', version: 1 };
  const a = applyUpdate(e0, { source: 's1', baseVersion: 1, ref: 'r1', patch: { v: 1 } });
  assert.equal(a.ok, true);
  assert.equal(a.entity.version, 2);
  const b = applyUpdate(a.entity, { source: 's2', baseVersion: 1, ref: 'r2', patch: { v: 2 } });
  assert.equal(b.ok, false);
  assert.equal(b.code, 'CONFLICT');
  assert.equal(b.entity.state, S.CONFLICTED);
  assert.deepEqual(b.entity.conflict.competing, ['r1', 'r2']);
  assert.equal(b.entity.conflict.entity, 'e1');
  assert.match(b.entity.conflict.reason, /different sources/);
  assert.equal(b.entity.conflict.resolver, null, 'the record names the authorised resolver once one is set');
  const c = applyUpdate(a.entity, { source: 's2', baseVersion: 1, ref: 'r2', patch: { v: 2 }, resolver: 'owner' });
  assert.equal(c.entity.conflict.resolver, 'owner');
  const d = applyUpdate(c.entity, { source: 's3', baseVersion: 1, ref: 'r3', patch: {} });
  assert.equal(d.code, 'STALE_GENERATION', 'a conflicted entity is not overwritten again');
  assert.equal(d.entity.state, S.CONFLICTED);
});

test('SO-04-A AC06: reassignment needs an expired or released lease or an authorised override, and records the inspection of prior attempts', () => {
  const t = { id: 't1', state: S.IN_PROGRESS, holder: 'h1', scopeVersion: 1, version: 3 };
  const base = { to: 'h2', actor: 'owner', time: 5, correlationId: 'corr-r', attempts: [{ ref: 'att-1' }, { ref: 'att-2' }] };
  let r = reassign(t, { ...base, lease: { taskId: 't1', state: 'active' } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'LEASE_NOT_FREE');
  r = reassign(t, { ...base, lease: { taskId: 't1', state: 'expired' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.record.inspectedAttempts, ['att-1', 'att-2']);
  assert.equal(r.task.holder, 'h2');
  r = reassign(t, { ...base, lease: { taskId: 't1', state: 'active' }, override: { authorised: true, by: 'owner' } });
  assert.equal(r.ok, true, 'an authorised override reassigns over a live lease');
});

test('SO-04-A AC06: a stale generation cannot overwrite after reassignment', () => {
  const t = { id: 't1', state: S.IN_PROGRESS, holder: 'h1', scopeVersion: 1, version: 3 };
  const r = reassign(t, { to: 'h2', actor: 'owner', time: 5, correlationId: 'corr-r', lease: { taskId: 't1', state: 'released' } });
  assert.equal(r.ok, true);
  assert.equal(r.task.version, 4);
  const stale = applyUpdate(r.task, { source: 'h1', baseVersion: 3, ref: 'r-old', patch: { holder: 'h1' } });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_GENERATION');
  assert.equal(stale.entity.version, 4, 'the entity is unchanged');
  assert.equal(stale.entity.holder, 'h2');
});

test('SO-04-A AC07: pause stops new dispatch, not the truth, and resume restores eligibility from the checkpoint', () => {
  const ready = { id: 't1', state: S.READY };
  const inflight = { id: 't2', state: S.IN_PROGRESS };
  const project = { id: 'p1', paused: false, tasks: [ready, inflight] };
  assert.equal(eligibleForDispatch(ready, project), true);
  const paused = pause(project);
  assert.equal(paused.paused, true);
  assert.equal(eligibleForDispatch(paused.tasks[0], paused), false, 'no task is eligible while paused');
  assert.equal(paused.tasks[0].state, S.READY, 'the truth is kept: the task is still READY');
  assert.equal(paused.tasks[1].state, S.IN_PROGRESS, 'the in-flight task stays IN_PROGRESS');
  assert.equal(paused.tasks[1].cancellation, 'requested');
  const resumed = resume(paused);
  assert.equal(resumed.paused, false);
  assert.equal(eligibleForDispatch(resumed.tasks[0], resumed), true, 'eligibility is restored from the checkpoint');
  assert.deepEqual(resumed.tasks.map((t) => t.id), ['t1', 't2']);
  assert.equal(resumed.tasks[1].cancellation, undefined, 'the checkpoint state is restored');
  assert.equal(resume(resumed).code, 'NOT_PAUSED');
});

test('SO-04-A AC07: hard cancellation is recorded only when the adapter confirms it', () => {
  const inflight = { id: 't2', state: S.IN_PROGRESS, cancellation: 'requested' };
  const yes = requestCancellation(inflight, () => 'confirmed');
  assert.equal(yes.ok, true);
  assert.equal(yes.task.state, S.CANCELLED);
  assert.equal(yes.task.cancellation, 'confirmed');
  assert.ok(yes.task.cancelReason, 'the cancellation carries a recorded reason');
  const no = requestCancellation(inflight, () => 'unsupported');
  assert.equal(no.ok, false);
  assert.equal(no.task.state, S.IN_PROGRESS, 'not confirmed, not cancelled');
  assert.equal(no.task.cancellation, 'unsupported');
  const pending = requestCancellation(inflight, () => 'requested');
  assert.equal(pending.ok, false);
  assert.equal(pending.task.state, S.IN_PROGRESS);
  assert.equal(pending.task.cancellation, 'requested');
});
