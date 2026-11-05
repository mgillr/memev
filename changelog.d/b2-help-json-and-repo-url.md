### Fixed

- `memev help` names the `--json` flag on `devices list`, `license status`, `plan`, `report status`, `review` and
  `compact`, which already accepted it, and lists `report status`.
- The leak scan accepts a denylisted word as the owner of this repository's URL only in the form
  `https://github.com/<owner>/memev`: a bare `github.com/<owner>/memev`, one inside a path, or a host that only ends in
  github.com is still a finding.
