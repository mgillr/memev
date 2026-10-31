### Added

- The external merge engine is called only through the boundary in `src/engine/merge.mjs`: the engine registers itself into the boundary, and the boundary reaches it as an external process, so the core holds no convergence logic of its own.
- `docs/EXTENSION-POINTS.md` describes that boundary: the licence gate, the registration point, how the engine is reached as a command, and the keep-both behaviour when the engine is not there.

### Fixed

- The merge engine's answer may be up to 64 MB, so a large note no longer fails to keep both versions, and an engine failure is named by the engine's id, never by a path, in the conflict record and on the card.
