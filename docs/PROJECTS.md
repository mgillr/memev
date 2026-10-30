# Projects

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A project is a set of tasks the engine runs for you. The engine keeps the tasks, their
dependencies, and who is working on each of them in one place, so two workers never do the same
work and a result that arrives too late is kept but not applied.

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
