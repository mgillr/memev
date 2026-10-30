### Added

- A tag-triggered release workflow builds the tarball and its checksum on a v* tag, runs the tests and the leak scan, checks the tag against package.json, and attaches both files to the release.
- `scripts/release-tag-check.mjs` checks a release tag against the version in package.json.
