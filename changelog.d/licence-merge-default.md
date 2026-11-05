### Fixed

- A paid licence issued without naming its services now carries `merge`, the paid engine's service
  (`ISSUED_SERVICES` in `src/engine/license.mjs`, used by `scripts/license/issue.mjs`). Before, the default left it out, so a
  paid licence issued with the defaults could never call the engine. The engine itself stays outside this repository.
- `memev license remove` says what removing a licence does: this computer keeps Personal, and computers added to the vault
  can still read but can no longer write.
