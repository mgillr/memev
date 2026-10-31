### Fixed

- `scripts/docker-trial-smoke.sh` runs as its own compose project, `memev-trial-smoke`. Before, it ran in the folder's default project, which `compose.yaml` shares, so its final `down -v` could remove the vault volume of a memev deployed from the same checkout.
