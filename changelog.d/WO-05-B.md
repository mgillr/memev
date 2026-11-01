### Added

- The paid engine flag (merge.paid, off by default on every install): when it is on and the licence allows it, a same-note conflict goes to the external merge engine as a separate process the install points at, and the merged note lands at the path. The sync builds the provider from the boundary's commandProvider and registers it through registerMergeProvider so the gate in merge.mjs picks it up; with the flag off nothing is registered and no call leaves the computer.
- Any refusal, failure or timeout of the engine falls back to the free behaviour: both versions are kept whole and a line names the reason. With the flag off, or the paid client module absent, the free behaviour runs and nothing leaves the computer.

### Fixed

- The stop sync skips the engine and keeps both versions, so a conflicted note at stop never holds the stop sync past its 3 s window.
- The interval and start syncs bound the engine call to 500 ms, well under the daemon's 800 ms health window, so a slow engine never holds the event loop past the health check.
- The paid client is reached through the boundary's commandProvider directly, not through createRequire, which needs require(esm) (unflagged from Node 22.12). On Node 22.11 the one-shot sync now reaches the engine.
- The engine call passes a 64 MB maxBuffer through the provider options, so a note over 1 MB merges without ENOBUFS.
- The paid engine status reports the engine as installed only when the install set a provider or configured an engine command that exists, not whenever the paid client module is present, since that module always ships.
