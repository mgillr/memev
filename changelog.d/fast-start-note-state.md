### Changed

- A start no longer reads every note. Each note's size, times and the entities its sections name are kept in `.memev/notes.state` as notes change, and a start reads a note only when its stat or its logged hash moved. The graph fills in behind the start and recall answers from the saved records until it has.
- A stop writes only what changed.
- The first open of a folder writes the log in groups, reads each note once, and converting an old index no longer loads it whole.
- `memev start` leaves a daemon that is still loading the vault instead of stopping it, and `memev stop` reaches one.

### Added

- A background sweep hashes every note against the log after a start, for an edit no stat can show. `memev status --json` gives its progress, what it found and how long that took.
