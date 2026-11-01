### Changed

- A licence is now checked against one schema in one place, `verifyLicense`, so install, activate, `loadLicense` and the merge gate refuse the same things. A licence may carry only `v`, `lid`, `tier`, `services`, `seats`, `connectors`, `iat`, `exp`, `grace_days`, `kid`, `sig`, `trial`, `trial_ext` and `org`; any other key is refused by name, including keys that share a name with an object member. `trial` and `trial_ext` must be true or false, `org` must be an opaque id of the form `org_` and 4 to 64 letters, digits, `_` or `-`, and a trial must carry one. `install` now refuses a licence that carries a name, an e-mail address or a machine, as `activate` already did, and writes nothing. `verifyLicense` returns `trial`, `trial_ext` and `org`.
- `verifyLicense` takes a `floor`, the latest time the vault recorded, and judges expiry and grace at the later of now and the floor. `loadLicense` keeps the floor in `license-clock.json` in the configuration directory, raises it on each check and never lowers it, so winding the clock back does not revive a lapsed licence. `engineAllowed` and `resolveMerge` accept the same `floor`.

### Added

- `scripts/license/issue.mjs --trial` issues a Business trial or a Corporate pilot, and `--trial --extension` issues the one extension, refused a second time for the same org by a local ledger. A trial runs for the fixed trial length and carries the merge service.
