### Added

- A task's history now keeps four event kinds apart: a requested action, an accepted dispatch, an observed execution and a verified outcome, each with its resource, time and payload hash. A provider's success response is not completion, and a task moves from in progress to verifying only after an observed execution under its current lease. `memev work status <project>` shows the four kinds in plain words and counts only confirmed tasks as done.
