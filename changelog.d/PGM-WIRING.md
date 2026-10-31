### Added

- The project store, the project state machine and the coordinator are now one path from the daemon: the vault holds one store and one coordinator per project, and every task move goes through the state machine's transition table, with its record appended to the project's event log.
- MCP tools `memev_task_plan`, `memev_task_claim`, `memev_task_heartbeat`, `memev_task_report`, `memev_task_release`, `memev_task_verify` and `memev_project_status`. A report moves a task to VERIFYING and never to a finished state; only `memev_task_verify`, a local operator action that needs evidence bound to the task's scope version and artifact hash, makes it VERIFIED.
- The resume card shows a project's task states and what is ready to claim.
- A test that fails when crdt-merge implementation code, a vendor/converge directory or a crdt-merge package import appears in the Apache-2.0 core, and a test that fails when the store, the state machine or the coordinator is not reached from the default entry or is built a second time.
