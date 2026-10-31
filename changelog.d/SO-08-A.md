### Added

- The coordinator (`src/engine/coordinator.mjs`) is the duplicate-work control for a project. It sits on the project store and makes claims atomic, so two processes cannot both win the same task; the winner gets a lease with a generation token, an issue time and an expiry, and the other gets a conflict that names the holder and the expiry.
- Every write carries the lease's generation token, so a stale owner cannot commit: a report under a released lease is late and one under a superseded generation is stale, both stored as an attempt with their output kept as evidence and no canonical field changed.
- Eligibility comes from dependencies and locks: a READY task is eligible when its dependencies are done and it holds no resource or artifact shared with an in-progress task, so independent tasks run in parallel and tasks that share a mutable resource are serialized.
- Heartbeats extend a lease within its ttl and store a checkpoint reference; when a lease expires without a heartbeat the sweep blocks its task as owner-lost with the checkpoint and does not reassign it.
- Dispatch and external actions are idempotent by key: a dispatch sends its payload once per key, a non-idempotent external action requires a key so a lost acknowledgement can be checked before a retry, and a retry reads the recorded outcome first and does not repeat a success.
- Two attempts that changed the same artifact are a conflict and the task is marked CONFLICTED, even when a git merge of the two would have succeeded.
- The coordinator takes a store as an argument and calls only its public API, so its rules are testable with a self-contained double; the tests cover the two-process claim race, stale and late reports, eligibility, heartbeats and expiry, idempotency, and the conflict.
