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

import { randomToken } from './util.mjs';
import { transition, projectStatus, TASK_STATES } from './project-state.mjs';

// Retry policies for external actions. SO-03-A's policy module is not on main yet, so the
// coordinator reads these local defaults; when the module lands it is passed in as `policies`.
export const DEFAULT_POLICIES = {
  idempotent: { allowResend: true, maxAttempts: 3 },
  nonIdempotent: { allowResend: false, maxAttempts: 1 },
};

// A busy-wait that does not need async: the store's lock is held only for a few milliseconds, so a
// short spin is enough to let the other writer finish its turn.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class Coordinator {
  constructor(store, { now = () => Date.now(), policies = DEFAULT_POLICIES, busy = { retries: 400, delay: 2 }, lifecycle = false } = {}) {
    this.store = store;
    this.lifecycle = lifecycle;
    this.now = now;
    this.policies = policies;
    this.busy = busy;
  }

  // Hold the store's lock across a callback, retrying while another live writer holds it.
  _withWrite(fn) {
    for (let i = 0; i < this.busy.retries; i++) {
      const r = this.store.withWrite(fn);
      if (!r || r.busy !== true || r.retry !== true) return r;
      sleepMs(this.busy.delay);
    }
    throw new Error('store_busy');
  }

  // The exclusive set a task holds while in progress: its declared resources plus its declared
  // artifacts, since both are mutable and must not be written by two tasks at once.
  _lockSet(t) { return [...new Set([...(t.resources || []), ...(t.artifacts || [])])]; }


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

  // The project's tasks as the state machine sees them, and the derived project status.
  status(project) {
    const tasks = {};
    const states = [];
    for (const [id, t] of Object.entries(this.store.snapshot('task'))) {
      if (t.project !== project) continue;
      tasks[id] = { state: t.status, title: t.title, deps: t.deps || [], lease_id: t.lease_id ?? null, blocked_reason: t.blocked_reason ?? null, artifact_hash: t.artifact_hash ?? null };
      states.push({ state: t.status, cancelReason: t.cancelReason });
    }
    const counts = {};
    for (const x of states) counts[x.state] = (counts[x.state] || 0) + 1;
    return { project, status: projectStatus(states), counts, tasks, eligible: this.eligible(project) };
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
              ...(this.lifecycle ? { scope_version: 1, criteria: spec.criteria || [], artifact_hash: spec.artifact_hash ?? null } : {}),
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
    const out = [];
    for (const [id, t] of Object.entries(tasks)) {
      if (!openStatuses.includes(t.status) || t.project !== project) continue;
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
            data: { ...task, status, generation, lease_id: leaseId, locks: this._lockSet(task) },
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
        const c = this._chain(s, this._view(l.task_id, task), [[TASK_STATES.VERIFYING, { actor: l.agent, reason: 'work reported, awaiting evidence', correlationId: lease.id }]]);
        if (!c.ok) return { ok: false, code: c.code, reason: c.reason };
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
      const existing = Object.values(s.snapshot('attempt')).find((a) => a.kind === 'dispatch' && a.key === key);
      if (existing) return { ok: true, sent: false, duplicate: true, result: existing.result ?? null };
      const result = send ? send(payload) : { sent: true };
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
}
