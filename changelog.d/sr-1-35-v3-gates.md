### Fixed

- The leak scan accepts GitHub's default merge subject, "Merge pull request #N from <owner>/<branch>", when <owner> is the
  account in the origin remote's GitHub URL. Any other login there, the branch segment, the rest of the message and other
  subjects are still scanned, and with no GitHub origin nothing is accepted.
- The SR-1.29 prompt hook start-up test compares against SR-1.29's own base, read from its spec, so it no longer fails every
  later contract whose base already holds SR-1.29's change. It also runs in plain CI whenever that commit is in the clone.
