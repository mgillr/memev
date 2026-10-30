# The paid convergence service: the specification

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[CONVERGENCE.md](CONVERGENCE.md), [EXTENSION-POINTS.md](EXTENSION-POINTS.md),
[PRICING.md](PRICING.md), [tiers/](tiers/README.md), [LICENSING-NOTICE.md](LICENSING-NOTICE.md).

This page is the specification of what the external convergence engine does for Memev. It is
written before the engine ships, so the engine's repository has a contract to meet and the tier
pages have something true to point at.

## The paid capability: concurrent, same-time editing

The paid capability is concurrent, same-time editing across the computers one licence covers:
several computers edit the same vault at the same time, and the edits come together with nothing
to resolve.

- **Personal with more computers:** automatic merge across several computers at once (planned).
- **Business and Corporate:** vault convergence for a company (both coming, planned).

Today the engine is not built into any released Memev. These features are planned and are not
sold until they are built ([tiers/README.md](tiers/README.md#what-is-built-and-what-is-planned)).
The free behaviour never changes: one computer at a time, git sync as single-writer backup, and a
conflict left for a person to resolve ([CONVERGENCE.md](CONVERGENCE.md#what-free-users-get)).

## The engine is an external dependency

The engine is crdt-merge. It lives in its own repository under its original licence, currently
BSL 1.1. Its source is not included in this repository: no copy of it is here, it is never
vendored, and it is not a package dependency. The Memev core calls it as an external dependency
and holds no convergence code of its own.

The core reaches the engine through one boundary, `src/engine/merge.mjs`
([EXTENSION-POINTS.md](EXTENSION-POINTS.md)): the licence gate, the provider registration, and
the merge call. The engine registers itself into the boundary; the core never imports it.

## The service contract

This is what the engine must do when the core calls it. The core hands the engine a note that two
computers changed differently:

1. **In:** the two versions and their common base, as one JSON line on the engine's standard
   input. Nothing else: no licence, no token, no path, and no vault data beyond the note being
   merged.
2. **Out:** one JSON line on standard output. `{ "text": "..." }` is the merged note.
   `{ "refuse": true }` keeps both versions.
3. **Merged result:** the merged text keeps every change either side made that does not conflict,
   and it is a note a person can read: no merge markers, no fragments of either side left behind.
4. **Refuse:** when the engine cannot merge the two versions safely, it refuses. The core then
   keeps both versions: this computer's version stays at the note's path, the other computer's
   version is kept whole in a conflict copy, and `memev doctor` reports the conflict. No version
   is lost or overwritten.
5. **Fail:** when the engine is not there, refuses, or fails, the core returns the same keep-both
   result, and a line names the reason. The free behaviour is the default and never changes.
6. **Licence gate:** the core calls the engine only when the licence allows it (the merge
   service, while the licence is valid or in grace). With no licence, an expired trial, or a
   licence without the merge service, the engine is not called and the keep-both result stands.

The contract is the same for every tier that buys the merge service. It says nothing about where
the engine runs: the boundary speaks to a command or an address, and this page does not decide
which. That decision is open, and the contract holds either way.

## Relationship to the wider architecture\n\nThe present service contract is a note-conflict contract. It must not be silently interpreted as a\ncontract for arbitrary structured state, project/programme/portfolio graphs, business approvals,\nsite federation or federated learning. Extending CRDT-Merge into those areas requires explicit\ninput/output schemas, ownership and authority rules, provenance, failure behaviour, policy checks\nand conformance tests. Memev remains responsible for business semantics and permission decisions;\nthe convergence engine does not decide whether a contribution is true, authorised or approved.\nSee [FEDERATION.md](FEDERATION.md), [ORGANISATIONAL-INTELLIGENCE.md](ORGANISATIONAL-INTELLIGENCE.md)\nand [FEDERATED-COMPUTATION.md](FEDERATED-COMPUTATION.md).\n\n## What is not said here

This page states no merge strategy names, no benchmark figures and no release dates for the
engine, because none are published for Memev. A page for any of them is written when the feature
ships ([CONVERGENCE.md](CONVERGENCE.md#what-is-not-said-here)).
