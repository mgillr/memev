### Added

- docs/TROUBLESHOOTING.md now holds one row per doctor check id, checked against `memev doctor --json`, so the table and the doctor cannot drift apart.
- test/doctor-troubleshooting.test.mjs pins both directions: every reported id has a row, every row names a reportable id, fix commands run clean in a sandbox, and the row and the check agree on severity.
