# ADR 8: trust governance in the federated model

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [addendum](../ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md), [federation](../../FEDERATION.md), [identity and scopes](../../IDENTITY-AND-SCOPES.md), [trust service](../../PAID-TRUST.md), [extension points](../../EXTENSION-POINTS.md).

**Status: decided (owner decision 1 Nov 2026).** This page began as a proposal, and it now holds the definition that the owner's answers adopt; the decision text is in [DECISIONS.md](../DECISIONS.md). It builds nothing and changes no code. Where it says **PROVISIONAL**, the choice waits on ADR 3, ADR 5 or ADR 7 (all still open or proposed) or on the decision and blocker workflow SO-A-05 (not decided), or it is a record-format detail that a later schema version may change. None of those is treated here as decided. The Business and Corporate topology of addendum section 13.6.1 stays **OPEN**: the owner direction of 1 Nov 2026 puts the federated architecture in scope and does not pick a topology (work breakdown row 1.3.6).

## Why this page exists

The addendum asks for two named integrations beside the merge boundary, the admission service and the trust service, and says the exact schemas, APIs, policy model, failure semantics and guarantees must be specified, tested and accepted before being described as delivered (addendum section 13.7). The work breakdown rows 4.3.7 and 4.3.8 were blocked in part because the trust-governance side had no definition in this repository. The admission side has one: SO-F-03.3 and SO-F-08 define the contribution admission and the admission adapter. What was missing is a definition of trust governance itself: who or what is trusted at each boundary, and how trust is granted, scoped, delegated, revoked and audited. This page is that definition, as the owner decided it.

The build is a set of specs, listed under [What the build contracts cover](#what-the-build-contracts-cover). PG-W-21A, the record and the evaluation, is signed as `k-pg-w-21a-trust-record-v1-ac28ab`, and its build is in review as pull request #378. The signed text stays as it is; PG-W-21A.2 supersedes it with what the decision adds, and PG-W-21B, the book, the gate and the events, is amended before it is signed.

## What the repository says today

Each line cites what is already written, by name and not by line, so that a cite does not go stale when a file changes. Nothing here is a claim about code that is not on main.

| Statement | Source |
| --- | --- |
| Trust must affect eligibility, permitted operations and verification requirements, with provenance and reviewable changes; trust is not one self-asserted score and not a substitute for access control, cryptographic verification or independent evidence | addendum section 13.7, the trust service bullet |
| The trust service owns its trust-governance mechanisms where selected, and the admission path reads trust only as an eligibility input | addendum section 13.7, the integration boundaries; `docs/FEDERATION.md`, State, ownership and convergence |
| A compromised identity, node or operator must not retain authority because it was previously trusted or because a location is temporarily disconnected | addendum section 13.6.1 |
| Cross-organisation collaboration is only through explicit contracts, identity relationships, capabilities and data-sharing rules; a partner gains no ambient access | addendum section 13.6.1 |
| A compromised or revoked operator or device is an acceptance test: affected contributions and downstream verification are identified for review and revalidation | addendum section 13.9 |
| When a service is unavailable, Memev reports degraded capability truthfully and claims no guarantee it could not establish | addendum sections 13.7 and 13.9; `docs/FEDERATION.md`, Acceptance criteria, item 12 |
| A signed contribution proves a key signed it; authority and validity are checked separately | `docs/FEDERATION.md`, Security and trust boundaries |
| A revoked identity or capability is rejected, including queued work not yet admitted | `docs/FEDERATION.md`, Acceptance criteria, item 6 |
| The trust service is planned, runs on the engine's side of the external boundary, adds a check on merged note versions, and is not in the core; the core already checks device keys and revocation itself | `docs/PAID-TRUST.md`, What the trust service would do and What the core already does |
| The core sends the engine only two note versions and their base, never signatures | `docs/PAID-TRUST.md`, Where it would run |
| Six subject types (person, agent, device, node, operator, service), each with an owner who is a person; eight scope types from personal to organisation; keys with their own expiry and revocation | `SUBJECT_TYPES`, `SCOPE_TYPES` and `validateSubject` in `src/engine/identity.mjs`; `docs/IDENTITY-AND-SCOPES.md`, The model |
| Memberships, scope parents, subject keys checked against a request signature, and the node, operator and service subjects are planned and not enforced | `docs/IDENTITY-AND-SCOPES.md`, What is planned |
| A person vouches for an agent role offline, by a signature that does not carry to another role, principal or key | `docs/AGENT-IDENTITY.md`, the opening paragraph |
| A device is enrolled, revocable alone and counted; revoking a token is a recorded flag | `DeviceRegistry` in `src/engine/devices.mjs`; `TokenStore.revoke` in `src/engine/tokens.mjs` |
| A personal or home vault never federates into a company node; a person who leaves a company has their keys revoked and their devices removed | `docs/FEDERATION.md`, Deployment scopes and the paragraph after the diagram |
| Crdt-merge stays in its own repository and is reached only across the call-out boundary; nothing from it is vendored | `docs/scope-one/DECISIONS.md`, ADR 6 (decided) |

The code that these pull requests added is on main: the contribution admission (SO-F-03.3, `Admission` in `src/engine/federation/admission.mjs`) runs format, an optional external check, signature, authority and replay, and appends `federation.admitted` or `federation.rejected` to the operation log; the relationship and policy evaluation (SO-F-04, `evaluate` and `relationshipGate` in `src/engine/federation/policy.mjs`) denies a personal scope and offers a gate for the same external hook; and the actor resolution (SO-F-09.2, `resolveActor` and `isResolvedActor` in `src/engine/identity.mjs`) returns a frozen actor that a caller cannot forge. The composition of several checks on that hook is SO-F-04A (`composeExternal`), whose spec is merged and whose code is not built. The open follow-up "Two users of the Admission `external` hook" in [RECONCILIATION.md](../RECONCILIATION.md) records that more than one check wants that hook. No production code calls the trust record module yet.

## What is decided

Everything in this section follows the owner's answers of 1 Nov 2026 unless it is marked PROVISIONAL. The numbered principles come from the sources above.

### Principles

1. **Trust is an eligibility input, never access.** A trust record can make a subject ineligible for a purpose in a scope, or add a verification requirement. It never grants a permission, a membership, a token scope or a read. This is the rule the addendum states in section 13.7 and that SO-F-08 carries as a criterion.
2. **Deny by default.** A subject with no trust record is not eligible. This follows the safe default of ADR 5, that what is ungated stays denied, and the deny-by-default evaluation of SO-F-04; it is not a decision that ADR 5 is decided.
3. **No score.** A record states who vouched for whom, for which purposes, in which scope, until when, with which evidence references. There is no number, and propagation is not a substitute for any check in the admission path (addendum section 13.7).
4. **Local authority, with two things that cross.** Each site decides its own eligibility from signed records that its own operation log holds, and each site is its own root. A trust record from another node is never applied as trust. Only two things cross a node: a two-party contract that both parties signed, which is scoped, expires and can be revoked, and a revocation notice that its issuer signed, which any node can forward and which a node applies only when its own records give the issuer authority over what it revokes. A relay or a regional node holds no trust, so forwarding a notice gives the forwarder no authority. Trust is never transitive: a party that a trusted party trusts is not thereby trusted.
5. **Audit by the log.** Every grant, revocation, root change, approval and review request is an event in the node's operation log, signed, with short fields and no evidence body, as `federation.rejected` carries no payload today. There is no second store, as ADR 7 proposes for the vault. ADR 7 is still proposed, so this is PROVISIONAL on it.
6. **Trust does not prove.** An eligible contributor's contribution is still checked for signature, authority and replay, and its content is not thereby true. Convergence and admission claim no more than they do today (addendum section 13.7).

### Who or what is trusted at each boundary

| Boundary | What is trusted | What vouches for it today | What trust governance adds |
| --- | --- | --- | --- |
| Person | The person as the owner of their agents, devices and own subject | a person is its own owner (`validateSubject`); personal scope stays personal (`docs/IDENTITY-AND-SCOPES.md`, What is enforced today) | A person is not made eligible by trust; the eligibility of a person for an organisational scope rests on membership, and a trust record can narrow it. A person may grant and revoke trust and approve what an agent proposes |
| Operator | The person or service that administers a site, a federation relationship or a vault | the operator subject type exists; no feature issues one yet (`docs/IDENTITY-AND-SCOPES.md`, What is planned) | An operator is a subject that may grant and revoke trust, and the one that holds the optional organisation co-root (see Roots) |
| Agent | A role under one owner | a person's offline vouch for a role and its key (`docs/AGENT-IDENTITY.md`) | An agent's eligibility is for named purposes only; it never exceeds its owner's, and revoking the owner revokes the agent. An agent may propose a grant and never makes one |
| Service | An external service acting as a subject, including a service on the engine side of the call-out boundary | the service subject type exists; none is issued (`docs/IDENTITY-AND-SCOPES.md`, What is planned) | A service is eligible for named purposes only, and cannot grant or revoke; a service that gives trust advice does not become an authority by giving it (addendum section 13.7) |
| Device | One computer with its own key | enrolled, revocable alone, counted (`DeviceRegistry`) | A device's eligibility is separate from its owner's. A new device of the owner gets no trust record in a personal scope, and low trust in the owner's organisation scopes (see New devices) |
| Node | A site's Memev server as a participant | node identity is planned, appropriate to its role (`docs/FEDERATION.md`, What Federation adds to the existing architecture) | A node is eligible for the scopes of its relationships; the relationship record of SO-F-04 is the edge, and trust records say which subjects behind the edge may contribute. A relay or regional node holds no trust |
| Site | An independently governed location, a scope type | the site scope type exists (`SCOPE_TYPES`); several sites are planned (`docs/FEDERATION.md`, Deployment scopes) | A site is its own root, and is trusted by relationship, not by size or name; what crosses is limited by the policy of that relationship |
| Organisation | A group of sites under one authority, a scope type | the organisation scope type exists; cross-organisation federation is planned (`docs/FEDERATION.md`, Deployment scopes) | An organisation may hold an optional co-root. No organisation gains ambient access to another (addendum section 13.6.1); two organisations meet only through a signed contract |

### Roots

A root is a record, not a configuration value. It names a subject, a validity window (a start and an expiry), and a purpose that it is a root for; a succession record names the root that replaces another from a stated time, so that a key can change without a gap and without a hidden default. A site is its own root, held by an operator or a person subject of that site. An organisation may add one optional key as a co-root, held by an operator subject. The co-root is not inherited: each site accepts it through its own signed, expiring record, and each site can drop it alone, by revoking that record or by letting it expire. Dropping it leaves the site's own root in force. No default root exists for any subject, device or node.

### New devices

A person's new device has no trust record in a personal scope: a personal scope is never shared, so there is nothing to trust. In the owner's organisation scopes, a new device of the owner has low trust, which means it may contribute and it may not verify, at a required verification level of 1, and never above its owner. One tap on an already trusted device of the same person raises it. The tap is that person's signed act, and it records which device approved. Without the tap the device has no trust at all. If every trusted device is lost, two recovery paths exist: the owner's recovery key, or a new grant by an operator. Neither one is automatic.

### How trust is granted, scoped, delegated, revoked and audited

- **Grant.** A grant is a signed record: the subject that is trusted, the issuer, one scope, the purposes it covers, a required verification level, a start, a required expiry, and zero or more evidence references. The purposes are `contribute` (submit a contribution into the scope) and `verify` (supply a verification or finding about the scope). The list is closed and changes only by a version bump. The required verification level is a whole number of 1 or more that a grant can raise: it is the number of independent verifications a contribution of the subject needs before it counts as verified. A grant for the personal scope is refused. Only a person or an operator subject writes a grant. An agent can propose one, a person approves it, and the approval is the signed act (the proposal step runs through SO-A-05, which is not decided, so the table of who may write trust is PROVISIONAL under ADR 5).
- **Scope.** A grant covers exactly the scope it names. A grant does not reach a parent or child scope, because scope parents are planned and not enforced (`docs/IDENTITY-AND-SCOPES.md`, What is planned). PROVISIONAL.
- **Delegate.** There is no delegation in release 1. The record format reserves it: one level only, and it can only narrow (the same scope, the same or fewer purposes, an expiry no later than its parent's, a verification level no lower). The writer refuses a record that uses it and the evaluator does not honour it. A grant that comes from a contract is never a parent.
- **Revoke.** A revocation is a signed record that names the grant it revokes, a time and a reason from a closed list (compromised, left, error, other). It takes effect from its time: an evaluation at a time before it is unchanged, which keeps a decision reproducible as of a time. A revoked or expired subject, as the identity model records it, stays refused by the admission path whatever a trust record says. Only a person or an operator subject revokes. A revocation is pushed to the other side of every contract at once, and a notice is signed by its issuer so that any node can forward it.
- **Freshness.** Each contract carries a freshness window, 24 hours by default. A node measures it on its own clock, from signed messages of the peer. When the peer has been silent for longer than the window, the node refuses new contributions from that side, queues them, and keeps its local work. A queued contribution is judged at the time it is admitted, not at the time it was queued.
- **Audit.** Each grant, approval and revocation is appended to the operation log as an event with short fields.
- **What a revocation does to admitted history.** Nothing admitted is deleted or reversed. A derived overlay, kept per operation id, marks the earlier work of a revoked subject as coming from a revoked source, and recall and findings show the mark. A revoked subject's verifications stop counting. The earlier work is verified again only when the reason is a compromise; for the reasons left and error it is kept and marked, and the overlay says which reason applied. A reconstruction of who contributed what, under which authority, is the operation log read in order (addendum section 13.9).

### Tiers and the licence

Local trust records and checks are part of the free core. Multi-site trust and cross-organisation trust belong to the contact-us tiers, Business and Corporate. It is enforced through the `services` list of the licence, and a lapsed licence never invalidates trust that already exists: it stops new multi-site or cross-organisation records and leaves the existing ones as they are.

### The external trust service

An outside trust service is optional and is evidence only, for Business and Corporate. It supplies references that a person attaches to a grant when the person approves it, and never to a single contribution. A reference never grants anything, and the core never depends on one. The merge-time check of [PAID-TRUST.md](../../PAID-TRUST.md) is a different thing and stays separate: it runs on the engine's side of the boundary, on merged note versions.

### How it composes with accountable admission and convergence

- **Admission.** The pipeline today is format, external, signature, authority and replay (`Admission` in `src/engine/federation/admission.mjs`). Trust governance is one more check in the external position, ahead of the node's own steps, which is where SO-F-08 puts external admission and where the relationship check of SO-F-04 already plugs in. A refusal there is a `federation.rejected` event with the rule code and no payload. A pass does not skip any later step: signature, authority and replay still run. A node with no trust check configured behaves exactly as it does without this decision.
- **More than one check on one hook.** The follow-up "Two users of the Admission `external` hook" in [RECONCILIATION.md](../RECONCILIATION.md) names the issue, and `composeExternal` of SO-F-04A is the one composition rule: checks run in a stated order, the first refusal wins, a check that throws is a refusal, and an empty list changes nothing. Its order is PROVISIONAL.
- **Findings.** A finding is a graph claim capped at theory, promoted only by a person or a verification (SO-F-09.2). Trust supplies one question to the finding path: whether a subject is eligible to `verify` in a scope. The wiring into the finding code waits for the permission matrix (ADR 5) and the decision workflow (SO-A-05), because who may verify and dismiss is provisional there.
- **Actor resolution.** A trust record is written, and a trust question is asked, with a resolved actor and never with a name a caller supplies, so that a forged `by` cannot grant or revoke trust. The actor is the one `resolveActor` returns (SO-F-09.2). The same accountability gap is open for finding operations: the follow-up "Finding ops replay trusts the `by` field" in [RECONCILIATION.md](../RECONCILIATION.md) records that raw `applyOp` and log replay still trust `by`, and that closing it blocks the merge of the first finding writer. A trust book that rebuilds from its own log trusts that log as the Admission does, so the write path takes only resolved actors and the replay limit is stated, not hidden.
- **Convergence and the call-out boundary.** Trust governance runs in the core as local records and checks. It is not part of the merge call-out and sends nothing to the engine, which receives two note versions and their base and nothing else (`docs/PAID-TRUST.md`, Where it would run). Crdt-merge stays in its own repository (ADR 6, decided). Convergence does not make anything trusted: a replicated copy grants no authority (`docs/FEDERATION.md`, State, ownership and convergence).
- **Leases.** Whether a revoked subject may finish a write that is in flight is a question of lease semantics, ADR 3 (open). The safe default of ADR 3 is a single active writer per project with no background renewal; this decision does not change it.

### Degraded mode

If the trust check cannot run (no records readable, the check throws), the node refuses the contribution and records why, keeps its local history, and reports the degraded capability; it does not admit on trust it could not establish (addendum sections 13.7 and 13.9). A peer that is silent for longer than the freshness window is a degraded case of the same kind: the node refuses new contributions from that side, queues them, and keeps its own work.

### What is not claimed

- No contract enforces any of this yet. SO-F-08 is a signed contract that requires the admission path to read trust only as an eligibility input; its code is not on main.
- Nothing here is built beyond what main already holds (see above). The build of PG-W-21A is in review as pull request #378, and the other specs are proposed.
- The trust service of `docs/PAID-TRUST.md` is not specified here, and this page states no key format, signature scheme or release date for it.
- No tier, price or licence changes. The tiers stand ([DECISIONS.md](../DECISIONS.md), Tiers).
- ADR 3, ADR 5 and ADR 7, the workflow SO-A-05 and the topology of row 1.3.6 are not settled by this page.

## The owner's answers

The ten questions, with the option the owner chose. The other options are kept so that the consequence of each choice stays visible. The choice and its clarifications are summarised in [DECISIONS.md](../DECISIONS.md).

1. **Trust root model.** Who is the first issuer a node accepts?
   - Chosen: A, each site is its own root, with an optional organisation key for Business and Corporate (the organisation key of B, held as a co-root that each site accepts alone).
   - A. Each site is its own root. Consequence: fits local-first and independent sites, and a cross-site relationship needs an explicit exchange of roots; nothing is shared by default.
   - B. One organisation key signs the roots of its sites. Consequence: one place to revoke an organisation, and a single key whose loss is serious; it points at a hierarchical topology, one of those `docs/FEDERATION.md` lists under Topology, and the topology is open (row 1.3.6).
   - C. An external trust service is the root through its adapter. Not chosen.
   - D. The owner of the vault only (one person). Not chosen.
2. **Whether sites federate across organisations.**
   - Chosen: B, only by an explicit two-party contract that names the scope, purposes and expiry, signed by both parties and revocable (addendum section 13.6.1). Consequence: meets the programme requirement MV-FED-04 in `docs/scope-one/programme/REQUIREMENTS.md` and needs two roots to meet; revocation must cross the boundary (question 4).
   - A. No. Not chosen.
   - C. Transitive trust through a shared third party. Not chosen: the addendum warns against trust propagation standing in for access control (section 13.7).
3. **Default trust level for a new device.**
   - Chosen: B, a low level for the owner's own new devices, within the Personal limit of 3 computers, raised by one tap from a trusted device, and none without it. See New devices for the rule that a new device acts only as its owner and never above.
   - A. No trust until an operator grants it. Not chosen as the default; an operator grant is the recovery path.
   - C. The level of its owner. Not chosen: a stolen device would inherit everything until revoked.
4. **Revocation propagation guarantees.**
   - Chosen: a push at once, with the bound of B: a node that has not heard from its relationship for the contract's freshness window (24 hours by default) refuses new contributions from the other side and keeps its local work. Consequence: a revoked party loses authority even across a partition, and local work during a long partition is limited to what the node itself holds.
   - A. Best effort only. Not chosen on its own, because a disconnected node would keep accepting, which the addendum (section 13.6.1) says must not leave a revoked party with authority.
   - C. Strict confirmation of the issuer's status. Not chosen: it conflicts with working through partitions.
5. **Whether trust governance is a paid-tier feature.** The tiers are Free, Personal at $12/month or $120/year for up to 3 computers, and contact us for more ([DECISIONS.md](../DECISIONS.md), Tiers). There is no Federated tier.
   - Chosen: A, local trust records and checks are part of the free core, and multi-site and cross-organisation trust are part of the contact-us tiers, enforced through the licence `services` list. A lapsed licence never invalidates existing trust. Consequence: consistent with federation being a planned capability above Personal (`docs/FEDERATION.md`, Status) and with the free behaviour never changing (`docs/PAID-TRUST.md`, What the core already does).
   - B. All trust governance is contact-us. Not chosen.
   - C. All of it is free. Not chosen.
6. **Who may grant and revoke trust** (couples to the permission matrix, ADR 5, open).
   - Chosen: A, a person or an operator subject only. Agents propose and a person approves, and each act is signed and logged. Consequence: matches the provisional dismissal rule of SO-F-09.2; agents and services cannot change trust. The proposal step is SO-A-05, which is not decided, and the table is PROVISIONAL under ADR 5.
   - B. The owner of the scope only. Not chosen.
   - C. Any subject with a role in a matrix. Not chosen: it waits on ADR 5.
7. **Purposes and verification requirements.**
   - Chosen: A and C together: two purposes, contribute and verify, plus a required-verification level that a grant can raise. Consequence: matches "trust affects verification requirements" (addendum section 13.7); the level counts verifications as the verification model of SO-F-09.2 defines them.
   - B. An open list per organisation. Not chosen.
8. **What a revocation does to already admitted contributions.**
   - Chosen: B, mark the affected contributions as coming from a revoked source, by a derived overlay, and verify them again only on a compromise. Consequence: truthful display, and a change to the knowledge status model (programme task WP10-01) that the overlay keeps out of the stored records.
   - A. Review only. Not chosen on its own.
   - C. Quarantine automatically. Not chosen: it can remove work that was fine.
9. **Whether delegation exists in the first release.**
   - Chosen: A for release 1, with the format of B reserved: one level, narrower only. Consequence: the writer and the evaluator ignore it, and a contract-sourced grant is never a parent.
   - C. Unbounded delegation. Not chosen.
10. **The role of the external trust service.**
    - Chosen: A in a narrower form: optional, and evidence only, as references on a grant at approval, for Business and Corporate. Consequence: the core never depends on it.
    - B. Source of records. Not chosen.
    - C. Not used by the core. Not chosen as the whole answer, because references are allowed.

## What the build contracts cover

The build is a set of specs, so that the part that depends on nothing open can proceed alone. All are proposed and unsigned unless stated, and the register in [RECONCILIATION.md](../RECONCILIATION.md) holds each one's status.

PG-W-21A (work package WP21-01) is the trust record data model and its schema, the validator, and an evaluation with deny by default and revocation as of a stated time. It is signed, it is a pure library that imports only the identity module on main, and it has no production caller, which is stated here and not waived. PG-W-21A.2 supersedes it before it merges, and adds the signature block, the verification level, the reserved delegation, the root records with succession, the optional co-root and the new-device rule. The signed file is not edited.

PG-W-21B (work packages WP21-02 and WP21-03) is the trust book over the operation log with its audit events and read-only reader, the eligibility gate for the Admission external hook, the composition of checks on that hook, the marking overlay, the review requests, and tests of the boundaries (trust never grants, the crdt-merge call-out is not touched, a personal scope is never shared). It builds on PG-W-21A.2, on the Admission of SO-F-03.3, on the actor of SO-F-09.2 and on `composeExternal` of SO-F-04A. It does not close the open follow-up "Finding ops replay trusts the `by` field" in [RECONCILIATION.md](../RECONCILIATION.md), which blocks the first finding writer; its trust book reads only resolved actors on its write path.

Four more specs are named in the register and are not written yet: a successor of the relationship contract (version 2 with two signatures, a freshness field and the sending node bound, checked against pull request #382 for overlap), a transport and push contract for revocation and relationship notices, a device pairing and recovery contract, and a small entitlement gate for the tier placement of question 5.

The topology of row 1.3.6 stays open and is not an input to any of it.

## How this closes

Per [DECISIONS.md](../DECISIONS.md), How these close, an ADR moves to decided when its owner records a choice there and the matching contract lands the behaviour. ADR 8 is recorded as decided; each behaviour is available only when its contract lands.
