### Fixed

- The leak scan allowlists the single line of commit 6f21fc3 that carries GitHub's default merge subject for PR 55, so history scans stay clean without rewriting history (same precedent as the PR 7 merge subject).
