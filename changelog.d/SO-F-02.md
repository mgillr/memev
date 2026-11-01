### Added

- The canonical project schema, version 1 (`docs/schemas/project-v1.json`): every entity type of the project store declares its authority owner (a subject type of the identity model), its scope version field and its merge class (last-writer, set-union, append-only or human-resolution). The store holds the same declarations and refuses an entity of a type that declares no merge class. The core records the class and applies none.
- Two incompatible approvals on one task, given on different versions, are a semantic conflict: when the store rebuilds its state from the log the task is `CONFLICTED`, a conflict record names every event, neither approval is applied, and both stay in the log. An approval that lists the events it resolves ends the conflict.
- `docs/PROJECTS.md` documents the merge classes and the semantic-conflict rule.
