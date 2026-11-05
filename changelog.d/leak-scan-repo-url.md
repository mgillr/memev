### Changed

- The leak scan (scripts/leak-scan.mjs, its denylisted-word check) accepts the owner's name only as the owner segment of
  this public repository's URL, github.com/<owner>/memev, in a tracked file. The same word anywhere else, in another
  repository's URL, on another host or in a commit message is still a finding.
