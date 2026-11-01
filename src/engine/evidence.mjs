// SPDX-License-Identifier: Apache-2.0
// The execution history of a task: four distinct event kinds that are never merged into one. A requested action
// (dispatch.requested), an accepted dispatch (dispatch.accepted), an observed execution (execution.observed) and a
// verified outcome (outcome.verified). Each carries the resource it concerns, the time and a hash of its payload. The word
// accepted here is a dispatch event of the coordinator; it is not the acceptance state of replicated operations. A provider's
// success response is an assertion to inspect, not completion: only an observed execution under the task's current lease
// lets a task leave IN_PROGRESS for VERIFYING, and VERIFIED stays with the evidence rule of the state machine.
// Pure functions over plain records: no store, no clock, no network.
import { sha256 } from './util.mjs';

export const EXECUTION_EVENT_KINDS = Object.freeze(['dispatch.requested', 'dispatch.accepted', 'execution.observed', 'outcome.verified']);

const STAGES = { 'dispatch.requested': 'requested', 'dispatch.accepted': 'accepted', 'execution.observed': 'observed', 'outcome.verified': 'verified' };
const REQUIRED = ['resource', 'time', 'payload_hash'];

/** An event of one of the four kinds must carry the resource, the time and the payload hash. */
export function validateExecutionEvent(e) {
  if (!e || !EXECUTION_EVENT_KINDS.includes(e.type)) return { ok: false, code: 'UNKNOWN_KIND', reason: `not an execution event kind: ${e?.type}` };
  for (const f of REQUIRED) {
    if (e[f] === undefined || e[f] === null || e[f] === '') return { ok: false, code: 'MISSING_FIELD', reason: `${e.type} is missing ${f}` };
  }
  return { ok: true };
}

/** The hash of a payload: a string as it is, anything else as its JSON. */
export function payloadHash(payload) {
  return sha256(typeof payload === 'string' ? payload : JSON.stringify(payload ?? null));
}

/** The execution.observed event of this task under this lease and generation, or null. */
export function observedUnderLease(events, { taskId, leaseId, generation }) {
  const hit = (events ?? []).find((e) => e && e.type === 'execution.observed' && e.task_id === taskId && e.lease_id === leaseId && e.generation === generation);
  return hit ?? null;
}

/** The four kinds of one task, each kept apart, in log order, and the furthest kind reached ('none' when there is none). */
export function executionStage(events, taskId) {
  const out = { stage: 'none', requested: [], accepted: [], observed: [], verified: [] };
  for (const e of events ?? []) {
    if (!e || e.task_id !== taskId || !STAGES[e.type]) continue;
    out[STAGES[e.type]].push(e);
    out.stage = STAGES[e.type];
  }
  return out;
}

/** The guard of the move from IN_PROGRESS to VERIFYING: an execution.observed event of this task under its current lease and
 *  generation. A dispatch that was accepted, or a success-shaped response, is not an observed execution. */
export function requireObserved(events, ref) {
  if (observedUnderLease(events, ref)) return { ok: true };
  return { ok: false, code: 'NOT_OBSERVED', reason: 'no execution.observed event of this task under its current lease: an accepted dispatch or a reported success is not an observed execution' };
}
