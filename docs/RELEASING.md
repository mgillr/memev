# Releasing Memev

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A checklist for cutting a release of the `memev` npm package.

## Before you tag

- [ ] The working tree is clean and on `main` at the commit you intend to release.
- [ ] `npm test` passes.
- [ ] `node scripts/leak-scan.mjs --history` passes on files and every commit message.
- [ ] `npm pack` lists only `bin/`, `src/`, `templates/`, `vendor/`, the published `docs/`, `LICENSE`, `NOTICE`, `README.md`, `SECURITY.md` and `CHARTER.md`, and no `test/`, `scripts/`, `contracts/` or `.github/`.
- [ ] `CHANGELOG.md` has a dated heading for the release, with the notes moved out of `## Unreleased`.
- [ ] `package.json` `version` is bumped.

## Verify the package installs

- [ ] Pack it: `d=$(mktemp -d); npm pack --pack-destination "$d"`.
- [ ] Install the tarball into a clean HOME and run init from it:
      `env HOME=$(mktemp -d) MEMEV_NO_TUNNEL=1 MEMEV_NO_SERVICE=1 MEMEV_NO_DOWNLOAD=1 npm exec --yes --package "$d"/*.tgz -- memev init --port 8787`.
- [ ] Init exits 0 and creates the vault under the clean HOME.

## Installers

`node scripts/release-tarball.mjs --out DIR` writes the release tarball and a `.sha256` file next to it. The tarball is the set `npm pack` publishes.

`scripts/install.sh <tarball-url>` fetches that tarball and the `.sha256` file beside the same URL, checks the SHA-256, runs `memev init`, and restarts from the installed copy. The URL must be https or a file URL. A local check uses a `file://` URL. The script has no download address built in. When Node.js 22 or newer is not on PATH, the installer fetches the pinned runtime named in `scripts/node-runtime.json`, checks that SHA-256, and runs from that copy. The same pins are carried in the installer scripts, so a one-line install still finds them. A later install reuses that copy when its version matches. `MEMEV_NODE_SPEC` and `MEMEV_NODE_FETCH` are for tests. `scripts/install.ps1 <tarball-url>` does the same on Windows and checks the hash with `Get-FileHash`.

## Update and version check

`memev update <tarball>` installs the tarball into a new runtime folder under the config dir and points the launcher at it. The tarball is a local file (the release tarball, or a test one); nothing is fetched. The old runtime stays until it is replaced.

The version check is opt-in and off by default. When it is on, `memev doctor` and `memev status` read a static version file whose location comes from the vault config (`update.version_file`) and show one `update available` line when it names a newer version. It reads only that local file; it makes no network call. Turn it on with `update.check: true` in the vault config, or `MEMEV_UPDATE_CHECK=1`.

## Tag-triggered release build

Pushing a `v*` tag runs `.github/workflows/release.yml`: the full test suite, the leak scan with `--history`, the tag check against the version in `package.json` (`scripts/release-tag-check.mjs`), the release tarball and its `.sha256` file, and the attachment of both to the release. The workflow builds and attaches only; it publishes nothing.

## Publish

- [ ] Tag the release and push the tag, then wait for the release workflow to pass: the test suite, the leak scan and the tag check run before anything is attached.
- [ ] `npm publish`, run by the maintainer from their own terminal, only after that workflow passed.
- [ ] Confirm the published version runs: `npm exec --yes --package memev@<version> -- memev --version`.

## After

- [ ] Open a fresh `## Unreleased` at the top of `CHANGELOG.md` for the next cycle.
