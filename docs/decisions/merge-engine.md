# Decision: the merge engine

Part of the [Memev documentation](../README.md). Related: [CONVERGENCE.md](../CONVERGENCE.md),
[PAID-CONVERGENCE.md](../PAID-CONVERGENCE.md), [PAID-TRUST.md](../PAID-TRUST.md),
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md), [FEDERATION.md](../FEDERATION.md).

Status: proposed. Owner decisions of 5 November 2026; the contract is SR-3.01.

## What is decided

- **One engine for the paid tiers.** Personal with more computers, Business and Corporate use the same engine through the same boundaries. Federated is planned: it cannot be licensed yet, and it will use the same engine when it can. The free core does not use the engine: one computer at a time, with git as a single-writer backup.
- **The engine is memev-merge.** It is a separate, private repository under a commercial licence. It is never placed in this repository, never vendored and never a package dependency of Memev. It is delivered only to a computer with a paid licence, as a signed program for that operating system, and it checks the licence itself.
- **memev-merge runs crdt-merge.** crdt-merge supplies convergence and the trust layer, E4, as planned for the Business tier. memev-merge adds what crdt-merge does not have: merging the text of a note.
- **What paid computers merge.** Each paid computer keeps its own copy of the vault, and the computers may be in different places. Their copies converge. A computer that only uses another computer's vault over the secure link keeps no copy and needs no merge.
- **ACFA-RS is not in paid Personal at launch.** It admits and reconstructs numeric contributions from an agreed set of contributors (signed PG-09.1, WP09-02) and needs at least five contributors to survive one bad one. It joins when a feed of figures from five or more bots exists, and is planned for Business and Federated.

## The roles, as planned for Business

The roles follow the programme decision DEC-17 ([DECOMPOSITION.md](../scope-one/programme/DECOMPOSITION.md)): crdt-merge converges, E4 governs trust, ACFA-RS admits and reconstructs numeric contributions, Proofline verifies acceptance, and Memev decides authority.

| Layer | What it does | Where it runs | State |
|---|---|---|---|
| Authority | Who may write: enrolled device keys, the seat count, revocation, the licence gate | Memev core: `src/engine/devices.mjs`, `entitlements.mjs`, `merge.mjs` | Built |
| Note text | When two copies changed the same note: a section-aware three-way merge keeps every change that does not overlap, writes no merge markers, and refuses only on overlapping edits; a refusal keeps both versions | memev-merge, through the merge boundary | Planned |
| Convergence | Each computer's operation-log entries are the replication unit, each with its causal context; every copy converges on the same entries in the same order | memev-merge, through crdt-merge, through the entry boundary | Planned |
| Trust (E4) | An entry signed by a key that is not enrolled, or is revoked, is refused before it changes the vault ([PAID-TRUST.md](../PAID-TRUST.md)) | memev-merge, through crdt-merge's E4, through the entry boundary | Planned |
| Travel between computers | Changes travel between your computers end-to-end encrypted; no server can read them | SR-4.03 | Planned |
| Numeric contributions (ACFA-RS) | Numeric contributions from an agreed contributor set only, never text memories | Not in paid Personal at launch | Planned for Business and Federated |

## The boundaries

The engine sits beside the core, behind two boundaries. The second is the adapter boundary that MV-TRU-05 plans beside the merge boundary ([DECOMPOSITION.md](../scope-one/programme/DECOMPOSITION.md), MV-TRU-05).

1. **The merge boundary** (`src/engine/merge.mjs`, built). It sends exactly one note's two versions and their common base, `{ a, b, base }`, and reads `{ text }` or `{ refuse }`. Nothing else crosses it: no log entry, no causal context, no device id, no signature. It carries the note-text layer only.
2. **The entry boundary** (planned, not built). It carries operation-log entries, each with its causal context, the id of the device that wrote it, the device's public key and the entry's signature. E4 checks entries here. It returns the entries to apply, in order, and the ones refused with the reason.

Which keys E4 checks: the ed25519 device keys that Memev enrols (`src/engine/devices.mjs`). The core passes the public keys of the enrolled, unrevoked devices across the entry boundary. No private key ever crosses either boundary.

## Algorithm

Algorithm: operation-log entries converge in crdt-merge, and the note text of a note changed on more than one computer is merged by a section-aware three-way merge in memev-merge; overlapping edits are refused and both versions kept.

- **The set:** each computer's entries are added to a crdt-merge `ORSet` (`crdt_merge/core.py:351` at crdt-merge 803d64f, the head of its public default branch): a set converges on its members whatever order the additions arrive in. The engine only adds entries and never removes one: the record cannot be quietly changed. crdt-merge has no grow-only set, and its `ORSet` has `remove` and `remove_tag` (`core.py:401`, `:420`), so memev-merge never calls them, and a test in memev-merge's CI checks that an attempt to remove an entry is refused. A correction is a new entry, as it is in the operation log today.
- **The order:** a set has no order, so the order is a rule over each entry's hybrid logical clock, with the device id as the tie-break, the HLC order SR-3.04 names. Memev's operation log already carries an HLC and an order function (`compareRecords` in `src/engine/oplog.mjs`), which nothing calls yet: SR-1.15 (no code without a caller) applies, and it does not count as done until SR-3.04 calls it. Causal context travels with each entry as a crdt-merge `VectorClock` (`crdt_merge/clocks.py:56`).
- **The trust check:** E4 verifies each entry before it is applied. The signature of every entry is checked whatever the sender's trust ("All levels: signature check", `crdt_merge/e4/adaptive_verification.py:149`); trust sets only how much is checked beyond it, and a quarantined sender is refused outright. The parts: Ed25519 signatures (`crdt_merge/e4/signing.py`), proof-carrying operations (`AggregateProofCarryingOperation.verify`, `crdt_merge/e4/pco.py:56`, `:120`), verification depth set by trust (`AdaptiveVerificationController.verify`, `crdt_merge/e4/adaptive_verification.py:77`, `:113`), and the trust state that converges with the data (`DeltaTrustLattice.merge`, `crdt_merge/e4/delta_trust_lattice.py:273`, `:492`; `CausalTrustClock`, `crdt_merge/e4/causal_trust_clock.py:47`).
- **The text:** crdt-merge has no text merge; memev-merge's three-way merge decides the text of a note whose versions diverged, deterministically, so every copy computes the same text.

Why: the operation log is already the record of every change ([DESIGN.md](../DESIGN.md)); converging it is how the Business plan replicates ([FEDERATION.md](../FEDERATION.md), per-scope operation-log streams). A text merge alone merges the files but not the record of who changed what, which E4 needs to check each contribution.

## Runtime

Runtime: one program for each operating system (macOS, Windows, Linux) that packs memev-merge, crdt-merge with E4 and the Python runtime they need, compiled to native code where the packaging tool allows; it runs as a long-running process beside the Memev daemon. Memev itself stays Node with no runtime dependencies.

Why: E4 exists in crdt-merge's Python package (about 12,000 lines and its test suite); none of the TypeScript, Rust or Java ports carries it. Packing it into one program means a paid computer needs no Python, and the program, not the core, holds the engine. It runs as one long-lived process because starting it per note costs too much: on the test Mac, importing crdt-merge takes 0.25 to 0.33 s warm and 0.82 s cold, so a per-note call cannot meet a 50 ms budget. The boundary speaks to the running process; when it is not running, the core keeps both versions, as today.

Delivery: the program is downloaded only after a paid licence is activated, from the paid service, and Memev checks its signature before it runs it. It is updated the same way. It is never in the free installer.

## What crdt-merge does, in words a buyer can check

crdt-merge is a library of data types that converge: any two copies that have received the same changes reach the same state, in any order, with no coordinator. Its trust layer, E4, carries who made each change and checks it against the keys that may write. It does not merge prose; memev-merge does that and hands crdt-merge the record of each change.

## Testing

- The public Memev repository tests the boundaries against a shim (`test/merge-entitlement.test.mjs`, `test/engine-roundtrip.test.mjs`): it holds no engine and no credential for the private one.
- memev-merge's own, private CI runs Memev's conformance suite (SR-3.02) against a pinned Memev commit, and runs the multi-computer and soak tests (SR-3.04).

## What this changes in the plans

- **SR-3.01:** requirement 2 "names the runtime (Node, no Python bridge)" and criterion 3 "Runtime: Node" are replaced by "names the runtime and the repository"; criterion 3 checks for `Runtime:` followed by a runtime name.
- **SR-3.03:** T1 "bin/memev-merge.mjs" and the licence "decided in SR-3.05" become a compiled `memev-merge` program and a commercial licence; T2 "zero runtime dependencies" becomes "its runtime dependency is crdt-merge, compiled in"; T2's 50 ms is measured on a running engine, not including start-up; T2's behaviour criteria and T3 are unchanged.
- **SR-3.02:** the suite stays in Memev; it runs against the real engine in memev-merge's CI, not in Memev's public CI.
- **SR-3.04:** unchanged, except that its tests run in memev-merge's CI; its HLC order is the order rule above.
- **SR-4.03:** names the per-computer copy (the owner's answer of 5 Nov) and the entry boundary as what it carries; D-WO-HOSTED-SYNC is corrected (SR-4.03 builds hosted sync).
- **SR-1.06:** the licence schema carries `merge` (paid licences carry it since PR #422).
- **Installer (SR-1.18 and the installer drafts):** the paid join downloads and checks the engine program.
- **A provider that keeps one engine process open** in the public core (`src/engine/merge.mjs` today starts the program once per note with `spawnSync`, lines 46 to 62). A small change with no engine code in it; it belongs to SR-3.04 T1 (merge on sync through the boundary).
- **A new criterion for engine delivery, integrity and update,** in SR-4.02 or SR-5.01: no plan item covers it today. It must name: one build machine per operating system (a Windows program cannot be built on a Mac); the signing identities the owner must obtain (an Apple Developer ID for macOS and a code-signing certificate for Windows; none exists today); and which key signs the engine program and who keeps it (SR-9.03 covers the licence key only).
- **SR-3.05** gains memev-merge's commercial licence. crdt-merge's change date reads differently in three places in crdt-merge's own repository (LICENSE, README, `e4/__init__.py`); that is fixed in memev-ops and crdt-merge first, and this page states one date once the owner confirms it.
