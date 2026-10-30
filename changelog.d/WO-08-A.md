### Added

- docs/TROUBLESHOOTING.md now holds one row per doctor check id, checked against `memev doctor --json`, so the table and the doctor cannot drift apart.
- Symptoms the doctor cannot see from the vault (a cloud app's 401, a tunnel address that changed, a failed push, a hand edit, a crash) stay as a list without check ids.
- test/doctor-troubleshooting.test.mjs pins both directions: every reported id has a row, every row names a reportable id, fix commands run clean in a sandbox, and the row and the check agree on severity.
