# Projects

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A project is a durable set of related entities and events: scope, plans, milestones,
deliverables, work packages, tasks, artifacts, checks, evidence, approvals and blockers. The
canonical `ProjectStore` persists and reconstructs project state from its append-only event log.
The pure state machine in `src/engine/project-state.mjs` defines legal task transitions; the
`Coordinator` adds claims, leases, generations, dispatch control, recovery and governed lifecycle
operations. The vault wires these components together. This page describes the implemented local
project layer; it does not imply that every planned user interface, external integration or federated
workflow is shipped.

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
| `project` | `person` | `last-writer` | `scope_version` is the exception: it is monotonic and the highest value stands, never the newest write. No contract enforces this yet |
| `task` | `person` | `human-resolution` | declared, not surfaced yet |
| `lease` | `service` | `human-resolution` | provisional: the class and the owner |
| `attempt` | `agent` | `append-only` | declared, not surfaced yet |
| `evidence` | `service` | `append-only` | provisional: the owner |
| `conflict` | `person` | `human-resolution` | declared, not surfaced yet |
| `session` | `device` | `last-writer` | declared, not surfaced yet |
| `approval` | `person` | `human-resolution` | surfaced: the semantic conflict rule below |
| `event` | `service` | `append-only` | provisional: the owner |

No type uses `set-union` yet; the class is there for the types that come later.

Only approvals are surfaced today. Every other class is declared and recorded, and nothing applies or surfaces it; that is the work of the merge provider (SO-F-06). The monotonic `scope_version` is not in SO-F-06: no contract enforces it yet. `task` is declared `human-resolution` and a competing task write is not surfaced either: the version check of the state machine is what catches two updates of one task, not this table.

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

"Terminal" here means a state with an empty row in `TRANSITIONS`, which today is `CANCELLED` only (a test holds the store's list equal to those rows). `VERIFIED` and `FAILED` have moves out, and the legacy `DONE` status of a coordinator without the lifecycle is not in the table at all, so a task in any of those three does show as `CONFLICTED`.

### What reads it, and what is not enforced yet

**The conflict is surfaced and not enforced.** Nothing in `src/` calls `view('task')` or `conflicts()` today. The coordinator reads `snapshot()`, so until the wiring below lands, a task with an unresolved approve and reject can still be claimed, reported, reassigned or cancelled. This change adds the derivation and the two readers and nothing that acts on them: changing the coordinator is outside the scope of SO-F-02.

**The wiring that follows.** SO-1.01 wiring will make the coordinator consume `view('task')` and `conflicts()` on its read side: `claim`, the eligibility check, `status` and the task listing around `_tasksOf`. Its writes keep using `snapshot()`, so a conflicted task is never written back as `CONFLICTED`. Until that lands the store's readers have no caller in `src/`, which this page records rather than hides.

A person settles a conflict by recording an approval, with a decision, whose `resolves` lists the events it settles. The list is honoured only when:

- every entry is an earlier approval event of the same task, so an approval on another task settles nothing here
- it names both sides, at least one approve and at least one reject, so a rejection cannot be dropped alone

The store refuses such a write if it breaks either rule. A log that converged in from another computer is not refused, because it was written elsewhere: on replay a resolution that breaks a rule is ignored, an approval with a decision the store does not know is not used, and each is reported in the store's recovered list while the record stays in the log as it arrived.

Some choices are made on purpose:

- The approval's `task_version` does not decide anything. A stale approval after a scope amendment still counts, and an approve and a reject on the same version are a conflict too. The rule applies no approval, it only surfaces them, and whether an approval covers the current scope is the question the state machine answers through the scope version its evidence binds to.
- One person who approves and then rejects has made a conflict, and a resolving approval that names both events settles it. A later write never replaces an earlier one.
- Who may settle a conflict is not checked: `by` is a note on the approval and is not verified, so any writer can settle a conflict by naming both sides, an agent included. ADR 5 (the permission matrix, open) or SO-03-A should close that; who a writer is gets resolved at the store boundary by SO-F-01. This rule does not decide either.
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

## The execution history

A task's history keeps four event kinds apart, and they are never merged into one: a requested action (`dispatch.requested`), an accepted dispatch (`dispatch.accepted`), an observed execution (`execution.observed`) and a verified outcome (`outcome.verified`). The order is requested, accepted, observed, verified, and each kind carries the resource it concerns, the time and a hash of its payload. The kinds and their check live in `src/engine/evidence.mjs`, and the project store refuses an event of these kinds that lacks one of the three fields.

A provider's success response is not completion. The word accepted in `dispatch.accepted` is a dispatch event of the coordinator: the provider took the request. It is not the acceptance state of replicated operations, and it moves no task. A task leaves `IN_PROGRESS` for `VERIFYING` only after an `execution.observed` event under its current lease and generation, and the coordinator refuses the move with `NOT_OBSERVED` when there is none. A report is the observation of the work it carries, so a report under the current lease records one; a late or stale report records none. `VERIFIED` is reached only through the evidence rule above, and the coordinator then records `outcome.verified`. The four kinds are recorded when the coordinator runs with its lifecycle on.

`memev work status <project>` (`--json` for the same fields as data) prints the project status and, for each task, how many times each kind was recorded, in plain words: asked for, taken on, seen running and confirmed. Only a confirmed task counts as done, so a task that was seen running is not done.

## The relationship model

A project is a model whose parts are linked on purpose, and every view of it is a projection of the store. Milestones, deliverables and work packages are entities of the one project store, each with a stable id. The links between scope, milestones, plans, deliverables, work packages, tasks, dependencies, artifacts, checks, evidence, blockers, permissions and resources are stored as events, one event per link, and the id of a link depends only on its type and its two ends, so linking twice stores one event. The eleven link types and the kinds each may join are in [`schemas/relationships-v1.json`](schemas/relationships-v1.json); the store refuses a link that does not fit it. The code is `src/engine/relationships.mjs`.

A change to a requirement or to a scope version marks every plan, task, artifact, approval and evidence record that depends on it with a stale marker. The marker names the change and the chain of links that reached the record. A link points from what is decided to what follows from it, except a task's dependency: a change to a task reaches the tasks that depend on it, and a task reaches the approvals and evidence records that name it. `memev work impact <id>` lists the dependents with the reason and whether each is stale now.

A stale marker clears in two ways only. A new verification clears it: an evidence record that did not exist when the marker was made, for the same task. An explicit re-acceptance clears it too, and it names who accepted and why. A report from a session, a claim or the old evidence clears nothing, and a later change marks the record again. Re-acceptance is how a person says that a change does not touch a record.

A projection says which event it comes from, when, the scope version, the plan version and whether it is fresh or stale. A value that cannot be confirmed, because the source event is not in the log or a version was never recorded, reads `not confirmed` and is never a guess.

Progress derives from the model: a work package, a deliverable and a milestone count the verified tasks under them over all the tasks under them, through the links, and a task linked to no work package is in no figure. A percentage that a session reports about itself is not an input and moves no figure.

## Recovery and control

When a session stops heart-beating its lease lapses and the sweep marks the task blocked with the reason owner lost. `recover` then inspects what the session left: its checkpoint, its lease, the artifacts its attempts changed and the external actions with no recorded success. It writes one inspection record and returns a plan: resume from the checkpoint, reassign, or ask the user. A task with an action that did not succeed is never resumed or repeated blind, so the plan is to ask. With no checkpoint and nothing outstanding the plan is to reassign. A reassignment after a disconnect is refused until the inspection of the task's current generation is recorded, and a task is not dispatched to a second holder while the first lease is live.

On a start the coordinator reads the project back from its store: the pause flag, the tasks in flight under live leases and the pending approvals. Leases past their expiry are marked at that point. Nothing is dispatched by a start. Dispatch comes only from an eligibility pass, which offers the tasks eligible now, never one that holds a live lease, and none while the project is paused.

`memev work pause <project>` stops new dispatch at once and prints, for each task in flight, requested, confirmed or unsupported. Cooperative cancellation is asked for through the capability record of the client holding the task; with no such record the answer is unsupported, never confirmed. `memev work resume <project>` continues from the last checkpoint. `memev work cancel <project> <task> --reason <why>` records who cancelled and why, and is refused without a reason. A task in flight stays in flight, marked requested or unsupported, until its session confirms. Each of the three takes `--json`, and exits 0 when done, 1 when refused or when the project or task does not exist, and 2 on a usage error.

`memev work status <project>` also lists the active tasks with their owner and lease expiry, the blocked items with their reasons, the pending approvals and the stale evidence, each with a next action. A project that does not exist exits 1 with one line.

Transitions are posted on the bus as ids and states only (see the bus guide). A bus message applied twice changes the project once.
