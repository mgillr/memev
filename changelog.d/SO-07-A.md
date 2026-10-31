### Added

- The project store keeps one canonical project state per project under the vault's `.memev/projects/<id>/`: a snapshot per entity kind and one append-only event log, with a schema version on every file and every record.
- The store supports the handoff's minimum entities (project, task, lease, attempt, evidence, conflict, session and approval), each with a validator that refuses a record missing a required field and names the field.
- Appending is idempotent by key (the same event twice returns the original record and appends nothing new) and refuses a stale generation, recording the refusal as a refused event in the log.
- On every open the state is rebuilt from the event log alone, so the log wins over a snapshot that has drifted; a torn last line is truncated and reported, and a bad line in the middle is skipped and reported while every valid record after it is kept.
- A store at an older schema version is migrated forward once on open, with a `.bak-v1` copy kept beside each snapshot and a migration event recorded; a store at a newer version refuses to open and writes nothing.
- A record that looks like a credential is refused by default (and the refusal is recorded) or, with the allow flag, redacted and marked redacted; `compact()` drops only the superseded snapshot copies and keeps every transition in the log.
- One writer holds the lock at a time: a second process appending to the same project is told to retry instead of interleaving a partial line, and ids are sortable, unique across restarts and never reused.
- `Vault#projectStore(id)` opens the store for one project under that vault.
