### Changed

- The `check` job (npm test, the changelog guard, the leak scan and gitleaks) now runs on every push to main as well as on pull requests, so a landing that breaks main shows on main. On a push the changelog guard compares with main as it was before the push, every push to main gets its own run that a later push does not cancel, and a push that changes only docs/ or changelog.d/ is checked too.
