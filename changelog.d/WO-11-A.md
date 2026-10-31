### Added

- Regression guards for the four paid paths: the relay down with the vault working through the git backup, a same-note conflict keeping both versions byte for byte (the merge engine reached once when the licence allows it, never when it does not), an expired licence past its grace period, and changing the licence tier.
- A doctor check for each of the four paid paths, named on every run, with a row for each in the troubleshooting table: `relay`, `merge`, `license-expired` and `license-change`. `license-change` warns when the licence is valid and an added computer within its seat count can still only read, and otherwise names the tier in force. A file one of these checks cannot read is reported on that check instead of ending the doctor run.

### Fixed

- The list of keep-both copies a sync left on disk reads the conflict record a sync writes itself as well as the one the daemon writes. Before, the record a sync wrote itself made the list fail, which would have ended the doctor run and `memev license install` after the licence was written.
