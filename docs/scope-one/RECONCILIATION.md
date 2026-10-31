# Scope One reconciliation: programme decomposition against the Scope One work breakdown

Part of the [documentation index](../README.md). Related: [DECISIONS.md](DECISIONS.md), [INVENTORY.md](INVENTORY.md), [programme decomposition](programme/README.md).

Dated 31 October 2026, against main at `4823064`, which includes the Scope One work breakdown (`WBS.md` in `docs/scope-one`, with `SO-1.01` to `SO-1.11` and its test `wbs.test.mjs`) from pull request #324. This page refers to that work breakdown and to `SO-1.02` (the reconciliation contract) instead of restating them; leaf numbers below are the numbers in `WBS.md`. It does not edit `WBS.md`, any `SO-1.x` contract, any signature or any red-team record: those are owned by the ASTL workstream.

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

## Claim register

Who writes which task, so that two workstreams do not write the same one. Owners are workstreams. A status is as of the date above.

| Task id | Owner workstream | Branch or pull request | Status |
| --- | --- | --- | --- |
| Scope One `WBS.md`, `wbs.test.mjs` | ASTL workstream | memev #324, branch `wbs` | merged |
| `SO-1.01` to `SO-1.11` contracts | ASTL workstream | memev #324 | merged, signed |
| Contract signing and re-signing (all repositories) | ASTL workstream | `scripts/gate/redteam-gate.mjs` in memev; #319 to #323 merged | in progress |
| Red-team records | ASTL workstream | `contracts/**/redteam/` | in progress |
| `WP01-01` to `WP01-05` (crdt-merge correctness) | Programme workstream | crdt-merge, branch `fix/crdt-correctness-four-bugs` #180 | in progress |
| `WP07-01` to `WP07-03`, `WP15-01` (memev wiring and licence guard) | Programme workstream | memev, branch `feat/wire-project-engine` #326 | in progress |
| `WP17-05`, `WP16-03` and `WP15-02` for memev (this reconciliation, tiers, README, decisions) | Programme workstream | memev, branch `docs/engine-decision-tiers-reconcile` #325 | open |
| `WP16-02` (converge README) | Programme workstream | converge, branch `docs/fair-mem0-comparison` #1 | open |
| `WP16-03` (site plans) | Programme workstream | memev-site, branch `fix/plans-match-tier-decision` #1 | open |
| `WP05-02`, `WP15-02` for memev-ops (SR-3.01 and SR-3.03 superseded, SR-3.05) | Programme workstream | memev-ops, branch `docs/engine-decision-sr3` #13 | open |
| Programme contract specs (`contracts/programme`, one per work package and one per work pull request) | Programme workstream | memev, same branch as the row above #325 | open, unsigned; signing by the ASTL workstream |
| Every other `WP*` task (the work itself) | unclaimed | none | not started |

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
| `MV-PGM-06` | Parallel bot work is deconflicted: one claim register for who is writing which WBS or contract | missing | this register |

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
