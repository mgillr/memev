### Added

- The external merge engine is called only through the boundary in `src/engine/merge.mjs`: the engine registers itself into the boundary, and the boundary reaches it as an external process, so the core holds no convergence logic of its own.
- `docs/EXTENSION-POINTS.md` describes that boundary: the licence gate, the registration point, how the engine is reached as a command, and the keep-both behaviour when the engine is not there.
