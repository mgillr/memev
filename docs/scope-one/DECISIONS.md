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

- Status: decided (owner decision 1 Nov 2026)
- Decision owner: owner
- Decision: trust governance is a set of local, signed, revocable eligibility records about who or what (person, operator,
  agent, service, device, node, site) may contribute or verify in which scope. Trust is read only as an eligibility input of
  the admission path: it can refuse or add a verification requirement and never grants access, and a subject with no record
  is not eligible. Records live in the node's operation log, with no second store. The owner answered the ten questions of
  [design/trust-governance.md](design/trust-governance.md) as follows.
  1. Trust root (question 1): each site is its own root, with an optional organisation key for Business and Corporate.
  2. Across organisations (question 2): only through a two-party contract that both parties sign, that is scoped, expires
     and can be revoked. There is no transitive trust.
  3. New device (question 3): the owner's own new device gets low trust, which one tap from an already trusted device
     raises. Without that tap it gets none.
  4. Revocation across nodes (question 4): a revocation is pushed at once, and each contract has a freshness window (24 hours
     by default). A node refuses new contributions from a side that has been silent for longer than the window, and keeps
     its local work.
  5. Tier placement (question 5): local trust is free. Multi-site and cross-organisation trust are in the contact-us tiers.
  6. Who may grant and revoke (question 6): only a person or an operator subject. Agents propose and a person approves,
     and each grant or revocation is signed and logged.
  7. Purposes (question 7): contribute and verify, plus a required-verification level that a grant can raise.
  8. Admitted history (question 8): earlier work is kept and marked as coming from a revoked source, by an overlay. It is
     re-verified only when the cause is a compromise.
  9. Delegation (question 9): none in release 1. The record format reserves one level of delegation that can only narrow.
  10. External trust service (question 10): optional, and evidence only, for Business and Corporate.
- Clarifications the owner adopted:
  1. The new-device rule (3) means that a new device gets no trust record in a personal scope. Low trust means
     contribute-only at required verification 1, in the owner's organisation scopes only, and never above the owner.
  2. The one tap is the person's signed act, and it records the approving device. Lost-device recovery has two paths: the
     owner's recovery key, or a new grant by an operator.
  3. The organisation key is an optional co-root held by an operator subject. Each site accepts it through its own signed,
     expiring record and can drop it alone.
  4. Roots are records with validity windows, and a succession record moves a root to its successor.
  5. The proposal step goes through SO-A-05, which is not decided. The table of who may write trust (GRANT_AUTHORITY)
     stays provisional under ADR 5.
  6. A contract carries both signatures, a freshness field, and binds the sending node.
  7. Freshness is measured on the local clock from signed peer messages. A contribution refused for staleness is queued, and
     it is evaluated at the time it is admitted.
  8. Delegation is reserved in the format only. The writer and the evaluator ignore it in release 1, and a grant that comes
     from a contract is never a parent.
  9. The marking is a derived overlay per operation id. A revoked subject's verifications stop counting. The reasons left
     and error are defined by the spec that builds the overlay.
  10. An external trust service supplies references on a grant, attached when a person approves it and never per
      contribution. The merge-time check of [PAID-TRUST.md](../PAID-TRUST.md) stays separate from these references.
  11. Question 5 is enforced through the services list of the licence. A licence that lapses never invalidates trust that
      already exists.
  12. The tiers are named Business and Corporate in every document, and the stale citations and the statements that
      PG-W-21A is unsigned are corrected.
- Relay and regional nodes hold no trust: a relay only forwards, and a regional node only caches or forwards. Revocation
  notices are signed by their issuer and can be forwarded by any node, so a forwarder is never trusted for their content.
- Sources: the questions and options in [design/trust-governance.md](design/trust-governance.md); the addendum, section 13.7
  and the acceptance tests of section 13.9 ([ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md](ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md));
  [FEDERATION.md](../FEDERATION.md); [PAID-TRUST.md](../PAID-TRUST.md); the signed contract SO-F-08.
- Reasons: each site stays able to work alone, so local-first holds, and nothing is shared by default. The only things that
  cross a boundary are a contract that two parties signed and a notice that its issuer signed, so no party gains authority
  by being forwarded or by being a neighbour of a trusted party. A person stays accountable for every grant.
- Still open, and not settled by this record: ADR 3 (lease semantics), ADR 5 (permission matrix) and ADR 7 (memory and
  project-state authority) stay as they are, SO-A-05 (the decision and blocker workflow) is not decided, and the topology of
  work breakdown row 1.3.6 stays open. The table of who may write trust is provisional until ADR 5 and SO-A-05 are decided,
  and deciding them changes that table and nothing else.
- Build: the decision is built by a set of specs, all proposed and unsigned unless the register in
  [RECONCILIATION.md](RECONCILIATION.md) says otherwise. PG-W-21A is signed (`k-pg-w-21a-trust-record-v1-ac28ab`) and its build
  is in review as pull request #378. PG-W-21A.2 supersedes it with the signature block, the verification level, the roots and
  the reserved delegation, and PG-W-21B is amended before it is signed.
- Safe default: deny by default and local records only, as before. Nothing in the code changes by this record, so until a
  contract lands a behaviour, that behaviour is not available.

### Tiers (historical decision, owner decision 31 Oct 2026 — superseded)

The owner decision on 31 October was the free core, Personal at $12/month or $120/year for up to 3 computers, and contact us for anything above, with no Federated tier. This was the decision in force on that date. It is explicitly superseded by the owner decision of 2 November 2026 below. The names the app and licence tooling use today remain Personal for the free core and Personal with more computers for the paid tier; the higher tiers still require code and contract work.

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


## Owner decision of 2 November 2026: add the Federated tier

This decision explicitly reverses and supersedes the 31 October 2026 decision that there would be no Federated tier. The earlier record remains above as historical context; it is no longer the current product decision.

**Decision:** Memev has five named tiers:

1. **Personal** — one person, one computer; the free core.
2. **Personal with more computers** — one person, up to three computers; the current paid Personal offer.
3. **Business** — one organisation, initially a single company node.
4. **Corporate** — one organisation across multiple sites, departments, programmes, portfolios and jurisdictions.
5. **Federated** — multiple independent organisations coordinating shared projects, programmes, portfolios, supply chains, research or industry work while retaining separate ownership, operators, trust roots, policies and legal responsibilities.

Business and Corporate concern coordination within one organisation. Federated is the distinct cross-organisation tier. It is not a shared global vault, a central authority over participants, or an assumption that one organisation can see another's internal records.

**Commercial placement:** Federated is a contact-us tier. Scope and price are determined by participating organisations, trust relationships, sites, jurisdictions, work scopes, integrations, computation workloads, governance, deployment and support. Business customers may separately commission multi-site services, but that does not substitute for the Federated tier.

**Architecture:** the existing local-first architecture, vault, communications bus, work contracts, provenance, convergence call-out boundary, identity and trust decisions remain in force. The new tier extends those foundations; it does not replace them. Cross-organisation relationships require explicit bilateral agreements, separate trust roots, narrow scopes, expiry, revocation and local policy approval. There is no transitive trust.

**Availability:** the Federated tier is a product and commercial target, not an assertion of shipped capability. The upgrade catalogue may display the tier, but the licence issuer must refuse Federated licences until the entitlement model is specified. Cross-node transport, federation membership, admission, trust exchange, sovereign policy enforcement, federated queries/reasoning and federated computation require implementation and end-to-end validation. No Federated offer may be sold as operational until its applicable acceptance criteria pass.

**Documentation:** README, tiers, pricing, services, architecture and federation documentation must describe the five-tier model consistently and distinguish Business (one organisation), Corporate (multi-site within one organisation) and Federated (independent organisations).

**Owner confirmation:** explicit in the conversation on 2 November 2026.
