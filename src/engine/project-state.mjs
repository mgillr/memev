// SPDX-License-Identifier: Apache-2.0
// The project and task state machine: the eleven task states, the seven derived project
// statuses, one transition table, and the invariants of the project layer as code. Pure
// functions over plain records: no persistence, no bus, no network, no model call, so the
// whole table can be tested in process.
//
// The invariants held here:
//   1. only accepted work is dispatched (READY needs its dependencies done)
//   2. agent assertions never verify (VERIFIED needs bound evidence, not a report)
//   3. evidence binds to the scope version and the artifact hash
//   4. scope changes invalidate (amendScope)
//   5. reassignment needs an expired or released lease, or an authorised override
//   6. duplicate delivery is idempotent (the store's part, SO-07-A)
//   7. stale generations cannot overwrite (applyUpdate)
//   8. conflicts surface, never last-write-wins (applyUpdate, reassign)
//   9. every transition records its fields (makeRecord, EventLog)
//  10. pause stops dispatch while hard cancellation is claimed only on confirmation

export const TASK_STATES = Object.freeze({
  PROPOSED: 'PROPOSED',
  ACCEPTED: 'ACCEPTED',
  READY: 'READY',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  PAUSED: 'PAUSED',
  VERIFYING: 'VERIFYING',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  CONFLICTED: 'CONFLICTED',
  CANCELLED: 'CANCELLED',
});

export const PROJECT_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  VERIFYING: 'VERIFYING',
  COMPLETE: 'COMPLETE',
  CANCELLED: 'CANCELLED',
});

// The one transition table: for each state, the states a task may move to. Anything not
// listed is refused with ILLEGAL_TRANSITION; a move to the same state is NO_CHANGE.
export const TRANSITIONS = Object.freeze({
  PROPOSED: Object.freeze(['ACCEPTED', 'CANCELLED']),
  ACCEPTED: Object.freeze(['READY', 'BLOCKED', 'PAUSED', 'CANCELLED']),
  READY: Object.freeze(['IN_PROGRESS', 'BLOCKED', 'PAUSED', 'CANCELLED']),
  IN_PROGRESS: Object.freeze(['BLOCKED', 'PAUSED', 'VERIFYING', 'FAILED', 'CANCELLED']),
  BLOCKED: Object.freeze(['READY', 'ACCEPTED', 'PAUSED', 'CANCELLED']),
  PAUSED: Object.freeze(['READY', 'IN_PROGRESS', 'CANCELLED']),
  VERIFYING: Object.freeze(['VERIFIED', 'FAILED', 'CONFLICTED', 'ACCEPTED']),
  VERIFIED: Object.freeze(['CANCELLED']),
  FAILED: Object.freeze(['ACCEPTED', 'READY', 'CANCELLED']),
  CONFLICTED: Object.freeze(['ACCEPTED', 'READY', 'CANCELLED']),
  CANCELLED: Object.freeze([]),
});

const refuse = (code, reason) => ({ ok: false, code, reason });

/** READY: every dependency is VERIFIED, or CANCELLED where the policy allows it. */
function depsSatisfied(task, ctx) {
  for (const id of task.dependsOn ?? []) {
    const dep = ctx.tasksById?.[id];
    if (!dep) return refuse('MISSING_DEPENDENCY', `dependency ${id} is not in the task set`);
    if (dep.state === TASK_STATES.VERIFIED) continue;
    if (dep.state === TASK_STATES.CANCELLED && ctx.policy?.allowCancelledDeps) continue;
    return refuse('DEP_NOT_VERIFIED', `dependency ${id} is ${dep.state}, not VERIFIED`);
  }
  return { ok: true };
}

/** IN_PROGRESS: a live lease for this task, not expired and not released. */
function liveLease(task, ctx) {
  const l = ctx.lease;
  if (!l || l.taskId !== task.id) return refuse('NO_LIVE_LEASE', 'no lease reference for this task');
  if (l.state === 'expired' || l.state === 'released') return refuse('NO_LIVE_LEASE', `the lease is ${l.state}`);
  if (ctx.now != null && l.expiresAt != null && l.expiresAt <= ctx.now) return refuse('NO_LIVE_LEASE', 'the lease has expired');
  return { ok: true };
}

/** VERIFIED: an evidence record for every mandatory criterion, bound to the task's current
 *  scope version and artifact hash. An agent report is not evidence. */
function evidenceFor(task, ctx) {
  const mandatory = (task.criteria ?? []).filter((c) => c.mandatory);
  const evs = ctx.evidence ?? [];
  for (const c of mandatory) {
    const hit = evs.some((e) => e.taskId === task.id && e.criterion === c.id && e.scopeVersion === task.scopeVersion && e.artifactHash === task.artifactHash);
    if (!hit) return refuse('NO_EVIDENCE', `criterion ${c.id} has no evidence bound to scope version ${task.scopeVersion} and the current artifact hash${ctx.report ? '; an agent report is not evidence' : ''}`);
  }
  return { ok: true };
}

const RECORD_FIELDS = ['actor', 'time', 'reason', 'correlationId'];

/** The transition record: actor, time, reason, previous state, new state, scope version,
 *  correlation id and evidence references. A record missing any field is refused naming it. */
export function makeRecord(task, to, ctx = {}) {
  for (const f of RECORD_FIELDS) {
    if (ctx[f] === undefined || ctx[f] === null || ctx[f] === '') return refuse('MISSING_FIELD', `record is missing ${f}`);
  }
  return {
    ok: true,
    record: {
      actor: ctx.actor,
      time: ctx.time,
      reason: ctx.reason,
      from: task.state,
      to,
      scopeVersion: task.scopeVersion,
      correlationId: ctx.correlationId,
      evidence: [...(ctx.evidence ?? [])],
    },
  };
}

/** Move a task to a new state. Returns { ok: true, task, record } with a new task record,
 *  or { ok: false, code, reason, task } leaving the input untouched. */
export function transition(task, to, ctx = {}) {
  if (!TASK_STATES[to]) return refuse('UNKNOWN_STATE', `unknown state ${to}`);
  if (to === task.state) return { ...refuse('NO_CHANGE', `already ${task.state}`), task };
  if (!(TRANSITIONS[task.state] ?? []).includes(to)) return { ...refuse('ILLEGAL_TRANSITION', `${task.state} -> ${to} is not in the transition table`), task };
  if (to === TASK_STATES.READY) { const d = depsSatisfied(task, ctx); if (!d.ok) return { ...d, task }; }
  if (to === TASK_STATES.IN_PROGRESS) { const l = liveLease(task, ctx); if (!l.ok) return { ...l, task }; }
  if (to === TASK_STATES.VERIFIED) { const e = evidenceFor(task, ctx); if (!e.ok) return { ...e, task }; }
  const rec = makeRecord(task, to, ctx);
  if (!rec.ok) return rec;
  const newTask = { ...task, state: to };
  if (to === TASK_STATES.CANCELLED) newTask.cancelReason = ctx.reason;
  return { ok: true, task: newTask, record: rec.record };
}

/** The append-only event log: every record gets a unique id and is frozen on entry. */
export class EventLog {
  #entries = [];
  #ids = new Set();
  #seq = 0;
  append(record) {
    const id = record.id ?? `ev-${++this.#seq}`;
    if (this.#ids.has(id)) return refuse('DUPLICATE_EVENT_ID', `event id ${id} is already recorded`);
    const entry = Object.freeze({ ...record, id });
    this.#ids.add(id);
    this.#entries.push(entry);
    return { ok: true, entry };
  }
  entries() { return [...this.#entries]; }
  get size() { return this.#entries.length; }
}

/** A scope change: bump the version, return the affected tasks and evidence, mark that
 *  evidence stale, and move affected VERIFIED and VERIFYING tasks back to ACCEPTED with a
 *  replan reason. Unaffected tasks keep their state and ids. */
export function amendScope(project, change) {
  const paths = new Set(change.paths ?? []);
  const nextVersion = project.scopeVersion + 1;
  const affectedTaskIds = new Set();
  const tasks = project.tasks.map((t) => {
    const hit = (t.scope ?? []).some((p) => paths.has(p));
    if (!hit) return t;
    affectedTaskIds.add(t.id);
    if (t.state === TASK_STATES.VERIFIED || t.state === TASK_STATES.VERIFYING) {
      return { ...t, state: TASK_STATES.ACCEPTED, scopeVersion: nextVersion, replanReason: 'scope changed: the bound evidence is stale, replan the task' };
    }
    return { ...t, scopeVersion: nextVersion };
  });
  const evidence = project.evidence.map((e) => (affectedTaskIds.has(e.taskId) && !e.stale ? { ...e, stale: true } : e));
  const affectedEvidence = evidence.filter((e, i) => e.stale && !(project.evidence[i] ?? {}).stale);
  return {
    project: { ...project, scopeVersion: nextVersion, tasks, evidence },
    affected: {
      tasks: project.tasks.filter((t) => affectedTaskIds.has(t.id)),
      evidence: affectedEvidence,
    },
  };
}

/** The derived project status, a pure function of the tasks and the project flags.
 *  Precedence: CANCELLED, DRAFT, PAUSED, NEEDS_ATTENTION, VERIFYING, COMPLETE, ACTIVE. */
export function projectStatus(tasks, flags = {}) {
  if (flags.cancelled) return PROJECT_STATUSES.CANCELLED;
  if (!tasks.some((t) => t.state !== TASK_STATES.PROPOSED)) return PROJECT_STATUSES.DRAFT;
  if (flags.paused) return PROJECT_STATUSES.PAUSED;
  if (flags.pendingApproval || tasks.some((t) => t.state === TASK_STATES.BLOCKED || t.state === TASK_STATES.CONFLICTED)) return PROJECT_STATUSES.NEEDS_ATTENTION;
  if (tasks.some((t) => t.state === TASK_STATES.VERIFYING)) return PROJECT_STATUSES.VERIFYING;
  if (tasks.length > 0 && tasks.every((t) => t.state === TASK_STATES.VERIFIED || (t.state === TASK_STATES.CANCELLED && t.cancelReason))) return PROJECT_STATUSES.COMPLETE;
  return PROJECT_STATUSES.ACTIVE;
}

/** Apply one update to a versioned entity. A current update applies and bumps the version;
 *  a stale update from a different source surfaces a CONFLICTED entity with a conflict
 *  record instead of last-write-wins; any other stale update is refused. */
export function applyUpdate(entity, update) {
  if (update.baseVersion === entity.version) {
    return { ok: true, entity: { ...entity, ...update.patch, version: entity.version + 1, lastWrite: { source: update.source, ref: update.ref } } };
  }
  if (entity.lastWrite && entity.lastWrite.source !== update.source && !entity.conflict) {
    return {
      ok: false,
      code: 'CONFLICT',
      reason: 'two updates from different sources on the same version',
      entity: {
        ...entity,
        state: TASK_STATES.CONFLICTED,
        conflict: {
          competing: [entity.lastWrite.ref, update.ref],
          entity: entity.id,
          reason: 'competing updates from different sources on the same version',
          resolver: update.resolver ?? null,
        },
      },
    };
  }
  return { ok: false, code: 'STALE_GENERATION', reason: `update is based on version ${update.baseVersion}, the entity is at ${entity.version}`, entity };
}

/** Reassign a task to a new holder. Needs an expired or released lease, or an authorised
 *  override; records the inspection of the prior attempts; bumps the generation so a stale
 *  one cannot overwrite. */
export function reassign(task, ctx = {}) {
  const lease = ctx.lease;
  const leaseFree = lease && lease.taskId === task.id && (lease.state === 'expired' || lease.state === 'released');
  const override = ctx.override && ctx.override.authorised === true;
  if (!leaseFree && !override) return refuse('LEASE_NOT_FREE', 'reassignment needs an expired or released lease, or an authorised override');
  if (!ctx.to) return refuse('MISSING_FIELD', 'record is missing to');
  const record = {
    actor: ctx.actor,
    time: ctx.time,
    reason: ctx.reason ?? 'reassignment',
    from: task.holder ?? null,
    to: ctx.to,
    scopeVersion: task.scopeVersion,
    correlationId: ctx.correlationId,
    evidence: [],
    inspectedAttempts: (ctx.attempts ?? []).map((a) => a.ref ?? a.id),
  };
  for (const f of ['actor', 'time', 'correlationId']) {
    if (record[f] === undefined || record[f] === null || record[f] === '') return refuse('MISSING_FIELD', `record is missing ${f}`);
  }
  const newTask = { ...task, holder: ctx.to, generation: (task.generation ?? 0) + 1, version: (task.version ?? 1) + 1 };
  return { ok: true, task: newTask, record };
}

/** A task is eligible for dispatch only while it is READY and the project is not paused. */
export function eligibleForDispatch(task, project) {
  return !project.paused && task.state === TASK_STATES.READY;
}

/** Pause the project: stop new dispatch, keep the truth. In-flight tasks stay IN_PROGRESS
 *  with a cancellation field of requested; the checkpoint holds the state to resume from. */
export function pause(project) {
  const checkpoint = Object.freeze({ scopeVersion: project.scopeVersion, tasks: project.tasks.map((t) => Object.freeze({ ...t })) });
  const tasks = project.tasks.map((t) => (t.state === TASK_STATES.IN_PROGRESS ? { ...t, cancellation: 'requested' } : { ...t }));
  return { ...project, paused: true, tasks, checkpoint };
}

/** Ask the adapter to hard-cancel an in-flight task. The cancellation is recorded as
 *  CANCELLED only when the adapter confirms it; otherwise the task keeps its state with a
 *  cancellation field of requested or unsupported. */
export function requestCancellation(task, adapter) {
  const result = typeof adapter === 'function' ? adapter() : adapter;
  if (result === 'confirmed') {
    return { ok: true, task: { ...task, state: TASK_STATES.CANCELLED, cancellation: 'confirmed', cancelReason: 'hard cancellation confirmed by the adapter' } };
  }
  if (result === 'unsupported') return { ok: false, code: 'CANCELLATION_UNSUPPORTED', task: { ...task, cancellation: 'unsupported' } };
  return { ok: false, code: 'CANCELLATION_PENDING', task: { ...task, cancellation: 'requested' } };
}

/** Resume the project: restore the tasks from the checkpoint taken at pause. */
export function resume(project) {
  if (!project.paused) return refuse('NOT_PAUSED', 'the project is not paused');
  const tasks = (project.checkpoint?.tasks ?? project.tasks).map((t) => ({ ...t }));
  return { ...project, paused: false, tasks, checkpoint: null };
}
