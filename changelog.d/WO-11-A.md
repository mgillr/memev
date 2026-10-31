### Added

- Regression guards for the four paid paths: the relay down with the vault working through the git backup, a same-note conflict keeping both versions byte for byte (the merge engine reached once when the licence allows it, never when it does not), an expired licence past its grace period, and changing the licence tier.
- A doctor check for the paid paths, named on every run, with a row for each in the troubleshooting table: `relay`, `merge` and `license-expired`. The relay check says what the backup line says: a first connect is not a failure, a relay the daemon is not holding is on but not running, and the git backup carries the notes either way. A file one of these checks cannot read is reported on that check instead of ending the doctor run. The constant licence-change line is gone: it could not fail.

### Fixed

- The list of keep-both copies a sync left on disk reads the conflict record a sync writes itself as well as the one the daemon writes. Before, the record a sync wrote itself made the list fail, which would have ended the doctor run and `memev license install` after the licence was written.
