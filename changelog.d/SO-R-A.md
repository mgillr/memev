### Added

- `scripts/smoke.sh` runs the CLI smoke after any install: version, init, doctor, status in a fresh HOME on a port the operating system hands out; it exits non-zero and names the step when any step fails.
- The CI pull-request job packs the package, installs it from the packed tarball, runs the CLI smoke on the installed copy, builds the container image and runs the Docker smoke, after the suite and the leak scan.
- `docs/DEVELOPING.md` carries the source-install commands, kept equal to the workflow by `test/release-gates.test.mjs`, which also runs them from a clean export of `HEAD`.
- `docs/RELEASING.md` names the release owner role, the failure and rollback steps, and the post-release verification record.
