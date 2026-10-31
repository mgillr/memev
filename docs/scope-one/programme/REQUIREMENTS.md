# Memev requirements (MV-*)

Part of the [programme decomposition](README.md). Up: the [documentation index](../../README.md).

Derived on 2026-10-31 from the owner's notes file (decomposition in DECOMPOSITION.md). One line per requirement: `- ID: text`. Every id is covered by at least one task in `fragments/` (see `contract coverage` output in VALIDATION.md).
Existing contract families keep their own ids (SR-*, QL-*, SO-*, WO-*); where one of them already owns a requirement the line says so and the task here is an interface or duplicate guard only.

## Architecture

- MV-ARCH-01: Memev is described and built as distributed operating infrastructure for human and autonomous work, not as an agent-memory application; planned and delivered capability are stated separately.
- MV-ARCH-02: crdt-merge is the convergence substrate for Memev federated state; Memev builds no second CRDT engine and does not stop at wiring crdt-merge into git conflict handling.
- MV-ARCH-03: The federated state engine is a foundational dependency; the paid multi-computer merge is only its first commercial demonstration.
- MV-ARCH-04: Responsibility split is explicit: Memev owns project semantics, identity, authority, contracts, coordination, approvals, policy; the engine owns CRDT state, causal sync, trust/identity primitives and receipts.
- MV-ARCH-05: Merge semantics are chosen per object class (observations, metadata, membership, counters, task ownership, task state, contracts, approvals, external actions), never one CRDT for everything.
- MV-ARCH-06: Replication and acceptance are separate: a node may receive and replicate an operation without accepting its consequences into authoritative project state.
- MV-ARCH-07: Memev decides, per change: is the agent authorised, does it break an invariant, does it depend on a superseded decision, is it safe to auto-accept, does it need verification, may it proceed offline, does it need global authorisation.
- MV-ARCH-08: Schemas and docs preserve the distinctions: replicated is not verified, signed is not true, converged is not completed, admitted is not correct, trust is not access control, a payment receipt is not proof of delivery.
- MV-ARCH-09: No competing state stores, duplicate coordinators or separate policy engines are created while the architecture grows.
- MV-ARCH-10: Memev works both as a complete platform and as independently deployable services (for example verification only).
- MV-ARCH-11: Memev supports MCP and A2A and does not replace them; no proprietary agent runtime; existing agents join without migrating.

## CRDT correctness

- MV-CRDT-01: ORSet remove keeps observed-remove information so a stale replica cannot resurrect a removed element (A adds, B syncs, A removes, A syncs with B's old state).
- MV-CRDT-02: LWWMap.get and LWWMap.value agree after an older delete is merged with a newer write.
- MV-CRDT-03: Fact conflict policy is explicit and consistent: AgentState (timestamp, node id) versus ContextMerge max_confidence; docs say what actually wins.
- MV-CRDT-04: TrustAgentState delete is a replicated tombstone and its merge is observed-remove/causal; it is not called production-grade until then.
- MV-CRDT-05: The gossip bridge boundary is preserved: the engine supplies state and digests, the caller supplies transport, scheduling and the sync lifecycle.
- MV-CRDT-06: Operation and contribution tags are globally unique ((node id, counter) or UUID) and equal-timestamp LWW and FWW ties are order independent.
- MV-CRDT-07: E4 KeyPair verification is strict Ed25519 with no HMAC fallback keyed by the public key. (Added from live review; not in the notes.)

## Conformance gate

- MV-CONF-01: A formal CRDT conformance gate for the memory, agent-state and gossip subsystems runs in CI, not only model-merge tests.
- MV-CONF-02: The gate generates operation histories (random interleavings of operations on several replicas), not a few hand-built states.
- MV-CONF-03: The gate covers: commutativity, associativity, idempotency, deletion propagation, concurrent additions, stale replica recovery, duplicate delivery, out-of-order delivery, process restart, cross-language serialisation, clock skew, replica identity collision, partition and heal.

## Integration

- MV-INT-01: Memev vault data is represented in CRDT-compatible state (P0 agent memory integration).
- MV-INT-02: One canonical operation envelope with versioned schema and deterministic serialisation: origin identity and node, operation id, causal dependencies, project and object id, type and payload, authorisation evidence, contract or policy reference, content hash, verification status (P0).
- MV-INT-03: The oplog, the bus, project coordination and the engine use that one event model rather than four.
- MV-INT-04: A Memev integration design maps vault operations, agent state, bus events, project state and contracts into one replicated event model (deliverable 2).
- MV-INT-05: The engine is integrated as a separately licensed dependency across the existing external call-out boundary, never vendored.
- MV-INT-06: Real multi-node gossip transport with reconnect and partition recovery (P1).
- MV-INT-07: Tasks, dependencies, decisions and contracts use the same replicated project model (P1).

## Trust and verification

- MV-TRU-01: Signed identity, scoped delegation, revocation and admission for contributing nodes and agents (P1).
- MV-TRU-02: Accepted work carries independently verifiable evidence (P1 verification receipts).
- MV-TRU-03: Shared knowledge records distinguish own observation, single-source claim, corroborated claim, verified result, approved decision, disputed contribution and superseded fact; repetition by many agents does not raise a disputed claim.
- MV-TRU-04: ACFA-RS is used only for compatible numeric contributions with an agreed contributor set; the Krum n>=2f+3 and Bulyan n>=4f+3 assumptions are enforced; verification is pinned to trusted identities and policy; never for text memories or averaged confidences.
- MV-TRU-05: Service contracts exist for ACFA-RS and E4 as adapter boundaries beside the merge boundary, with no product names in the open core.
- MV-TRU-06: The system can answer which version of a spec or decision was authoritative at the time an agent did a piece of work.
- MV-TRU-07: Equivocation and suspicious contributions are detected and handed to Memev authority and exclusion policy.

## Federation

- MV-FED-01: Independent site nodes: each runs its own Memev server, keeps local authoritative records, controls local identity, keeps working during partitions, publishes only authorised state and reconciles on reconnect.
- MV-FED-02: Sharing classes are enforced: approved project state, decisions, task handoffs, signed contributions with receipts and authorised knowledge are shared; raw data, private memory, credentials and restricted documents stay local.
- MV-FED-03: Disclosure controls are explicit: deltas are not automatically GDPR-compliant; minimisation, secure aggregation or differential privacy where required; redaction is not those guarantees.
- MV-FED-04: Both intra-organisation (several offices) and inter-organisation federation are supported, with cross-organisation identity and trust.
- MV-FED-05: Node identity, organisation membership, permission boundaries and sovereignty policies exist per site.
- MV-FED-06: The deployment model scales by topology and trust boundary, not by computer count.

## Demonstrators

- MV-DEM-01: Federated prototype: three independent nodes with separate identities, concurrent agents, a network partition, recovery and a verifiable shared project outcome (deliverable 3).
- MV-DEM-02: One end-to-end workflow: a fact or decision originates on one node, is replicated and evaluated on others, influences independently executed work and becomes an accepted verifiable outcome.
- MV-DEM-03: Three architectural acceptance demonstrators: autonomous project delivery, organisational intelligence, independent-site federation.
- MV-DEM-04: An adversarial participant is part of the demonstration and is excluded with evidence.
- MV-DEM-05: A public federation benchmark shows the architecture under realistic failures (P2).
- MV-DEM-06: Python, Rust and TypeScript nodes exchange identical protocol representations (P2).

## Free-core recall

- MV-REC-01: `get` (known object) and `recall` (relevant knowledge) stay separate operations.
- MV-REC-02: Recall stage 1: phrase matching, alias query expansion, exact project/task/file/decision ids, temporal filters, better ranking for decisions and accepted facts, reciprocal rank fusion, handling of superseded and contested knowledge.
- MV-REC-03: Recall stage 2: graph-aware retrieval over the existing entity graph (decisions, amendments, dependent tasks, evidence, contracts, supersessions).
- MV-REC-04: Recall stage 3: optional local semantic retrieval; local model by default, external provider optional.
- MV-REC-05: Recall stage 4: trust-aware retrieval distinguishing the knowledge statuses; this bridges to later federation work, not to a tier (there is no Federated tier).
- MV-REC-06: Free recall is never deliberately weakened, and the licensed CRDT implementation is never imported into the free core.

## Licensing

- MV-LIC-01: The CRDT engine stays in its own separately licensed repository; the open Memev repo holds only interfaces, protocol definitions and client code.
- MV-LIC-02: ACFA-RS licence and patent terms are checked separately before the release package is designed.
- MV-LIC-03: A software licensing lawyer reviews the combined distribution against the BSL restriction on standalone merge products or services.
- MV-LIC-04: The licence boundary is stated once: Apache-2.0 core, BSL-1.1 engine, ACFA-RS own licence, commercial federated services.

## Product and positioning

- MV-PRD-01: The Converge README no longer says Mem0 'gave up on conflict resolution'; it keeps the technical distinction (extraction and retrieval versus distributed state convergence).
- MV-PRD-02: Public README, tier pages and site describe the real ambition without claiming planned federation.
- MV-PRD-03: Portfolio is Memev Operating Environment, Memev Federation, Memev Network, in that adoption sequence.
- MV-PRD-04: A distinct Federated tier above Corporate. SUPERSEDED by the owner decision of 31 Oct 2026 (docs/scope-one/DECISIONS.md): there is no Federated tier; the tiers are Free core, Personal ($12/month or $120/year, up to 3 computers) and contact us for anything above.
- MV-PRD-05: Commercial value tracks nodes, trust domains, governance and managed services, not machine count.
- MV-PRD-06: An Infrastructure Strategy and Architecture Blueprint: target architecture, repository mapping, missing capabilities, interfaces, licensing boundaries, build sequence, positioning, first wedge, ecosystem route.
- MV-PRD-07: An integration audit across memev, crdt-merge and converge as one system: components, reuse, correct, missing, exact implementation contracts.
- MV-PRD-08: Entry sequence: stage 1 interoperable and accountable (SDKs, MCP/A2A, conformance, reference deployment), stage 2 multi-organisation federation demonstrator, stage 3 commercial network; first wedge engineering and industrial programmes, healthcare as demonstration.
- MV-PRD-09: Every feature is judged by: does it make Memev more essential to a distributed agent ecosystem, or is it only a better application.
- MV-PRD-10: SDKs, framework adapters and public conformance tests let existing agents (for example LangGraph) join a Memev project, claim work, submit evidence and sync state.
- MV-PRD-11: Payments follow verified acceptance (x402 for machine payments, Stripe for fiat) with idempotency and reconciliation; a payment receipt is not proof of delivery.

## Scope One

- MV-S1-01: Outcome-to-delivery lifecycle: intake and scope, formal spec with approvals, contracts and work packages, resource choice, coordinated execution with recovery, verification against the original requirements, delivery with evidence and limits.
- MV-S1-02: PMO-grade project workspace and a persistent lead-agent interface over canonical state.
- MV-S1-03: Organisational intelligence: evidence-linked discovery of cross-project dependencies and conflicts; both original plans are preserved until an authorised change.
- MV-S1-04: Canonical execution authority: project-store, project-state and coordinator form one authoritative path with leases, generations, idempotency and recovery.
- MV-S1-05: Provider-neutral execution adapters: discovery, session lifecycle, dispatch, checkpoint, progress, cancellation, recovery.
- MV-S1-06: The Scope One register is refreshed against current main; the recorded 4/17/58/19 split is the 30 Oct baseline, not a fresh run.

## Programme

- MV-PGM-01: Requirements, PRs, contracts and decisions are reconciled in one register as the first management task.
- MV-PGM-02: Every open PR and every branch without a PR gets an explicit disposition (merge, rework, close, supersede).
- MV-PGM-03: Work runs as parallel streams with stable interfaces (A to F), each stream with its own owner lane.
- MV-PGM-04: One canonical contract format and id namespace for new work (memev attest/1 specs versus proofline/1).
- MV-PGM-05: Requirements owned by an existing contract stay covered by it; no duplicate contracts are written for them.
- MV-PGM-07: The three engine plans are reconciled into one: the notes (crdt-merge via call-out, never vendored), PI-04/PI-05 on branch dev-integration-specs (vendor the Apache-2.0 TS core, Node oplog engine) and SR-3.01/SR-3.03 (new memev-merge text engine). RESOLVED by the owner decision of 31 Oct 2026: crdt-merge stays in its own repository and is reached only across the WO-05-A call-out boundary; PI-04/PI-05 and SR-3.01/SR-3.03 are superseded (docs/scope-one/DECISIONS.md, ADR 6).
- MV-PGM-06: Parallel workstream work is deconflicted: one claim register for who is writing which WBS or contract.
