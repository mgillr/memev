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

`scripts/install.sh <tarball-url>` fetches that tarball and the `.sha256` file beside the same URL, checks the SHA-256, runs `memev init`, and restarts from the installed copy. The URL must be https or a file URL. A local check uses a `file://` URL. The script has no download address built in. `scripts/install.ps1 <tarball-url>` does the same on Windows and checks the hash with `Get-FileHash`.

## Publish

- [ ] `npm publish`, run by the maintainer from their own terminal.
- [ ] Tag the release and push the tag.
- [ ] Confirm the published version runs: `npm exec --yes --package memev@<version> -- memev --version`.

## After

- [ ] Open a fresh `## Unreleased` at the top of `CHANGELOG.md` for the next cycle.
