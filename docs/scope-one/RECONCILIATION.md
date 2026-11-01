# Scope One reconciliation: programme decomposition against the Scope One work breakdown

Part of the [documentation index](../README.md). Related: [DECISIONS.md](DECISIONS.md), [INVENTORY.md](INVENTORY.md), [programme decomposition](programme/README.md).

Dated 31 October 2026, against main at `4823064`, which includes the Scope One work breakdown (`WBS.md` in `docs/scope-one`, with `SO-1.01` to `SO-1.11` and its test `wbs.test.mjs`) from pull request #324. This page refers to that work breakdown and to `SO-1.02` (the reconciliation contract) instead of restating them; leaf numbers below are the numbers in `WBS.md`. It does not edit `WBS.md`, any `SO-1.x` contract, any signature or any red-team record: those are owned by the signing process and the Scope One record, not by this page.

## Headline

The programme decomposition has 81 requirements (`MV-*`) and 82 tasks in 18 work packages ([programme/REQUIREMENTS.md](programme/REQUIREMENTS.md), [programme/WBS.md](programme/WBS.md)). Each requirement is compared with the 276 leaves of the Scope One work breakdown. Programme work that `SO-1.01` to `SO-1.11` already covers is not re-specified: the mapping is in the [programme contract manifest](../../contracts/programme/manifest.json).

| | Same | Missing | Conflicting | Total |
| --- | --- | --- | --- | --- |
| Requirements | 34 | 43 | 4 | 81 |
| Programme tasks | 30 | 49 | 3 | 82 |

- **Same:** a leaf of the Scope One work breakdown already owns the requirement. The programme keeps that owner and adds no duplicate contract (`MV-PGM-05`).
- **Missing:** no leaf of the Scope One work breakdown owns it. These are the programme's own additions. Most are in the crdt-merge repository (`WP01` to `WP03`), which the Scope One work breakdown does not cover, and in recall, the replicated event model, federation demonstrators and positioning.
- **Conflicting:** the work breakdown or the programme holds a position that the owner decisions of 31 October 2026 supersede. There are four requirements and three tasks (listed below). None is resolved by editing the work breakdown.

A task takes the strongest class of the requirements it serves: conflicting, then missing, then same only if every requirement it serves is the same. The classification is the author's reading, requirement by requirement, with the leaf cited in the last column; a reviewer should confirm it.

### Conflicting

| Item | Where | Resolution |
| --- | --- | --- |
| `MV-ARCH-02`, `MV-PGM-07`, task `WP05-02` | The work breakdown holds SR-3.01 (2.4.1) as covered and the branch `dev-integration-specs` with PI-04 and PI-05 (7.1) as covered. SR-3.03 is named as absent from the manifest (1.2.4) | Superseded by the owner decision of 31 October 2026 ([DECISIONS.md](DECISIONS.md), ADR 6): crdt-merge stays in its own repository, reached only across the call-out boundary (WO-05-A). PI-04, PI-05, SR-3.01 and SR-3.03 are superseded. The work breakdown's own note ("Reported, not confirmed", under 1.3) is the pending confirmation |
| `MV-PRD-04`, task `WP16-01` | 1.3.5 closes the tier set with no Federated tier | The programme draft asked for a distinct Federated tier. Not adopted: the owner decision names the free core, Personal, and contact us. No Federated tier |
| `MV-PRD-05`, task `WP16-07` | 1.3.5 and 4.3.1 fix Personal at up to 3 computers | The programme draft prices by nodes and trust domains, not computers. Not adopted for Personal; anything above Personal is contact us |

## What the work breakdown holds that the programme does not restate

- Section 3 of the work breakdown has 98 leaves, one per Scope One requirement (`SO-REQ-001` to `SO-REQ-098`). The programme covers Scope One in six requirements (`MV-S1-01` to `MV-S1-06`) and points at those leaves rather than copying them.
- Section 2 has 57 seed-readiness contracts. The programme's overlap table names eight of them (SR-1.15, SR-2.01, SR-3.01, SR-3.03, SR-3.05, SR-3.06, SR-6.07, SR-6.10). Four of those (SR-3.03, SR-3.06, SR-6.07, SR-6.10) are not in the manifest and so are not leaves of the work breakdown.
- Sections 6 to 8 (pull requests, branches, merged foundations) are mirrored here by [INVENTORY.md](INVENTORY.md), refreshed to the live `gh pr list` state.
- 45 leaves are blocked on owner decisions. None is decided here.

## Boundaries with the Scope One contracts

[WBS.md](WBS.md) section 9.1 records where the programme tasks touch `SO-1.01` to `SO-2.14`; this page applies that table and does not restate it. In short: where a Scope One contract is the design record, the programme spec keeps only the build and test criteria the record does not hold.

- `WP07-01` to `WP07-04` stay with the wiring pull request, which cites `SO-1.01` and does not replace it. `WP08-01`, `WP17-01` and `WP17-02` are `SO-1.02` and `WBS.md`; `WP08-02` and `WP08-03` have one programme spec, `PG-08.1`, which cites `SO-1.04`, `SO-1.10`, `SO-1.11` and the signed `SO-11-A` and specifies only the build gaps those leave open. `WP08-01`, `WP17-01` and `WP17-02` have no programme spec.
- `SO-2.03` keeps retention, deletion and invalidation; `WP10-01` and `WP10-02` keep the status lattice. `SO-2.02` keeps retrieval-time access; `WP13-01` keeps the publish boundary. `SO-2.04` and `SO-2.05` feed `WP08-04` and `WP14-04`; `SO-2.06` holds the acceptance tests of the organisational-intelligence demonstrator. `SO-2.08` treats `WP18-02` as its first instance. `SO-2.13` leaves the licence boundary to `WP15` and the pricing dimensions to the tier decision.
- `SO-2.07` to `SO-2.11` require canonical operation contracts at their adapter layers; the `WP04` envelope is that contract and no programme spec defines an adapter for those systems.
- No clash was found that needs a change to a Scope One file.

## Claim register

Who writes which task, so that two authors do not write the same one. Claims are anonymous ids: Claim A is the Scope One baseline and the signing of contracts, Claim B the programme specs and their work pull requests, Claim C the crdt-merge conformance work and the Scope One decision records, Claim D the seed-readiness and quality-loop follow-ups, Claim E the Scope One build-layer contracts of the fold (`SO-A-xx`). A status is as of the date above.

| Task id | Claim | Branch or pull request | Status |
| --- | --- | --- | --- |
| Scope One `WBS.md`, `wbs.test.mjs` | Claim A | memev #324, branch `wbs` | merged |
| `SO-1.01` to `SO-1.11` contracts | Claim A | memev #324 | merged, signed |
| Contract signing and re-signing (all repositories) | Claim A | `scripts/gate/redteam-gate.mjs` in memev; #319 to #323 merged | in progress |
| Red-team records | Claim A | `contracts/**/redteam/` | in progress |
| `WP01-01` to `WP01-05` (crdt-merge correctness) | Claim B | crdt-merge, branch `fix/crdt-correctness-four-bugs` #180 | merged to crdt-merge main through #181 as `252c93e6` (includes #179 and #180) |
| `WP07-01` to `WP07-04`, `WP15-01` (memev wiring, single-authority guard and licence guard; implements `SO-1.01`) | Claim B | memev, branch `feat/wire-project-engine` #326 | in progress |
| `WP17-05`, `WP16-03` and `WP15-02` for memev (this reconciliation, tiers, README, decisions) | Claim B | memev, branch `docs/engine-decision-tiers-reconcile` #325 | merged (squash 5b28be9) |
| `WP16-02` (converge README) | Claim B | converge, branch `docs/fair-mem0-comparison` #1 | open |
| `WP16-03` (site plans) | Claim B | memev-site, branch `fix/plans-match-tier-decision` #1 | open |
| `WP05-02`, `WP15-02` for memev-ops (SR-3.01 and SR-3.03 superseded, SR-3.05) | Claim B | memev-ops, branch `docs/engine-decision-sr3` #13 | open |
| Programme contract specs (`contracts/programme`, one per work package and one per work pull request) | Claim B | memev, same branch as the row above #325 | merged with the row above (squash 5b28be9); unsigned; signing under Claim A |
| Baseline 8.1 (dashboard and command centre, lead-agent single authority, release and installation readiness, failure-path suite, ADR 4 and ADR 5 drafts) | Claim A | `SO-1.x` contracts and `WBS.md` | agreed split |
| Baseline 8.2 (intake to end-to-end demo, extending `SO-1.x`), with `WP08-01` to `WP08-03` | Claim A | `SO-1.02` (`WP08-01`, `WP17-01`, `WP17-02`), `SO-1.04` (`WP08-02`), `SO-1.10` and `SO-1.11` (`WP08-03`) | agreed split; `PG-08.1` (programme) holds the build gaps of `WP08-02` and `WP08-03` only, trimmed against `SO-A-03` and `SO-A-10` |
| Baseline 8.3 (organisational intelligence, WBS 5.3.x and 4.3.2), with `WP08-04` | Claim A (baseline scope); Claim C (decision records `SO-2.01` to `SO-2.06`, branches `feat/so-2-0X-<slug>`, active) | `SO-2.01` to `SO-2.06` | agreed split; no programme spec |
| Baseline 8.4 except A2A, SDK and payments (WBS 5.4.4 to 5.4.8 and the non-GitHub parts of 5.4.6), 5.5.11 federated computation, 5.6.5 commercial integration services | Claim A | `SO-2.07` to `SO-2.13` | agreed split |
| Baseline 8.6 personal multi-device, business deployment, enterprise deployment, public distribution and external security assurance, with `WP16-04` | Claim A | `SO-2.14` and `WBS.md` | agreed split; no programme spec |
| `WP11-01` to `WP11-06`, `WP17-03`, `WP17-04`, `WP17-06` | Claim A | `SO-1.02` and `WBS.md` | no programme spec |
| Baseline 8.4 A2A (`WP18-01`), SDK and framework adapter (`WP18-02`), payments (`WP18-04`); 8.5 (`WP01` to `WP06`, `WP09`, `WP10`, `WP12` to `WP14`); 8.6 licensing (`WP15`), tiers and claims (`WP16`), conformance tests (`WP18-03`) | Claim B | `contracts/programme` | specs proposed, work unclaimed; except the rows below for `PG-02.1`, `PG-03.1`, `PG-03.4`, `PG-03.5`, `PG-06.2` and `PG-12.2` |
| `PG-02.1` (CRDT conformance gate; `WP02-01` to `WP02-04`) | Claim C | crdt-merge, branch `feat/pg-02-1-crdt-conformance-gate` | queued after `SO-2.01` to `SO-2.06` |
| `PG-05.2` (merge semantics: docs/MERGE-SEMANTICS.md, state map and round-trip test, built in pull request #364 at 8390745; trimmed `WP05-01` to `WP05-04` and `WP05-06`; `WP05-05` stays with `WO-05-B`, draft pull request #201; supersedes the signed `PG-05.1`) | Claim D | branch `feat/pg-05-1-merge-semantics`, pull request #364 | claimed; proposed, unsigned |
| `PG-05.1` (signed as `k-pg-05-1-engine-integrati-8d9e24`; files unchanged) | superseded | none | superseded by `PG-05.2` (owner delegation, 1 Nov 2026; reason: pull request #364 changes `docs/CONVERGENCE.md` (a link only), `docs/MODULES.md` and `changelog.d/PG-05.1.md`, which `PG-05.1` does not list in a scope; `PG-05.2` adds those three paths, to `WP05-01` and `WP05-04`, and changes no criterion); the manifest records `superseded_by`; the claim moved to `PG-05.2` |
| `SO-08-B` (recovery and control, `WP08-02`; a signed vault contract, cited by id; repository text in `SO-08-B`) | Claim E | branch `feat/recovery-and-control`, pull request #361 (draft), stacked on #350 | claimed |
| `SO-08-C` (production callers: `recover`, `reconstruct`, `eligibilityPass` and `applyBusMessage` called from the vault, the MCP server and the daemon, and the Coordinator given the bus in `src/engine/vault.mjs`; `WP08-02`; not `SO-08-B`) | Claim E | none yet; stacked on pull request #361, which is stacked on #350 | claimed; proposed, unsigned |
| `PG-19.2` (the work command wired to `runWork` in `src/cli/main.mjs`, with a production `openStore` port that reaches project state through one read-only vault method; `WP19-01` to `WP19-03`; supersedes the signed `PG-19.1`; not `SO-08-B`) | Claim E | none yet; stacked on pull request #361 and reusing its `work` case in `src/cli/main.mjs` | claimed; proposed, unsigned |
| `PG-19.1` (signed 1 Nov 2026; files unchanged) | superseded | none | superseded by `PG-19.2` (owner delegation, 1 Nov 2026; reason: `PG-19.1` says the port returns the real project store, which requirement 3 of `SO-1.01` forbids, so `PG-19.2` goes through one read-only vault method, `Vault#tasksReader`, whose frozen reader has one member, `snapshot`, that returns copies); the manifest records `superseded_by` and `supersedes`; the claim moved to `PG-19.2` |
| `PG-20.1` (the scope verifier allows a spec's own change note, `changelog.d/<id>.md` and its base-id name, and nothing else; `WP20-01`; starts once pull request #347 merges, because the verifier exists only there) | unclaimed | none | open, unclaimed; proposed, unsigned |
| `PG-03.1` (vectors, crdt-merge); one pull request | Claim C | branch `feat/pg-03-1-*` | queued after `SO-2.01` to `SO-2.06` |
| `PG-03.4` (crdt-merge-ts; supersedes the signed `PG-03.2`) and `PG-03.6` (crdt-merge-rs; supersedes `PG-03.5`, which superseded the signed `PG-03.3`); one pull request per package; depend on `PG-03.1` | Claim C | branches `feat/pg-03-4-*`, `feat/pg-03-5-*` (the branch name of the crdt-merge-rs pull request is unchanged) | active |
| `SO-F-01` (identity and scopes model, version 1; a signed fold contract of pull request #341) | Claim C | branch `feat/so-f-01-identity-and-scopes` | claimed |
| `WP04-03` (adapters: the oplog record, the bus message and the project-store events convert to and from the envelope; in `PG-04.3`) | Claim D | branch `feat/pg-04-1-envelope-adapters`, pull request #366 (draft), stacked on #357 (draft until #357 merges) | claimed |
| `WP04-04` (op-log wiring: the envelope reachable from the oplog append path, `src/engine/oplog.mjs`; in `PG-04.3`) | Claim D | branch `feat/pg-04-1-envelope-adapters`, pull request #366 (draft), stacked on #357 (draft until #357 merges) | claimed |
| `PG-04.1` (signed as `k-pg-04-1-canonical-operat-b77c7c`; files unchanged) | superseded | none | superseded by `PG-04.2` (owner delegation, 1 Nov 2026; reason: pull request #357 must map src/engine/envelope.mjs into `docs/MODULES.md`, which `PG-04.1` does not list in the scope of `WP04-02`; `PG-04.2` adds that one path and changes nothing else); the manifest records `superseded_by`; `WP04-01` and `WP04-02` are built in pull request #357 and are not in this register |
| `PG-04.2` (proposed 1 Nov 2026; files unchanged) | superseded | none | superseded by `PG-04.3` (owner delegation, 1 Nov 2026; reason: pull request #366 changes docs/MODULES.md for `WP04-03` and `WP04-04`, which `PG-04.2` lists only for `WP04-02`; `PG-04.3` adds that one path to those two tasks and changes nothing else); the manifest records `superseded_by` and `supersedes`; the `WP04-03` and `WP04-04` claims moved to `PG-04.3` |
| `SO-F-02` (signed as `k-so-f-02-canonical-projec-38d008`; files unchanged) | superseded | none | superseded by `SO-F-02.2` (owner delegation, 1 Nov 2026; reason: it keeps T1 and adds T2, the coordinator reading `store.view('task')`); the manifest records `superseded_by` and `supersedes`; no claim on `SO-F-02` was in the register, so none moved |
| `SO-F-02.2` task T2 (the coordinator's read side reads `store.view('task')`, so a task with unresolved approve and reject approvals cannot be claimed; follow-up to pull request #354, which builds T1) | Claim C | none yet; starts once pull request #354 merges | claimed |
| `SO-A-03` (the four execution event kinds; a signed fold contract of pull request #341) | Claim E | branch `feat/so-a-03-*` (none pushed yet) | claimed |
| `SO-A-04` (relationship model and change propagation; a signed fold contract of pull request #341) | Claim E | branch `feat/so-a-04-*` (none pushed yet) | claimed |
| `PG-03.2` and `PG-03.3` (signed; files unchanged) | superseded | none | superseded by `PG-03.4` and, through `PG-03.5`, `PG-03.6` (signer's decision, 1 Nov 2026; reason: the editions lack the features the vectors need, so the signed scope cannot be met); the manifest records `superseded_by` |
| `PG-03.5` (crdt-merge-rs; the file is unchanged, specSha256 `8b748b0e38f3efe054c03a600845d83746e5874c87a384711356ec96746ebd56`) | superseded | none | superseded by `PG-03.6` (owner delegation, 1 Nov 2026; reason: `PG-03.5` hard-pins crdt-merge commit `b92d0ef` in `tests/vectors/SOURCE`, and crdt-merge main is now `aab0099` with byte-identical vectors, so an edition pinned at `aab0099` would fail it); the manifest records `superseded_by` |
| `PG-12.2` (multi-node gossip transport; `WP12-01` to `WP12-03`; supersedes the signed `PG-12.1`) | unclaimed | none | open, unclaimed |
| `PG-06.2` (replication separate from acceptance; `WP06-01` to `WP06-03`; supersedes the signed `PG-06.1`) | unclaimed | none | open, unclaimed |
| `PG-06.1` and `PG-12.1` (signed; files unchanged) | superseded | none | superseded by `PG-06.2` and `PG-12.2` (signer's decision, 1 Nov 2026; reason: the owner's no-duplication rule and the owner delegation of 1 Nov 2026, under which the fold is the build layer); the manifest records `superseded_by` |
| Which layer to build against: the fold or the programme specs `PG-04.1`, `PG-05.1`, `PG-08.1`, `PG-09.1`, `PG-10.1`, `PG-13.1`, `PG-14.1` | Owner (delegated) | decided: the fold is the build layer (owner delegation, 1 Nov 2026); the overlapping tasks cite their fold id and keep only the gaps | trimmed; `PG-06.1` and `PG-12.1` were signed and are superseded by `PG-06.2` and `PG-12.2` (signer's decision, 1 Nov 2026), which are trimmed |
| Upgrade, rollback, backup and restore, and uninstall (work breakdown 5.1.3, requirements 70 and 96) | signed vault contract `SO-R-C` | cited by id, no programme task | covered by the vault contract |
| `SR-6.03` installers and public release | signed vault contracts `WO-02-A` and `MEM-015` | cited by id, no programme task | covered by the vault contracts |
| `SR-0.03` tasks 1, 3 and 4 (one pull request) | Claim D | branch `feat/sr-0-03-tasks-1-3-4` | active |
| `SR-0.03` task 2 (the scope verifier, 16 criteria) | Claim D | branch `feat/sr-0-03-task-2-scope-verifier`, stacked on #336 | claimed |
| `SR-0.03` version 2 (signed as `k-sr-0-03-verify-runs-ever-2259f2`; files unchanged) | superseded | none | superseded by `SR-0.03.3` (version 3, in `contracts/programme/specs`; owner delegation, 1 Nov 2026); the spec pins the base `3989c80bea615381947758e0ab1d28dfe18f115b` on T1 criterion 7 (the memev main commit that merged pull request #343, which carried the README re-sign fix; owner delegation, 1 Nov 2026); the manifest records `superseded_by` |
| `QL-1.01` task 2 (the red-team gate, linked to #314) | Claim D | branch `feat/ql-1-01-task-2` | queued after `SR-0.03` |
| `SO-F-03` (signed as `k-so-f-03-contribution-sig-2ba083`, version 2; files unchanged) | superseded | none | superseded by `SO-F-03.2` (owner delegation, 1 Nov 2026; reason: it builds on the operation envelope of `PG-04.1`, which is built first); no claim on `SO-F-03` existed, so none moved, and `SO-F-03.2` is unclaimed; the manifest records `superseded_by` and `supersedes` |
| `SO-F-03.2` (signed as `k-so-f-03-2-contribution-s-bc1be8`, merged by pull request #355; files unchanged) | superseded | none | superseded by `SO-F-03.3` (owner delegation, 1 Nov 2026; reason: commit cfcc2db of pull request #358 fixes the stale line at README.md:195 and that line stays, so `SO-F-03.3` adds README.md to the scope of T1 and changes no criterion); the manifest records `superseded_by` and `supersedes`; `SO-F-03.3` is unclaimed |
| `SO-F-09` (signed as `k-so-f-09-finding-model-fo-cbe213`, version 2; files unchanged; built in pull request #362 at fe3d7f3, stacked on #349) | superseded | none | superseded by `SO-F-09.2` (owner delegation, 1 Nov 2026; reason: four accepted definitions are written in and pinned (stub session, who may write a verification record, `by` from the resolved credential, strict withholding), and who may adjudicate, verify and dismiss and the confirm and reject outcomes are marked provisional until ADR 5 and `SO-A-05`, with dismissal limited to person and operator subjects; the scope adds only src/engine/identity.mjs, because the signed scope already lists `changelog.d/SO-F-09.md` and `docs/MODULES.md`); the manifest records `superseded_by` and `supersedes`; no claim on `SO-F-09` was in the register, so none moved |
| Every other `WP*` task (the work itself) | unclaimed | none | not started |

## Signed vault contracts, cited by id

The owner vault holds signed contracts that already cover some programme work. They are cited by id only: no vault contract file or text is copied into this repository, because a copy would carry a second, unverifiable signature. Where a signed contract covers a task, the programme spec cites it and does not repeat the criterion.

| Vault contract | What it covers | Used by |
| --- | --- | --- |
| `SO-05-A` | typed project and task tools on the existing MCP handler, identical over stdio and HTTP, scoped by token and seat | PGP-1.02 (WP07-01 to WP07-04) and SO-1.01 |
| `SO-06-A` | architecture guards: project modules persist only through the store, nothing else constructs the store or coordinator, no project module imports the merge engine | PGP-1.02 T1 and T3 |
| `WO-05-A` | the external-engine call boundary | foundation of PG-05.1 and of every spec that names the call-out boundary |
| `WO-05-B` | the paid-engine client behind a flag, off by default (build in draft PR #201, still open) | WP05-05, dropped from PG-05.1; PG-05.1 and WP05-06 cite it |
| `WO-05-C` | the external convergence service specification | foundation of PG-05.1 |
| `WO-05-D` | the external trust service specification | PG-09.1 and PG-09.2 place their adapters on its boundary |
| `WO-05-E` | the licence boundary text guard: the two licence pages agree and name the engine licence | PG-15.1, PGP-1.03 and PGP-1.06 (SR-3.05 states the licences once) |
| `MEM-145, MEM-146, MEM-147` | human binding of agent roles (bind, verify, setup, roles listing) | foundation of WP09-01 (PG-09.1) |
| `SO-05-B` | per-client capability records and an honest connection state | WP18-02 (PG-18.1) and SO-1.04 |
| `SO-09-A` | authorisation matrix at every entry point | boundary of PG-13.1 with SO-2.02 |
| `SO-11-A` | end-to-end acceptance of the delivery loop with two stub sessions, the failure matrix and the sixteen acceptance criteria | WP08-03 (PG-08.1), with SO-1.10 and SO-1.11 |
| `SO-08-B` | recovery and control: disconnect recovery, restart reconstruction, pause, resume and cancel, with cancellation read from the adapter capability record | WP08-02 (PG-08.1) |
| `SO-R-C` | upgrade, rollback, backup and restore, and uninstall paths, tested and documented | owner of WBS 5.1.3 and requirements 70 and 96 (SO-REQ-070, SO-REQ-096), which the work breakdown marks as having no owner; no programme task covers it |
| `WO-02-A, MEM-015` | the published one-line install and the public release | SR-6.03; no programme task touches it, and any spec that does cites these |
| `SO-14-A` | evidence class and checked date on public claims pages | PG-16.1 |
| `MEM-064, MEM-065, MEM-066, MEM-137, REV-032` | price, tier-name and plan wording; the price and tier values they carry are superseded by the owner decision of 31 Oct 2026 | PGP-1.03, PGP-1.05 and PG-16.1 |

`WP05-05` (the paid-engine client, draft pull request #201) is owned by `WO-05-B` and is dropped from `PG-05.1`. Upgrade, rollback, backup and restore, and uninstall (requirements 70 and 96 of the work breakdown, which marks them as having no owner) are owned by `SO-R-C`; no programme task covers them.

## Decisions on layers and authority

| Decision | Question | Overlaps | Status |
| --- | --- | --- | --- |
| Layer to build against | The fold (`SO-A-01` to `SO-A-12`, `SO-R-E`, `SO-F-01` to `SO-F-13` except `SO-F-11`, which was dropped; 25 signed contracts, cited by id only) or the programme specs | `PG-04.1`: `SO-F-03`, `SO-F-12`; `PG-05.1`: `SO-F-02`, `SO-F-06`; `PG-08.1`: `SO-A-03`, `SO-A-10`; `PG-09.1`: `SO-F-01`, `SO-F-03`, `SO-F-08`; `PG-10.1`: `SO-F-09`; `PG-13.1`: `SO-F-01`, `SO-F-04`, `SO-F-05`, `SO-F-07`; `PG-14.1`: `SO-F-13`; `PG-06.2`: `SO-A-03`, `SO-F-12`; `PG-12.2`: `SO-F-07`, `SO-F-12`; superseded, signed files not edited: `PG-06.1` by `PG-06.2`; `PG-12.1` by `PG-12.2` | DECIDED: the fold is the build layer (owner delegation, 1 Nov 2026). Each overlapping programme task cites its fold id and keeps only what the fold does not cover (table below). `PG-06.1` and `PG-12.1` were signed and overlap the fold; the signer superseded them with `PG-06.2` and `PG-12.2` (1 Nov 2026), which cite the fold ids and keep only the gaps; the signed files are unchanged. |
| Wiring of the work command | Which spec covers dispatching `memev work` to `runWork` in `src/cli/main.mjs` and a production `openStore` for `runWork`? | `SO-A-03` (defines `runWork`), `SO-A-01` (lists `src/cli/main.mjs` in scope for `memev work prefer` only), `SO-08-B` (recovery and control; not this gap) | decided: no existing spec covers it; the new spec `PG-19.1` does (owner delegation, 1 Nov 2026); `PG-19.1` is superseded by `PG-19.2`, which keeps its criteria and routes `openStore` through one read-only vault method, because requirement 3 of `SO-1.01` lets only the vault, the coordinator and the project store reach the store |
| Default scope paths | `docs/MODULES.md` and `changelog.d/<id>.md` land outside the scope of almost every feature pull request (`SR-0.03.3`, `PG-04.1`, `SO-08-B`, `PG-19.1`, `PG-05.1`). Which change fixes it once? | the scope verifier of `SR-0.03.3` (T2, pull request #347); `PG-05.2`, `PG-04.2` | PROPOSED: `PG-20.1` adds one rule to the scope verifier (the contract's own note `changelog.d/<id>.md` and its base-id name are in scope; nothing else); `docs/MODULES.md` is already in scope there when the generator reproduces it. A default in a spec template needs a template the repository does not have; the redteam gate only reads scope for staleness. Pending the signer |
| Memory and project-state authority | Is the vault the only authority (local-first, no second database)? | all `SO-1.x`, `SO-2.x` and programme specs | PROPOSED, pending owner confirmation: recorded as ADR 7 in [DECISIONS.md](DECISIONS.md); the owner decision of 31 Oct 2026 (local-first, the cloud only a relay and a backup) is the only part decided |
| Operation envelope before contribution signature | Does `SO-F-03` build on the operation envelope that `PG-04.1` specifies, and in what order? | `PG-04.1` `WP04-01` and `WP04-02`; `SO-F-03` | DECIDED: build `PG-04.1` `WP04-01` and `WP04-02` first, then `SO-F-03` (owner delegation, 1 Nov 2026). The signed `SO-F-03` is superseded by `SO-F-03.2` (file unchanged), which adds `PG-04.1` as a predecessor beside `SO-F-01` and `SO-F-02` and names docs/OPERATION-ENVELOPE.md, src/engine/envelope.mjs and test/envelope.test.mjs (not yet written) in its scope, so a reviewer reads them; every other criterion is kept. |

## Fold overlaps by task

The fold is the build layer ([WBS.md](WBS.md) section 9.2 on its branch lists the same overlaps; the fold ids are cited by id only). A trimmed task cites the fold id, drops what the fold owns and keeps the gap. `PG-09.2`, `PG-15.1` and `PG-16.1` have no fold overlap.

| Task | Spec | Fold contract | Owned by the fold, not restated | Kept here | Disposition |
| --- | --- | --- | --- | --- | --- |
| `WP04-01` to `WP04-04` | `PG-04.3` (supersedes `PG-04.2`, which supersedes the signed `PG-04.1`) | `SO-F-03`, `SO-F-12` | the signature and admission block, the per-sender sequence, the rejected event, scope and classification on the envelope | the one envelope, with an optional extension block that the hash covers | trimmed: cited, envelope kept |
| `WP05-01` | `PG-05.2` (supersedes the signed `PG-05.1`) | `SO-F-02` | the merge class on each entity type and its enforcement in the store | the semantics table and its rationale; class names equal those of `SO-F-02` | trimmed |
| `WP05-04`, `WP05-06` | `PG-05.2` (supersedes the signed `PG-05.1`) | `SO-F-06` | validation of engine input and output at `src/engine/merge.mjs`; refusal of malformed output and forbidden transitions | the state map; one real-engine round trip | trimmed |
| `WP08-02` | `PG-08.1` | `SO-A-03` | the four execution event kinds | the adapter contract module and its conformance suite | trimmed |
| `WP08-03` | `PG-08.1` | `SO-A-10` | the reference journey, the fault matrix, the invariant checker and the stub sessions | the four `SO-1.11` step assertions that the journey does not assert one by one | trimmed |
| `WP09-01` | `PG-09.1` | `SO-F-01`, `SO-F-03` | subjects, keys, expiry, revocation, scope types, request resolution; contribution signature and admission | admission of a node or agent to a site | trimmed |
| `WP09-02` | `PG-09.1` | `SO-F-08` | the admission adapter and trust as an eligibility input only | the trust adapter boundary and its interface | trimmed |
| `WP09-03` | `PG-09.1` | `SO-F-03` | the per-sender sequence, the rejected event and replay refusal | equivocation detection and the hand-off to the exclusion policy | trimmed |
| `WP10-01`, `WP10-02` | `PG-10.1` | `SO-F-09` | the finding model, its cap at theory, dismissal, correction and adjudication | the status lattice, the status and origin fields | trimmed |
| `WP13-01` | `PG-13.1` | `SO-F-05` | the six classes, local only by default, inheritance by derived data | enforcement at the publish boundary, calling the classes of `SO-F-05` and the evaluation of `SO-F-04` | trimmed |
| `WP13-03` | `PG-13.1` | `SO-F-01`, `SO-F-04` | subjects, scope types, the relationship record and the policy document | membership and permission boundaries inside one site | trimmed |
| `WP13-04` | `PG-13.1` | `SO-F-07` | the authorised view and the last-known label | reconcile on reconnect and fail-visible finality | trimmed |
| `WP13-05` | `PG-13.1` | `SO-F-04` | the inter-organisation relationship record | the trust-domains page | trimmed |
| `WP14-04` | `PG-14.1` | `SO-F-13` | the conflict detection of the organisational intelligence demonstrator | the demonstrator page | cited |
| `WP06-01` | `PG-06.2` (supersedes the signed `PG-06.1`) | `SO-A-03` | the four execution event kinds and the observed-before-verified guard; the word accepted for dispatch events | the six acceptance states for replicated operations and who may make each transition | trimmed: cited, gap kept |
| `WP06-02`, `WP06-03` | `PG-06.2` (supersedes the signed `PG-06.1`) | `SO-F-12` | the replication stream record, the split into per-scope streams and the delivery between two sandbox nodes | the seven-question evaluator and its place on the write path of the project store | trimmed: cited, gap kept |
| `WP12-01` | `PG-12.2` (supersedes the signed `PG-12.1`) | `SO-F-07`, `SO-F-12` | the stream record (the replication unit); the read side of a stopped peer (last-known label, authorised view) | the transport adapter interface, the in-memory adapter and the five anti-entropy conformance tests | trimmed: cited, gap kept |
| `PGP-1.03` task 4 | `PGP-1.03` | `SO-A-11` | the script that checks the register and the inventory | the reconciliation pages, written by hand | cited |
| `SR-6.03` | `SR-6.03` (memev copy) | `SO-R-E` | the maintainer-run script for the first public image | the automated publish from the release workflow | cited |

## Requirement register

One row per requirement of [programme/REQUIREMENTS.md](programme/REQUIREMENTS.md). "Leaf" is the number in the Scope One work breakdown that owns the same thing, or the reason none does.

| Requirement | Summary | Class | Leaf or note |
| --- | --- | --- | --- |
| `MV-ARCH-01` | Memev is described and built as distributed operating infrastructure for human and autonomous work, not as an agent-memory application; planned and de... | same | 6.2 (#224, blocked) |
| `MV-ARCH-02` | crdt-merge is the convergence substrate for Memev federated state; Memev builds no second CRDT engine and does not stop at wiring crdt-merge into git ... | conflicting | 2.4.1 SR-3.01 and 7.1 PI-04 are held as covered; superseded by owner decision 31 Oct 2026 |
| `MV-ARCH-03` | The federated state engine is a foundational dependency; the paid multi-computer merge is only its first commercial demonstration | same | 4.3.8, 5.5.1 |
| `MV-ARCH-04` | Responsibility split is explicit: Memev owns project semantics, identity, authority, contracts, coordination, approvals, policy; the engine owns CRDT ... | same | 4.1.10, 5.5.2 |
| `MV-ARCH-05` | Merge semantics are chosen per object class (observations, metadata, membership, counters, task ownership, task state, contracts, approvals, external ... | missing | none |
| `MV-ARCH-06` | Replication and acceptance are separate: a node may receive and replicate an operation without accepting its consequences into authoritative project s... | missing | none |
| `MV-ARCH-07` | Memev decides, per change: is the agent authorised, does it break an invariant, does it depend on a superseded decision, is it safe to auto-accept, do... | missing | none |
| `MV-ARCH-08` | Schemas and docs preserve the distinctions: replicated is not verified, signed is not true, converged is not completed, admitted is not correct, trust... | missing | SO-1.04 (4.1.3) separates requested, accepted, observed and verified; not the same distinctions |
| `MV-ARCH-09` | No competing state stores, duplicate coordinators or separate policy engines are created while the architecture grows | same | 3.8.8 (SO-REQ-093), 5.2.1 (SO-1.01) |
| `MV-ARCH-10` | Memev works both as a complete platform and as independently deployable services (for example verification only) | missing | none |
| `MV-ARCH-11` | Memev supports MCP and A2A and does not replace them; no proprietary agent runtime; existing agents join without migrating | same | 5.4.2 (blocked), 5.4.1 |
| `MV-CRDT-01` | ORSet remove keeps observed-remove information so a stale replica cannot resurrect a removed element (A adds, B syncs, A removes, A syncs with B's old... | missing | crdt-merge repository, outside the WBS |
| `MV-CRDT-02` | LWWMap.get and LWWMap.value agree after an older delete is merged with a newer write | missing | crdt-merge repository, outside the WBS |
| `MV-CRDT-03` | Fact conflict policy is explicit and consistent: AgentState (timestamp, node id) versus ContextMerge max_confidence; docs say what actually wins | missing | crdt-merge repository, outside the WBS |
| `MV-CRDT-04` | TrustAgentState delete is a replicated tombstone and its merge is observed-remove/causal; it is not called production-grade until then | missing | crdt-merge repository, outside the WBS |
| `MV-CRDT-05` | The gossip bridge boundary is preserved: the engine supplies state and digests, the caller supplies transport, scheduling and the sync lifecycle | missing | crdt-merge repository, outside the WBS |
| `MV-CRDT-06` | Operation and contribution tags are globally unique ((node id, counter) or UUID) and equal-timestamp LWW and FWW ties are order independent | missing | crdt-merge repository, outside the WBS |
| `MV-CRDT-07` | E4 KeyPair verification is strict Ed25519 with no HMAC fallback keyed by the public key | missing | crdt-merge repository, outside the WBS |
| `MV-CONF-01` | A formal CRDT conformance gate for the memory, agent-state and gossip subsystems runs in CI, not only model-merge tests | missing | 2.4.2 SR-3.02 tests the provider boundary in memev, not CRDT laws |
| `MV-CONF-02` | The gate generates operation histories (random interleavings of operations on several replicas), not a few hand-built states | missing | none |
| `MV-CONF-03` | The gate covers: commutativity, associativity, idempotency, deletion propagation, concurrent additions, stale replica recovery, duplicate delivery, ou... | missing | none |
| `MV-INT-01` | Memev vault data is represented in CRDT-compatible state (P0 agent memory integration) | missing | none |
| `MV-INT-02` | One canonical operation envelope with versioned schema and deterministic serialisation: origin identity and node, operation id, causal dependencies, p... | missing | none |
| `MV-INT-03` | The oplog, the bus, project coordination and the engine use that one event model rather than four | missing | SO-1.01 (5.2.1) unifies project execution only |
| `MV-INT-04` | A Memev integration design maps vault operations, agent state, bus events, project state and contracts into one replicated event model (deliverable 2) | missing | none |
| `MV-INT-05` | The engine is integrated as a separately licensed dependency across the existing external call-out boundary, never vendored | same | 5.5.2, 6.3 (#201), 8.x WO-05-A |
| `MV-INT-06` | Real multi-node gossip transport with reconnect and partition recovery (P1) | same | 7.1 (PI-07 on dev-integration-specs) |
| `MV-INT-07` | Tasks, dependencies, decisions and contracts use the same replicated project model (P1) | same | 3.8.6 (SO-REQ-091), 5.2.1 (SO-1.01); the replicated part is not in the WBS |
| `MV-TRU-01` | Signed identity, scoped delegation, revocation and admission for contributing nodes and agents (P1) | same | 5.5.3, 5.5.5 (blocked) |
| `MV-TRU-02` | Accepted work carries independently verifiable evidence (P1 verification receipts) | same | 3.8.9 (SO-REQ-094), 5.2.9 |
| `MV-TRU-03` | Shared knowledge records distinguish own observation, single-source claim, corroborated claim, verified result, approved decision, disputed contributi... | same | 3.1.9 (SO-REQ-009), 5.2.10 (SO-1.07); partial |
| `MV-TRU-04` | ACFA-RS is used only for compatible numeric contributions with an agreed contributor set; the Krum n>=2f+3 and Bulyan n>=4f+3 assumptions are enforced... | missing | none |
| `MV-TRU-05` | Service contracts exist for ACFA-RS and E4 as adapter boundaries beside the merge boundary, with no product names in the open core | same | 5.5.4, 8.6 (WO-05-D) |
| `MV-TRU-06` | The system can answer which version of a spec or decision was authoritative at the time an agent did a piece of work | missing | SO-1.09 (4.1.9) keeps artefact version history only |
| `MV-TRU-07` | Equivocation and suspicious contributions are detected and handed to Memev authority and exclusion policy | same | 5.5.3 (contribution admission, blocked) |
| `MV-FED-01` | Independent site nodes: each runs its own Memev server, keeps local authoritative records, controls local identity, keeps working during partitions, p... | same | 4.3.4, 5.5.8 (blocked) |
| `MV-FED-02` | Sharing classes are enforced: approved project state, decisions, task handoffs, signed contributions with receipts and authorised knowledge are shared... | same | 5.5.6 (blocked) |
| `MV-FED-03` | Disclosure controls are explicit: deltas are not automatically GDPR-compliant; minimisation, secure aggregation or differential privacy where required... | missing | 5.5.6 names sovereign exchange but not disclosure controls |
| `MV-FED-04` | Both intra-organisation (several offices) and inter-organisation federation are supported, with cross-organisation identity and trust | same | 5.5.9, 5.5.10 (blocked) |
| `MV-FED-05` | Node identity, organisation membership, permission boundaries and sovereignty policies exist per site | same | 5.5.5 (blocked) |
| `MV-FED-06` | The deployment model scales by topology and trust boundary, not by computer count | same | 4.3.9 |
| `MV-DEM-01` | Federated prototype: three independent nodes with separate identities, concurrent agents, a network partition, recovery and a verifiable shared projec... | missing | none |
| `MV-DEM-02` | One end-to-end workflow: a fact or decision originates on one node, is replicated and evaluated on others, influences independently executed work and ... | missing | none |
| `MV-DEM-03` | Three architectural acceptance demonstrators: autonomous project delivery, organisational intelligence, independent-site federation | same | 4.3.10, 5.2.14 (SO-1.11); partial |
| `MV-DEM-04` | An adversarial participant is part of the demonstration and is excluded with evidence | missing | none |
| `MV-DEM-05` | A public federation benchmark shows the architecture under realistic failures (P2) | missing | none |
| `MV-DEM-06` | Python, Rust and TypeScript nodes exchange identical protocol representations (P2) | missing | none |
| `MV-REC-01` | `get` (known object) and `recall` (relevant knowledge) stay separate operations | missing | delivered on main, not listed in the WBS |
| `MV-REC-02` | Recall stage 1: phrase matching, alias query expansion, exact project/task/file/decision ids, temporal filters, better ranking for decisions and accep... | missing | none |
| `MV-REC-03` | Recall stage 2: graph-aware retrieval over the existing entity graph (decisions, amendments, dependent tasks, evidence, contracts, supersessions) | missing | none |
| `MV-REC-04` | Recall stage 3: optional local semantic retrieval; local model by default, external provider optional | same | 2.3.1 (SR-2.01) |
| `MV-REC-05` | Recall stage 4: trust-aware retrieval distinguishing the knowledge statuses; this bridges to the Federated tier | missing | none |
| `MV-REC-06` | Free recall is never deliberately weakened, and the licensed CRDT implementation is never imported into the free core | missing | none |
| `MV-LIC-01` | The CRDT engine stays in its own separately licensed repository; the open Memev repo holds only interfaces, protocol definitions and client code | same | 5.5.2, 2.4.4 (SR-3.05) |
| `MV-LIC-02` | ACFA-RS licence and patent terms are checked separately before the release package is designed | missing | none |
| `MV-LIC-03` | A software licensing lawyer reviews the combined distribution against the BSL restriction on standalone merge products or services | missing | SR-3.06 is not in the manifest or the WBS |
| `MV-LIC-04` | The licence boundary is stated once: Apache-2.0 core, BSL-1.1 engine, ACFA-RS own licence, commercial federated services | same | 2.4.4 (SR-3.05) |
| `MV-PRD-01` | The Converge README no longer says Mem0 'gave up on conflict resolution'; it keeps the technical distinction (extraction and retrieval versus distribu... | missing | none |
| `MV-PRD-02` | Public README, tier pages and site describe the real ambition without claiming planned federation | same | 2.6.2 (SR-5.04), 2.7.5 (SR-6.11) |
| `MV-PRD-03` | Portfolio is Memev Operating Environment, Memev Federation, Memev Network, in that adoption sequence | missing | none |
| `MV-PRD-04` | A distinct Federated tier above Corporate | conflicting | 1.3.5 records the tier set as decided, with no Federated tier |
| `MV-PRD-05` | Commercial value tracks nodes, trust domains, governance and managed services, not machine count | conflicting | 1.3.5 and 4.3.1 decide a price per computer count for Personal |
| `MV-PRD-06` | An Infrastructure Strategy and Architecture Blueprint: target architecture, repository mapping, missing capabilities, interfaces, licensing boundaries... | missing | none |
| `MV-PRD-07` | An integration audit across memev, crdt-merge and converge as one system: components, reuse, correct, missing, exact implementation contracts | missing | none |
| `MV-PRD-08` | Entry sequence: stage 1 interoperable and accountable (SDKs, MCP/A2A, conformance, reference deployment), stage 2 multi-organisation federation demons... | missing | none |
| `MV-PRD-09` | Every feature is judged by: does it make Memev more essential to a distributed agent ecosystem, or is it only a better application | missing | none |
| `MV-PRD-10` | SDKs, framework adapters and public conformance tests let existing agents (for example LangGraph) join a Memev project, claim work, submit evidence an... | same | 5.4.5 (blocked) |
| `MV-PRD-11` | Payments follow verified acceptance (agentic payment protocols for machine payments, Stripe for fiat) with idempotency and reconciliation; a payment receipt is not proof o... | same | 5.4.3 (blocked) |
| `MV-S1-01` | Outcome-to-delivery lifecycle: intake and scope, formal spec with approvals, contracts and work packages, resource choice, coordinated execution with ... | same | 3.1.2 to 3.1.4, 3.8.5 |
| `MV-S1-02` | PMO-grade project workspace and a persistent lead-agent interface over canonical state | same | 3.8.1 (SO-REQ-086), 5.2.10 (SO-1.05) |
| `MV-S1-03` | Organisational intelligence: evidence-linked discovery of cross-project dependencies and conflicts; both original plans are preserved until an authori... | same | 5.3.1 to 5.3.6 (blocked) |
| `MV-S1-04` | Canonical execution authority: project-store, project-state and coordinator form one authoritative path with leases, generations, idempotency and reco... | same | 5.2.1 (SO-1.01) |
| `MV-S1-05` | Provider-neutral execution adapters: discovery, session lifecycle, dispatch, checkpoint, progress, cancellation, recovery | same | 5.2.5 (SO-1.04) |
| `MV-S1-06` | The Scope One register is refreshed against current main; the recorded 4/17/58/19 split is the 30 Oct baseline, not a fresh run | same | 1.2.2, 1.2.3 (SO-1.02) |
| `MV-PGM-01` | Requirements, PRs, contracts and decisions are reconciled in one register as the first management task | same | 1.2.2, 1.2.3 (SO-1.02) |
| `MV-PGM-02` | Every open PR and every branch without a PR gets an explicit disposition (merge, rework, close, supersede) | same | 6, 7 |
| `MV-PGM-03` | Work runs as parallel streams with stable interfaces (A to F), each stream with its own owner lane | missing | none |
| `MV-PGM-04` | One canonical contract format and id namespace for new work (memev attest/1 specs versus proofline/1) | missing | none |
| `MV-PGM-05` | Requirements owned by an existing contract stay covered by it; no duplicate contracts are written for them | same | 9 (owner index and overlap check) |
| `MV-PGM-07` | The three engine plans are reconciled into one: the notes (crdt-merge via call-out, never vendored), PI-04/PI-05 on branch dev-integration-specs (vend... | conflicting | 7.1 PI-04 and PI-05 and 1.2.4 SR-3.01, SR-3.03 are open or covered; superseded by owner decision 31 Oct 2026 |
| `MV-PGM-06` | Parallel work is deconflicted: one claim register for who is writing which WBS or contract | missing | this register |

## Open follow-ups

| Follow-up | Where | Detail | Status |
| --- | --- | --- | --- |
| `LWWRegister` merge with equal timestamp and equal `node_id` | the crdt-merge reference first, then the TypeScript and Rust editions (`PG-03.4`, `PG-03.6`) | The Python reference keeps self and the Rust edition keeps other, so merge is not commutative in that case. The case is excluded from the vectors and must not be asserted. A higher timestamp wins, and on equal timestamps the greater `node_id` wins, in all editions. Fix the reference first; the editions follow (owner delegation, 1 Nov 2026) | open |
| Raise the daemon start wait | src/cli/daemon.mjs (SR-1.01, SR-1.24) | waitMs 6000 too short for cold starts on Windows runners; candidate for next SR-1 revision; test-side retry in #352/#359 meanwhile | open |
| Production caller for recovery and reconstruction | src/engine/coordinator.mjs (SO-08-B, pull request #361) | recover, reconstruct, eligibilityPass and applyBusMessage have no production caller; they need vault, mcp or daemon wiring | covered by `SO-08-C` T2 and T3 (Claim E; proposed, unsigned) |
| Give the Coordinator the bus | src/engine/vault.mjs (SO-08-B, pull request #361) | The Coordinator isn't given the bus in vault.mjs, so transitions are posted only where a bus is passed in | covered by `SO-08-C` T1 (Claim E; proposed, unsigned) |
| Capability record | the adapter capability record (SO-05-B; SO-08-B AC03) | The capability record waits on SO-05-B: pause reports requested for tasks in flight, unsupported only when a capability port is passed in, and nothing reports confirmed | open |
| Bus seat names for vault claims | src/engine/vault.mjs and src/engine/bus.mjs (SO-08-B, pull request #361) | Vault claims hold name/client, which isn't a bus seat name, so transitions only reach the operator | open |
| Claims, provenance, assert and recall without a scope check | `vault.claims()`, `vault.provenance()`, `vault.assert()` and `recall` (src/engine/vault.mjs; `SO-F-09`, pull request #362, at fe3d7f3) | `claims()` and `provenance()` list claims with no scope check. `vault.assert()` (vault.mjs:805) matches a finding by its statement through `findClaim`, so an unscoped write token can refute it and read its status. `recall` (vault.mjs:635) prints any claim's statement given evidence on a path. All four must route through `viewFinding` or a scope check before anything raises findings; the contract is to be drafted later | open |
| Wiring verifier not implemented | `WP04-04` of `PG-04.3` (src/engine/index.mjs, `buildEnvelope`); the verifier types in src/engine/contracts.mjs | The criterion 'oplog default path references the envelope' uses a `wiring` verifier (entry src/engine/index.mjs, symbol buildEnvelope), and no wiring verifier is implemented, so that criterion was checked only on the import graph | open |
| Two users of the Admission `external` hook | `relationshipGate` (`SO-F-04`, pull request #368) and `SO-F-08` | Both use the `external` hook of Admission. Whichever of them merges second composes the two | open |
| One scope per Admission | Admission (`SO-F-04`, pull request #368) | Admission holds one scope, so for now a node with several relationships uses one Admission per scope. Whether to change that later is still to be decided | open |


## Programme tasks by work package

| Work package | Same | Missing | Conflicting |
| --- | --- | --- | --- |
| WP01 | 0 | 7 | 0 |
| WP02 | 0 | 4 | 0 |
| WP03 | 0 | 3 | 0 |
| WP04 | 0 | 4 | 0 |
| WP05 | 1 | 4 | 1 |
| WP06 | 0 | 3 | 0 |
| WP07 | 4 | 0 | 0 |
| WP08 | 4 | 0 | 0 |
| WP09 | 2 | 2 | 0 |
| WP10 | 2 | 2 | 0 |
| WP11 | 1 | 5 | 0 |
| WP12 | 2 | 1 | 0 |
| WP13 | 4 | 1 | 0 |
| WP14 | 1 | 4 | 0 |
| WP15 | 1 | 2 | 0 |
| WP16 | 1 | 4 | 2 |
| WP17 | 3 | 3 | 0 |
| WP18 | 4 | 0 | 0 |
