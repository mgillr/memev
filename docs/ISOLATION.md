# Isolation

Memev is a new project with its own history. It started from an empty repository.

- It has no git link to any earlier project: no shared commits, no remote, fork, submodule or subtree.
- Earlier private work that informed the design is read-only from this project's point of view.
  Nothing here writes to it: no branches, pull requests, issues, comments, pushes or settings changes.
- Ideas were re-implemented, not copied. Every file here was written for Memev or vendored with its
  licence (see `vendor/` and `NOTICE`).
- Memev does not depend on, download from or report to any service run by its author.
  It has no telemetry. At runtime it uses only Node.js built-ins, git, and (when you switch on
  remote access) a tunnel program you choose.
- The repository stays private until its owner decides to publish it.

Checks that keep it this way:

- `scripts/leak-scan.mjs` (run in CI on every push and pull request, over every file and every commit
  message) fails on denylisted words (stored only as SHA-256 hashes), personal e-mail addresses, public
  IP addresses and personal home paths.
- gitleaks (pinned release, checksum verified) scans the full history in CI.
- `test/isolation.test.mjs` checks that the repository has a single root commit history with no
  foreign remotes, submodules or subtrees, and that `package.json` has no runtime dependencies.
