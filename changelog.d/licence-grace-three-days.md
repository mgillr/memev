### Changed

- Paid licences are issued with a grace period of 3 days after the paid period ends (`ISSUED_GRACE_DAYS` in
  `src/engine/license.mjs`, used by `scripts/license/issue.mjs` and `scripts/license-dev.mjs`); `--grace` still sets
  another. A licence that states no grace period keeps 14 days, as before. `docs/PRICING.md` says so.
