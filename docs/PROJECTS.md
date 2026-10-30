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
Every state change the module makes goes through it: a scope change, a conflict and a confirmed
cancellation are moves in the table with their records, like any other. Every allowed move
still has to pass its guard:

- to `READY`, every dependency is `VERIFIED`, or `CANCELLED` where the policy allows it
- to `IN_PROGRESS`, a live lease for the task; a lease with an expiry is checked against the
  time the caller gives, because the module reads no clock
- to `VERIFIED`, the task names at least one mandatory criterion and carries a scope version
  and an artifact hash, and every mandatory criterion has a live evidence record of that task
  bound to both; a task with no mandatory criterion cannot be verified, so a report never is

A transition that passes comes back as a new task record plus a record of the move; the input
is never mutated.

## Transition table

The table in the module, one line per state, and the test reads it from this page:

- `PROPOSED` to `ACCEPTED`, `CANCELLED`
- `ACCEPTED` to `READY`, `BLOCKED`, `PAUSED`, `CANCELLED`
- `READY` to `IN_PROGRESS`, `BLOCKED`, `PAUSED`, `CANCELLED`
- `IN_PROGRESS` to `BLOCKED`, `PAUSED`, `VERIFYING`, `FAILED`, `CONFLICTED`, `CANCELLED`
- `BLOCKED` to `READY`, `ACCEPTED`, `PAUSED`, `CANCELLED`
- `PAUSED` to `READY`, `IN_PROGRESS`, `CANCELLED`
- `VERIFYING` to `VERIFIED`, `FAILED`, `CONFLICTED`, `ACCEPTED`
- `VERIFIED` to `ACCEPTED`, `CANCELLED`
- `FAILED` to `ACCEPTED`, `READY`, `CANCELLED`
- `CONFLICTED` to `ACCEPTED`, `READY`, `CANCELLED`
- `CANCELLED` to nothing: it is the end of the line

`VERIFIED` to `ACCEPTED` is the replan after a scope change, and `IN_PROGRESS` to `CONFLICTED`
is two sources writing the same work in flight.

## The invariants

The ten invariants of the project layer, as code paths in the module:

1. only accepted work is dispatched
2. agent assertions never verify: a report is not evidence
3. evidence binds to the scope version and the artifact hash
4. scope changes invalidate: `amendScope` bumps the version, marks the affected evidence
   stale and replans the affected `VERIFIED` and `VERIFYING` tasks back to `ACCEPTED`
5. reassignment needs an expired or released lease of that task, or an override marked
   authorised, and records the inspection of the prior attempts
6. duplicate delivery is idempotent (the store's part, SO-07-A)
7. stale generations cannot overwrite: a reassignment bumps the task's generation, and an
   update that does not present the current generation is refused even on the current version
8. conflicts surface, never last-write-wins: two updates from different sources on the same
   version produce `CONFLICTED` with a conflict record; a task in a state the table does not
   move to `CONFLICTED` keeps its state with the conflict record attached, so a cancelled task
   is never revived
9. every transition records its fields: actor, time, reason, previous state, new state,
   scope version, correlation id and evidence references, in an append-only log with unique
   event ids
10. pause stops dispatch while hard cancellation is claimed only on confirmation

## Pause and resume

Pausing stops new dispatch, not the truth: no task is eligible while the project is paused,
but the tasks keep their states. In-flight tasks stay `IN_PROGRESS` with a cancellation
field of `requested`, `confirmed` or `unsupported`, and a hard cancellation is recorded as
`CANCELLED` only when the adapter confirms it. The move and its record are checked before the
adapter is asked, so the adapter never cancels work that would not be recorded.

Resuming makes the ready tasks eligible again and keeps everything that happened during the
pause: a confirmed cancellation stays `CANCELLED`, and work that moved on stays where it is.
The checkpoint taken at the pause is used only to withdraw the cancellation request the pause
itself made, on a task whose state has not changed since.
