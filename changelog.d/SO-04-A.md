### Added

- A project and task state machine in `src/engine/project-state.mjs`: eleven task states,
  seven derived project statuses, one transition table, and the project-layer invariants
  (evidence binding, scope invalidation, conflict surfacing, pause and resume) as pure
  functions, documented in `docs/PROJECTS.md`.
