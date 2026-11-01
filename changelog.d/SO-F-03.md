### Added

- A contribution is an operation envelope with a signature and admission block, and a node admits it in two steps: the signature, then authority and policy for the scope and classification. A replay is refused, even after a restart, and every refusal is recorded in the vault's operation log with nothing of the payload. Planned: no route or command uses it yet. See docs/FEDERATION.md.
- The replay mark of a contribution is kept per sender and scope, and an Admission reads the operation log again, from the record after the last one it read, when the log has moved. Two Admissions over one log no longer admit one sequence twice. The reason recorded for a failed external admission service is now a fixed text. Planned: no route or command uses it yet. See docs/FEDERATION.md.
