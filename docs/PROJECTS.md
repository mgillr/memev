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

## Entity types and merge classes

The store keeps nine entity types. The canonical project schema, `docs/schemas/project-v1.json`, declares three things for each, and the store holds the same declarations in `ENTITY_KINDS` in `src/engine/project-store.mjs`; a test keeps the two equal and another pins every owner and class, so changing one of them fails a test:

- the **owner**: a subject type of the [identity model](IDENTITY-AND-SCOPES.md): `person`, `agent`, `device`, `node`, `operator` or `service`. It is a declaration of which kind of subject the type belongs to. Nothing enforces it: the store checks that it is a subject type and does not check who writes. It is not the memory authority of ADR 7, which is still proposed, and it is not the permission matrix of ADR 5, which is still open. Both are decided elsewhere, and this declaration does not stand in for either
- the **scope version field**: the field that carries the entity's scope version, `scope_version`. When an entity has it, it is a positive whole number. It is the same field for every type today
- the **merge class**: what is supposed to happen when two sources write the same entity

There are four merge classes:

- `last-writer` the newest write stands. Newest means newest in log order. A tie is broken by the merge provider, not by the core
- `set-union` the elements of every write stand
- `append-only` nothing is replaced, every write is kept
- `human-resolution` competing writes are surfaced and a person settles them. They are never silently merged

| Entity type | Owner | Merge class | Status |
|---|---|---|---|
| `project` | `person` | `last-writer` | `scope_version` is the exception: it is monotonic and the highest value stands, never the newest write |
| `task` | `person` | `human-resolution` | declared, not surfaced yet |
| `lease` | `service` | `human-resolution` | provisional: the class and the owner |
| `attempt` | `agent` | `append-only` | declared, not surfaced yet |
| `evidence` | `service` | `append-only` | provisional: the owner |
| `conflict` | `person` | `human-resolution` | declared, not surfaced yet |
| `session` | `device` | `last-writer` | declared, not surfaced yet |
| `approval` | `person` | `human-resolution` | surfaced: the semantic conflict rule below |
| `event` | `service` | `append-only` | provisional: the owner |

No type uses `set-union` yet; the class is there for the types that come later.

Only approvals are surfaced today. Every other class is declared and recorded, and nothing applies or surfaces it; that is the work of the merge provider (SO-F-06). `task` is declared `human-resolution` and a competing task write is not surfaced either: the version check of the state machine is what catches two updates of one task, not this table.

Three entries are provisional, which means they wait on a decision and may change with it:

- The `lease` class waits on ADR 3 (lease semantics), which is open. Its safe default is one active writer with contending writes queued, not merged, and none of the four classes is a queue. A lease is not `last-writer`, because the newest write would then pre-empt the writer that holds it; the coordinator already refuses a second claim on a live lease. `human-resolution` is the nearest class, since a competing lease write is never settled by the newest one. When ADR 3 is decided, the class follows it.
- The `lease`, `evidence` and `event` owner is `service`, and no `service` subject can be issued yet ([IDENTITY-AND-SCOPES.md](IDENTITY-AND-SCOPES.md)). The declaration is kept until the model issues one, and until then no subject holds that ownership.
- The decisions an approval can record, `approve` and `reject`, are a closed pair that stands in for the seven decision states of the decision queue (SO-A-05, SO-1.08), which are not in code yet.

Moving an entity from one owner to another, and several concurrent owners of one type, are not defined here. Both are deferred.

The core records the merge class of a type and applies none. The free path keeps both versions of a competing write: both stay in the event log, and the store shows the later one as it is, without merging them. Applying a class is the job of the merge provider behind `src/engine/merge.mjs`, which is not in the core. The store refuses an entity of a type that declares no merge class, or no owner, and writes nothing. A type passed to the store can add to the built-in ones and cannot take the name of one.

A store that is migrated to a newer schema version carries that version in its files and on every record it writes, and the schema names the store version it describes.

## The semantic conflict rule

The version check in the state machine (invariant 8) catches two updates from different sources on the same version. It does not catch two approvals on one task that say incompatible things when they were given on different versions. For example, one computer records an approval of version 1 while another records a rejection of version 2, and the two logs then converge.

That is a semantic conflict. The store reads every approval event in the log, and each write is its own event: two writes that happen to share an approval id are two events, so one approving and one rejecting is a conflict like any other. For each task with approvals of more than one decision (`approve` and `reject`) it derives one conflict record that names every event involved, with the approvals, their decisions and the versions they were given on, and applies neither approval.

Both approvals stay in the log and as entities, unchanged. Nothing is written to the log for the conflict, and it is never written into a task: the stored task keeps its own status, and the conflict is read through `store.conflicts()` and `store.view('task')`. The view shows a task that is not in a terminal state as `CONFLICTED`, with the status it had as `prior_status` and the record attached. It is a display and makes no transition, so a cancelled task stays `CANCELLED`, and anything that acts on a task reads the stored one. The same log always gives the same result.

A person settles a conflict by recording an approval, with a decision, whose `resolves` lists the events it settles. The list is honoured only when:

- every entry is an earlier approval event of the same task, so an approval on another task settles nothing here
- it names both sides, at least one approve and at least one reject, so a rejection cannot be dropped alone

The store refuses such a write if it breaks either rule. A log that converged in from another computer is not refused, because it was written elsewhere: on replay a resolution that breaks a rule is ignored, an approval with a decision the store does not know is not used, and each is reported in the store's recovered list while the record stays in the log as it arrived.

Some choices are made on purpose:

- The approval's `task_version` does not decide anything. A stale approval after a scope amendment still counts, and an approve and a reject on the same version are a conflict too. The rule applies no approval, it only surfaces them, and whether an approval covers the current scope is the question the state machine answers through the scope version its evidence binds to.
- One person who approves and then rejects has made a conflict, and a resolving approval that names both events settles it. A later write never replaces an earlier one.
- Who may settle a conflict is not checked: `by` is a note on the approval and is not verified, so any subject that can write an approval can name both sides. The permission matrix is ADR 5, which is open, and who a writer is gets resolved at the store boundary by SO-F-01. This rule does not decide either.
- The set of decisions is provisional, as above.

Approvals that agree, a single approval, and approvals with no decision are not conflicts.

## The coordinator

The coordinator (`src/engine/coordinator.mjs`) is the duplicate-work control. It sits on top of the
project store and turns the store's single-writer path into the rules that keep a project moving:

- **Claims are atomic.** A claim is a read-check-write under the store's lock, so two processes
  cannot both win the same task. The winner gets a lease with a generation token, an issue time and
  an expiry; the other gets a conflict that names the holder and the expiry.
- **A stale owner cannot commit.** Every write carries the lease's generation token. Once the token
  is superseded (the task was released and re-claimed, or the lease expired), a report under the old
  token is refused. A report under a released lease is *late*; one under a superseded generation is
  *stale*. Both are stored as an attempt with their output kept as evidence, and no canonical field
  changes.
- **Eligibility comes from dependencies and locks.** A READY task is eligible when its dependencies
  are all DONE and it holds no resource or artifact shared with an in-progress task. Independent
  tasks run in parallel; tasks that share a mutable resource are serialized.
- **Heartbeats keep a lease alive.** A heartbeat extends the lease within its ttl and stores a
  checkpoint reference. When a lease expires without a heartbeat, the sweep blocks its task as
  owner-lost with the checkpoint, and does not reassign it.
- **Dispatch and external actions are idempotent by key.** A dispatch sends its payload once per key.
  A non-idempotent external action requires a key so a lost acknowledgement can be checked before a
  retry; a retry reads the recorded outcome first and does not repeat a success, and follows the
  policy for the kind (idempotent actions may be resent up to a limit, non-idempotent ones may not).
- **A shared artifact is a conflict.** Two attempts that changed the same artifact are a conflict and
  the task is marked CONFLICTED, even when a git merge of the two would have succeeded.

## Design notes

The coordinator does not open or own a store. It takes one as an argument and calls only its public
API (`withWrite`, `append`, `snapshot`, `stats`). In production the caller passes a ProjectStore
from SO-07-A; the tests pass a self-contained double with the same API, so the coordinator's
duplicate-work rules are testable without the store on main.

The per-task generation token lives in the task record, not the store's global generation, so
ownership versions are per task. The store's global generation still guards the append path against
a writer that has gone stale, but the coordinator does not depend on it.

The retry policies for external actions are read from a small local table until SO-03-A's policy
module is on main; when it lands it is passed in as `policies`.
