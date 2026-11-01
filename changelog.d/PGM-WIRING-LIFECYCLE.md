### Added

- The rest of the project state machine is reached from the daemon through the coordinator: pausing and resuming a project, amending its scope, cancelling and reassigning a task, patching a task, and reading the event log. MCP tools `memev_project_pause`, `memev_project_resume`, `memev_scope_amend`, `memev_task_cancel`, `memev_task_reassign` and `memev_task_update`; `memev_project_status` accepts `history`.
- A paused project hands out no work: claims and dispatches are refused and nothing is listed as eligible, and a task in flight gets a cancellation request.
- Amending a project's scope raises its scope version, marks evidence bound to the old version stale and returns an affected verified task to ACCEPTED for re-planning. Cancellation and reassignment go through the transition table and are written to the event log; reassigning a task whose lease is live needs an administrator override, which revokes that lease.
- A task can be linked to a signed contract when it is planned. `memev_contract_verify` then feeds the task automatically: a pass makes a task in VERIFYING VERIFIED, with evidence rows bound to its scope version and a Memev-computed artifact hash, and a failure moves it to FAILED. A task changed or re-scoped between its report and the verify stays unverified, and a contract-linked task cannot be verified by hand.

### Fixed

- Taking over the project store's lock no longer fails when the holder releases it between two reads, and no longer removes a lock taken by another process in the meantime.
