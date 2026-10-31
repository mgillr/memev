# WBS (generated from the contract fragments)

Part of the [programme decomposition](README.md). Up: the [documentation index](../../README.md).

82 tasks in 18 work packages. Status is derived from the strongest status of the requirements a task serves (conflicting > open PR > branch > existing contract > planned > new gap > done guard); it is a reconciliation hint, not a claim that the task is finished. No task is done.

Critical path (11 tasks): WP17-01 -> WP17-03 -> WP04-01 -> WP05-01 -> WP05-03 -> WP12-01 -> WP12-02 -> WP12-03 -> WP14-01 -> WP14-02 -> WP14-04

## WP01 crdt-merge correctness fixes for the agent/memory subsystems (lane lane-engine)

- WP01-01 [new gap] ORSet.remove keeps observed-remove information; a stale replica cannot resurrect a removed element | repo crdt-merge | after: none | owner: lane-engine | serves: MV-CRDT-01
- WP01-02 [new gap] LWWMap.get and LWWMap.value agree after merging an older delete with a newer write | repo crdt-merge | after: none | owner: lane-engine | serves: MV-CRDT-02
- WP01-03 [new gap] Fact conflict policy made explicit: AgentState resolves by (timestamp, node id), ContextMerge by max confidence; document and test which wins | repo crdt-merge | after: WP01-01 | owner: lane-engine | serves: MV-CRDT-03
- WP01-04 [new gap] TrustAgentState delete is a replicated tombstone and its merge is causal observed-remove | repo crdt-merge | after: WP01-01 | owner: lane-engine | serves: MV-CRDT-04
- WP01-05 [new gap] Operation and contribution tags are globally unique; equal-timestamp LWW/FWW ties are order independent | repo crdt-merge | after: WP01-01 | owner: lane-engine | serves: MV-CRDT-06
- WP01-06 [in an open PR] Land crdt-merge PR #179 (strict Ed25519 verification, no HMAC fallback keyed by the public key) after review | repo crdt-merge | after: none | owner: owner | serves: MV-CRDT-07
- WP01-07 [planned (docs only)] Gossip boundary note: the engine supplies state and digests; the caller supplies transport, scheduling, lifecycle | repo crdt-merge | after: WP01-01 | owner: lane-engine | serves: MV-CRDT-05

## WP02 CRDT conformance gate (history-based, CI) (lane lane-engine)

- WP02-01 [new gap] History generator: random interleavings of operations on N replicas with drop, duplicate, reorder and restart | repo crdt-merge | after: WP01-01, WP01-02 | owner: lane-engine | serves: MV-CONF-02
- WP02-02 [new gap] Conformance suite for ORSet, LWWMap, AgentState, TrustAgentState and gossip: commutativity, associativity, idempotency | repo crdt-merge | after: WP02-01 | owner: lane-engine | serves: MV-CONF-01, MV-CONF-03
- WP02-03 [new gap] Scenario suite: deletion propagation, stale replica, duplicate and out-of-order delivery, process restart, clock skew, replica id collision, partition and heal | repo crdt-merge | after: WP02-01 | owner: lane-engine | serves: MV-CONF-03
- WP02-04 [new gap] Run the conformance gate in CI on every PR to crdt-merge | repo crdt-merge | after: WP02-02, WP02-03 | owner: lane-engine | serves: MV-CONF-01

## WP03 Cross-language protocol vectors (lane lane-engine)

- WP03-01 [new gap] Shared serialisation test vectors (JSON) produced by the Python reference for ORSet, LWWMap, AgentState | repo crdt-merge | after: WP02-02 | owner: lane-engine | serves: MV-DEM-06
- WP03-02 [new gap] TypeScript edition reads and re-emits every vector byte-identically | repo crdt-merge-ts | after: WP03-01 | owner: lane-engine | serves: MV-DEM-06
- WP03-03 [new gap] Rust edition reads and re-emits every vector byte-identically | repo crdt-merge-rs | after: WP03-01 | owner: lane-engine | serves: MV-DEM-06

## WP04 Canonical operation envelope (lane lane-core)

- WP04-01 [new gap] Envelope specification: fields, versioning, deterministic serialisation, hash rules | repo memev | after: WP17-03 | owner: lane-core | serves: MV-INT-02
- WP04-02 [new gap] Envelope module: build, canonical-serialise, hash and validate an envelope | repo memev | after: WP04-01 | owner: lane-core | serves: MV-INT-02
- WP04-03 [new gap] Adapters: the oplog record, the bus message and project-store events convert to and from the envelope without loss | repo memev | after: WP04-02 | owner: lane-core | serves: MV-INT-03
- WP04-04 [new gap] Envelope is reachable from the real write path (oplog append), not only from tests | repo memev | after: WP04-03 | owner: lane-core | serves: MV-INT-03

## WP05 Engine integration: merge semantics, mapping, boundary (lane lane-core)

- WP05-01 [new gap] Merge-semantics table: object classes (observations, metadata, membership, counters, task ownership, task state, contracts, approvals, external actions) to semantics, with rationale | repo memev | after: WP01-03, WP04-01 | owner: lane-core | serves: MV-ARCH-05
- WP05-02 [conflicting] Resolve the engine question: structured replicated state on crdt-merge, Markdown text merge on its own layer; reconcile SR-3.01 and SR-3.03 accordingly | repo memev-ops | after: WP17-04 | owner: owner | serves: MV-ARCH-02, MV-ARCH-03, MV-PGM-07
- WP05-03 [in an open PR] Integration design: how vault operations, agent state, bus events, project state and contracts map to the replicated event model | repo memev | after: WP05-01, WP05-02, WP04-01 | owner: lane-core | serves: MV-INT-04, MV-ARCH-04
- WP05-04 [new gap] Vault note and agent-state mapping to CRDT-compatible state | repo memev | after: WP05-03, WP04-03 | owner: lane-core | serves: MV-INT-01
- WP05-05 [in an open PR] Paid-engine client behind a flag, off by default (finish and land PR #201 WO-05-B) | repo memev | after: WP05-03 | owner: lane-core | serves: MV-INT-05
- WP05-06 [in an open PR] Engine round trip: a memev state change replicates through crdt-merge and back on two local vaults | repo memev | after: WP05-04, WP05-05 | owner: lane-core | serves: MV-INT-01, MV-INT-05

## WP06 Replication separate from acceptance (lane lane-core)

- WP06-01 [new gap] Acceptance state model: received, replicated, evaluated, accepted, rejected, superseded; transitions and who may make them | repo memev | after: WP04-01, WP07-02 | owner: lane-core | serves: MV-ARCH-06
- WP06-02 [new gap] Acceptance evaluator implementing the seven questions (authorised, invariant, superseded dependency, auto-accept, verification, offline, global authority) | repo memev | after: WP06-01 | owner: lane-core | serves: MV-ARCH-07
- WP06-03 [new gap] Acceptance is on the default path: a replicated operation does not change authoritative state until accepted | repo memev | after: WP06-02 | owner: lane-core | serves: MV-ARCH-06

## WP07 Wire the canonical project authority path (lane lane-core)

- WP07-01 [new gap] Wire project-store into a caller on the default path (CLI or server) | repo memev | after: WP17-01 | owner: lane-core | serves: MV-S1-04
- WP07-02 [new gap] Wire project-state (state machine and ten invariants) so that every task transition goes through it | repo memev | after: WP07-01 | owner: lane-core | serves: MV-S1-04, MV-INT-07
- WP07-03 [new gap] Wire coordinator (atomic claims, leases, generation tokens) behind the MCP and CLI claim path | repo memev | after: WP07-02 | owner: lane-core | serves: MV-S1-04
- WP07-04 [new gap] Single-authority guard: a test fails if a second state store or coordinator is introduced | repo memev | after: WP07-03 | owner: lane-core | serves: MV-ARCH-09

## WP08 Scope One lifecycle gaps (intake to delivery) (lane lane-core)

- WP08-01 [new gap] Refresh the Scope One requirement register (98 SO-REQ) against current main and publish the fresh counts | repo memev | after: WP17-01 | owner: lane-core | serves: MV-S1-06
- WP08-02 [planned (docs only)] Provider-neutral execution adapter contract: discovery, session lifecycle, dispatch, checkpoint, progress, cancellation, recovery | repo memev | after: WP07-03 | owner: lane-core | serves: MV-S1-05
- WP08-03 [planned (docs only)] Lifecycle test: intake, spec with approvals, contract and work packages, execution, verification, delivery with evidence | repo memev | after: WP07-03, WP10-03 | owner: lane-core | serves: MV-S1-01, MV-S1-02
- WP08-04 [planned (docs only)] Organisational intelligence prototype: evidence-linked cross-project dependency and conflict detection; both original plans preserved until an authorised change | repo memev | after: WP10-02, WP11-03 | owner: lane-core | serves: MV-S1-03

## WP09 Identity, admission and ACFA boundary (lane lane-trust)

- WP09-01 [planned (docs only)] Signed node and agent identity with scoped delegation, revocation and admission, on top of the sibling identity project and agentid-bind | repo memev | after: WP04-02 | owner: lane-trust | serves: MV-TRU-01, MV-FED-05
- WP09-02 [planned (docs only)] ACFA-RS adapter boundary: numeric contributions only, agreed contributor set, Krum n>=2f+3 and Bulyan n>=4f+3 enforced, trusted-identity pinned verification | repo memev | after: WP09-01 | owner: lane-trust | serves: MV-TRU-04, MV-TRU-05
- WP09-03 [new gap] Equivocation and suspicious-contribution handler: evidence goes to Memev authority and exclusion policy | repo memev | after: WP09-01, WP06-02 | owner: lane-trust | serves: MV-TRU-07
- WP09-04 [new gap] ACFA-RS patent and licence check recorded before any release package is designed | repo memev-ops | after: none | owner: owner | serves: MV-LIC-02

## WP10 Evidence, knowledge status and receipts (lane lane-trust)

- WP10-01 [new gap] Knowledge status lattice: own observation, single-source claim, corroborated, verified, approved decision, disputed, superseded; transition rules | repo memev | after: WP04-01 | owner: lane-trust | serves: MV-ARCH-08, MV-TRU-03
- WP10-02 [new gap] Status and origin fields on notes and facts; repetition by many agents never raises a disputed claim | repo memev | after: WP10-01 | owner: lane-trust | serves: MV-TRU-03
- WP10-03 [planned (docs only)] Link accepted work to an independently verifiable receipt | repo memev | after: WP10-01, WP07-02 | owner: lane-trust | serves: MV-TRU-02
- WP10-04 [new gap] As-of query: which version of a spec or decision was authoritative when an agent did a piece of work | repo memev | after: WP10-02, WP07-02 | owner: lane-trust | serves: MV-TRU-06

## WP11 Free-core recall stages (lane lane-core)

- WP11-01 [new gap] Stage 1 recall: phrase matching, alias expansion, exact id lookup, temporal filters | repo memev | after: WP17-04 | owner: lane-core | serves: MV-REC-02
- WP11-02 [new gap] Stage 1 recall: reciprocal rank fusion, decision and accepted-fact boost, superseded and contested handling | repo memev | after: WP11-01 | owner: lane-core | serves: MV-REC-02
- WP11-03 [new gap] Stage 2 recall: graph-aware retrieval (decisions, amendments, dependent tasks, evidence, contracts, supersessions) | repo memev | after: WP11-02 | owner: lane-core | serves: MV-REC-03
- WP11-04 [new gap] Stage 4 recall: trust-aware ranking by knowledge status | repo memev | after: WP11-03, WP10-02 | owner: lane-core | serves: MV-REC-05
- WP11-05 [owned by an existing contract] Stage 3 (local semantic retrieval) is delivered by the existing contract SR-2.01; this task only checks the interface | repo memev | after: WP11-02 | owner: lane-core | serves: MV-REC-04
- WP11-06 [done in main] get and recall stay separate operations (regression guard) | repo memev | after: WP11-01 | owner: lane-core | serves: MV-REC-01

## WP12 Multi-node gossip transport (lane lane-fed)

- WP12-01 [on a branch] Transport adapter interface (send state, receive state, digests) with an in-memory implementation | repo memev | after: WP04-02, WP05-03 | owner: lane-fed | serves: MV-INT-06
- WP12-02 [on a branch] Relay-backed transport: reconnect, backoff, partition recovery | repo memev | after: WP12-01 | owner: lane-fed | serves: MV-INT-06
- WP12-03 [on a branch] Three-node local harness: three vaults with separate identities exchange envelopes through the transport | repo memev | after: WP12-02, WP09-01 | owner: lane-fed | serves: MV-INT-06, MV-DEM-01

## WP13 Federation sites, sharing classes, disclosure (lane lane-fed)

- WP13-01 [in an open PR] Sharing classes enforced at the publish boundary: shared (approved state, decisions, handoffs, signed contributions, authorised knowledge) versus local-only (raw data, private memory, credentials, restricted documents) | repo memev | after: WP09-01, WP10-01, WP04-02 | owner: lane-fed | serves: MV-FED-02, MV-FED-01
- WP13-02 [new gap] Disclosure policy document: minimisation, secure aggregation, differential privacy per data class; states that redaction is not those guarantees | repo memev | after: WP13-01 | owner: lane-fed | serves: MV-FED-03
- WP13-03 [in an open PR] Site node identity, organisation membership and sovereignty policy per site | repo memev | after: WP09-01 | owner: lane-fed | serves: MV-FED-05, MV-FED-01
- WP13-04 [in an open PR] Offline operation and reconcile on reconnect: a node keeps local authority during a partition and reconciles through acceptance | repo memev | after: WP13-03, WP06-03, WP12-02 | owner: lane-fed | serves: MV-FED-01
- WP13-05 [planned (docs only)] Intra- and inter-organisation trust: cross-organisation identity and trust-domain boundaries | repo memev | after: WP13-03, WP09-02 | owner: lane-fed | serves: MV-FED-04

## WP14 Federation demonstrators and benchmark (lane lane-fed)

- WP14-01 [new gap] Federated prototype: three independent nodes, concurrent agents, a partition, recovery and a verifiable outcome | repo memev | after: WP12-03, WP13-04 | owner: lane-fed | serves: MV-DEM-01
- WP14-02 [new gap] End-to-end workflow: a fact originates on node A, replicates, is evaluated on B and C, informs independent work and becomes an accepted verifiable outcome | repo memev | after: WP14-01, WP10-03 | owner: lane-fed | serves: MV-DEM-02
- WP14-03 [new gap] Adversarial participant is excluded with evidence inside the demonstration | repo memev | after: WP14-01, WP09-03 | owner: lane-fed | serves: MV-DEM-04
- WP14-04 [new gap] Three architectural acceptance demonstrators: autonomous project delivery, organisational intelligence, independent-site federation | repo memev | after: WP14-02, WP08-04 | owner: lane-fed | serves: MV-DEM-03
- WP14-05 [new gap] Public federation benchmark under realistic failures | repo memev | after: WP14-01, WP03-02 | owner: lane-fed | serves: MV-DEM-05

## WP15 Licensing boundary (lane lane-product)

- WP15-01 [new gap] Structural no-import guard: nothing under the Apache core imports the licensed engine package | repo memev | after: none | owner: lane-product | serves: MV-REC-06, MV-LIC-01
- WP15-02 [owned by an existing contract] Licence boundary stated once: Apache-2.0 core, BSL-1.1 engine (change date 2028-03-29), ACFA-RS own licence, commercial services | repo memev | after: none | owner: lane-product | serves: MV-LIC-04
- WP15-03 [owned by an existing contract] Counsel review of the combined distribution against the BSL use restriction recorded | repo memev-ops | after: WP15-02 | owner: owner | serves: MV-LIC-03

## WP16 Positioning, tiers, public claims, blueprint (lane lane-product)

- WP16-01 [conflicting] Owner decision on the Federated tier: add a distinct tier, or keep the decided four-name model | repo memev | after: WP17-01 | owner: owner | serves: MV-PRD-04, MV-PRD-05
- WP16-02 [new gap] Converge README: remove the claim that Mem0 'gave up' on conflict resolution; keep the technical distinction | repo converge | after: none | owner: lane-product | serves: MV-PRD-01
- WP16-03 [in an open PR] Public README, tier pages and site describe the real ambition without claiming planned federation (supersedes the wording in PR #224) | repo memev | after: WP16-01 | owner: lane-product | serves: MV-PRD-02, MV-ARCH-01
- WP16-04 [in an open PR] Deployment model scales by topology and trust boundary, not by computer count, documented | repo memev | after: WP16-01 | owner: lane-product | serves: MV-FED-06, MV-ARCH-10
- WP16-05 [planned (docs only)] Portfolio sequence: Operating Environment, Federation, Network | repo memev | after: WP16-01 | owner: lane-product | serves: MV-PRD-03, MV-PRD-08
- WP16-06 [new gap] Infrastructure Strategy and Architecture Blueprint: target architecture, repository mapping, missing capabilities, interfaces, licensing boundaries, build sequence, first wedge | repo memev | after: WP05-03, WP17-02 | owner: lane-product | serves: MV-PRD-06, MV-PRD-07
- WP16-07 [conflicting] Commercial value tracks nodes, trust domains, governance and managed services: pricing dimensions documented | repo memev | after: WP16-01 | owner: lane-product | serves: MV-PRD-05

## WP17 Programme governance and reconciliation (lane owner)

- WP17-01 [new gap] Reconcile register: replace the stale '27 open draft PRs' inventory with live PR, branch and contract state | repo memev | after: none | owner: owner | serves: MV-PGM-01, MV-S1-06
- WP17-02 [new gap] Disposition for every open PR and every branch without a PR (merge, rework, close or supersede) recorded in one table | repo memev | after: WP17-01 | owner: owner | serves: MV-PGM-02
- WP17-03 [new gap] One canonical contract format and id namespace: decide attest/1 specs versus proofline/1 and write the mapping | repo memev-ops | after: WP17-01 | owner: owner | serves: MV-PGM-04
- WP17-04 [new gap] Requirement ownership map: each MV-* id is either covered by an existing SR/QL/SO/WO contract or by a new task here | repo memev-ops | after: WP17-03 | owner: owner | serves: MV-PGM-05
- WP17-05 [new gap] Claim register so that two workstreams do not write the same WBS or contract at once | repo memev-ops | after: none | owner: owner | serves: MV-PGM-06, MV-PGM-03
- WP17-06 [new gap] Judgement rule recorded: a feature is accepted only with an answer to 'does this make Memev more essential to a distributed agent ecosystem' | repo memev | after: WP17-05 | owner: owner | serves: MV-PRD-09

## WP18 Interop SDKs, A2A and payments (lane lane-product)

- WP18-01 [planned (docs only)] A2A adapter alongside the existing MCP server; no replacement protocol | repo memev | after: WP04-02 | owner: lane-product | serves: MV-ARCH-11
- WP18-02 [new gap] SDK and a framework adapter (LangGraph first) so an existing agent can join a project, claim work, submit evidence and sync state | repo memev | after: WP18-01, WP10-03 | owner: lane-product | serves: MV-PRD-10
- WP18-03 [new gap] Public conformance tests that any implementation can run | repo memev | after: WP18-02, WP02-04 | owner: lane-product | serves: MV-PRD-10
- WP18-04 [new gap] Payment after verified acceptance: agentic payment protocol adapters and a Stripe adapter, idempotency, reconciliation; a payment receipt is never taken as proof of delivery | repo memev | after: WP10-03 | owner: lane-product | serves: MV-PRD-11

