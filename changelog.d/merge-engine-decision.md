### Added

- `docs/decisions/merge-engine.md`: the decision on the paid merge engine (proposed, SR-3.01). The engine is memev-merge,
  a separate program outside this repository that runs crdt-merge with E4 for every paid tier and is delivered only with
  a paid licence; it is called across the merge boundary (built) and an entry boundary beside it (planned). The README
  names it, and the docs index lists the page.
