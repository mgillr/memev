# Scope One decisions

This page holds the architecture decision records the handoff leaves open, the decisions the
owner has made since, and a separate list of questions that only the product owner can answer.
An ADR that is open or proposed records a decision that is not yet made: it names the topic, the
current status, the rationale for leaving it open, the owner who will close it, and the safe
default the code follows until then. An ADR that is decided records what was chosen and why.
Nothing on this page changes behaviour; it records what is decided, what is undecided and what
we do in the meantime.

[Back to the documentation index](../README.md)

## ADRs

Each ADR uses a fixed topic list from the handoff. Status is one of `open`, `proposed`,
`decided`. While a status is `open` or `proposed`, the safe default is the behaviour the
current code already uses, so no contract is blocked on a guess.

### ADR 1: store schema version and migration

- Status: open
- Decision owner: engineering owner of the project-state contract
- Rationale: the project and task state machine introduces a new store shape. Whether it
  is a new schema version, a migration of the existing store, or a separate store is not
  settled. The handoff forbids a second store, so the choice is between a versioned
  migration and an in-place extension.
- Safe default: extend the existing store in place and record a schema version field; do
  not create a second store. Migrations are additive and reversible.

### ADR 2: id and event ordering

- Status: open
- Decision owner: engineering owner of the project-state contract
- Rationale: ids for projects, tasks and state events, and the order those events are
  applied, are not fixed. The op-log already provides an append-only order; the open
  question is whether state-machine events reuse that order or carry their own sequence.
- Safe default: reuse the existing op-log order for state events; ids are opaque strings
  assigned at write time. No reordering, no gaps.

### ADR 3: lease semantics

- Status: open
- Decision owner: engineering owner of the project-state contract
- Rationale: when two writers or two devices work the same project, a lease decides who may
  write. The handoff does not fix lease duration, renewal, or what happens on expiry.
- Safe default: a single active writer per project; a lease is implicit while a write is
  in flight and there is no background renewal. Contending writes are queued, not merged.

### ADR 4: policy defaults

- Status: open
- Decision owner: product owner
- Rationale: the default recall, retention and compaction policies are not set. These
  affect what a user sees and how long data is kept, so they are a product decision, not
  an engineering one.
- Safe default: keep the policies the current code already applies. New projects inherit
  the existing defaults; nothing is tightened or loosened until the product owner decides.

### ADR 5: permission matrix

- Status: open
- Decision owner: product owner
- Rationale: which role may do which action (create a project, edit a task, run an engine
  call, export) is not fixed as a matrix. The entitlements module already gates some
  actions; the open question is the full role-by-action table.
- Safe default: keep the entitlements module current gates. No new role or action is
  granted until the matrix is decided; anything ungated stays denied.

### ADR 6: the convergence engine stays in its own repository

- Status: decided (owner decision 31 Oct 2026)
- Decision owner: owner
- Decision: crdt-merge (BSL 1.1, licensed by its licensor, with its PATENTS file) stays in its
  own repository. Memev (Apache-2.0) consumes it only across the existing external call-out and provider
  boundary (WO-05-A, [docs/CONVERGENCE.md](../CONVERGENCE.md)). Nothing from crdt-merge is vendored, copied
  or ported into Memev, including any TypeScript port. There is no new Memev merge engine and no new
  merge-engine repository.
- Reasons: this keeps the BSL-licensed, patented engine out of the Apache-2.0 core, so that including
  it in the core cannot relicense it. Inclusion in an Apache-2.0 work would put the engine's code
  under terms that let anyone use it, and it would weaken the position the PATENTS file protects. A call-out
  boundary lets each side keep its own licence, and the free core works without the engine.
- Superseded by this decision: PI-04 and PI-05 (branch `dev-integration-specs`, not modified by this
  record), and SR-3.01 and SR-3.03 (memev-ops, seed readiness). SR-3.05 states the licences once:
  Apache-2.0 core, BSL-1.1 crdt-merge, ACFA-RS under its own licence, commercial federated services.
- Open item: a software licensing lawyer reviews the BSL change date of 2028-03-29 and the combined
  distribution against the BSL use restriction. The change date is not changed by this record.
- Safe default: keep the call-out boundary as it is; do not build or re-sign the superseded contracts.

### ADR 7: memory and project-state authority

- Status: proposed (pending owner confirmation)
- Decision owner: owner
- Proposal: the vault and its store are the one canonical authority for memory and project state, local-first,
  with no second database. External components (the engine, the admission service, the trust service, compute
  runtimes) are reached only across adapter boundaries, and there is no migration to another implementation.
- Sources: what is decided is the owner decision of 31 Oct 2026 (below): topology is local-first and the cloud is
  only a relay and a backup. The wider statement that the vault is the only authority is recorded in the owner
  vault as decision D-SO-MEMORY-AUTHORITY, which that record shows as taken under the owner's delegation of 30 Oct 2026, not as the owner's own word. It is cited by id and is not copied here.
- Rationale for leaving it proposed: no owner-signed contract or owner statement in this repository carries the
  second part, so it is not stated here as decided.
- Safe default: keep the code as it is: one store under the vault, no second database, and the engine behind the
  call-out boundary (ADR 6, SO-1.01).

### ADR 8: trust governance in the federated model

- Status: proposed (pending owner decision)
- Decision owner: owner
- Proposal: trust governance is a set of local, revocable eligibility records about who or what (person, operator, agent,
  service, device, node, site) may contribute or verify in which scope. Trust is read only as an eligibility input of the
  admission path: it can refuse or add a verification requirement and never grants access, and a subject with no record is not
  eligible. Records live in the node's operation log, with no second store, and a revocation asks for review of what the
  subject already contributed and changes nothing silently. Every product choice in it is provisional. The full proposal, with
  the ten open questions for the owner (trust root model, federation across organisations, the default for a new device,
  revocation propagation, tier placement, who may grant and revoke, purposes, effect on admitted history, delegation, and the
  role of the external trust service), is in [design/trust-governance.md](design/trust-governance.md).
- Sources: addendum lines 331 to 347 and 381 to 383 ([ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md](ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md));
  [FEDERATION.md](../FEDERATION.md); [PAID-TRUST.md](../PAID-TRUST.md); the signed contract SO-F-08, whose code is not on main.
- Rationale for leaving it proposed: the repository defines the admission side and no definition of trust governance, and the
  owner has not answered the questions that shape it. The topology of work breakdown row 1.3.6 stays open.
- Safe default: local records only, deny by default, no record crosses a node, and the trust service stays an unspecified
  adapter boundary beside the merge boundary (ADR 6, `docs/EXTENSION-POINTS.md`). Nothing in the code changes.

### Tiers (decided, owner decision 31 Oct 2026)

The free core, Personal at $12/month or $120/year for up to 3 computers, and contact us for
anything above. There is no Federated tier, no per-computer price for Business or Corporate, and no
separate Personal trial. Every tier and pricing page follows this ([PRICING.md](../PRICING.md),
[tiers](../tiers/README.md)). The names the app, the licence tooling and their tests use today are
Personal for the free core and Personal with more computers for the paid tier; renaming them is a code
and contract change that this record does not make.

## Owner decisions of 31 October 2026

These are decided, in the owner's words of that day. Cite them as "owner decision 31 Oct 2026".

- Topology: local-first. The cloud is only a relay and a backup.
- Providers are neutral: every supported provider stands on equal footing, and no work or tier depends on one.
- Tiers: the Free core, which includes cloud AI and is the trial; Personal at $12/month or $120/year for up to 3
  computers; contact us for the higher tiers. There is no separate Personal trial (docs/BUSINESS-TRIAL.md).
- Engine: crdt-merge stays in its own repository and is reached only across the call-out boundary; it is
  never vendored into Memev (ADR 6). The BSL change date of 2028-03-29 is unchanged and awaits a lawyer review.
- No Federated tier: federation across sites is planned and is not available.
- Review: while the reviewer is out, the author acts as interim reviewer with one interim key
  (docs/CONTRACTS.md, "The interim reviewer"). What it signs says so and waits for an independent re-review.

These close the owner decisions the [addendum](ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md) review asked for first
(topology, provider neutrality, tier set). They do not accept the addendum's other recommendations; those still need
explicit acceptance one by one.

## Decisions taken under owner delegation

- Layer to build against (decided, owner delegation, 1 Nov 2026): the fold (`SO-A-01` to `SO-A-12`, `SO-R-E`,
  `SO-F-01` to `SO-F-13` except `SO-F-11`, which was dropped and whose guards moved into `SO-F-03`, `SO-F-04`,
  `SO-F-07` and `SO-F-10`; 25 signed contracts, cited by id only) is the build layer. The programme specs `PG-04.1`,
  `PG-05.1`, `PG-08.1`, `PG-09.1`, `PG-10.1`, `PG-13.1` and `PG-14.1` cite the fold ids per task and keep only what the
  fold does not cover; the table is in [RECONCILIATION.md](RECONCILIATION.md). `PG-06.1` and `PG-12.1` were signed and
  overlap the fold; the signer superseded them (1 Nov 2026) with `PG-06.2` and `PG-12.2`, which cite the fold ids and
  keep only the gaps. The signed files are unchanged and stay on record; the manifest and RECONCILIATION carry the
  back-reference.
- ADR 7 (memory and project-state authority) stays proposed, pending owner confirmation.

## Product-owner decision list

These questions block specific contracts. Each lists the contracts it blocks (ids from the
[inventory](INVENTORY.md)) and a safe default so work can continue without an answer. The
product owner closes each by choosing an option; until then the safe default holds.

| Question | Contracts blocked | Safe default |
| --- | --- | --- |
| Which configured AI clients are in scope for the first release, and in what order? | MEM-101, MEM-051 | ship the clients already documented; add new ones behind the same hand-off without a new contract |
| Which deployment modes ship in the first release? | MEM-138, MEM-139 | local-first; cloud-hosted behind the same interface |
| What is the secure remote model for customer-initiated access? | MEM-142 | customer-initiated only, no standing remote session |
| What is the paid conversion path and its place in the flow? | MEM-133 | keep the current conversion step |

## How these close

- An ADR moves to `decided` when its owner records a choice here and the matching contract
  lands the behaviour. The [traceability](TRACEABILITY.md) page then points the affected
  requirement at the deciding contract.
- A product-owner question is removed from this list when the answer is recorded and the
  blocked contracts proceed. The safe default is what the code does until that moment, so
  removing a row never changes behaviour on its own.
