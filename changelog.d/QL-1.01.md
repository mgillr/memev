### Added

- The red-team gate (`scripts/gate/redteam-gate.mjs`, engine code in `src/engine/redteam-gate.mjs`): a contract is signed only with a red-team record that is complete, bound to the spec's hash and to a reviewed commit, signed by a trusted reviewer key, and closed by a clean round or a signed stop decision. It reports every failing rule, not only the first. `docs/CONTRACTS.md` explains the record and the rules.
