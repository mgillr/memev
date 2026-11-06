# Scope One work breakdown structure and traceability

Part of the [Memev documentation](../README.md). Up: the [README](../../README.md). Related: [requirements](REQUIREMENTS.md), [traceability](TRACEABILITY.md), [inventory](INVENTORY.md), [slice plan](SLICE-PLAN.md), [decisions](DECISIONS.md), [contracts](../../contracts/README.md).

Reconciled 31 October 2026 against main at `4823064`. The requirement register and the traceability matrix stay dated 30 October at `2909702d`; this page is the refreshed view, and where it differs it says so and cites the evidence.

## How to read this page

- One tree, numbered. A leaf is one thing that has to be delivered, decided or settled. Each leaf has one owner line; an owner is named once on its own leaf and cited from the others, so no work is described twice.
- A leaf has one of four statuses. **delivered**: on main and a test proves it. **covered**: an existing contract, an open pull request, merged work or a task of the programme decomposition owns what is left (a programme task is proposed and unsigned until its contract is signed). **new**: a contract added with this page (SO-1.01 to SO-1.11 and SO-2.01 to SO-2.14) owns it. **blocked**: it cannot be contracted or built until the named decision or fact exists.
- A dagger (†) after an id marks a contract signed in the owner's vault that the review of PR #222 names (issuecomment-6534383323). It is not in this repository and cannot be checked from here, so every leaf that rests on one is flagged and counted apart.
- The build layer: SO-A-01 to SO-A-12, SO-R-E and SO-F-01 to SO-F-13 are the fold of 30 Oct 2026, signed by pull request #341 and adapted to this repository and listed in section 9 (SO-F-11 is dropped, see 9.3). They build what the design records of SO-1.x and SO-2.x decide. A leaf that rested on a dagger contract and now has one of them as its build contract is covered; a leaf with no dagger keeps its status and names the build layer in its note.
- Sections 1 to 3, 5, 6, 7 and 8 are different lenses on the same work, so a total across all of them counts a thing once per lens. Section 9 lists each owner once.
- Source names: "baseline" is the master traceability and target architecture baseline of 31 October 2026 (main at `aa3af6c`), "addendum" is the Scope One addendum of PR #222, and "review" is its review table.
- Recorded statuses of requirements are the register's own. "On main" is the status the evidence of 31 October supports; it moves only where a test on main shows it, and says which.

## Summary

Leaves: 278. delivered 21, covered 214, new 29, blocked 14. Of the covered leaves, 96 rest wholly or partly on a contract that only the owner's vault holds and this repository cannot check.

| Section | Leaves | delivered | covered | new | blocked |
| --- | --- | --- | --- | --- | --- |
| 1 Control and decisions | 19 | 1 | 12 | 2 | 4 |
| 2 Platform contracts | 59 | 0 | 59 | 0 | 0 |
| 3 Requirements | 98 | 4 | 86 | 5 | 3 |
| 4 Addendum | 23 | 0 | 13 | 5 | 5 |
| 5 Delivery families | 52 | 0 | 34 | 16 | 2 |
| 6 Pull requests | 7 | 0 | 6 | 1 | 0 |
| 7 Branches | 7 | 3 | 4 | 0 | 0 |
| 8 Merged foundations | 13 | 13 | 0 | 0 | 0 |
| Total | 278 | 21 | 214 | 29 | 14 |

The sections are lenses on the same work, so the total counts a thing once per lens; the requirement lens (98 leaves) is the one that must reach "delivered".

## 1. Control, quality and decisions

### 1.1 Quality-loop contracts

| WBS | Contract | Title | Signed | Record | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1.1 | QL-1.01 | Red-team gate: no contract is signed without a clean record that matches its spec | v3 signed | interim record | covered | task 2 (sign, verify and MCP integration) is not built |
| 1.1.2 | QL-1.02 | Mutation gate: the changed lines are broken on purpose and the tests must catch every mutant | v2 signed | interim record | covered | spec in manifest; signed with a record-based provenance |
| 1.1.3 | QL-1.03 | Security checklist before merge on every change that touches command execution, auth, tokens, the tunnel or th | v2 signed | interim record | covered | spec in manifest; signed with a record-based provenance |
| 1.1.4 | QL-1.04 | The claims check runs in every repository from one script: a claim ahead of its status row fails CI | v2 signed | interim record | covered | spec in manifest; signed with a record-based provenance |
| 1.1.5 | QL-1.05 | The sensitive-path gate runs in CI from a workflow the pull request cannot change | unsigned | none | covered | spec in manifest; no record yet |
| 1.1.6 | QL-1.06 | The claims check ships to every repository and runs in memev's CI | unsigned | none | covered | spec in manifest; no record yet |

### 1.2 Reconciliation

| WBS | Item | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 1.2.1 | Requirement register, traceability matrix and inventory | SO-T-A (delivered, #213) | delivered | test/scope-one-record.test.mjs; dated 30 October, so superseded for status by section 3 of this page |
| 1.2.2 | This work breakdown and its test | SO-1.02 | new | docs/scope-one/WBS.md and test/wbs.test.mjs check that every requirement, contract and ledger row is here once |
| 1.2.3 | Pull request and branch ledger | SO-1.02 | new | sections 6 and 7 of this page, reconciled against main on 31 October |
| 1.2.4 | Contract set repairs: dangling dependencies and red-green commands that name a directory | amendments to SR-3.02, SR-2.03, SR-3.04, SR-4.07, SR-5.02, SR-6.01, SR-6.11, SR-9.05 | blocked | each needs an owner decision on what the absent contract is (SR-3.03, SR-4.02 to SR-4.05, SR-5.01, SR-6.10, SR-7.02, SR-9.01); the baseline says not to infer them |

### 1.3 Open and closed owner decisions

| WBS | Decision | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 1.3.1 | ADR 4: policy defaults | product owner | blocked | DECISIONS.md ADR 4 is open; the safe default holds until it is decided |
| 1.3.2 | ADR 5: permission matrix | product owner | blocked | DECISIONS.md ADR 5 is open; anything ungated stays denied until it is decided |
| 1.3.3 | Memory authority (D-SO-MEMORY-AUTHORITY†) | owner | blocked | named open in the review, row 10 |
| 1.3.4 | First supported clients and their order | product owner | covered | product-owner question 1; it has a safe default (DECISIONS.md) |
| 1.3.5 | Tier names and trial length | owner | covered | closed by owner decision 31 Oct 2026: Free core (the trial), Personal for up to 3 computers at the list price in docs/PRICING.md, contact us for higher tiers |
| 1.3.6 | Deployment modes and topology | owner | covered | closed in part by owner decision 31 Oct 2026: local-first, the cloud only a relay and a backup; the Business and Enterprise topology of addendum 13.6.1 still needs its own decision |
| 1.3.7 | Provider neutrality | owner | covered | closed by owner decision 31 Oct 2026: every supported provider on equal footing |
| 1.3.8 | Secure remote model | product owner | covered | product-owner question 4; safe default is customer-initiated only |
| 1.3.9 | Paid conversion path | product owner | covered | product-owner question 5; the current conversion step stays |

Reported, not confirmed: a parallel working team reports that the owner decided there is no in-house merge engine and that the external convergence engine is reached only through the WO-05-A provider boundary. If the owner confirms it, that supersedes PI-04 and PI-05 (section 7.1), SR-3.01 and SR-3.03 (absent from the manifest, see 1.2.4). Nothing here was built, re-signed or contracted for those four, and their rows above stay as they were until the owner confirms.

## 2. Platform readiness contracts (seed readiness)

All 59 contracts of `contracts/seed-readiness/manifest.json`, one leaf each. The gap id is the manifest's. A contract is signed when `contracts/signed/` holds a file for it that `node scripts/gate/redteam-gate.mjs --report` accepts; a signature does not say the work is built.

### 2.1 SR-0: Verification foundations

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1.1 | SR-0.03 | G85 | Verify runs every verifier type the specs use: red-green tests, metrics and scope, behind the same l | v2 signed | interim record | covered |  |
| 2.1.2 | SR-0.04 | N01, N03, N06, N08, N09 | Receipts match signatures, and what is claimed is in the tree | unsigned | none | covered | depends on SR-1.35 |
| 2.1.3 | SR-1.35 | owner 6 Nov 2026 | Memev is fast on every axis we measured | unsigned | none | covered | code landed by PR 437 |

### 2.2 SR-1: Runtime, integrity, authority and security

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.2.1 | SR-1.01 | G01 | One writer, enforced: an exclusive lock on the vault log | v2 signed | interim record | covered |  |
| 2.2.2 | SR-1.02 | G02 | No AI-drafted command runs without local approval | unsigned | none | covered |  |
| 2.2.3 | SR-1.03 | G03 | Replay protection that survives a restart | v2 signed | interim record | covered |  |
| 2.2.4 | SR-1.04 | G04 | Cloud connectors: no bearer in the URL, proof of possession | unsigned | none | covered |  |
| 2.2.5 | SR-1.05 | G05 | A bounded rate limiter | v2 signed | interim record | covered | one criterion statement appears twice with two different verifiers (recorded in its record, answer 1, rejected) |
| 2.2.6 | SR-1.06 | G06 | One licence schema, validated everywhere | v2 signed | interim record | covered |  |
| 2.2.7 | SR-1.07 | G07 | Pinned TLS on the relay and a configured OAuth issuer | unsigned | none | covered |  |
| 2.2.8 | SR-1.08 | G08 | Remote setup session: allowlist that works, tested like the rest | unsigned | none | covered |  |
| 2.2.9 | SR-1.09 | G09 | Code a second engineer can read | unsigned | none | covered |  |
| 2.2.10 | SR-1.10 | G10 | A suite that is green on any machine | unsigned | none | covered |  |
| 2.2.11 | SR-1.11 | G11 | memev stop always ends inside its bound | unsigned | none | covered |  |
| 2.2.12 | SR-1.12 | G12 | CI that protects main | unsigned | none | covered |  |
| 2.2.13 | SR-1.13 | G13 | Performance numbers anyone can reproduce | unsigned | none | covered |  |
| 2.2.14 | SR-1.14 | G14 | The multilingual claim runs in the suite | unsigned | none | covered |  |
| 2.2.15 | SR-1.15 | G15 | No code without a caller | unsigned | none | covered |  |
| 2.2.16 | SR-1.16 | G16 | Docs and code say the same thing | unsigned | none | covered |  |
| 2.2.17 | SR-1.17 | G17 | A bus that scales to a team | unsigned | none | covered |  |
| 2.2.18 | SR-1.18 | G18 | Windows out of preview | unsigned | none | covered |  |
| 2.2.19 | SR-1.19 | G19 | The lab plan is run, not just written | unsigned | none | covered |  |
| 2.2.20 | SR-1.20 | G20 | External security review before any public launch | unsigned | none | covered |  |
| 2.2.21 | SR-1.21 | G86 | A missing note the log cannot rebuild is reported, never silent | v2 signed | interim record | covered |  |
| 2.2.22 | SR-1.22 | G87 | A whole-note write interrupted after the log append recovers from the log, not from the old file | v2 signed | interim record | covered |  |
| 2.2.23 | SR-1.23 | G88 | verify() catches a removed tail of the active segment and a removed last record of a path | unsigned | none | covered |  |
| 2.2.24 | SR-1.24 | G89 | No CLI command writes vault state beside a live daemon | v2 signed | interim record | covered |  |
| 2.2.25 | SR-1.25 | G90 | A cloud seat allowed to assign tasks addresses one local seat, never all | v2 signed | interim record | covered |  |
| 2.2.26 | SR-1.26 | G91 | One write can never make the vault unopenable | v2 signed | interim record | covered |  |
| 2.2.27 | SR-1.27 | G92 | Done comes only from a passing verify | v2 signed | interim record | covered |  |
| 2.2.28 | SR-1.28 | G93 | The bus writes its own routing files | v2 signed | interim record | covered |  |
| 2.2.29 | SR-1.29 | G94 | A hook starts without loading the whole CLI | unsigned | none | covered |  |
| 2.2.30 | SR-1.30 | G95 | Done holds across computers and clones | unsigned | none | covered |  |
| 2.2.31 | SR-1.31 | G96 | Every other CLI state writer goes through the daemon or the lock | unsigned | none | covered |  |
| 2.2.32 | SR-1.32 | G98 | Bus messages reach the model as untrusted data, and the open routes are stated | unsigned | none | covered |  |
| 2.2.33 | SR-1.33 | G99 | A test count that means behaviour | unsigned | none | covered |  |

### 2.3 SR-2: Context and client continuity

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.3.1 | SR-2.01 | G21 | Recall that finds paraphrases | unsigned | none | covered |  |
| 2.3.2 | SR-2.02 | G22 | A public memory benchmark | unsigned | none | covered |  |
| 2.3.3 | SR-2.03 | G23 | Every client hook verified against the real app | unsigned | none | covered | its red-green cmd names a directory, not the test_file |
| 2.3.4 | SR-2.04 | G24 | Continuity measured in every app, including those without hooks | unsigned | none | covered |  |
| 2.3.5 | SR-2.05 | G25 | Catch restatements and count confirmations | unsigned | none | covered |  |
| 2.3.6 | SR-2.06 | G26 | One rules file for every app | unsigned | none | covered |  |
| 2.3.7 | SR-2.07 | G27 | Project names in any script | unsigned | none | covered |  |
| 2.3.8 | SR-2.08 | G28 | A local read-only view of the vault | unsigned | none | covered |  |
| 2.3.9 | SR-2.09 | G29 | The coming-soon provider: build it or stop showing it | unsigned | none | covered |  |
| 2.3.10 | SR-2.10 | G100 | Known issues are listed, and the free tier holds for three days | unsigned | none | covered |  |

### 2.4 SR-3: Convergence engine boundary

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.4.1 | SR-3.01 | G30 | Engine decision: what merges a note, where it lives, how it is licensed | unsigned | none | covered |  |
| 2.4.2 | SR-3.02 | G31 | An engine conformance suite in the core | unsigned | none | covered | its red-green cmd names a directory, not the test_file |
| 2.4.3 | SR-3.04 | G33 | Several computers editing one vault at once, nothing to resolve | unsigned | none | covered | depends on SR-3.03, which is not in the manifest (not inferred) |
| 2.4.4 | SR-3.05 | G34 | One licence for the engine, stated once | unsigned | none | covered |  |

### 2.5 SR-4: Hosted services

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.5.1 | SR-4.07 | G101 | memev uses the live hosted services | unsigned | none | covered | depends on SR-4.02 to SR-4.05 and SR-5.01, which are not in the manifest |

### 2.6 SR-5: Business and commercial model

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.6.1 | SR-5.02 | G43 | The Business trial can actually start | unsigned | none | covered | depends on SR-4.02 and SR-7.02, which are not in the manifest |
| 2.6.2 | SR-5.04 | G45 | Paid tiers sell only what is built, on every surface | unsigned | none | covered |  |

### 2.7 SR-6: Distribution and product presence

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.7.1 | SR-6.01 | G48 | The repository goes public | unsigned | none | covered | depends on SR-9.01, which is not in the manifest |
| 2.7.2 | SR-6.02 | G49 | npx memev init works | unsigned | none | covered |  |
| 2.7.3 | SR-6.03 | G50 | Installers and a container anyone can fetch | unsigned | none | covered |  |
| 2.7.4 | SR-6.04 | G51 | Listed where people look for MCP servers | unsigned | none | covered |  |
| 2.7.5 | SR-6.11 | G102 | One product site | unsigned | none | covered | depends on SR-6.10, which is not in the manifest |

### 2.8 SR-9: Engineering review

| WBS | Contract | Gap | Title | Signed | Record | Status | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.8.1 | SR-9.05 | G80 | A second engineer and two-person review | unsigned | none | covered | depends on SR-9.01, which is not in the manifest |

## 3. Scope One requirements

One leaf per requirement of the register, in eight areas. "Recorded" is the register's status of 30 October. "On main" is the status the evidence of 31 October supports. Seven rows move from DOCUMENTED_ONLY to EXISTS_BUT_INCOMPLETE, each on the test or module named in its last column; nothing else moves, and nothing moves to verified.

### 3.1 Scope One acceptance criteria

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.1.1 | SO-REQ-001 | A non-technical user installs and connects the initial supported clients through a guided flow. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | MEM-101 (#140) and the slice 4 set; SR-6.02; SR-6.03 | covered | slice plan slice 4 |
| 3.1.2 | SO-REQ-002 | A user describes a project in natural language and receives a comprehensible scope, assumptions, plan, and acceptance criteria. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-02-A†; SO-1.05 (brief view and lead area) | covered |  |
| 3.1.3 | SO-REQ-003 | Material ambiguity and consequential actions trigger the appropriate approval, while routine reversible work proceeds autonomously. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-03-A†; ADR 4 is open | covered | policy defaults wait on the owner (DECISIONS.md ADR 4) |
| 3.1.4 | SO-REQ-004 | A user approves, pauses, resumes, amends, or cancels the project without manually coordinating individual agents. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-04-A (delivered, #221); SO-1.05 (pause, resume and cancel semantics, addendum 5) | covered |  |
| 3.1.5 | SO-REQ-005 | The planner decomposes scope into dependency-aware tasks with stable ids. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-02-A†; SO-04-A (dependency-aware tasks, delivered) | covered |  |
| 3.1.6 | SO-REQ-006 | At least two supported agent sessions execute different tasks through the shared state model. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-08-A (delivered, #218); SO-05-B†; SO-1.01 | covered |  |
| 3.1.7 | SO-REQ-007 | Exclusive task claims and stale ownership are enforced under concurrency. | DOCUMENTED_ONLY | EXISTS_BUT_INCOMPLETE (moved) | SO-08-A (delivered, #218) | covered | test/coordinator.test.mjs AC01 (two processes, one wins), AC04 (expired lease), AC07 (late report); nothing outside vault.mjs imports it yet |
| 3.1.8 | SO-REQ-008 | A daemon restart or new session reconstructs state from canonical records. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-07-A (delivered, #217); REV-003; SO-1.01 | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.1.9 | SO-REQ-009 | The interface distinguishes reported, inferred, and verified state and shows provenance. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C†; SO-1.07 | covered |  |
| 3.1.10 | SO-REQ-010 | No task becomes verified without required checks tied to current scope and artifact versions. | DOCUMENTED_ONLY | EXISTS_BUT_INCOMPLETE (moved) | SO-04-A; SR-1.27; SR-1.30; SO-1.01 | covered | test/project-state.test.mjs AC02: VERIFIED needs evidence bound to the scope version and artifact; the runner does not call it yet |
| 3.1.11 | SO-REQ-011 | Failed checks, blocked work, conflicts, stale evidence, and missing permissions are actionable and visible. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-C†; SO-1.08 | covered |  |
| 3.1.12 | SO-REQ-012 | Pause stops new dispatch and accurately reports in-flight task status. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-1.01 (dispatch honours the project status); SO-04-A (paused status) | new |  |
| 3.1.13 | SO-REQ-013 | Duplicate events and stale results do not corrupt state or repeat non-idempotent actions blindly. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-08-A AC02 and AC05; SO-07-A AC02 (all delivered) | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.1.14 | SO-REQ-014 | Existing tests continue to pass and new deterministic failure cases are automated. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | MEM-100 (test/fail-paths.test.mjs); SO-11-A†; SO-1.10 | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.1.15 | SO-REQ-015 | A final delivery summary includes artifacts, run and use instructions, checks performed, evidence, limitations, and unresolved items. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-1.11 (step 15 of the reference project) | new |  |
| 3.1.16 | SO-REQ-016 | Product documentation identifies per-client capability limits and does not overclaim universal auto-registration or hard cancellation. | EXISTS_AND_VERIFIED | EXISTS_AND_VERIFIED | docs/CLIENTS.md; test/clients-unsupported.test.mjs | delivered | paths on main: 1 of 1, changed since baseline: 1 |

### 3.2 Failure tests F01 to F20

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.2.1 | SO-REQ-017 | When session context is compacted, scope, constraints, task state, and the next action survive resume. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.2 | SO-REQ-018 | When a different supported agent resumes the project, it receives canonical state and only eligible assignments. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.3 | SO-REQ-019 | When an agent claims completion without passing checks, the work remains unverified. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.4 | SO-REQ-020 | When stale context from another project appears, project boundaries and provenance prevent silent contamination. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.5 | SO-REQ-021 | When two agents claim an exclusive task, one claim wins and the other gets a clear conflict response. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.6 | SO-REQ-022 | When an agent disconnects mid-task, the system recovers from a checkpoint without blind duplicate dispatch. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.7 | SO-REQ-023 | When an old agent returns after reassignment, its output is retained but cannot overwrite current state. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.8 | SO-REQ-024 | When scope changes after verification, affected checks become stale and tasks are replanned. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.9 | SO-REQ-025 | When devices sync incompatible changes, the conflict is visible and resolvable, not silently overwritten. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.10 | SO-REQ-026 | When a user pauses during active execution, no new dispatch happens and in-flight cancellation state is reported honestly. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.11 | SO-REQ-027 | When a required verifier is unavailable, the task cannot become verified and the system explains why. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.12 | SO-REQ-028 | When an event is delivered twice, idempotency prevents duplicate transitions and side effects. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.13 | SO-REQ-029 | When a client lacks session discovery or cancellation, status shows the limitation accurately. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.14 | SO-REQ-030 | When evidence belongs to an old scope or artifact, it is not accepted for the current scope without explicit policy. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.15 | SO-REQ-031 | When the daemon restarts, canonical state and event history reconstruct consistently. | EXISTS_AND_VERIFIED | EXISTS_AND_VERIFIED | SO-11-A†; REV-003 (delivered) | delivered | test/oplog.test.mjs and test/oplog-recovery.test.mjs; paths on main: 1 of 1, changed since baseline: 0 |
| 3.2.16 | SO-REQ-032 | When the planner encounters an ambiguous high-impact choice, it asks the user and explains the consequence. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.17 | SO-REQ-033 | When a routine reversible choice is underspecified, the system chooses a reasonable default, records the assumption, and proceeds. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.18 | SO-REQ-034 | When an action exceeds a configured cost or permission boundary, it stops at the policy gate and requests approval. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.19 | SO-REQ-035 | When verification fails, the system diagnoses, retries within policy, or reports a blocker, and does not claim success. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |
| 3.2.20 | SO-REQ-036 | When an external side effect succeeds but acknowledgement is lost, the system checks the actual outcome before retrying to avoid duplicate side effects. | MISSING | MISSING | SO-11-A† (failure matrix F01 to F20, review row 11) | covered | no test on main is named for this id |

### 3.3 Dashboard acceptance criteria

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.3.1 | SO-REQ-037 | A first-time non-technical user identifies project status, next milestone, outstanding decisions, blockers, and the latest deliverable without engineer onboarding. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C† | covered |  |
| 3.3.2 | SO-REQ-038 | Clicking a milestone or task reveals dependencies, owner, acceptance criteria, latest events, and verification evidence. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C†; SO-1.05 (WBS view drill-down) | covered |  |
| 3.3.3 | SO-REQ-039 | The agents view reports actual runtime status and does not fabricate activity. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C† | covered |  |
| 3.3.4 | SO-REQ-040 | The comms view filters and traces messages to the tasks and decisions they concern, respecting access controls and redacting secrets. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C† | covered |  |
| 3.3.5 | SO-REQ-041 | Changes show scope and plan history and identify affected verification when scope or artifacts change. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C†; SO-1.07 (affected verification marked stale) | covered |  |
| 3.3.6 | SO-REQ-042 | Outstanding work is derived from canonical state and includes blocked work, unresolved conflicts, and missing evidence. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C† | covered |  |
| 3.3.7 | SO-REQ-043 | Interface status stays consistent with backend state after refresh, process restart, and reconnection. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C†; SO-1.07; SO-1.01 | covered |  |
| 3.3.8 | SO-REQ-044 | Closing the dashboard does not stop autonomous execution, and reopening it reconstructs current state from durable project data. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C†; SO-1.01 | covered |  |
| 3.3.9 | SO-REQ-045 | A user starts from a natural-language goal and reaches the first meaningful plan without configuring agents, protocols, or infrastructure. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-02-A†; SO-1.05; SO-1.11 | covered |  |

### 3.4 Onboarding acceptance criteria

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.4.1 | SO-REQ-046 | A user with only a local folder starts a project without a GitHub account. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-O-A†; vault.mjs (recorded as incomplete) | covered | paths on main: 1 of 1, changed since baseline: 1 |
| 3.4.2 | SO-REQ-047 | A user with GitHub connects it once, selects permitted repositories, and uses them from the command centre without configuring each agent separately. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-B† | covered |  |
| 3.4.3 | SO-REQ-048 | Local folder access and GitHub access are separately scoped, visible, and revocable. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-A to SO-O-B†; SO-1.06 | covered |  |
| 3.4.4 | SO-REQ-049 | Existing Git remotes and repository history are detected and preserved, with no duplicates or silent overwrites. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-O-B† | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.4.5 | SO-REQ-050 | Creating a remote repository or pushing local content requires explicit confirmation of owner, visibility, destination, and operation. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-C† | covered |  |
| 3.4.6 | SO-REQ-051 | The system never claims to create a GitHub account automatically and guides the user through provider-owned registration steps. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-B† | covered |  |
| 3.4.7 | SO-REQ-052 | Secret scanning and destination checks run before publishing content, and detected secrets block the push until resolved. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-O-C†; src/engine/secrets.mjs, scripts/leak-scan.mjs | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.4.8 | SO-REQ-053 | Agents cannot access local paths or repositories outside the user grants, even if another agent requests access. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-A†; SO-03-A† | covered |  |
| 3.4.9 | SO-REQ-054 | When setup is complete, the lead and all permitted agents use the same project-scoped access layer without per-agent credentials. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-A to SO-O-B†; SO-1.06 | covered |  |

### 3.5 Lead agent acceptance criteria

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.5.1 | SO-REQ-055 | Setup lets the user select a supported available lead while remaining usable with sensible defaults. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |
| 3.5.2 | SO-REQ-056 | The chosen lead is visible in the command centre along with its provider, health, and current role. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A†; SO-C-A† | covered |  |
| 3.5.3 | SO-REQ-057 | Exactly one lead has authority to dispatch work at a time, even when several AI clients are connected to the same bus. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |
| 3.5.4 | SO-REQ-058 | Two agents coordinating the same project cannot create competing plans or dispatch the same task under different leadership. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A†; SO-08-A (delivered) | covered |  |
| 3.5.5 | SO-REQ-059 | An unavailable preferred lead triggers an explicit recovery choice, with no silent substitution. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |
| 3.5.6 | SO-REQ-060 | Lead handover preserves canonical project state, records an auditable event, and prevents the old lead from acting with stale authority. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |
| 3.5.7 | SO-REQ-061 | A lead failure does not erase work or trigger blind duplicate execution, and recovery follows the saved preference and fallback policy. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A†; SO-08-A (delivered) | covered |  |
| 3.5.8 | SO-REQ-062 | The bus operator role and the project lead are independently represented unless the user explicitly configures them to be the same. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |

### 3.6 Release acceptance criteria

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.6.1 | SO-REQ-063 | Every advertised install method has been executed successfully in a clean environment using the published artifact. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-R-A (delivered, #208); SR-6.02; SR-6.03 | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.6.2 | SO-REQ-064 | The npm package installs and its documented executable runs on each claimed supported platform and runtime. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SR-6.02; SO-R-A (delivered) | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.6.3 | SO-REQ-065 | The published Docker image starts, passes its health check, preserves configured data across restart, and follows documented configuration and permission requirements. | DOCUMENTED_ONLY | EXISTS_BUT_INCOMPLETE (moved) | SO-R-B (delivered, #212); SR-6.03 | covered | test/docker-path.test.mjs exists; no published image is exercised yet |
| 3.6.4 | SO-REQ-066 | A clean source checkout builds and passes the documented test suite without relying on local developer state. | EXISTS_AND_VERIFIED | EXISTS_AND_VERIFIED | SO-R-A (delivered, #208) | delivered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.6.5 | SO-REQ-067 | The lead agent can follow the installation runbook, verify the result, and clearly report success or failure without hard-coded provider assumptions. | DOCUMENTED_ONLY | EXISTS_BUT_INCOMPLETE (moved) | SO-R-D (delivered, #216) | covered | test/agent-runbook.test.mjs exists; the end-to-end follow by a lead agent is not shown |
| 3.6.6 | SO-REQ-068 | Quick-start commands, package versions, image tags, environment variables, ports, and prerequisites match the actual release. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-R-A; SR-1.16 | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.6.7 | SO-REQ-069 | CI and release records provide traceable evidence, and failed mandatory gates block publication. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SR-1.12; SO-R-A | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.6.8 | SO-REQ-070 | Upgrade, backup and recovery, and rollback instructions are tested for the supported release path. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | no contract in this repository owns upgrade, rollback and uninstall; SO-R-C† is not visible | blocked | ownership unconfirmed; paths on main: 1 of 1, changed since baseline: 1 |
| 3.6.9 | SO-REQ-071 | No release is called production-ready while a mandatory advertised installation path is broken or unverified. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-R-A; SR-6.01 | covered |  |

### 3.7 Builder handoff checklist

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.7.1 | SO-REQ-072 | Confirm the baseline branch, commit, working tree, and test status. | EXISTS_AND_VERIFIED | EXISTS_AND_VERIFIED | SO-T-A (delivered, #213) | delivered | paths on main: 1 of 1, changed since baseline: 1 |
| 3.7.2 | SO-REQ-073 | Implement scoped local workspace selection and access checks before allowing agents to read or write project files. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-A† | covered |  |
| 3.7.3 | SO-REQ-074 | Implement GitHub authorization, repository discovery and selection, and explicit repository-creation and push confirmation, keeping local-only use available. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-B to SO-O-C† | covered |  |
| 3.7.4 | SO-REQ-075 | Add secret scanning and destination and history checks before any initial push or publish operation. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-O-C†; scripts/leak-scan.mjs | covered | paths on main: 1 of 1, changed since baseline: 0 |
| 3.7.5 | SO-REQ-076 | Validate the source map against current code before implementation. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-1.02 (this WBS and its test) | new |  |
| 3.7.6 | SO-REQ-077 | Agree the first supported clients and test them end to end. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-05-B†; docs/CLIENTS.md; product-owner question 1 has a safe default | covered |  |
| 3.7.7 | SO-REQ-078 | Implement the state schema, transitions, and invariants first. | DOCUMENTED_ONLY | EXISTS_BUT_INCOMPLETE (moved) | SO-04-A (delivered, #221); SO-07-A (delivered, #217) | covered | src/engine/project-state.mjs and project-store.mjs have tests (AC01 to AC07); not yet one path with the coordinator |
| 3.7.8 | SO-REQ-079 | Implement lead selection, single-authority enforcement, and safe lead handover before parallel dispatch. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |
| 3.7.9 | SO-REQ-080 | Keep the project lead distinct from the existing bus operator role unless explicitly configured. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |
| 3.7.10 | SO-REQ-081 | Implement atomic ownership, idempotency, and recovery before parallel dispatch. | DOCUMENTED_ONLY | EXISTS_BUT_INCOMPLETE (moved) | SO-08-A (delivered, #218) | covered | coordinator AC01 to AC05: atomic lease, generation, idempotent dispatch; not yet connected to the live runtime |
| 3.7.11 | SO-REQ-082 | Connect contracts and verification before claiming autonomous delivery. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-1.01; SR-1.27 | covered |  |
| 3.7.12 | SO-REQ-083 | Add policy and human gates before enabling external or destructive actions. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-03-A†; ADR 4 and ADR 5 are open | covered |  |
| 3.7.13 | SO-REQ-084 | Ship the complete vertical slice before expanding integrations. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-1.11 | new |  |
| 3.7.14 | SO-REQ-085 | Record the demo and metrics, and update this document as implementation decisions change. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-1.02; SO-1.11 | new |  |

### 3.8 The finished Scope One system

| WBS | Id | Outcome | Recorded | On main | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.8.1 | SO-REQ-086 | A complete, non-technical onboarding and project command centre. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-C-A to SO-C-C†; SO-1.05 | covered |  |
| 3.8.2 | SO-REQ-087 | Local project-folder selection and safe, explicitly scoped filesystem access. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-A† | covered |  |
| 3.8.3 | SO-REQ-088 | Optional GitHub connection, repository discovery and selection, scoped permissions, safe Git operations, and secret scanning before publication. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-O-B to SO-O-C† | covered |  |
| 3.8.4 | SO-REQ-089 | A user-selected supported lead agent, visible fallback handling, one active coordinator, and safe lead handover. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-L-A† | covered |  |
| 3.8.5 | SO-REQ-090 | Natural-language goal intake, clarification of material ambiguity, plan and scope review, and approval gates for consequential actions. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-02-A†; SO-03-A† | covered |  |
| 3.8.6 | SO-REQ-091 | Persistent project and task state, atomic contracts, dependencies and ownership, dispatch, progress, retries, idempotency, interruption recovery, and conflict handling. | DOCUMENTED_ONLY | EXISTS_BUT_INCOMPLETE (moved) | SO-04-A; SO-07-A; SO-08-A; SO-1.01 | covered | three delivered modules, not one execution path |
| 3.8.7 | SO-REQ-092 | Integrated memory and shared context based on a documented architecture decision, with recall, provenance, retention, recovery, and migration guarantees. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | D-SO-MEMORY-AUTHORITY† (open decision) | blocked | the requirement needs a documented architecture decision; the addendum review lists it as open; paths on main: 1 of 1, changed since baseline: 0 |
| 3.8.8 | SO-REQ-093 | Specialist-agent coordination through reconciled existing bus and tool interfaces, not a competing orchestration subsystem. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | MEM-031; SR-1.17; SR-1.28; SR-1.32 | covered | paths on main: 1 of 1, changed since baseline: 1 |
| 3.8.9 | SO-REQ-094 | Build, test, integration, and evidence-backed verification, where a task claim alone is not completion and changes to scope or artifacts invalidate affected verification. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-05-D†; SR-0.03; SR-1.27; SO-1.01 | covered |  |
| 3.8.10 | SO-REQ-095 | Security and permissions enforced by runtime adapters, with least privilege, revocation, secrets protection, audit records, and human approval for destructive, external, financial, privacy-sensitive, or otherwise consequential actions. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-03-A†; SR-1.02; ADR 5 is open | covered | paths on main: 1 of 1, changed since baseline: 1 |
| 3.8.11 | SO-REQ-096 | Complete install, first-run, upgrade, backup and recovery, rollback, and uninstall paths for every advertised supported distribution. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | no contract in this repository owns upgrade, rollback and uninstall; SO-R-C† is not visible | blocked | ownership unconfirmed; paths on main: 1 of 1, changed since baseline: 0 |
| 3.8.12 | SO-REQ-097 | User-facing delivery of results, test evidence, documented limitations, remaining work, and useful troubleshooting information. | DOCUMENTED_ONLY | DOCUMENTED_ONLY | SO-1.11; SO-1.09; SO-C-C† | covered |  |
| 3.8.13 | SO-REQ-098 | Regression, integration, security, clean-install, upgrade, restart and recovery, and end-to-end acceptance tests. | EXISTS_BUT_INCOMPLETE | EXISTS_BUT_INCOMPLETE | SO-11-A†; SO-1.10; SO-1.11 | covered | paths on main: 1 of 1, changed since baseline: 0 |

Method: for every row that names implementation paths, each path was checked on main (21 of 21 exist) and the commits since the baseline that touch it were counted (6 paths changed). The seven moves come from three modules merged after the baseline (`src/engine/project-state.mjs`, `src/engine/project-store.mjs`, `src/engine/coordinator.mjs`) and two release paths (`test/docker-path.test.mjs`, `test/agent-runbook.test.mjs`).

Finding: nothing outside `src/engine/vault.mjs` (line 408) imports `project-state.mjs`, `project-store.mjs` or `coordinator.mjs`, and `coordinator.mjs` imports only `util.mjs` (line 15). The three modules are delivered and tested; they are not yet one path. SO-1.01 owns that.

## 4. Addendum recommendations and the failure-test inventory

### 4.1 Recommendations

Each of the thirteen recommendations of the addendum, classified in the review table. Only recommendations the owner accepts become contracts; the owner request of 31 Oct 2026 (t531u) that every aspect be built into contracts is taken as that acceptance for the rows the review classed "agree". Row 13 was classed "needs evidence and decisions" and stays blocked.

| WBS | Rec | Subject | Review | Owner of what exists | New contract | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 4.1.1 | 1 | Establish one trustworthy baseline | agree | SO-T-A (delivered) | SO-1.02 | new |
| 4.1.2 | 2 | State machine, store and coordinator as the execution authority | agree | SO-04-A, SO-07-A, SO-08-A (delivered); SO-08-B†, SO-L-A† | SO-1.01 (integration); SO-1.03 (assignment preference); build layer SO-A-01, SO-A-02 | covered |
| 4.1.3 | 3 | Provider-neutral agent adapter contract | agree | SO-05-B† | SO-1.04; build layer SO-A-03 | covered |
| 4.1.4 | 4 | Intake, planning, execution, policy and verification kept separate | agree | SO-02-A†, SO-03-A†, SO-05-D†, SO-07-A | none, covered | covered |
| 4.1.5 | 5 | The workspace as a product surface | needs evidence | SO-C-A to SO-C-C† | SO-1.05; build layer SO-A-08, SO-A-09, SO-A-12 | covered |
| 4.1.6 | 6 | Connections and access | agree | SO-O-A to SO-O-C† | SO-1.06; build layer SO-A-07 | covered |
| 4.1.7 | 7 | A factual, interdependent model | agree | SO-07-A, SO-05-C†, SO-05-D† | SO-1.07; build layer SO-A-04 | covered |
| 4.1.8 | 8 | Blockers and decisions as a workflow | agree | SO-03-A†, SO-C-C† | SO-1.08; build layer SO-A-05 | covered |
| 4.1.9 | 9 | Inspectable artefacts | agree | SO-05-D†, SO-02-B† | SO-1.09; build layer SO-A-06 | covered |
| 4.1.10 | 10 | Core path separate from commercial infrastructure | agree | SR-3.01, SR-3.05 (the engine decision and its licence, which close the documentation task the review asks for); D-SO-MEMORY-AUTHORITY† open | none, covered | covered |
| 4.1.11 | 11 | Recovery and security as acceptance | agree | SO-11-A†, SO-09-A† | SO-1.10; build layer SO-A-10 | covered |
| 4.1.12 | 12 | The whole user journey | agree | SO-11-A† | SO-1.11; build layer SO-A-10 | covered |
| 4.1.13 | 13 | Final-state architecture | needs evidence and decisions | nothing signed | none; see 4.3 | blocked |

### 4.2 The addendum's thirteen fault classes against F01 to F20

The author's mapping of addendum 11 to the failure tests of the register. A reviewer should confirm it; SO-1.10 takes the unmatched classes.

| Addendum 11 fault class | Nearest failure test | Result |
| --- | --- | --- |
| Process termination during writes, dispatch and verification | F06 (agent disconnects mid-task), F15 (daemon restart) | matched in part |
| Network loss, reconnect, duplicate messages and replay | F12 (event delivered twice) | matched in part |
| Expired leases, stale generations and competing agents | F05, F07 | matched |
| Conflicting edits to the same artifact | F09 (devices sync incompatible changes) | matched in part |
| Scope changes after approval or partial completion | F08 | matched |
| Missing, corrupt or unreadable evidence | none (F14 is evidence of an old scope) | unmatched |
| Permission denial and access outside the approved workspace | F18 covers the policy gate, not access outside the workspace | matched in part |
| Retries of consequential external actions | F20 | matched |
| UI refresh, reconnection and restart while events arrive | none | unmatched |
| Stale or out-of-order events | none (F12 is duplicates) | unmatched |
| Revoked folder, GitHub or provider permissions while work is queued | none | unmatched |
| Loss of a remote machine or agent session without falsely reporting completion | F06, F03 | matched |
| Provider failure during a task | none (F19 is a failed verification) | unmatched |

Real inventory of the failure tests, from the code on main. The register records 19 of 20 missing and the slice plan says 16 are missing; neither number was copied. No test on main is named F01 to F20. F15 (requirement 31) is the one the register counts as verified, on `test/oplog.test.mjs` and `test/oplog-recovery.test.mjs`. A separate set exists: `docs/testing/LAB-TEST-PLAN.md` lists 19 operational tests T-FAIL-01 to T-FAIL-19, and `test/fail-paths.test.mjs` automates four of them (T-FAIL-07, 14, 15 and 16). So the register's count of 19 missing stands for F01 to F20, the slice plan's 16 matches neither set, and 15 of the 19 operational tests have no automated test on main.

### 4.3 Final-state architecture (addendum 13)

| WBS | Subject | Owner of what exists | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 4.3.1 | 13.1 Personal deployment, one or several machines | SR-3.04; SR-1.25; SR-1.30 | covered | owner decision 31 Oct 2026: Personal covers up to 3 computers; SR-3.04 owns concurrent editing of one vault |
| 4.3.2 | 13.2 Small business shared memory | SO-2.01; SO-2.02; SO-2.14 | new | the organisational knowledge model (SO-2.01), the permission model (SO-2.02) and multi-person project permissions (SO-2.14) are design-record contracts released by the owner on 31 October 2026; the records are not yet written; build layer SO-F-01, SO-F-02 |
| 4.3.3 | 13.3 Larger businesses and offices | none | blocked | depends on 13.2 and on the node-identity task (5.5.5), which the programme decomposition proposes as WP09-01 and WP13-03 |
| 4.3.4 | 13.4 Enterprise and international federation | #224 (merged 1 Nov 2026) | new | the federated architecture of #224 is in scope by owner direction, 1 Nov 2026; it is not yet built |
| 4.3.5 | 13.5 Governed shared memory | SO-2.02; SO-2.03 | new | permission-aware access (SO-2.02) and provenance, retention and invalidation (SO-2.03); the status lattice of a note is WP10-01 and WP10-02 of the programme decomposition; build layer SO-F-01, SO-F-03, SO-F-05 |
| 4.3.6 | 13.6 Cross-project intelligence | SO-2.04; SO-2.05; SO-2.06 | new | findings (SO-2.04), cross-functional routing (SO-2.05) and the acceptance tests (SO-2.06); a prototype is WP08-04 of the programme decomposition and consumes these records; build layer SO-F-09, SO-F-13 |
| 4.3.7 | 13.6.1 Federated site memory | none | blocked | owner decision 31 Oct 2026 settles local-first with the cloud only a relay and a backup; the review also asks for the two named integrations to be defined, and the trust-governance one is undefined in this repository; build layer SO-F-05, SO-F-07, SO-F-12; a proposed definition of trust governance (ADR 8, design/trust-governance.md) and two unsigned build contracts (PG-W-21A for the record and the evaluation, PG-W-21B for the book, the gate and the events, not to be signed before ADR 8 is signed off) now exist, pending sign-off and the owner's decisions, so the row stays blocked |
| 4.3.8 | 13.7 Convergence, accountable admission and trust governance | SR-3.01, SR-3.02, SR-3.05 (convergence engine boundary); WO-05-D (#206, specification merged) | blocked | the admission and trust-governance integrations have no contract and no definition in this repository; build layer SO-F-03, SO-F-06, SO-F-08; the trust-governance side now has a proposed definition (ADR 8) and two unsigned build contracts (PG-W-21A and PG-W-21B), pending sign-off and the owner's decisions, so the row stays blocked |
| 4.3.9 | 13.8 Deployment profiles | owner decision 31 Oct 2026 on tiers | covered | illustrative profiles, not thresholds; the tier set is decided |
| 4.3.10 | 13.9 Acceptance tests for the final state | none | blocked | cannot be written before the contracts above exist |

Rows 4.3.4 and 6.2 changed from blocked to new: the status change follows the owner's direction of 1 Nov 2026 that the federated architecture is in scope, and it is not yet built.

## 5. Delivery families of the master baseline

Section 8 of the baseline lists proposed contract families and says their ids are allocated only after the architecture and requirements are accepted. Each family is placed once: owned by what exists, owned by a new contract of this change, or blocked with its reason. A family that appears only in the baseline, with no line in the register, the addendum or an owner decision, is not contracted: the addendum protocol turns only accepted recommendations into contracts, and nothing here may be invented.

### 5.1 Contracts the slice plan calls for

| WBS | Family | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 5.1.1 | Dashboard and project command centre | SO-C-A to SO-C-C†; SO-1.05 | covered | the slice plan (slice 7) says no contract is created; the review says SO-C-* are signed in the vault. The owner confirms which is right |
| 5.1.2 | Lead-agent selection and single authority | SO-L-A†; SO-1.03 | covered | the slice plan (slice 8) says no contract is created; the review names SO-L-A. Same confirmation |
| 5.1.3 | Release and installation readiness | SO-R-A, SO-R-B, SO-R-D (delivered); SR-6.02; SR-6.03 | covered | upgrade, rollback and uninstall have no owner (requirements 70 and 96); SO-R-C† is not visible |
| 5.1.4 | Failure-path test contract | SO-11-A†; SO-1.10 | covered | the slice plan (slice 10) says to be contracted; the review names SO-11-A. Real inventory in 4.2 |
| 5.1.5 | Policy defaults decision (ADR 4) | product owner | blocked | DECISIONS.md ADR 4 is open |
| 5.1.6 | Permission matrix decision (ADR 5) | product owner | blocked | DECISIONS.md ADR 5 is open |

### 5.2 Execution families (addendum)

| WBS | Family | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 5.2.1 | Canonical execution integration | SO-1.01 | new | code evidence in section 3 |
| 5.2.2 | Project intake and scope resolution | SO-02-A† | covered |  |
| 5.2.3 | Project decomposition and planning | SO-02-A† | covered | the review lists SO-02-A with the intake and planning separation (row 4) |
| 5.2.4 | Resource and capability registry | SO-1.06; SO-05-B†; build layer SO-A-07 | covered | the internal readiness registry is the gap the review names (row 6) |
| 5.2.5 | Agent adapter specification | SO-05-B†; SO-1.04 | covered |  |
| 5.2.6 | Agent adapter implementations | SO-05-B†; SR-2.03; MEM-146 (#215, delivered) | covered | which clients come first is product-owner question 1; it has a safe default |
| 5.2.7 | Lead-agent authority | SO-L-A†; SO-1.03 | covered |  |
| 5.2.8 | Execution policy and human approval | SO-03-A† | covered | defaults wait on ADR 4 and ADR 5 |
| 5.2.9 | Evidence and acceptance integration | SO-05-D†; SR-0.03; SR-1.27; SR-1.30 | covered |  |
| 5.2.10 | Canonical workspace projections | SO-05-C†; SO-1.05; SO-1.07; build layer SO-A-04, SO-A-08 | covered |  |
| 5.2.11 | Connections and access settings | SO-O-A to SO-O-C†; SO-1.06; build layer SO-A-07 | covered |  |
| 5.2.12 | Blocker and decision workflow | SO-03-A†; SO-1.08; build layer SO-A-05 | covered |  |
| 5.2.13 | Artefact and deliverable management | SO-02-B†; SO-1.09; build layer SO-A-06 | covered |  |
| 5.2.14 | End-to-end delivery demonstration | SO-1.11 | new |  |

### 5.3 Organisational intelligence and memory

| WBS | Family | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 5.3.1 | Organisational knowledge model | SO-2.01 | new | owner release of 8.3 on 31 October 2026; the vault graph and retrieval modules are foundations only; build layer SO-F-02 |
| 5.3.2 | Permission-aware knowledge access | SO-2.02 | new | retrieval and action time; sharing classes at a site boundary are WP13-01 of the programme decomposition; build layer SO-F-01, SO-F-03, SO-F-04, SO-F-05 |
| 5.3.3 | Provenance and retention | SO-2.03 | new | retention, deletion, invalidation and derived-record provenance; the status lattice of a note is WP10-01 and WP10-02; build layer SO-F-12 |
| 5.3.4 | Cross-project intelligence | SO-2.04 | new | the design record; the prototype is WP08-04 and consumes it; build layer SO-F-09 |
| 5.3.5 | Cross-functional issue discovery | SO-2.05 | new | routing and access rules; WP08-04 and WP14-04 build on it; build layer SO-F-13 |
| 5.3.6 | Organisational intelligence acceptance | SO-2.06 | new | the acceptance tests of the organisational-intelligence demonstrator in WP14-04; build layer SO-F-13 |

### 5.4 Ecosystem integrations

| WBS | Family | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 5.4.1 | Existing client and tool interfaces | docs/CLIENTS.md; SR-2.03; SO-05-B† | covered | owned already; no new contract |
| 5.4.2 | Agent-to-agent communication | WP18-01 (programme decomposition, proposed and unsigned) | covered | an adapter alongside the existing MCP server; no replacement protocol |
| 5.4.3 | Agentic commerce and payment | WP18-04 (programme decomposition, proposed and unsigned) | covered | payment after verified acceptance |
| 5.4.4 | Specialist knowledge systems | SO-2.07 | new | owner release of 8.4 on 31 October 2026 |
| 5.4.5 | Agent frameworks and runtimes | SO-2.08; WP18-02 (first adapter, programme decomposition) | new | provider neutrality is decided; SO-2.08 is every framework other than the first adapter |
| 5.4.6 | Software delivery systems | SO-O-B† (GitHub); SO-2.09 | new | SO-2.09 is the other repository hosts and issue trackers |
| 5.4.7 | Business communication | SO-2.10 | new | owner release of 8.4 on 31 October 2026 |
| 5.4.8 | Enterprise systems | SO-2.11 | new | owner release of 8.4 on 31 October 2026 |

### 5.5 Convergence, trust and federation

| WBS | Family | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 5.5.1 | Structured-state convergence | WP05-01 to WP05-06 (programme decomposition, proposed and unsigned); SR-3.04 | covered | the merge-semantics table and the integration design; reported superseded items stay as in the note before section 2 |
| 5.5.2 | Engine conformance and entitlement | SR-3.02; SR-3.05; WO-05-A, MEM-130 (#163), #201; WP02-01 to WP02-04, WP15-01 (programme decomposition, proposed and unsigned) | covered |  |
| 5.5.3 | Contribution admission | WP09-02 (programme decomposition, proposed and unsigned) | covered | the admission boundary for contributions |
| 5.5.4 | Distributed trust governance | WO-05-D (#206, specification merged); WP09-01, WP09-03, WP06-01 to WP06-03 (programme decomposition, proposed and unsigned) | covered | identity, equivocation handling and the acceptance state model |
| 5.5.5 | Node identity and authority | WP09-01, WP13-03 (programme decomposition, proposed and unsigned) | covered |  |
| 5.5.6 | Sovereign data exchange | WP13-01, WP13-02 (programme decomposition, proposed and unsigned) | covered | sharing classes at the publish boundary and the disclosure policy |
| 5.5.7 | Federation protocol | WP12-01 to WP12-03 (programme decomposition, proposed and unsigned); #224 (merged 1 Nov 2026) | covered | transport adapter, relay-backed transport and the three-node harness |
| 5.5.8 | Partition and recovery | SR-3.04 (personal scale only); WP12-02, WP13-04 (programme decomposition, proposed and unsigned) | covered |  |
| 5.5.9 | Multi-site administration | WP13-03 (programme decomposition, proposed and unsigned) | covered | site identity, organisation membership and sovereignty policy |
| 5.5.10 | Cross-organisation projects | WP13-05 (programme decomposition, proposed and unsigned) | covered | cross-organisation identity and trust-domain boundaries |
| 5.5.11 | Federated computation | SO-2.12 | new | owner release of 8.5 row 11 on 31 October 2026; behind the provider boundary; build layer SO-F-10 |

### 5.6 Commercial and distribution

| WBS | Family | Owner | Status | Evidence or remaining |
| --- | --- | --- | --- | --- |
| 5.6.1 | Personal multi-device release | SR-3.04; SR-3.05; SR-5.04; MEM-130 (#163); MEM-134 (#177) | covered |  |
| 5.6.2 | Business deployment | SR-5.02; SR-5.04; MEM-069 (delivered, #133); SO-2.14 | new | SR-5.02 owns the trial, SR-5.04 tier enforcement and MEM-069 team invites; SO-2.14 is multi-person project permissions and team administration, and waits on ADR 5 |
| 5.6.3 | Enterprise deployment | WP16-04, WP13-03 (programme decomposition, proposed and unsigned) | covered | deployment by topology and trust boundary, not by computer count |
| 5.6.4 | Protocol conformance service | WP18-03 (programme decomposition, proposed and unsigned) | covered | public conformance tests |
| 5.6.5 | Commercial integration services | SO-2.13; WP15-01, WP15-02, WP16-07 (programme decomposition, proposed and unsigned) | new | SO-2.13 is the service boundary; the licence boundary and the pricing dimensions are the WPs |
| 5.6.6 | Public product distribution | SR-6.01; SR-6.02; SR-6.03; SR-6.04; SR-6.11 | covered |  |
| 5.6.7 | External security assurance | SR-1.20; SR-9.05 | covered |  |

## 6. Pull requests

| WBS | PR | Work | State on 31 Oct | Owner | Status | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 6.1 | #222 | Scope One addendum | open, draft, CI green after two merges of main | review row table | covered | independent review done in the table; the owner accepts or rejects each row. This page and SO-1.01 to SO-1.11 are what accepted rows became |
| 6.2 | #224 | Federation and deployment documentation | merged 1 Nov 2026 | 13.4, 5.5 | new | the federated architecture is in scope by owner direction, 1 Nov 2026; it is not an implementation and is not yet built |
| 6.3 | #201 | Paid-engine client, off by default | open, draft | SR-3.02; WO-05-B | covered | one lifecycle with #154, #163, #177; keep the engine external; reconcile with the landing branch (section 7) |
| 6.4 | #177 | Trial separation and abuse guards | open, draft | SR-5.02; MEM-134 | covered | review with #154 and #163 |
| 6.5 | #163 | Merge-engine entitlement and trial seat policy | open, draft | MEM-130 | covered | reconcile with the licence schema (SR-1.06, signed) and #201 |
| 6.6 | #154 | Trial licence format and verification | open, draft | MEM-129 | covered | review the schema against SR-1.06; owns the Business trial per SR-5.02 |
| 6.7 | #132 | Signed personal trial licence | closed 31 Oct 2026, branch kept | MEM-067 | covered | owner decision 31 Oct 2026: no Personal trial, the free core is the trial; MEM-067 removed from slice 5; branch kept, not merged |

Pull requests merged for this reconciliation, for the record: #319 (QL-1.01 and QL-1.02 records, merge commit), #320 (gate build 2), #321 (SR-5.02 re-point), #322 (interim reviewer key, signer-2 and stop public keys), #323 (sixteen contracts re-signed with provenance, merge commit).

## 7. Branches without a live pull request

Compared with main on 31 October 2026 by merge base, commit list, changed files and blob identity. Nothing was deleted or merged.

| WBS | Branch | Ahead / behind | Finding | Status | Disposition |
| --- | --- | --- | --- | --- | --- |
| 7.1 | dev-integration-specs | 1 / 163 | one commit adds `dev_integration/` with PI-01 to PI-18, 18 pull-in specs and an index, none of it on main. Its note says PI-04 to PI-07 supersede WO-05 and WO-06, and PI-04 is titled to vendor the convergence core, which the slice plan (slice 3) and the baseline boundary forbid | covered | overlaps the paid-engine work (#201, #163) and parts of the identity and audit contracts; the owner decides which PI specs, if any, become contracts. Not merged, to avoid a second plan beside this page |
| 7.2 | docs/federation-architecture | 31 / 105 | historical federation documentation; #223 closed and #224 supersedes it | covered | keep as history; do not merge as is |
| 7.3 | mem-004-healthz-names-vault-memev | 1 / 167 | one change note only (`changelog.d/MEM-004.md`); the behaviour is on main (`src/server/http.mjs` line 123 returns the vault id to local callers) | delivered | already delivered; the branch holds only a note. Close with owner approval |
| 7.4 | mem-014-one-line-installers-install | 3 / 167 | installers and their tests are on main through #98 and #99 (`scripts/install.sh`, `test/installers.test.mjs`) | delivered | superseded by main; close with owner approval |
| 7.5 | wo-05-b-paid-engine-client-behind-landing | 8 / 105 | three commits ahead of the #201 branch (engine budget as one bounded share), touching `src/cli/sync.mjs` and adding paid-merge.mjs and paid-client.test.mjs, which exist only on that branch | covered | a newer line of #201; reconcile by updating #201 or adopting this branch, not both. Owner approval |
| 7.6 | wo-10-a-sales-kit-security-brief-landing | 7 / 106 | all five added files are byte-identical on main (#198) | delivered | already delivered; close with owner approval |
| 7.7 | wo-10-a-sales-kit-security-brief-landing-b | 8 / 106 | same as the other landing branch plus one commit (three lines in `docs/DATA-FLOW.md`, `docs/README.md`, `docs/SECURITY-BRIEF.md`) not on main | covered | the one commit is small and useful: land it as a pull request if the owner wants those three lines; then close |

Branches with a pull request are in section 6: `federation-aligned` (#224), `so-01-scope-one-review-addendum` (#222), `wo-05-b-paid-engine-client-behind` (#201), `mem-134-separation-abuse-guards-trial` (#177), `mem-130-merge-engine-entitlement-trial` (#163), `mem-129-trial-licence-format-verification` (#154), `mem-067-signed-personal-trial-licence` (#132, closed). The branches of merged pull requests were removed by the host when they merged.

## 8. Merged foundations

Merged work that other leaves build on. A merge does not close the integration work of the leaves that cite it.

| WBS | PR | Work | Status | What it still leaves open |
| --- | --- | --- | --- | --- |
| 8.1 | #213 | Takeover record (SO-T-A) | delivered | status of every row since 30 October: section 3 |
| 8.2 | #217 | Canonical project store (SO-07-A) | delivered | integration with the state machine and the runtime: SO-1.01 |
| 8.3 | #218 | Coordinator (SO-08-A) | delivered | connection to the live runtime and to adapters: SO-1.01, SO-1.04 |
| 8.4 | #221 | Project and task state machine (SO-04-A) | delivered | one lifecycle with the store and coordinator: SO-1.01 |
| 8.5 | #225 | Seed-readiness contract set | delivered | repairs in 1.2.4 |
| 8.6 | #206 | External trust-service specification (WO-05-D) | delivered | the integration contracts of 5.5 |
| 8.7 | #294, #299, #315 | Red-team gate and mutation runner (QL-1.01, QL-1.02) | delivered | QL-1.01 task 2 |
| 8.8 | #208 | Release gates (SO-R-A) | delivered | published artefacts: requirements 63 and 64 |
| 8.9 | #212 | Docker path (SO-R-B) | delivered | a published image: requirement 65 |
| 8.10 | #216 | Agent-led installation runbook (SO-R-D) | delivered | a lead agent following it end to end: requirement 67 |
| 8.11 | #210 | Paid-path regression guards (WO-11-A) | delivered | none known |
| 8.12 | #215 | Human binding of agent roles (MEM-146) | delivered | role accountability inside dispatch: SO-1.01 |
| 8.13 | #204, #209 | Weekly funnel report and monthly verdict (WO-04-A, WO-12-A) | delivered | none known |

## 9. Owner index and overlap check

Each new contract, with what it was checked against so that it does not repeat existing work.

| Contract | Title | Depends on | Checked against | Result |
| --- | --- | --- | --- | --- |
| SO-1.01 | Canonical execution integration: the store, the state machine and the coordinator as one authority | none | src/engine/coordinator.mjs, project-state.mjs, project-store.mjs, vault.mjs; SO-08-B†; SR-1.27, SR-1.30 | no overlap found in the repository; the vault contract SO-08-B† may touch it and must be read before the decision record is written |
| SO-1.02 | Reconciliation: one work breakdown that accounts for every requirement, contract, pull request and branch | none | SO-T-A; docs/scope-one/TRACEABILITY.md; INVENTORY.md | no overlap; it is the refresh the takeover record lacks |
| SO-1.03 | Lead assignment: a default suitability analysis and an in-language user preference | SO-1.01 | SO-L-A†; SO-08-A | the review says the override and the suitability analysis are not in SO-L-A as signed |
| SO-1.04 | Dispatch events: a requested action, an accepted dispatch, an observed execution and a verified outcome stay apart | SO-1.01 | SO-05-B†, SO-05-D†; coordinator dispatch keys | the review says the four-way distinction is not in SO-05-B or SO-05-D as signed |
| SO-1.05 | Workspace: the eleven project views and the persistent lead-agent area | SO-1.01, SO-1.07 | SO-C-A to SO-C-C†; docs/PROJECTS.md | the review says the eleven views go beyond SO-C-* |
| SO-1.06 | Connections and access: the provider and tool connections screen and the internal resource readiness registry | SO-1.01 | SO-O-A to SO-O-C†; docs/CLIENTS.md; src/engine/devices.mjs | the review says the connections screen and the readiness registry are new |
| SO-1.07 | Relationship model: explicit relations between project items, and change propagation that marks affected work stale | SO-1.01 | SO-07-A; SO-05-C†; SO-05-D† | the review says the relationship model and propagation are new |
| SO-1.08 | Decision queue: blockers and user decisions as one workflow with named states | SO-1.01 | SO-03-A†; SO-C-C† | the review says the queue states are new |
| SO-1.09 | Artefacts: version history, comparison and previews that show verification state | SO-1.01 | SO-05-D†; SO-02-B† | the review says history and previews are new |
| SO-1.10 | Fault classes: the addendum classes that F01 to F20 do not name, added to the failure suite | SO-1.01 | SO-11-A†; SO-09-A†; F01 to F20; test/fail-paths.test.mjs | only the six unmatched classes of 4.2 are taken; the others stay with SO-11-A† |
| SO-1.11 | Reference project: the whole user journey as one integration gate | SO-1.01, SO-1.05, SO-1.06, SO-1.07, SO-1.08, SO-1.10 | SO-11-A†; SO-R-A to SO-R-D | the review says the fifteen steps are not in SO-11-A |
| SO-2.01 | Organisational knowledge model: relationships between people, teams, projects, decisions, artefacts and evidence | none | src/engine/vault.mjs, graph and retrieval modules; baseline 8.3; addendum 13.2; WP08-04, WP10-01, WP14-04 | no overlap; WP08-04 and WP14-04 consume the model and WP10 defines the status of a fact, not the model |
| SO-2.02 | Permission-aware knowledge access: retrieval governed by identity, project membership, classification, policy and jurisdiction | SO-2.01 | baseline 8.3; addendum 13.5; WP13-01, WP13-02 | WP13-01 is the publish boundary of a site; this is retrieval and action time and takes none of it |
| SO-2.03 | Provenance, retention and invalidation of organisational knowledge | SO-2.01 | baseline 8.3; addendum 13.5; WP10-01 to WP10-04 | WP10-01 and WP10-02 are the status lattice and origin fields; this takes retention, deletion, invalidation and derived-record provenance only |
| SO-2.04 | Cross-project intelligence: evidence-backed discovery across otherwise independent work | SO-2.01, SO-2.03 | baseline 8.3; addendum 13.6; WP08-04, WP14-04 | WP08-04 builds a prototype; this is the design record it consumes and builds nothing |
| SO-2.05 | Cross-functional issue discovery without unrestricted access to private records | SO-2.02, SO-2.04 | baseline 8.3; addendum 13.2 and 13.6; WP08-04, WP14-04 | the routing and access rules only; WP08-04 and WP14-04 build on it |
| SO-2.06 | Organisational intelligence acceptance: tests for false findings, leakage and lost provenance | SO-2.02, SO-2.03, SO-2.04, SO-2.05 | baseline 8.3; addendum 13.9; WP14-04 | WP14-04 names the demonstrators; this defines the acceptance tests of the organisational-intelligence one only |
| SO-2.07 | Specialist knowledge systems: import, export, references, provenance and ownership at the boundary | SO-2.02, SO-2.03 | baseline 8.4; docs/IMPORT.md and MEM-105 (import of history); WP18 | no overlap; the import of history from other applications is a different capability |
| SO-2.08 | Agent frameworks and runtimes: a provider-neutral task adapter and capability mapping | SO-1.04 | baseline 8.4; addendum 5; docs/CLIENTS.md; WP18-02 | WP18-02 is the first adapter; this is every other framework and runtime |
| SO-2.09 | Software delivery systems: other repository hosts and issue trackers | SO-1.06 | baseline 8.4; SO-O-B†, SO-O-C†; docs/CLIENTS.md; WP18 | GitHub stays with SO-O-B†; this is the others |
| SO-2.10 | Business communication systems: authorised event ingestion and task linkage | SO-1.06, SO-2.03 | baseline 8.4; WP18 | no overlap |
| SO-2.11 | Enterprise systems: explicit data contracts, least privilege, audit and retention | SO-1.06, SO-2.02, SO-2.03 | baseline 8.4; WP13-01, WP13-03; WP18 | no overlap; WP13 concerns sites of Memev, not enterprise systems |
| SO-2.12 | Federated computation behind the provider boundary | none | baseline 8.5 and 10; WO-05-A; WP09-02, WP12, WP13 | WP09-02, WP12 and WP13 are prerequisites and are not repeated; no overlap with a task of the programme decomposition |
| SO-2.13 | Commercial integration services that keep the open-core boundary neutral | none | baseline 8.6; addendum 10 and 13.7; WP15-01, WP15-02, WP16-07 | WP15 holds the licence boundary and WP16-07 the pricing dimensions; this is the service boundary only |
| SO-2.14 | Business deployment: multi-person project permissions and team administration | none | baseline 8.6; SR-5.02, SR-5.04, MEM-069; ADR 5; WP16-01 | SR-5.02, SR-5.04 and MEM-069 stay with their owners; WP16-01 decides tier names and takes none of this |
| SO-A-01 | Lead agent: assignment preferences and overrides in ordinary language | SO-1.01 | SO-02-A†; SO-03-A†; SO-05-A; SO-08-A; SO-C-A†; SO-L-A†; main at d1c65ef | build layer of SO-1.03; valid with fixes (build layer, see its provenance) |
| SO-A-02 | Default agent suitability analysis: capability requirements per task | SO-1.01 | SO-02-A†; SO-03-A†; SO-05-B†; SO-08-A; SO-L-A†; main at d1c65ef | build layer of SO-1.03; valid with fixes (build layer, see its provenance) |
| SO-A-03 | Requested | SO-1.01 | SO-04-A; SO-05-D†; SO-07-A; SO-08-A; SO-C-C†; main at d1c65ef | build layer of SO-1.04; valid with fixes (build layer, see its provenance) |
| SO-A-04 | Relationship model and change propagation: milestones | SO-1.01 | SO-02-A†; SO-05-C†; SO-05-D†; SO-07-A; SO-C-C†; main at d1c65ef | build layer of SO-1.07; valid with fixes (build layer, see its provenance) |
| SO-A-05 | Decision and blocker queue as a workflow: seven states | SO-A-04, SO-1.01 | SO-03-A†; SO-08-B†; SO-C-A†; SO-C-C†; SO-L-A†; main at d1c65ef | build layer of SO-1.08; valid with fixes (build layer, see its provenance) |
| SO-A-06 | Artifact registry: every material artifact linked to its requirement | SO-A-04, SO-1.01 | SO-02-B†; SO-05-C†; SO-05-D†; SO-C-C†; SO-O-A†; main at d1c65ef | build layer of SO-1.09; valid as the fold left it (build layer, see its provenance) |
| SO-A-07 | Connections and access: one table over the folder grants | SO-1.01 | MEM-145; SO-05-B†; SO-09-A†; SO-C-A†; SO-C-C†; SO-O-A†; SO-O-B†; main at d1c65ef | build layer of SO-1.06; valid with fixes (build layer, see its provenance) |
| SO-A-08 | Workspace | SO-A-01, SO-A-03, SO-A-04, SO-A-05, SO-A-06, SO-1.01 | SO-05-C†; SO-C-A†; SO-C-B†; SO-C-C†; main at d1c65ef | build layer of SO-1.05; valid with fixes (build layer, see its provenance) |
| SO-A-09 | Workspace | SO-A-04, SO-A-08 | SO-C-C†; main at d1c65ef | build layer of SO-1.05; valid as the fold left it (build layer, see its provenance) |
| SO-A-12 | Workspace | SO-A-06, SO-A-09 | SO-C-C†; main at d1c65ef | build layer of SO-1.05, SO-1.09; valid as the fold left it (build layer, see its provenance) |
| SO-A-10 | Fault injection and the reference journey: the failure matrix extended to F31 | SO-A-01, SO-A-02, SO-A-03, SO-A-06, SO-A-07, SO-A-08 | SO-09-A†; SO-11-A†; main at d1c65ef | build layer of SO-1.10, SO-1.11; valid as the fold left it (build layer, see its provenance) |
| SO-A-11 | Baseline reconciliation: a register check over the takeover record with implemented | none | SO-T-A; WO-05-A; WO-05-B; main at d1c65ef | build layer of SO-1.02; valid with fixes (build layer, see its provenance) |
| SO-W-08B | Recovery and control: disconnect recovery, restart reconstruction, pause, resume and cancel through memev work, idempotent bus delivery and memev work status | SO-1.01, SO-A-03 | SO-08-A; SO-05-B†; the vault set-work bundle; main at d1c65ef | repository text of the signed vault contract, unsigned (owner delegation, 1 Nov 2026); maps to PG-08.1 WP08-02 |
| SO-W-08C | Production callers for recovery and control, and the bus for the Coordinator | SO-W-08B, SO-1.01, SO-A-03 | pull request #361 follow-ups; main at d1c65ef | unsigned; written under owner delegation, 1 Nov 2026; maps to PG-08.1 WP08-02 |
| SO-R-E | Publish the versioned container image by a maintainer-run script after the Docker smoke passes: the registry account read from the environment or the origin remote | none | SO-R-B; WO-01-A; main at d1c65ef | build layer of none (WBS only); valid with fixes (build layer, see its provenance) |
| SO-F-01 | Identity and scopes model | none | MEM-134; MEM-145; MEM-146; SO-09-A†; main at d1c65ef | build layer of SO-2.02, SO-2.14; valid with fixes (build layer, see its provenance) |
| SO-F-02 | Canonical project schema | SO-F-01, SO-1.01 | SO-04-A; SO-07-A; WO-05-A; main at d1c65ef | build layer of SO-1.07, SO-2.01; valid with fixes (build layer, see its provenance) |
| SO-F-02.2 | Canonical project schema, with the coordinator reading the conflict view | SO-F-01, SO-1.01 | SO-04-A; SO-07-A; WO-05-A; main at d1c65ef | supersedes SO-F-02 (owner delegation, 1 Nov 2026); T2 follows pull request #354; build layer of SO-1.07, SO-2.01 |
| SO-F-03 | Contribution signature and two-step admission: a signed | SO-F-01, SO-F-02 | MEM-145; main at d1c65ef | build layer of SO-2.02, SO-2.03; valid with fixes (build layer, see its provenance) |
| SO-F-03.2 | Contribution signature and two-step admission, built after the operation envelope | SO-F-01, SO-F-02, PG-04.1 | MEM-145; main at d1c65ef | supersedes SO-F-03 (owner delegation, 1 Nov 2026); build layer of SO-2.02, SO-2.03 |
| SO-F-03.3 | Contribution signature and two-step admission, with the README line that states federation | SO-F-01, SO-F-02, PG-04.1 | MEM-145; main at d1c65ef | supersedes SO-F-03.2 (owner delegation, 1 Nov 2026); adds README.md to the scope of T1; build layer of SO-2.02, SO-2.03 |
| SO-F-03.4 | Contribution signature and two-step admission, with the replay mark per sender and scope and the log read again when it has moved | SO-F-01, SO-F-02, PG-04.1 | MEM-145; main at d1c65ef; pull request #358 | supersedes SO-F-03.3 (owner decision, 1 Nov 2026, and the red-team review of pull request #374); supersedes criterion 2 by name, carries the rest verbatim and adds ten (seven tests, AC14 to AC20, and three on the text), among them the own-append cursor rule and the fixed reason of external_failed; scope unchanged; unsigned, spec only; build layer of SO-2.02, SO-2.03 |
| SO-F-04 | Federation membership and policy exchange specification: the relationship record | SO-F-01, SO-F-03 | main at d1c65ef | build layer of SO-2.02, SO-2.14; valid with fixes (build layer, see its provenance) |
| SO-F-04A | Composition of the checks on the Admission external hook: one synchronous function that runs the relationship check, any local check and the service checks, a degraded answer honoured only from a service check and never admitting | SO-F-04, SO-F-03.4 | the open row 'Two users of the Admission external hook' of RECONCILIATION.md; pull request #368 | unsigned follow-up of SO-F-04, additive, spec only (1 Nov 2026); base is SO-F-04; owns composeExternal, which WP21-03 of PG-W-21B will cite; the order of the checks is provisional pending ADR 8; built after SO-F-03.4 and before SO-F-04B |
| SO-F-04B | One Admission per scope: an AdmissionSet that routes by scope and refuses a second Admission for a scope through a registry kept for the log | SO-F-04, SO-F-03.4 | the open row 'One scope per Admission' of RECONCILIATION.md; pull request #368 | unsigned follow-up of SO-F-04, additive, spec only (1 Nov 2026); base is SO-F-04; keeps no mark of its own, because the mark per sender and scope is SO-F-03.4's |
| SO-F-05 | Classification model: six replication classes on notes and entities | SO-F-02, SO-F-04 | main at d1c65ef | build layer of SO-2.02, SO-2.03; valid with fixes (build layer, see its provenance) |
| SO-F-04C | The relationship gate refuses a contribution unless the sending node is a party node of a relationship of the scope: the new fixed deny rule deny.not_a_party | SO-F-04 | pull request #368; the review of relationshipGate | unsigned follow-up of SO-F-04, additive, spec only (1 Nov 2026); the base is 2f24e94, the main commit that merged pull request #368; build layer of SO-2.02, SO-2.14 |
| SO-F-12 | Replication unit: per-scope operation-log streams carrying classification and causal context | SO-F-05, SO-F-03 | main at d1c65ef | build layer of SO-2.03; valid with fixes (build layer, see its provenance) |
| SO-F-06 | Structured-state convergence contract for the engine: input and output schemas per merge class validated in the single boundary | SO-F-02, SO-1.01 | MEM-131; WO-05-A; WO-05-B; main at d1c65ef | build layer of SO-2.01; valid with fixes (build layer, see its provenance) |
| SO-F-07 | Federated query and continuity specification: an authorised view with provenance and freshness | SO-F-04, SO-F-12 | main at d1c65ef | build layer of SO-2.02, SO-2.12; valid with fixes (build layer, see its provenance) |
| SO-F-08 | Admission adapter boundary: the admission service behind an adapter beside the merge boundary | SO-F-03 | WO-05-A; WO-05-D; main at d1c65ef | build layer of SO-2.13; valid with fixes (build layer, see its provenance) |
| SO-F-09 | Finding model for organisational intelligence: a finding is a graph claim capped at theory by evidence | SO-F-01, SO-F-02 | main at d1c65ef | build layer of SO-2.04, SO-2.01; valid with fixes (build layer, see its provenance) |
| SO-F-09.2 | Finding model, with four accepted definitions written in and pinned | SO-F-01, SO-F-02 | main at d1c65ef | supersedes SO-F-09 (owner delegation, 1 Nov 2026); adds src/engine/identity.mjs to the scope; who may adjudicate, verify and dismiss is provisional until ADR 5 and SO-A-05 (dismiss: person and operator only); build layer of SO-2.04, SO-2.01 |
| SO-F-13 | Cross-functional conflict detection on a bounded programme: the seeded two-plan conflict detected | SO-F-09, SO-A-05 | main at d1c65ef | build layer of SO-2.05, SO-2.06; valid as the fold left it (build layer, see its provenance) |
| SO-F-10 | Federated computation specification as an interface reservation: the work specification and receipt schemas | SO-F-03, SO-F-04 | main at d1c65ef | build layer of SO-2.12; valid with fixes (build layer, see its provenance) |

### 9.1 Overlap with the programme decomposition

The programme decomposition (docs/scope-one/programme/ on branch docs/engine-decision-tiers-reconcile, 82 tasks in 18 work packages, proposed and unsigned) was read on 31 October 2026 against the contracts of this page. Where the two touch, the contract here is the design record and the task there is the build, unless the table says otherwise. The branch is not on main, so the task ids below are not checked by a test.

| Contract | Programme task | Overlap | Disposition |
| --- | --- | --- | --- |
| SO-1.01 | WP07-01 to WP07-04 | wiring of the store, state machine and coordinator; branch feat/wire-project-engine cites SO-1.01 | the same work: SO-1.01 is the decision record and the branch builds it; the owner confirms that one is not signed twice |
| SO-1.02 | WP08-01, WP17-01, WP17-02 | refresh of the register and the inventory and a disposition of every open pull request and branch | the same work: this page and sections 6 and 7 are that refresh and ledger; the tasks there should consume them, not repeat them |
| SO-1.04 | WP08-02 | a provider-neutral execution adapter contract | SO-1.04 adds the four-way event distinction; WP08-02 is the adapter contract itself; to be sequenced, not merged |
| SO-1.10, SO-1.11 | WP08-03 | a lifecycle test from intake to delivery | SO-1.11 is the fifteen-step reference project and WP08-03 is a lifecycle test; one of the two should own the gate |
| SO-1.07 | WP10-04 | which version of a decision was authoritative at the time | the relationship model and staleness of SO-1.07 take no as-of query; no overlap found |
| SO-2.01 to SO-2.06 | WP08-04, WP14-04, WP10-01 to WP10-04, WP13-01, WP13-02 | organisational intelligence prototype and demonstrator; knowledge status; sharing classes and disclosure | each SO-2 request states what it takes and what it leaves; the prototype and the demonstrator consume the records |
| SO-2.08 | WP18-02 | the first framework adapter | WP18-02 is the first instance; SO-2.08 is every other framework and runtime |
| SO-2.12 | WP09-02, WP12-01 to WP12-03, WP13-03 | contribution admission, transport and sites | prerequisites of federated computation, not repeated |
| SO-2.13 | WP15-01, WP15-02, WP16-07 | licence boundary and pricing dimensions | SO-2.13 is the service boundary only |
| SO-2.14 | WP16-01 | tier names | WP16-01 decides names and takes none of the permissions and administration |

Rows of section 5 owned by the programme decomposition are marked covered with its task id. They stay covered only while the owner accepts that decomposition; a task there is not a signed contract.

Ids with a dagger that this page cites and that cannot be checked here: D-SO-MEMORY-AUTHORITY, SO-02-A, SO-02-B, SO-03-A, SO-05-B, SO-05-C, SO-05-D, SO-08-B, SO-09-A, SO-11-A, SO-C-A, SO-C-C, SO-L-A, SO-MEMORY-AUTHORITY, SO-O-A, SO-O-B, SO-O-C, SO-R-C. They are exactly the ones the review table names.

### 9.2 The build layer against the programme decomposition

The build layer (SO-A-01 to SO-A-12, SO-R-E, SO-F-01 to SO-F-13) was read against the programme specs of PR #325 (contracts/programme/specs, PG-01.1 to PG-18.1). Where the two touch, one owns the thing and the other cites it; neither copies the other.

| Contract | Programme task | Overlap | Disposition |
| --- | --- | --- | --- |
| SO-F-01 | WP09-01, WP13-03 | subjects, delegation, revocation, node identity and membership per site | SO-F-01 owns the subject and scope model and the resolution at the request boundary; WP09-01 builds admission on it and WP13-03 reuses it; both should cite SO-F-01 |
| SO-F-02 | WP05-01, WP05-04 | merge semantics per object class | WP05-01 owns the semantics table and its rationale; SO-F-02 owns the declaration on each entity type and its enforcement in the store; the class names must equal the table |
| SO-F-03 | WP04-01 to WP04-04, WP09-01, WP09-03 | the operation envelope and admission | PG-04.1 owns the one envelope; SO-F-03 adds only the signature and admission block, the per-sender sequence and the rejected event; test/envelope.test.mjs is PG-04.1 and is not used here; SO-F-03.2 supersedes SO-F-03, is built after WP04-01 and WP04-02, and names the envelope specification, implementation and tests in its scope so a reviewer reads them |
| SO-F-04 | WP13-03, WP13-05 | membership and trust domains | SO-F-04 is the two-party relationship record and policy exchange; WP13-03 owns membership inside a site and reads the record |
| SO-F-05 | WP13-01 | sharing classes | SO-F-05 owns the six-class classification and inheritance by derived data; WP13-01 enforces at the publish boundary using these classes |
| SO-F-06 | WP05-04, WP05-06, WP01-07 | state mapping, round trip and gossip boundary | those map and exercise state; SO-F-06 validates the payload at the one boundary src/engine/merge.mjs |
| SO-F-07 | WP13-04, WP12-01 | offline operation, transport | SO-F-07 is the read side (authorised view, last-known label); WP13-04 owns reconcile on reconnect; WP12-01 owns transport |
| SO-F-08 | WP09-02 | the trust adapter boundary | WP09-02 owns the trust adapter; SO-F-08 owns the admission adapter and the rule that the admission path reads trust only as an eligibility input |
| SO-F-09 | WP10-01, WP10-02 | knowledge status | WP10-01 owns the status lattice; SO-F-09 defines a finding and its cap and maps the cap into the lattice once it lands |
| SO-F-12 | WP04-03, WP06-01 to WP06-03, WP12-01 | stream record, acceptance, transport | the stream record is the PG-04.1 envelope with scope and classification; acceptance is WP06; transport is WP12-01 and is not built by SO-F-12 |
| SO-A-03 | WP06-01 | the word accepted | dispatch.accepted is a dispatch event; the acceptance state of WP06-01 is for replicated operations; the two vocabularies stay apart |
| SO-A-10 | WP08-03 | a lifecycle test from intake to delivery | as for SO-1.11 in 9.1: one of the two should own the gate; SO-A-10 is the reference journey with two stub sessions |
| SO-A-11 | WP08-01, WP17-01, WP17-02, PGP-1.03 | register and inventory refresh | PGP-1.03 writes the reconciliation pages by hand; SO-A-11 adds the script that checks them |
| SO-R-E | SR-6.03 | publishing the image | SR-6.03 owns the automated publish from the release workflow; SO-R-E is the maintainer-run script for the first public image and does not touch the workflow |

### 9.3 Dropped from the fold

SO-F-11 (architecture invariants as guards) is dropped: the pages it edits are not on main and the SO-06-A guard tests it maps to are not in this repository. Its two new guards are absorbed where they have something to guard: the federation import guard into SO-F-03 and the planned-label rule into the status checks of SO-F-03, SO-F-04, SO-F-07 and SO-F-10; the no-dispatch-command guard into SO-F-10.
