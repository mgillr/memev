// SPDX-License-Identifier: Apache-2.0
// The coordinator: atomic claims and leases over the project store. It turns the store's
// single-writer path into duplicate-work controls. A claim is a read-check-write under the lock,
// so two processes cannot both win the same task. Every write carries the lease's generation token
// and is refused once that token is superseded. Eligibility comes from dependencies and shared
// resource locks. Heartbeats extend a lease within its ttl, and an expired lease blocks its task
// rather than reassigning it. Dispatch and external actions are idempotent by key, and two attempts
// that changed the same artifact are a conflict even when a git merge of the two would succeed.
//
// The store is injected: the coordinator never opens or owns a store, it only calls its public API
// (withWrite, append, snapshot, stats). In production the caller passes a ProjectStore from SO-07-A;
// the tests pass a self-contained double with the same API. The per-task generation token lives in
// the task record, not the store's global generation, so ownership versions are per task.

// With `lifecycle: true` (how the vault builds it, the only place it is built) every status change goes
// through the one transition table of project-state.mjs, and each move is appended to the store's log as a
// task.transitioned event with its record (actor, time, reason, previous and new state, scope version,
// correlation id, evidence). A report then moves a task to VERIFYING, never to a finished state: VERIFIED
// comes only from verify(), which needs evidence bound to the scope version and the artifact hash. The rest of
// the table is wired here too: pause and resume (a paused project dispatches nothing), amendScope (a scope change
// makes the evidence bound to the old version stale and replans the affected tasks), requestCancellation and
// reassign (each a move through the table with its record in the log), applyUpdate (a stale or competing update
// surfaces a conflict instead of being overwritten) and EventLog (the history is read back through it).
// Without it the coordinator keeps its original READY/IN_PROGRESS/DONE statuses, which is what the unit
// tests over a store double use.

import { randomToken } from './util.mjs';
import { payloadHash, observedUnderLease, requireObserved, executionStage, EXECUTION_EVENT_KINDS } from './evidence.mjs';
import {
  transition, projectStatus, TASK_STATES,
  amendScope, reassign, pause, resume, requestCancellation, eligibleForDispatch, applyUpdate, EventLog,
} from './project-state.mjs';

// Retry policies for external actions. SO-03-A's policy module is not on main yet, so the
// coordinator reads these local defaults; when the module lands it is passed in as `policies`.
export const DEFAULT_POLICIES = {
  idempotent: { allowResend: true, maxAttempts: 3 },
  nonIdempotent: { allowResend: false, maxAttempts: 1 },
};

// The descriptive fields of a task an update may change. Everything else on a task is authoritative state.
const PATCHABLE = ['title', 'note', 'priority', 'labels'];

// A busy-wait that does not need async: the store's lock is held only for a few milliseconds, so a
// short spin is enough to let the other writer finish its turn.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class Coordinator {
  constructor(store, { now = () => Date.now(), policies = DEFAULT_POLICIES, busy = { retries: 400, delay: 2 }, lifecycle = false, bus = null } = {}) {
    this.store = store;
    // the bus the transitions are posted on (src/engine/bus.mjs): transport only, the store is the truth
    this.bus = bus;
    this._held = false;
    this.lifecycle = lifecycle;
    this.now = now;
    this.policies = policies;
    this.busy = busy;
  }

  // Hold the store's lock across a callback, retrying while another live writer holds it.
  _withWrite(fn) {
    // a call made while this coordinator already holds the lock (a bus message that runs an action) joins that turn
    if (this._held) return fn(this.store);
    const turn = (s) => { this._held = true; try { return fn(s); } finally { this._held = false; } };
    for (let i = 0; i < this.busy.retries; i++) {
      const r = this.store.withWrite(turn);
      if (!r || r.busy !== true || r.retry !== true) return r;
      sleepMs(this.busy.delay);
    }
    throw new Error('store_busy');
  }

  // The exclusive set a task holds while in progress: its declared resources plus its declared
  // artifacts, since both are mutable and must not be written by two tasks at once.
  _lockSet(t) { return [...new Set([...(t.resources || []), ...(t.artifacts || [])])]; }

  // ---- the execution history: requested, accepted, observed and verified are four event kinds that stay apart
  // (evidence.mjs). They are recorded only with `lifecycle: true`, in the same log as the task moves.

  // The resource an execution event concerns: the one the caller names, else the task's exclusive set, else the task id.
  _resourceOf(taskId, task, explicit) {
    if (typeof explicit === 'string' && explicit) return explicit;
    const set = task ? this._lockSet(task) : [];
    return set.length ? set.join(',') : taskId;
  }
  _execEvent(s, type, taskId, fields) {
    const data = { type, task_id: taskId, time: this.now(), ...fields };
    s.append({ type: 'task.event', entity: { kind: 'event', data } });
    return data;
  }
  _execEvents(s) { return Object.values(s.snapshot('event')).filter((e) => EXECUTION_EVENT_KINDS.includes(e.type)); }

  // executionEvents(taskId): the four kinds of one task, or of every task, in log order.
  executionEvents(taskId = null) {
    return this._execEvents(this.store).filter((e) => !taskId || e.task_id === taskId);
  }

  // The four kinds of each task, kept apart, as counts and the furthest kind reached.
  _executionOf(ids) {
    const events = this.executionEvents();
    return Object.fromEntries(ids.map((id) => {
      const x = executionStage(events, id);
      return [id, { stage: x.stage, requested: x.requested.length, accepted: x.accepted.length, observed: x.observed.length, verified: x.verified.length }];
    }));
  }

  // observe(lease, { resource, payload, actor }): record an execution.observed event under the lease. It is refused unless the
  // lease is the task's current one. An observation alone moves no state; the report that follows does.
  observe(lease, { resource, payload = null, actor } = {}) {
    if (!this.lifecycle) return this._off();
    return this._withWrite((s) => {
      const l = s.snapshot('lease')[lease.id];
      if (!l) return { ok: false, error: 'no_such_lease' };
      const task = s.snapshot('task')[l.task_id];
      if (!task) return { ok: false, error: 'no_such_task' };
      if (l.status !== 'active' || l.generation !== task.generation) return { ok: false, stale: true, reason: 'lease_not_current' };
      const event = this._execEvent(s, 'execution.observed', l.task_id, { lease_id: lease.id, generation: l.generation, resource: this._resourceOf(l.task_id, task, resource), payload_hash: payloadHash(payload), actor: actor ?? l.agent });
      return { ok: true, event };
    });
  }


  // ---- the lifecycle: moves through project-state's table (only with `lifecycle: true`)

  // The state machine's view of a stored task, and of every task in the set (for dependency checks).
  _view(id, t) {
    return { id, state: t.status, dependsOn: t.deps || [], scopeVersion: t.scope_version ?? 1, criteria: t.criteria || [], artifactHash: t.artifact_hash ?? null };
  }
  _tasksById(s) {
    const out = {};
    for (const [id, t] of Object.entries(s.snapshot('task'))) out[id] = { id, state: t.status };
    return out;
  }

  // One move of a task view through transition(). Returns { ok, view, record } or the refusal.
  _step(s, view, to, ctx) {
    const r = transition(view, to, { time: this.now(), tasksById: this._tasksById(s), ...ctx });
    if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
    return { ok: true, view: r.task, record: r.record };
  }

  // Persist the records of the moves a call made, one task.transitioned event each, in the same writer turn.
  _logMoves(s, taskId, records) {
    for (const rec of records) s.append({ type: 'task.transitioned', entity: { kind: 'event', data: { type: 'task.transitioned', task_id: taskId, ...rec } } });
    this._post(s, taskId, records);
  }

  // Each move is also posted on the bus, to the operator seat and to the seat of the task's assignee, as ids and states only.
  // The post is best effort: a bus that is down or refuses a message never blocks or undoes a transition.
  _post(s, taskId, records) {
    if (!this.bus || !records.length) return;
    const task = s.snapshot('task')[taskId];
    const project = task?.project ?? this.store.id;
    const newest = Object.values(s.snapshot('lease')).filter((l) => l.task_id === taskId).sort((a, b) => (b.generation || 0) - (a.generation || 0))[0];
    const assignee = task?.holder ?? newest?.agent ?? null;
    for (const rec of records) {
      try { this.bus.postTransition({ project, task: taskId, from: rec.from, to: rec.to, correlation: rec.correlationId ?? null, assignee }); } catch { /* transport only */ }
    }
  }

  // Run a chain of moves in memory and stop at the first refusal. Nothing is written here.
  _chain(s, view, steps) {
    const records = [];
    let cur = view;
    for (const [to, ctx] of steps) {
      const r = this._step(s, cur, to, ctx);
      if (!r.ok) return r;
      cur = r.view; records.push(r.record);
    }
    return { ok: true, view: cur, records };
  }


  // ---- the project record: the flags and the scope version that belong to the project, not to one task

  _project(s, project) {
    return s.snapshot('project')[project] ?? { name: project, paused: false, scope_version: 1 };
  }
  _putProject(s, project, data) {
    s.append({ type: 'project.upserted', entity: { kind: 'project', id: project, data } });
  }
  // A project-level event (pause, resume, scope change, reassignment, cancellation outcome), in the same log.
  _logEvent(s, type, fields) {
    s.append({ type: 'task.event', entity: { kind: 'event', data: { type, ...fields } } });
  }
  _putTask(s, id, data) {
    s.append({ type: 'task.upserted', entity: { kind: 'task', id, data } });
  }
  _tasksOf(s, project) {
    return Object.entries(s.snapshot('task')).filter(([, t]) => t.project === project);
  }
  _off() { return { ok: false, error: 'lifecycle_off' }; }
  _ctx(actor, reason, correlationId) { return { actor, time: this.now(), reason, correlationId }; }

  // pause(project): stop new dispatch and keep the truth. In-flight tasks stay IN_PROGRESS and carry a cancellation
  // field of requested; the project record keeps the checkpoint resume() needs.
  // capability(taskId, task) is the adapter's capability record for the client holding the task: true when it can cancel
  // cooperatively. Without a record the answer for an in-flight task is unsupported, never confirmed.
  pause(project, { actor = 'operator', reason = 'paused', capability = null } = {}) {
    if (!this.lifecycle) return this._off();
    return this._withWrite((s) => {
      const proj = this._project(s, project);
      if (proj.paused) return { ok: false, code: 'ALREADY_PAUSED', reason: 'the project is already paused' };
      const tasks = this._tasksOf(s, project);
      const view = { paused: false, scopeVersion: proj.scope_version, tasks: tasks.map(([id, t]) => ({ id, state: t.status, ...(t.cancellation ? { cancellation: t.cancellation } : {}) })) };
      const p = pause(view);
      const cancellations = {};
      for (const [id, t] of tasks) {
        const nt = p.tasks.find((x) => x.id === id);
        if (nt.state === TASK_STATES.IN_PROGRESS && typeof capability === 'function') nt.cancellation = capability(id, t) === true ? 'requested' : 'unsupported';
        if (nt.state === TASK_STATES.IN_PROGRESS) cancellations[id] = nt.cancellation;
        if (nt.cancellation !== t.cancellation) this._putTask(s, id, { ...t, cancellation: nt.cancellation });
      }
      const checkpoint = { scopeVersion: p.checkpoint.scopeVersion, tasks: p.checkpoint.tasks.map((x) => ({ id: x.id, state: x.state, ...(x.cancellation ? { cancellation: x.cancellation } : {}) })) };
      this._putProject(s, project, { ...proj, paused: true, pause_checkpoint: checkpoint, paused_reason: reason });
      this._logEvent(s, 'project.paused', { project, ...this._ctx(actor, reason, `pause:${project}:${this.now()}`) });
      return { ok: true, paused: true, cancellations };
    });
  }

  // resume(project): dispatch is allowed again; what happened during the pause is kept, and only the cancellation
  // request the pause itself made is withdrawn.
  resume(project, { actor = 'operator', reason = 'resumed' } = {}) {
    if (!this.lifecycle) return this._off();
    return this._withWrite((s) => {
      const proj = this._project(s, project);
      const tasks = this._tasksOf(s, project);
      const view = { paused: !!proj.paused, scopeVersion: proj.scope_version, checkpoint: proj.pause_checkpoint ?? null, tasks: tasks.map(([id, t]) => ({ id, state: t.status, ...(t.cancellation ? { cancellation: t.cancellation } : {}) })) };
      const r = resume(view);
      if (r.ok === false) return { ok: false, code: r.code, reason: r.reason };
      for (const [id, t] of tasks) {
        const nt = r.tasks.find((x) => x.id === id);
        if (nt.cancellation !== t.cancellation) { const { cancellation, ...rest } = t; this._putTask(s, id, nt.cancellation === undefined ? rest : { ...rest, cancellation: nt.cancellation }); }
      }
      this._putProject(s, project, { ...proj, paused: false, pause_checkpoint: null, paused_reason: null });
      this._logEvent(s, 'project.resumed', { project, ...this._ctx(actor, reason, `resume:${project}:${this.now()}`) });
      return { ok: true, paused: false };
    });
  }

  // amendScope(project, { paths }, { actor, reason }): a scope change bumps the project's scope version, marks the
  // evidence bound to the tasks that touch those paths stale, and moves their VERIFIED and VERIFYING tasks back to
  // ACCEPTED through the table, each move with its record. A task keeps its own scope version, so evidence bound to the
  // old one can never verify it again.
  amendScope(project, change, { actor = 'operator', reason = 'scope amended' } = {}) {
    if (!this.lifecycle) return this._off();
    if (!Array.isArray(change?.paths) || !change.paths.length || change.paths.some((x) => typeof x !== 'string' || !x)) return { ok: false, code: 'NO_PATHS', reason: 'a scope change names the paths it changes' };
    return this._withWrite((s) => {
      const proj = this._project(s, project);
      const tasks = this._tasksOf(s, project);
      const ids = new Set(tasks.map(([id]) => id));
      const view = {
        scopeVersion: proj.scope_version,
        tasks: tasks.map(([id, t]) => ({ id, state: t.status, scope: [...(t.artifacts || []), ...(t.scope || [])], scopeVersion: t.scope_version ?? 1 })),
        evidence: Object.entries(s.snapshot('evidence')).filter(([, e]) => ids.has(e.task_id)).map(([id, e]) => ({ id, taskId: e.task_id, criterion: e.criterion, scopeVersion: e.scope_version, artifactHash: e.artifact_hash, stale: !!e.stale })),
      };
      const correlationId = `scope:${project}:${this.now()}`;
      const r = amendScope(view, change, { actor, time: this.now(), correlationId });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      const records = [...r.records];
      for (const nt of r.project.tasks) {
        const old = tasks.find(([id]) => id === nt.id)[1];
        if (nt.state === old.status && nt.scopeVersion === (old.scope_version ?? 1)) continue;
        this._putTask(s, nt.id, { ...old, status: nt.state, scope_version: nt.scopeVersion, ...(nt.replanReason ? { replan_reason: nt.replanReason } : {}) });
        if (nt.state !== old.status) this._logMoves(s, nt.id, [records.shift()]);
      }
      let staled = 0;
      for (const e of r.project.evidence) {
        if (!e.stale) continue;
        const old = s.snapshot('evidence')[e.id];
        if (old && !old.stale) { s.append({ type: 'evidence.upserted', entity: { kind: 'evidence', id: e.id, data: { ...old, stale: true } } }); staled++; }
      }
      this._putProject(s, project, { ...proj, scope_version: r.project.scopeVersion });
      this._logEvent(s, 'scope.amended', { project, paths: change.paths, from_version: proj.scope_version, to_version: r.project.scopeVersion, affected_tasks: r.affected.tasks.map((t) => t.id), stale_evidence: staled, actor, reason, time: this.now(), correlationId });
      return { ok: true, scope_version: r.project.scopeVersion, affected: { tasks: r.affected.tasks.map((t) => t.id), evidence: staled } };
    });
  }

  // cancel(taskId, { adapter }): a hard cancellation of an in-flight task is recorded only when the adapter confirms it;
  // until then the task keeps its state with a cancellation field of requested or unsupported. A task nobody is
  // working on has nothing in flight and is cancelled directly. Both go through requestCancellation and the table.
  cancel(taskId, { actor = 'operator', reason = 'cancelled', adapter = 'requested' } = {}) {
    if (!this.lifecycle) return this._off();
    return this._withWrite((s) => {
      const task = s.snapshot('task')[taskId];
      if (!task) return { ok: false, error: 'no_such_task' };
      const inflight = task.status === TASK_STATES.IN_PROGRESS;
      const view = { ...this._view(taskId, task), ...(task.cancellation ? { cancellation: task.cancellation } : {}) };
      const t = this.now();
      const r = requestCancellation(view, inflight ? adapter : 'confirmed', { actor, time: t, reason, correlationId: `cancel:${taskId}:${t}` });
      if (!r.ok) {
        if (r.code === 'CANCELLATION_PENDING' || r.code === 'CANCELLATION_UNSUPPORTED') {
          this._putTask(s, taskId, { ...task, cancellation: r.task.cancellation });
          this._logEvent(s, 'task.cancellation', { task_id: taskId, outcome: r.task.cancellation, actor, reason, time: t });
        }
        return { ok: false, code: r.code, reason: r.reason ?? null, cancellation: r.task?.cancellation ?? null };
      }
      if (task.lease_id) {
        const l = s.snapshot('lease')[task.lease_id];
        if (l) s.append({ type: 'lease.upserted', entity: { kind: 'lease', id: task.lease_id, data: { ...l, status: 'cancelled', cancelled: t } } });
      }
      this._putTask(s, taskId, { ...task, status: r.task.state, cancelReason: reason, cancellation: 'confirmed', generation: (task.generation || 0) + 1, lease_id: null, locks: [] });
      this._logMoves(s, taskId, [r.record]);
      return { ok: true, state: r.task.state };
    });
  }

  // reassign(taskId, { to, override }): hand a task to another holder. It needs a released or expired lease, or an
  // authorised override (which revokes the live lease); it records the attempts it inspected, bumps the task's
  // generation so the old holder's writes are stale, and makes the task READY again through the table, reserved for
  // the new holder.
  reassign(taskId, { to, actor = 'operator', reason = 'reassigned', override = false } = {}) {
    if (!this.lifecycle) return this._off();
    return this._withWrite((s) => {
      const task = s.snapshot('task')[taskId];
      if (!task) return { ok: false, error: 'no_such_task' };
      if (![TASK_STATES.IN_PROGRESS, TASK_STATES.BLOCKED, TASK_STATES.READY, TASK_STATES.ACCEPTED].includes(task.status)) return { ok: false, code: 'NOT_REASSIGNABLE', reason: `a ${task.status} task is not reassigned` };
      const live = task.lease_id ? s.snapshot('lease')[task.lease_id] : null;
      const leaseView = { taskId, state: live && live.status === 'active' ? 'active' : 'released' };
      const attempts = Object.entries(s.snapshot('attempt')).filter(([, a]) => a.task_id === taskId).map(([id]) => ({ id }));
      const t = this.now();
      const correlationId = `reassign:${taskId}:${t}`;
      const r = reassign({ ...this._view(taskId, task), holder: live?.agent ?? task.holder ?? null, generation: task.generation ?? 0, version: task.version ?? 1 }, { lease: leaseView, override: { authorised: override === true }, to, actor, time: t, reason, correlationId, attempts });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      const ctx = { actor, correlationId };
      const steps = [];
      if (task.status === TASK_STATES.IN_PROGRESS) steps.push([TASK_STATES.BLOCKED, { ...ctx, reason: `reassigned: ${reason}` }]);
      if (task.status !== TASK_STATES.READY) steps.push([TASK_STATES.READY, { ...ctx, reason: `reassigned to ${to}` }]);
      const c = this._chain(s, this._view(taskId, task), steps);
      if (!c.ok) return { ok: false, code: c.code, reason: c.reason };
      if (live && live.status === 'active') s.append({ type: 'lease.upserted', entity: { kind: 'lease', id: task.lease_id, data: { ...live, status: 'revoked', revoked: t } } });
      this._putTask(s, taskId, { ...task, status: c.view.state, holder: to, generation: r.task.generation, version: r.task.version, lease_id: null, locks: [], blocked_reason: null });
      this._logMoves(s, taskId, c.records);
      this._logEvent(s, 'task.reassigned', { task_id: taskId, ...r.record });
      return { ok: true, holder: to, generation: r.task.generation };
    });
  }

  // update(taskId, { patch, base_version, generation, source }): a versioned edit of a task's descriptive fields.
  // A current update applies; two updates from different sources on the same version surface a conflict (the task is
  // CONFLICTED where the table allows it) instead of the last write winning; a stale generation is refused. The fields
  // that are authoritative state (status, lease, generation, scope, hashes, holder, locks) are never patchable.
  update(taskId, { patch = {}, base_version, generation, source = 'unknown', ref = null } = {}, { actor = source } = {}) {
    if (!this.lifecycle) return this._off();
    const bad = Object.keys(patch).filter((k) => !PATCHABLE.includes(k));
    if (bad.length || !Object.keys(patch).length) return { ok: false, code: 'FORBIDDEN_FIELD', reason: bad.length ? `not patchable: ${bad.join(', ')}` : 'an update names at least one field' };
    return this._withWrite((s) => {
      const task = s.snapshot('task')[taskId];
      if (!task) return { ok: false, error: 'no_such_task' };
      const t = this.now();
      const entity = { id: taskId, state: task.status, scopeVersion: task.scope_version ?? 1, version: task.version ?? 1, generation: task.generation ?? 0, lastWrite: task.lastWrite, ...(task.conflict ? { conflict: task.conflict } : {}), ...Object.fromEntries(PATCHABLE.filter((k) => task[k] !== undefined).map((k) => [k, task[k]])) };
      const r = applyUpdate(entity, { baseVersion: base_version, generation, source, ref: ref ?? `${source}:${t}`, patch }, { actor, time: t, correlationId: `update:${taskId}:${t}` });
      if (r.ok) {
        this._putTask(s, taskId, { ...task, ...patch, version: r.entity.version, lastWrite: r.entity.lastWrite });
        return { ok: true, version: r.entity.version };
      }
      if (r.code === 'CONFLICT') {
        this._putTask(s, taskId, { ...task, status: r.entity.state, conflict: r.entity.conflict });
        if (r.record) this._logMoves(s, taskId, [r.record]);
        this._logEvent(s, 'task.conflict', { task_id: taskId, ...r.entity.conflict, time: t });
      }
      return { ok: false, code: r.code, reason: r.reason };
    });
  }

  // fail(taskId): a VERIFYING task whose mandatory check failed goes to FAILED through the table.
  fail(taskId, { actor = 'contract-verify', reason = 'a mandatory check failed' } = {}) {
    if (!this.lifecycle) return this._off();
    return this._withWrite((s) => {
      const task = s.snapshot('task')[taskId];
      if (!task) return { ok: false, error: 'no_such_task' };
      const c = this._chain(s, this._view(taskId, task), [[TASK_STATES.FAILED, { actor, reason, correlationId: `fail:${taskId}:${this.now()}` }]]);
      if (!c.ok) return { ok: false, code: c.code, reason: c.reason };
      this._putTask(s, taskId, { ...task, status: c.view.state });
      this._logMoves(s, taskId, c.records);
      return { ok: true, state: c.view.state };
    });
  }

  // The history of task moves, read back through the append-only EventLog: unique ids, frozen entries, in log order.
  history(taskId = null) {
    const log = new EventLog();
    for (const [id, e] of Object.entries(this.store.snapshot('event'))) {
      if (e.type === 'task.transitioned' && (!taskId || e.task_id === taskId)) log.append({ ...e, id });
    }
    return log.entries();
  }

  // The project's tasks as the state machine sees them, and the derived project status.
  status(project, { history = false } = {}) {
    const tasks = {};
    const states = [];
    const proj = this.store.snapshot('project')[project] ?? {};
    for (const [id, t] of Object.entries(this.store.snapshot('task'))) {
      if (t.project !== project) continue;
      tasks[id] = { state: t.status, title: t.title, deps: t.deps || [], lease_id: t.lease_id ?? null, blocked_reason: t.blocked_reason ?? null, artifact_hash: t.artifact_hash ?? null, scope_version: t.scope_version ?? 1, holder: t.holder ?? null, cancellation: t.cancellation ?? null, contract: t.contract_id ? { id: t.contract_id, task: t.contract_task } : null };
      states.push({ state: t.status, cancelReason: t.cancelReason });
    }
    const counts = {};
    for (const x of states) counts[x.state] = (counts[x.state] || 0) + 1;
    return { project, status: projectStatus(states, { paused: !!proj.paused, cancelled: !!proj.cancelled }), paused: !!proj.paused, scope_version: proj.scope_version ?? 1, counts, tasks, eligible: this.eligible(project), ...(history ? { history: this.history().filter((e) => tasks[e.task_id]).slice(-100), ...(this.lifecycle ? { execution: this._executionOf(Object.keys(tasks)), work: this._workDetail(project, tasks) } : {}) } : {}) };
  }

  // verify(taskId, { actor, evidence }) is the only way to VERIFIED. Each evidence item names the criterion it
  // answers, the scope version and the artifact hash it was taken against; transition() refuses the move unless
  // every mandatory criterion of the task has live evidence bound to the task's own scope version and hash.
  verify(taskId, { actor = 'operator', evidence = [], reason = 'every mandatory criterion has bound evidence' } = {}) {
    if (!this.lifecycle) return { ok: false, error: 'lifecycle_off' };
    return this._withWrite((s) => {
      const task = s.snapshot('task')[taskId];
      if (!task) return { ok: false, error: 'no_such_task' };
      const ev = evidence.map((e) => ({ taskId, criterion: e.criterion, scopeVersion: e.scope_version ?? e.scopeVersion, artifactHash: e.artifact_hash ?? e.artifactHash, ref: e.ref ?? null }));
      const t = this.now();
      const r = this._step(s, this._view(taskId, task), TASK_STATES.VERIFIED, { actor, reason, correlationId: `verify:${taskId}:${t}`, evidence: ev });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      for (const e of ev) s.append({ type: 'evidence.upserted', entity: { kind: 'evidence', data: { task_id: taskId, criterion: e.criterion, scope_version: e.scopeVersion, artifact_hash: e.artifactHash, ref: e.ref } } });
      s.append({ type: 'task.upserted', entity: { kind: 'task', id: taskId, data: { ...task, status: r.view.state } } });
      this._logMoves(s, taskId, [r.record]);
      this._execEvent(s, 'outcome.verified', taskId, { resource: this._resourceOf(taskId, task), payload_hash: payloadHash(task.artifact_hash ?? null), scope_version: task.scope_version ?? 1, actor });
      return { ok: true, state: r.view.state };
    });
  }

  // ---- planning and eligibility

  // plan(project, specs) upserts the plan's tasks as READY and flags pairs of tasks whose declared
  // artifacts overlap. Overlapping artifacts are exclusive, so the eligibility check serializes the
  // pair: while one is in progress the other is not eligible.
  plan(project, specs, { actor = 'planner' } = {}) {
    return this._withWrite((s) => {
      const byArtifact = new Map();
      for (const spec of specs) {
        for (const a of spec.artifacts || []) {
          if (!byArtifact.has(a)) byArtifact.set(a, []);
          byArtifact.get(a).push(spec.id);
        }
      }
      const overlap = [];
      const seen = new Set();
      for (const [a, ids] of byArtifact) {
        if (ids.length < 2) continue;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const key = [ids[i], ids[j]].sort().join('::');
            if (seen.has(key)) continue;
            seen.add(key);
            overlap.push({ artifact: a, tasks: [ids[i], ids[j]] });
          }
        }
      }
      for (const spec of specs) {
        const arts = spec.artifacts || [];
        let status = spec.status || 'READY';
        let moved = [];
        if (this.lifecycle) {
          if (s.snapshot('task')[spec.id]) continue;   // already planned: re-planning never resets a task
          const ctx = { actor, reason: 'planned', correlationId: `plan:${project}:${spec.id}` };
          const steps = [[TASK_STATES.ACCEPTED, ctx]];
          if (!(spec.deps || []).length) steps.push([TASK_STATES.READY, ctx]);
          const c = this._chain(s, { id: spec.id, state: TASK_STATES.PROPOSED, dependsOn: spec.deps || [], scopeVersion: 1 }, steps);
          if (!c.ok) return { ok: false, code: c.code, reason: c.reason, task: spec.id };
          status = c.view.state; moved = c.records;
        }
        const overlapWith = [];
        for (const o of overlap) {
          if (!o.tasks.includes(spec.id)) continue;
          const other = o.tasks.find((t) => t !== spec.id);
          if (other && !overlapWith.includes(other)) overlapWith.push(other);
        }
        s.append({
          type: 'task.upserted',
          entity: {
            kind: 'task',
            id: spec.id,
            data: {
              title: spec.title || spec.id,
              project,
              status,
              deps: spec.deps || [],
              resources: spec.resources || [],
              artifacts: arts,
              generation: 0,
              lease_id: null,
              locks: [],
              blocked_reason: null,
              checkpoint: null,
              overlap: overlapWith,
              ...(this.lifecycle ? { scope_version: 1, criteria: spec.criteria || [], artifact_hash: spec.artifact_hash ?? null, ...(spec.contract ? { contract_id: spec.contract.id, contract_task: spec.contract.task } : {}) } : {}),
            },
          },
          key: `plan:${project}:${spec.id}`,
        });
        this._logMoves(s, spec.id, moved);
      }
      return { project, tasks: specs.map((x) => x.id), overlap };
    });
  }

  // eligible(project) returns the ids of READY tasks whose dependencies are all DONE and that hold
  // no exclusive resource (or artifact) shared with an IN_PROGRESS task. Independent tasks are all
  // returned, so they may run in parallel; tasks sharing a mutable resource are serialized.
  eligible(project) {
    const tasks = this.store.snapshot('task');
    const locked = new Set();
    for (const t of Object.values(tasks)) {
      if (t.status !== 'IN_PROGRESS' || t.project !== project) continue;
      for (const r of this._lockSet(t)) locked.add(r);
    }
    const doneStatus = this.lifecycle ? TASK_STATES.VERIFIED : 'DONE';
    const openStatuses = this.lifecycle ? [TASK_STATES.READY, TASK_STATES.ACCEPTED] : ['READY'];
    const done = new Set();
    for (const [id, t] of Object.entries(tasks)) {
      if (t.status === doneStatus && t.project === project) done.add(id);
    }
    const proj = this.lifecycle ? (this.store.snapshot('project')[project] ?? {}) : {};
    const out = [];
    for (const [id, t] of Object.entries(tasks)) {
      if (!openStatuses.includes(t.status) || t.project !== project) continue;
      // a paused project dispatches nothing; an ACCEPTED task whose dependencies are verified is dispatchable as READY
      if (this.lifecycle && !eligibleForDispatch({ state: TASK_STATES.READY }, { paused: !!proj.paused })) continue;
      if (!(t.deps || []).every((d) => done.has(d))) continue;
      if (this._lockSet(t).some((r) => locked.has(r))) continue;
      out.push(id);
    }
    return out;
  }

  // ---- claims and leases

  // The moves a claim makes in the lifecycle: ACCEPTED to READY when the dependencies allow it, then READY to
  // IN_PROGRESS, which the table lets through only with a live lease for this task.
  _claimMoves(s, taskId, task, agent, leaseId, t, ttl, promote) {
    const base = { actor: agent, correlationId: leaseId, now: t };
    const steps = [];
    if (promote) steps.push([TASK_STATES.READY, { ...base, reason: 'dependencies verified' }]);
    steps.push([TASK_STATES.IN_PROGRESS, { ...base, reason: 'claimed', lease: { taskId, state: 'active', expiresAt: t + ttl } }]);
    return this._chain(s, this._view(taskId, task), steps);
  }

  // claim(taskId, agent, ttl) is atomic: under the lock it reads the task, and only a READY task is
  // claimed. The winner gets a lease with a generation token, issue and expiry times; the task moves
  // to IN_PROGRESS and holds its exclusive set. A task that is not READY yields a conflict naming the
  // current holder and the lease expiry.
  claim(taskId, agent, ttl) {
    return this._withWrite((s) => {
      const tasks = s.snapshot('task');
      const task = tasks[taskId];
      if (!task) return { ok: false, error: 'no_such_task' };
      if (this.lifecycle && this._project(s, task.project).paused) return { ok: false, paused: true, reason: 'the project is paused: nothing is dispatched until it is resumed' };
      if (this.lifecycle && task.holder && agent !== task.holder && !String(agent).startsWith(`${task.holder}/`)) return { ok: false, reserved: { holder: task.holder }, reason: `the task was reassigned to ${task.holder}` };
      // lifecycle: an ACCEPTED task whose dependencies are all VERIFIED is made READY in the same turn
      const promote = this.lifecycle && task.status === TASK_STATES.ACCEPTED;
      if (task.status !== 'READY' && !promote) {
        const lease = task.lease_id ? s.snapshot('lease')[task.lease_id] : null;
        return {
          ok: false,
          conflict: {
            task_id: taskId,
            holder: lease?.agent ?? null,
            expires: lease?.expires ?? null,
            status: task.status,
          },
        };
      }
      const t = this.now();
      const generation = (task.generation || 0) + 1;
      const leaseId = `lease_${randomToken(6)}`;
      const lease = {
        task_id: taskId,
        agent,
        generation,
        issued: t,
        expires: t + ttl,
        status: 'active',
        checkpoint: null,
      };
      // The task update carries the store's generation token: if another writer already claimed the
      // task (advancing the generation), the single-writer path refuses this append as stale and the
      // claim becomes a conflict, so two processes cannot both win.
      const token = s.stats().generation;
      let status = 'IN_PROGRESS';
      let moved = [];
      if (this.lifecycle) {
        const c = this._claimMoves(s, taskId, task, agent, leaseId, t, ttl, promote);
        if (!c.ok) return { ok: false, blocked: { task_id: taskId, code: c.code, reason: c.reason, status: task.status } };
        status = c.view.state; moved = c.records;
      }
      try {
        s.append({
          type: 'task.upserted',
          gen: token,
          entity: {
            kind: 'task',
            id: taskId,
            data: { ...task, status, generation, lease_id: leaseId, holder: null, locks: this._lockSet(task) },
          },
        });
      } catch (e) {
        // the ProjectStore refuses a stale append with code stale_generation (its message says 'refused: generation ...')
        if (e?.code === 'stale_generation' || String(e?.message).includes('stale_generation')) {
          const fresh = s.snapshot('task')[taskId];
          const fl = fresh?.lease_id ? s.snapshot('lease')[fresh.lease_id] : null;
          return {
            ok: false,
            conflict: {
              task_id: taskId,
              holder: fl?.agent ?? null,
              expires: fl?.expires ?? null,
              status: fresh?.status ?? 'IN_PROGRESS',
            },
          };
        }
        throw e;
      }
      s.append({ type: 'lease.upserted', entity: { kind: 'lease', id: leaseId, data: lease } });
      this._logMoves(s, taskId, moved);
      return { ok: true, lease: { ...lease, id: leaseId } };
    });
  }

  // release(lease, reason) returns the task to READY and records the reason on the lease. The
  // generation token is superseded, so a later report under this lease is refused.
  release(lease, reason) {
    return this._withWrite((s) => {
      const leases = s.snapshot('lease');
      const l = leases[lease.id];
      if (!l) return { ok: false, error: 'no_such_lease' };
      const tasks = s.snapshot('task');
      const task = tasks[l.task_id];
      if (!task) return { ok: false, error: 'no_such_task' };
      if (l.status !== 'active' || l.generation !== task.generation) {
        return { ok: false, stale: true, reason: 'lease_not_current' };
      }
      const t = this.now();
      const generation = (task.generation || 0) + 1;
      // lifecycle: the table has no IN_PROGRESS to READY move, so a release is BLOCKED, then READY
      let status = 'READY';
      let moved = [];
      if (this.lifecycle) {
        const ctx = { actor: l.agent, correlationId: lease.id, now: t };
        const c = this._chain(s, this._view(l.task_id, task), [
          [TASK_STATES.BLOCKED, { ...ctx, reason: `lease released: ${reason ?? 'no reason given'}` }],
          [TASK_STATES.READY, { ...ctx, reason: 'released and free to claim' }],
        ]);
        if (!c.ok) return { ok: false, code: c.code, reason: c.reason };
        status = c.view.state; moved = c.records;
      }
      s.append({
        type: 'lease.upserted',
        entity: { kind: 'lease', id: lease.id, data: { ...l, status: 'released', released: t, release_reason: reason } },
      });
      s.append({
        type: 'task.upserted',
        entity: { kind: 'task', id: l.task_id, data: { ...task, status, generation, lease_id: null, locks: [] } },
      });
      this._logMoves(s, l.task_id, moved);
      return { ok: true };
    });
  }

  // heartbeat(lease, { checkpoint }) extends the lease within its ttl: the new expiry is now plus the
  // original ttl, and the checkpoint reference is stored on the lease for the sweep to keep.
  heartbeat(lease, { checkpoint } = {}) {
    return this._withWrite((s) => {
      const leases = s.snapshot('lease');
      const l = leases[lease.id];
      if (!l) return { ok: false, error: 'no_such_lease' };
      const tasks = s.snapshot('task');
      const task = tasks[l.task_id];
      if (!task) return { ok: false, error: 'no_such_task' };
      if (l.status !== 'active' || l.generation !== task.generation) {
        return { ok: false, stale: true };
      }
      const t = this.now();
      const ttl = l.expires - l.issued;
      const expires = t + ttl;
      s.append({
        type: 'lease.upserted',
        entity: { kind: 'lease', id: lease.id, data: { ...l, expires, checkpoint: checkpoint ?? l.checkpoint ?? null } },
      });
      return { ok: true, expires };
    });
  }

  // sweep() marks every active lease past its expiry as expired and blocks its task with the reason
  // owner lost and the lease's checkpoint reference. Nothing is reassigned: the task stays BLOCKED.
  sweep() {
    return this._withWrite((s) => {
      const t = this.now();
      const expired = [];
      for (const [id, l] of Object.entries(s.snapshot('lease'))) {
        if (l.status !== 'active' || l.expires > t) continue;
        const task = s.snapshot('task')[l.task_id];
        if (!task) continue;
        let moved = [];
        if (this.lifecycle) {
          const c = this._chain(s, this._view(l.task_id, task), [[TASK_STATES.BLOCKED, { actor: 'coordinator', reason: 'owner_lost: the lease expired without a heartbeat', correlationId: id }]]);
          if (!c.ok) continue;
          moved = c.records;
        }
        s.append({ type: 'lease.upserted', entity: { kind: 'lease', id, data: { ...l, status: 'expired', expired: t } } });
        s.append({
          type: 'task.upserted',
          entity: {
            kind: 'task',
            id: l.task_id,
            data: {
              ...task,
              status: 'BLOCKED',
              blocked_reason: 'owner_lost',
              checkpoint: l.checkpoint ?? task.checkpoint ?? null,
              lease_id: null,
              locks: [],
            },
          },
        });
        this._logMoves(s, l.task_id, moved);
        expired.push(id);
      }
      return { expired };
    });
  }

  // report(lease, result) commits a worker's result. Under a released or expired lease it is late:
  // stored as an attempt with status late and its output kept as evidence, changing no canonical
  // field. Under a superseded generation it is stale, recorded the same way. Under the current
  // generation it is applied, except that a result that changed an artifact a prior ok attempt already
  // changed is a conflict: a conflict record, the task CONFLICTED, even when a git merge would pass.
  report(lease, result) {
    return this._withWrite((s) => {
      const leases = s.snapshot('lease');
      const l = leases[lease.id];
      if (!l) return { ok: false, error: 'no_such_lease' };
      const tasks = s.snapshot('task');
      const task = tasks[l.task_id];
      if (!task) return { ok: false, error: 'no_such_task' };
      const t = this.now();
      const output = result.output ?? null;
      const artifacts = result.artifacts || [];

      const current = task.lease_id ? leases[task.lease_id] : null;
      const superseded = !!(task.lease_id && task.lease_id !== lease.id && current && current.generation > l.generation);

      if (l.status !== 'active' || l.generation !== task.generation) {
        const status = superseded ? 'stale' : 'late';
        const attemptId = `att_${randomToken(6)}`;
        const evId = `ev_${randomToken(6)}`;
        s.append({
          type: 'attempt.upserted',
          entity: { kind: 'attempt', id: attemptId, data: { task_id: l.task_id, lease_id: lease.id, agent: l.agent, status, output, artifacts, at: t } },
        });
        s.append({
          type: 'evidence.upserted',
          entity: { kind: 'evidence', id: evId, data: { task_id: l.task_id, ref: attemptId, kind: `${status}_output`, output } },
        });
        return { ok: false, [status]: true, attempt: attemptId };
      }

      const attempts = s.snapshot('attempt');
      const priorOk = Object.values(attempts).filter((a) => a.status === 'ok' && a.lease_id !== lease.id);
      const overlap = artifacts.filter((a) => priorOk.some((p) => (p.artifacts || []).includes(a)));
      if (overlap.length) {
        const confId = `conf_${randomToken(6)}`;
        const attemptId = `att_${randomToken(6)}`;
        s.append({ type: 'conflict.upserted', entity: { kind: 'conflict', id: confId, data: { task_id: l.task_id, lease_id: lease.id, artifacts: overlap, at: t } } });
        s.append({ type: 'attempt.upserted', entity: { kind: 'attempt', id: attemptId, data: { task_id: l.task_id, lease_id: lease.id, agent: l.agent, status: 'conflict', output, artifacts, at: t } } });
        let moved = [];
        if (this.lifecycle) {
          const c = this._chain(s, this._view(l.task_id, task), [[TASK_STATES.CONFLICTED, { actor: l.agent, reason: `two attempts changed ${overlap.join(', ')}`, correlationId: lease.id }]]);
          if (!c.ok) return { ok: false, code: c.code, reason: c.reason };
          moved = c.records;
        }
        s.append({ type: 'task.upserted', entity: { kind: 'task', id: l.task_id, data: { ...task, status: 'CONFLICTED' } } });
        this._logMoves(s, l.task_id, moved);
        return { ok: false, conflict: { task_id: l.task_id, artifacts: overlap } };
      }

      const generation = (task.generation || 0) + 1;
      const attemptId = `att_${randomToken(6)}`;
      // lifecycle: an agent's report is an assertion, so it moves the task to VERIFYING and no further
      let status = 'DONE';
      let moved = [];
      if (this.lifecycle) {
        // the move needs an execution.observed event under this lease and generation; a report is the observation of the
        // work it carries, so it records one when the lease has none yet
        const ref = { taskId: l.task_id, leaseId: lease.id, generation: l.generation };
        const events = this._execEvents(s);
        const observedNow = !observedUnderLease(events, ref);
        const observed = observedNow
          ? { type: 'execution.observed', task_id: l.task_id, time: t, lease_id: lease.id, generation: l.generation, resource: this._resourceOf(l.task_id, task, null), payload_hash: payloadHash({ output, artifacts, artifact_hash: result.artifact_hash ?? null }), actor: l.agent }
          : null;
        const guard = requireObserved(observed ? [...events, observed] : events, ref);
        if (!guard.ok) return { ok: false, code: guard.code, reason: guard.reason };
        const c = this._chain(s, this._view(l.task_id, task), [[TASK_STATES.VERIFYING, { actor: l.agent, reason: 'work reported, awaiting evidence', correlationId: lease.id }]]);
        if (!c.ok) return { ok: false, code: c.code, reason: c.reason };
        if (observedNow) s.append({ type: 'task.event', entity: { kind: 'event', data: observed } });
        status = c.view.state; moved = c.records;
      }
      s.append({ type: 'attempt.upserted', entity: { kind: 'attempt', id: attemptId, data: { task_id: l.task_id, lease_id: lease.id, agent: l.agent, status: 'ok', output, artifacts, at: t } } });
      s.append({ type: 'lease.upserted', entity: { kind: 'lease', id: lease.id, data: { ...l, status: 'reported' } } });
      s.append({ type: 'task.upserted', entity: { kind: 'task', id: l.task_id, data: { ...task, status, generation, lease_id: null, locks: [], ...(this.lifecycle && result.artifact_hash ? { artifact_hash: result.artifact_hash } : {}) } } });
      this._logMoves(s, l.task_id, moved);
      return { ok: true, attempt: attemptId };
    });
  }

  // ---- idempotent dispatch and external actions

  // dispatch(taskId, agent, key, payload, send) sends the payload once per key. The first call runs
  // send and records the result; a later call with the same key returns the recorded result without
  // sending again.
  dispatch(taskId, agent, key, payload, send) {
    return this._withWrite((s) => {
      const owner = s.snapshot('task')[taskId];
      if (this.lifecycle && owner && this._project(s, owner.project).paused) return { ok: false, paused: true, sent: false, reason: 'the project is paused' };
      const existing = Object.values(s.snapshot('attempt')).find((a) => a.kind === 'dispatch' && a.key === key);
      if (existing) return { ok: true, sent: false, duplicate: true, result: existing.result ?? null };
      // a task is sent once under a lease: a second dispatch, under another key, while that lease is live is refused
      const held = this.lifecycle && owner?.lease_id ? s.snapshot('lease')[owner.lease_id] : null;
      if (held && held.status === 'active' && held.expires > this.now() && Object.values(s.snapshot('attempt')).some((a) => a.kind === 'dispatch' && a.task_id === taskId && a.at >= held.issued)) {
        return { ok: false, code: 'LEASE_LIVE', sent: false, reason: `the task was already sent under the live lease of ${held.agent}` };
      }
      const resource = this._resourceOf(taskId, owner, payload && typeof payload === 'object' ? payload.resource : undefined);
      const hash = payloadHash(payload);
      const lease = owner?.lease_id ? s.snapshot('lease')[owner.lease_id] : null;
      const ref = { agent, key, ...(lease ? { lease_id: owner.lease_id, generation: lease.generation } : {}) };
      if (this.lifecycle && owner) this._execEvent(s, 'dispatch.requested', taskId, { ...ref, resource, payload_hash: hash });
      const result = send ? send(payload) : { sent: true };
      // a provider's answer is recorded as an accepted dispatch and nothing more: it moves no state and is not completion
      if (this.lifecycle && owner && result?.ok !== false && !result?.error) this._execEvent(s, 'dispatch.accepted', taskId, { ...ref, resource, payload_hash: hash });
      const attemptId = `att_${randomToken(6)}`;
      s.append({
        type: 'attempt.upserted',
        entity: { kind: 'attempt', id: attemptId, data: { task_id: taskId, agent, kind: 'dispatch', key, status: 'ok', result, at: this.now() } },
      });
      return { ok: true, sent: true, duplicate: false, result };
    });
  }

  // external(taskId, kind, key, payload, fn) records an external action. A non-idempotent action
  // (one whose policy does not allow a resend) requires a key, so a lost acknowledgement can be
  // checked before a retry. The action runs once per key and its outcome is recorded.
  external(taskId, kind, key, payload, fn) {
    const policy = this.policies[kind] ?? this.policies.nonIdempotent;
    if (!policy.allowResend && !key) return { ok: false, error: 'key_required' };
    return this._withWrite((s) => {
      const existing = Object.values(s.snapshot('attempt')).find((a) => a.kind === 'external' && a.key === key);
      if (existing) return { ok: true, sent: false, duplicate: true, result: existing.result ?? null };
      const result = fn ? fn(payload) : { status: 'success' };
      const attemptId = `att_${randomToken(6)}`;
      s.append({
        type: 'attempt.upserted',
        entity: { kind: 'attempt', id: attemptId, data: { task_id: taskId, kind: 'external', policy: kind, key, status: 'recorded', result, at: this.now() } },
      });
      return { ok: true, sent: true, duplicate: false, result };
    });
  }

  // retryExternal(taskId, kind, key, payload, fn) is the retry path after a lost acknowledgement. It
  // first reads the recorded outcome: if the action already succeeded it does not repeat it.
  // Otherwise it follows the policy for the kind: an idempotent action may be resent up to its
  // maxAttempts, a non-idempotent one may not be resent at all.
  retryExternal(taskId, kind, key, payload, fn) {
    const policy = this.policies[kind] ?? this.policies.nonIdempotent;
    return this._withWrite((s) => {
      const attempts = Object.values(s.snapshot('attempt')).filter((a) => a.kind === 'external' && a.key === key);
      const last = attempts[attempts.length - 1];
      if (last && last.result?.status === 'success') {
        return { ok: true, repeated: false, result: last.result };
      }
      if (!policy.allowResend || attempts.length >= policy.maxAttempts) {
        return { ok: false, error: 'retry_refused', policy };
      }
      const result = fn ? fn(payload) : { status: 'success' };
      const attemptId = `att_${randomToken(6)}`;
      s.append({
        type: 'attempt.upserted',
        entity: { kind: 'attempt', id: attemptId, data: { task_id: taskId, kind: 'external', policy: kind, key, status: 'recorded', result, at: this.now() } },
      });
      return { ok: true, repeated: true, result };
    });
  }

  // ---- recovery and control (SO-08-B)

  // What an operator needs to act on, from the store: the tasks in flight with their owner and lease expiry, the blocked ones
  // with their reasons, the approvals still pending and the evidence gone stale.
  _workDetail(project, tasks) {
    const leases = this.store.snapshot('lease');
    const active = []; const blocked = [];
    for (const [id, t] of Object.entries(tasks)) {
      if (t.state === TASK_STATES.IN_PROGRESS) { const l = t.lease_id ? leases[t.lease_id] : null; active.push({ task: id, title: t.title, owner: l?.agent ?? t.holder ?? null, lease_expires: l?.expires ?? null }); }
      if (t.state === TASK_STATES.BLOCKED) blocked.push({ task: id, title: t.title, reason: t.blocked_reason ?? 'blocked' });
    }
    return { active, blocked, approvals: this._pendingApprovals(tasks), stale_evidence: Object.entries(this.store.snapshot('evidence')).filter(([, e]) => e.stale === true && tasks[e.task_id]).map(([id, e]) => ({ id, task: e.task_id, criterion: e.criterion ?? null })) };
  }
  _pendingApprovals(tasks) {
    return Object.entries(this.store.snapshot('approval')).filter(([, a]) => tasks[a.task_id] && (a.status ?? 'pending') === 'pending').map(([id, a]) => ({ id, task: a.task_id, what: a.what ?? null }));
  }
  _newestLease(s, taskId) {
    return Object.entries(s.snapshot('lease')).filter(([, l]) => l.task_id === taskId).map(([id, l]) => ({ ...l, id })).sort((a, b) => (b.generation || 0) - (a.generation || 0))[0] ?? null;
  }

  // recover(taskId): the procedure after a session stops heart-beating. It refuses while the lease is live; otherwise it marks a
  // lapsed lease, inspects what the task left behind (its checkpoint, its lease, the artifacts its attempts changed and the
  // external actions with no recorded success), writes one inspection record and returns a plan: resume from the checkpoint,
  // reassign, or ask the user. A side effect that did not succeed is never resumed or repeated blind, so it asks the user.
  recover(taskId, { actor = 'operator' } = {}) {
    if (!this.lifecycle) return this._off();
    const pre = this.store.snapshot('task')[taskId];
    if (!pre) return { ok: false, error: 'no_such_task' };
    const held = pre.lease_id ? this.store.snapshot('lease')[pre.lease_id] : null;
    if (held && held.status === 'active') {
      if (held.expires > this.now()) return { ok: false, code: 'LEASE_LIVE', reason: 'the session still holds a live lease; nothing to recover' };
      this.sweep();
    }
    return this._withWrite((s) => {
      const task = s.snapshot('task')[taskId];
      if (task.status !== TASK_STATES.BLOCKED || task.blocked_reason !== 'owner_lost') return { ok: false, code: 'NOT_RECOVERABLE', reason: `a ${task.status} task has not lost its owner` };
      const lease = this._newestLease(s, taskId);
      const attempts = Object.values(s.snapshot('attempt')).filter((a) => a.task_id === taskId);
      const inspection = {
        checkpoint: task.checkpoint ?? lease?.checkpoint ?? null,
        lease_id: lease?.id ?? null,
        lease_status: lease?.status ?? null,
        artifacts: [...new Set(attempts.flatMap((a) => a.artifacts || []))],
        side_effects: attempts.filter((a) => a.kind === 'external' && a.result?.status !== 'success').map((a) => ({ key: a.key, kind: a.policy ?? null, status: a.result?.status ?? null })),
      };
      const action = inspection.side_effects.length ? 'ask_user' : inspection.checkpoint ? 'resume' : 'reassign';
      const plan = { action, ...(action === 'resume' ? { checkpoint: inspection.checkpoint } : {}) };
      this._logEvent(s, 'task.recovery.inspected', { task_id: taskId, generation: task.generation ?? 0, ...inspection, plan: action, actor, time: this.now() });
      return { ok: true, inspection, plan };
    });
  }

  // reassignAfterRecovery(taskId, { to }): the reassignment of a lost task, refused until recover() has recorded an inspection of
  // the generation the task is at now.
  reassignAfterRecovery(taskId, { to, actor = 'operator', reason = 'reassigned after recovery' } = {}) {
    if (!this.lifecycle) return this._off();
    return this._withWrite((s) => {
      const task = s.snapshot('task')[taskId];
      if (!task) return { ok: false, error: 'no_such_task' };
      const seen = Object.values(s.snapshot('event')).some((e) => e.type === 'task.recovery.inspected' && e.task_id === taskId && e.generation === (task.generation ?? 0));
      if (!seen) return { ok: false, code: 'NOT_INSPECTED', reason: 'recover the task first: a reassignment follows an inspection record' };
      return this.reassign(taskId, { to, actor, reason });
    });
  }

  // reconstruct(project): what a start needs from the store. Leases past their expiry are marked (their tasks BLOCKED with
  // owner_lost) and the rest is read back: the pause flag, the tasks in flight under live leases and the pending approvals.
  // It dispatches nothing.
  reconstruct(project) {
    const marked = this.sweep().expired;
    const tasks = {};
    for (const [id, t] of Object.entries(this.store.snapshot('task'))) if (t.project === project) tasks[id] = { state: t.status, title: t.title };
    const leases = Object.entries(this.store.snapshot('lease')).filter(([, l]) => tasks[l.task_id]).map(([id, l]) => ({ id, task_id: l.task_id, agent: l.agent, expires: l.expires, status: l.status }));
    return {
      project,
      paused: !!(this.store.snapshot('project')[project]?.paused),
      inflight: Object.keys(tasks).filter((id) => tasks[id].state === TASK_STATES.IN_PROGRESS),
      leases: { active: leases.filter((l) => l.status === 'active'), expired: leases.filter((l) => marked.includes(l.id)) },
      approvals: this._pendingApprovals(tasks),
    };
  }

  // eligibilityPass(project, { send }): the one place a start may dispatch from. It offers the tasks eligible now and never one that
  // holds a live lease; a paused project offers none. With send each offered task is dispatched once (keyed by its generation).
  eligibilityPass(project, { send = null, agent = 'coordinator' } = {}) {
    const tasks = this.store.snapshot('task');
    const leases = this.store.snapshot('lease');
    const t = this.now();
    const live = (id) => { const x = tasks[id]; const l = x?.lease_id ? leases[x.lease_id] : null; return (l && l.status === 'active' && l.expires > t) || Object.values(leases).some((y) => y.task_id === id && y.status === 'active' && y.expires > t); };
    const dispatchable = this.eligible(project).filter((id) => !live(id));
    const sent = [];
    if (send) for (const id of dispatchable) { const r = this.dispatch(id, agent, `pass:${id}:${tasks[id].generation ?? 0}`, { resource: this._resourceOf(id, tasks[id], undefined), what: tasks[id].title }, () => send(id)); if (r.ok && r.sent) sent.push(id); }
    return { ok: true, dispatchable, sent };
  }

  // applyBusMessage(msg): a request that arrived on the bus (cancel, pause or resume), applied once. The message id is recorded in the
  // same turn as the change, so a second delivery of the same message, here or in another process, changes nothing.
  applyBusMessage(msg) {
    if (!this.lifecycle) return this._off();
    if (!msg || typeof msg.id !== 'string' || !msg.id) return { ok: false, code: 'NO_ID', reason: 'a bus message needs an id to be applied once' };
    if (!['cancel', 'pause', 'resume'].includes(msg.kind)) return { ok: false, code: 'UNKNOWN_KIND', reason: 'a bus message asks for cancel, pause or resume' };
    if (!msg.project) return { ok: false, code: 'NO_PROJECT', reason: 'a bus message names its project' };
    return this._withWrite((s) => {
      if (Object.values(s.snapshot('event')).some((e) => e.type === 'bus.processed' && e.message_id === msg.id)) return { ok: true, duplicate: true };
      const o = { actor: msg.actor || 'operator', reason: msg.reason };
      const r = msg.kind === 'cancel' ? this.cancel(String(msg.task_id), o) : msg.kind === 'pause' ? this.pause(msg.project, o) : this.resume(msg.project, o);
      if (r.ok) this._logEvent(s, 'bus.processed', { message_id: msg.id, kind: msg.kind, project: msg.project, ...(msg.task_id ? { task_id: msg.task_id } : {}) });
      return r;
    });
  }
}
