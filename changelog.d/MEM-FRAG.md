### Changed

- Changes no longer edit CHANGELOG.md: each adds a note in changelog.d/ (see changelog.d/README.md), and `node scripts/changelog-assemble.mjs` folds the notes in at release. The pull request check fails any other edit of CHANGELOG.md.
