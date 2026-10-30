### Added

- `docs/DOCKER.md` documents the Docker path end to end: the persistent `memev-vault` volume, the loopback-only port, the unprivileged user, the health check, every environment variable the image reads, the pull-and-run example (with a placeholder image name until a registry is decided), the upgrade path (`docker compose pull` and `up -d`) and safe shutdown (`down` keeps the volume).
- `scripts/docker-smoke.sh` runs the whole persistence check against whatever image `MEMEV_IMAGE` names, or a local build when it is not set: build or pull, start, wait for healthy with a deadline, write a note through the CLI inside the container, restart, read the note back, and check that `down` keeps the volume. It exits non-zero naming the failed step.

### Changed

- The daemon refuses to start on a vault config with a syntax error: it logs one line naming the file and exits non-zero without a stack trace, instead of silently starting on defaults.
- `compose.yaml` takes the image name from `MEMEV_IMAGE` (default `memev:local`), and the image health check gets `--retries=3` and `--start-period=10s`.
