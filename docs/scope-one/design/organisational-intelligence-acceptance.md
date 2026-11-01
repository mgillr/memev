# SO-2.06 Organisational intelligence acceptance: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [projects](../../PROJECTS.md), [threat model](../../THREAT-MODEL.md).

This is the decision record that contract SO-2.06 asks for (task T1, phase design). It builds nothing and changes no code, and it writes no test. Every claim below cites a file and line, a section of a page in `docs/scope-one/`, or section 8.3 of the owner's baseline. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open decisions](#open-decisions). Nothing is inferred and no design is invented, and no threshold is set that a source does not set. Anything shaped like a permission matrix waits on ADR 5, the permission matrix, status open (`docs/scope-one/DECISIONS.md:58-66`), and is marked open here.

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-2.06-organisational-intelligence-acceptance.json`. The five requirements are at lines 13 to 17, the two named lines the record must carry ("Test list:" and "Measures:") are checked at lines 77 and 85, and the scope (this file and `docs/README.md`) is at lines 21 and 22. The spec names no dependency (line 11).
- Code on main at `908654d`: `src/engine/graph.mjs`, `src/engine/vault.mjs`, `src/engine/index.mjs`, `src/engine/merge.mjs`, `src/engine/project-state.mjs`, `src/engine/tokens.mjs`, and the tests `test/graph.test.mjs` and `test/oplog-recovery.test.mjs`.
- Docs: `docs/scope-one/WBS.md`, `docs/scope-one/DECISIONS.md`.
- Baseline: the owner's master traceability baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does. Section 8.3 lists the sixth contract family as "Organisational intelligence acceptance": "Tests for false positives, unsupported inferences, stale information, access leakage and provenance loss". It also says the existing vault, graph and retrieval modules are "useful foundations" that "do not by themselves establish this wider organisational intelligence capability".
- Settled decisions this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, with the cloud only a relay and a backup (line 72); providers are neutral and no work depends on one (line 73).
- Neighbouring records, cited and not restated. The knowledge model is the SO-2.01 record (docs/scope-one/design/organisational-knowledge-model.md on branch feat/so-2-01-org-knowledge-model, not yet on main). The access rules are the SO-2.02 record (docs/scope-one/design/permission-aware-knowledge-access.md on branch feat/so-2-02-permission-aware-access, not yet on main). Provenance, retention and invalidation are the SO-2.03 record (docs/scope-one/design/provenance-retention-invalidation.md on branch feat/so-2-03-provenance-retention, not yet on main). The finding is the SO-2.04 record (docs/scope-one/design/cross-project-intelligence.md on branch feat/so-2-04-cross-project-intelligence, not yet on main), and the routing is the SO-2.05 record (docs/scope-one/design/cross-functional-issue-discovery.md on branch feat/so-2-05-cross-functional-issue-discovery, not yet on main). The WBS lists SO-2.02 to SO-2.05 as the dependencies of SO-2.06 (`docs/scope-one/WBS.md:536`); the spec lists none. WP14-04 names the demonstrators, and this contract defines the acceptance tests of the organisational-intelligence one only (`docs/scope-one/WBS.md:421`, `:536`, `:557`).
- Layer: the fold contract SO-F-13, signed by pull request #341, is the build layer for the seeded conflict test. This record cites it by id and acceptance criterion, restates none of its text, and keeps only what it does not cover. The question of which layer is built against is decided (owner delegation, 1 Nov 2026): the fold is the build layer, as recorded in [RECONCILIATION.md](../RECONCILIATION.md).
- Current state in one line: no test on main exercises organisational intelligence. The tests that touch the nearest code are the claim status and provenance tests (`test/graph.test.mjs:21`, `:43`) and the log recovery tests (`test/oplog-recovery.test.mjs:23`, `:47`, `:73`, `:92`).

Related fold contracts: SO-F-13. It is signed in pull request #341 and recorded in contracts/signed, and it is cited here by id. This record has no dependency on it and does not restate it. Where a requirement below says "Covered by", the part named is owned by that contract and is not decided here. It is adopted as the build layer (owner delegation, 1 Nov 2026), so the parts marked covered stay with it.

Test list: the five families the spec names in its first requirement, each a test of the demonstrator and not of a single module: false positives, unsupported inferences, stale information, access leakage and provenance loss. The seeded cross-department conflict of requirement 2 and the exposure test of requirement 4 are two further tests the spec names. Covered by SO-F-13 AC01 and AC02: the seeded conflict, and false positives and misses of that detection on the fixture. Not covered by that contract: unsupported inferences, stale information, access leakage and provenance loss. Which tests exist for them is open, needs owner decision (open decisions 1 to 4).

Measures: the ten measures the spec names in its fifth requirement: convergence and recovery, prohibited information disclosure, duplicate side effects, false or unsupported findings, evidence traceability, trust-change propagation, scoped re-verification, time to detect cross-project conflicts, operational overhead, and the ability to continue through partial failure. Covered by SO-F-13 AC02: precision and recall for the seeded conflict, which bears on false findings only. For the other measures neither the sources nor SO-F-13 give a unit, a threshold or a method, and none is invented here. They are open, needs owner decision (open decision 8).

## Requirement 1: tests for false positives, unsupported inferences, stale information, access leakage and provenance loss

Decided by the sources:

- The five test families are required (spec line 13; baseline 8.3, sixth row). The WBS gives the family one owner, SO-2.06, for the acceptance tests of the organisational-intelligence demonstrator only (`docs/scope-one/WBS.md:421`, `:536`).
- Covered by SO-F-13: false positives and misses of the conflict detection, on a fixture (AC02).
- What exists today, from the code and the tests, for the other four:
  - Unsupported inference: a claim's status is derived from its evidence, and speculation alone never reaches theory (`src/engine/graph.mjs:13-19`, `:102-114`); `test/graph.test.mjs:21` moves a claim through its statuses and checks that each change is logged.
  - Stale information: a section with a review date is left out of recall once the date has passed (`src/engine/vault.mjs:437-438`), and a scope change marks bound evidence stale (`src/engine/project-state.mjs:177-214`).
  - Access leakage: recall drops the sections a token may not read before ranking (`src/engine/index.mjs:173-178`; `src/engine/vault.mjs:428-445`). The read paths with no per-path check are listed in the SO-2.02 record.
  - Provenance loss: `provenance` returns the operations and the recalls of a note (`src/engine/vault.mjs:645-656`; `test/graph.test.mjs:43`); the operation log is append-only and survives a torn line (`test/oplog-recovery.test.mjs:23`, `:47`).

Open, needs owner decision:

- What a failing test is for each of unsupported inferences, stale information and provenance loss: the seeded condition and the pass condition. No source defines them.
- Whether the five families are tested at the demonstrator level only, as the WBS says, or also per module.

## Requirement 2: a representative small business of about ten people across departments, each on separate projects and activities, where authorised agents discover shared knowledge and a seeded cross-department conflict

Decided by the sources:

- The scenario is required (spec line 14): about ten people across different departments, separate projects, authorised agents, a seeded cross-department conflict.
- Covered by SO-F-13: a seeded fixture with one programme and two plans in conflict (AC01). It is a bounded first target and not a business of ten people.
- What exists today: no fixture, no department and no person entity (SO-2.01). The only fixture directory on main is for the red-team gate (`test/fixtures/redteam`). A vault holds one project store open at a time (`src/engine/vault.mjs:408-410`).

Open, needs owner decision:

- The composition of the scenario: how many departments, projects, people and agents, and how each is represented, since no person or department entity exists.
- Whether the ten-person scenario extends the SO-F-13 fixture or is a separate one.
- Whether the people run on one vault or on several, which decides whether convergence (requirement 5) is part of the scenario.

## Requirement 3: a finding that correctly links the source evidence, affected projects, relevant owners and uncertainty, and is routed for review without silently changing either project

Decided by the sources:

- The finding and its routing are required (spec line 15).
- Covered by SO-F-13: the finding links both source versions, lists affected tasks, milestones and owners, states confidence and uncertainty, routes a decision, and neither plan changes (AC01).
- The meaning of a finding is the SO-2.04 record and the routing is the SO-2.05 record. This record takes neither.

Open, needs owner decision:

- Whether "affected projects" is the same as the affected tasks and milestones of SO-F-13 AC01, or a further link.

## Requirement 4: confidential departmental or project information must not be exposed to an unauthorised person or agent, including through summaries, search, embeddings, caches or derived insights

Decided by the sources:

- The non-exposure is required across the five surfaces (spec line 16).
- SO-F-13 has no criterion on exposure. The access rules are the SO-2.02 record, and the rule for derived records is the SO-2.03 record.
- What exists today for each surface:
  - Search: recall is filtered by the token's paths before ranking (`src/engine/vault.mjs:428-445`).
  - Derived insights: the graph is filtered by an optional view that the caller passes (`src/engine/vault.mjs:610-617`), and a claim lists its subject, predicate and object to any reader with the read scope (`src/engine/vault.mjs:640-643`).
  - Caches: the recall index and the graph are files under `.memev/`, which is not in the git backup (`src/engine/vault.mjs:65`, `:689`, `:816`).
  - Summaries and embeddings: no code on main produces either (a search of `src/` finds none).
  - An unauthorised caller can be made with a token limited to some paths (`src/engine/tokens.mjs:102-107`).

Open, needs owner decision:

- What the test seeds as confidential and what it counts as exposure: a path, a snippet, an entity name, a claim, the existence of a record.
- Which surfaces the test must reach, given that summaries and embeddings do not exist on main and the SO-2.02 record lists read paths with no per-path check.
- How an unauthorised person and an unauthorised agent are represented, since identity today names a credential and not a person.

## Requirement 5: measure convergence and recovery, prohibited disclosure, duplicate side effects, false or unsupported findings, evidence traceability, trust-change propagation, scoped re-verification, time to detect cross-project conflicts, operational overhead and the ability to continue through partial failure

Decided by the sources:

- The measures are required (spec line 17). They are listed in the "Measures:" line.
- Covered by SO-F-13: precision and recall of the seeded conflict, with the two minima that contract states (AC02). The other measures have no minimum in any source.
- What exists today for the measured behaviour:
  - Convergence: the core holds no convergence logic. A conflicted note goes to an external merge engine only through the provider boundary, and when the engine is absent or refuses, both versions are kept (`src/engine/merge.mjs:2-7`, `:27-34`).
  - Recovery: the operation log recovers from a torn or partial line (`test/oplog-recovery.test.mjs:23`, `:47`, `:73`, `:92`).
  - Scoped re-verification: a scope change returns affected verified tasks to accepted and marks only the bound evidence stale (`src/engine/project-state.mjs:177-214`).
  - Trust change: a revoked or expired token stops verifying (`src/engine/tokens.mjs:49-51`, `:60-66`), and no derived record is invalidated by it (SO-2.03 record).
  - Duplicate side effects, time to detect, operational overhead: no code or test on main measures them.

Open, needs owner decision:

- The unit, method and threshold of each measure other than the SO-F-13 pair. No source sets them.
- Whether convergence is measured at all while the merge engine is an external component that may be absent.
- What "partial failure" is for the demonstrator: a computer offline, a vault unreachable, a failed adapter.

## Open decisions

Each needs an owner decision before a build contract can be written. Items that are permission-matrix-shaped are marked ADR 5. What the fold covers is not listed here.

1. The seeded condition and pass condition for unsupported inferences (requirement 1).
2. The same for stale information (requirement 1).
3. The same for provenance loss (requirement 1).
4. Whether access leakage is tested at the demonstrator only or also per module (requirement 1).
5. The composition of the ten-person scenario and how people and departments are represented; SO-2.01 (requirement 2).
6. Whether the scenario extends the SO-F-13 fixture or is separate, and whether it runs on one vault or several (requirement 2).
7. What the confidential seed is, what counts as exposure, which surfaces are reached, and how an unauthorised person or agent is represented; SO-2.02, SO-2.03, ADR 5 (requirement 4).
8. The unit, method and threshold of each measure other than the SO-F-13 pair, whether convergence is measured, and what partial failure is (requirement 5).
9. Whether "affected projects" equals the affected tasks and milestones of SO-F-13 AC01 (requirement 3).
10. Resolved: SO-F-13 is adopted as the build layer for this scope (owner delegation, 1 Nov 2026; the layer row in RECONCILIATION.md).
11. The spec lists no dependency and the WBS lists SO-2.02 to SO-2.05 (`docs/scope-one/WBS.md:536`). The signed spec governs this record, and the difference is a documentation inconsistency to be fixed separately.
