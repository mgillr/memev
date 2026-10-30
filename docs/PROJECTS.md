# Projects

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A project is a set of tasks that move through a fixed set of states, and the project itself
shows one derived status at a time. The state machine lives in `src/engine/project-state.mjs`
as pure functions over plain records: no persistence, no bus, no network, no model call, so
the whole table can be tested in process. Later work adds the store and the bus hooks around
it; this page is the one documentation page of the project layer.

## Task states

The eleven task states:

- `PROPOSED` a task that has been drafted, not yet accepted
- `ACCEPTED` accepted work, planned against the current scope version
- `READY` every dependency is done, eligible for dispatch
- `IN_PROGRESS` claimed under a live lease
- `BLOCKED` waiting on something outside the task
- `PAUSED` held while the project is paused
- `VERIFYING` the work is checked against the criteria
- `VERIFIED` every mandatory criterion has bound evidence
- `FAILED` the check failed, it can be replanned
- `CONFLICTED` two sources competed, a resolver must decide
- `CANCELLED` closed with a recorded reason, the end of the line

## Project statuses

The seven derived project statuses, in the order the precedence resolves them:

- `CANCELLED` the project was cancelled
- `DRAFT` no task has been accepted yet
- `PAUSED` the project is paused
- `NEEDS_ATTENTION` a task is blocked or conflicted, or an approval is pending
- `VERIFYING` a task is being checked
- `COMPLETE` every task is verified or cancelled with a recorded reason
- `ACTIVE` anything else

## Transitions

One table in the module holds every allowed move, and nothing else is allowed. A move that is
not in the table is refused with a reason code, and a move to the same state is refused too.
Every allowed move still has to pass its guard:

- to `READY`, every dependency is `VERIFIED`, or `CANCELLED` where the policy allows it
- to `IN_PROGRESS`, a live lease for the task
- to `VERIFIED`, an evidence record for every mandatory criterion, bound to the task's
  current scope version and artifact hash

A transition that passes comes back as a new task record plus a record of the move; the input
is never mutated.

## The invariants

The ten invariants of the project layer, as code paths in the module:

1. only accepted work is dispatched
2. agent assertions never verify: a report is not evidence
3. evidence binds to the scope version and the artifact hash
4. scope changes invalidate: `amendScope` bumps the version, marks the affected evidence
   stale and replans the affected `VERIFIED` and `VERIFYING` tasks back to `ACCEPTED`
5. reassignment needs an expired or released lease, or an authorised override, and records
   the inspection of the prior attempts
6. duplicate delivery is idempotent (the store's part, SO-07-A)
7. stale generations cannot overwrite
8. conflicts surface, never last-write-wins: two updates from different sources on the same
   version produce `CONFLICTED` with a conflict record
9. every transition records its fields: actor, time, reason, previous state, new state,
   scope version, correlation id and evidence references, in an append-only log with unique
   event ids
10. pause stops dispatch while hard cancellation is claimed only on confirmation

## Pause and resume

Pausing stops new dispatch, not the truth: no task is eligible while the project is paused,
but the tasks keep their states. In-flight tasks stay `IN_PROGRESS` with a cancellation
field of `requested`, `confirmed` or `unsupported`, and a hard cancellation is recorded as
`CANCELLED` only when the adapter confirms it. Resuming restores the tasks from the
checkpoint taken at the pause.
