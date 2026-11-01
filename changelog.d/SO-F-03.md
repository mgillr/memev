### Added

- A contribution is an operation envelope with a signature and admission block, and a node admits it in two steps: the signature, then authority and policy for the scope and classification. A replay is refused, even after a restart, and every refusal is recorded in the vault's operation log with nothing of the payload. Planned: no route or command uses it yet. See docs/FEDERATION.md.
