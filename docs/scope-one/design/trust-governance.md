# ADR 8 proposal: trust governance in the federated model

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [addendum](../ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md), [federation](../../FEDERATION.md), [identity and scopes](../../IDENTITY-AND-SCOPES.md), [trust service](../../PAID-TRUST.md), [extension points](../../EXTENSION-POINTS.md).

**Status: proposed (pending owner decision).** This page proposes a definition. It builds nothing, changes no code and decides nothing. Every product choice in it is marked **PROVISIONAL**, and every choice that needs the owner is listed under [Open questions for the owner](#open-questions-for-the-owner), with its options and consequences, and none is settled. The decision records ADR 3, ADR 5 and ADR 7 are open or proposed in [DECISIONS.md](../DECISIONS.md) and are not treated here as decided, and neither is the decision and blocker workflow SO-A-05. The Business and Enterprise topology of addendum 13.6.1 stays **OPEN**: the owner direction of 1 Nov 2026 puts the federated architecture in scope and does not pick a topology (work breakdown row 1.3.6).

## Why this page exists

The addendum asks for two named integrations beside the merge boundary, the admission service and the trust service, and says the exact schemas, APIs, policy model, failure semantics and guarantees must be specified, tested and accepted before being described as delivered (addendum lines 331 to 347). The work breakdown rows 4.3.7 and 4.3.8 are blocked in part because the trust-governance side has no definition in this repository (WBS.md lines 374 and 375). The admission side has one: SO-F-03.3 and SO-F-08 define the contribution admission and the admission adapter. What is missing is a definition of trust governance itself: who or what is trusted at each boundary, and how trust is granted, scoped, delegated, revoked and audited. This page proposes it. The build contracts that follow from it are two, both unsigned: PG-W-21A, the record and the evaluation, which depends on no open question and no open pull request, and PG-W-21B, the book, the gate and the events, which is not to be signed before the owner signs off this ADR.

## What the repository says today

Each line cites what is already written. Nothing here is a claim about code that is not on main; code that lives only in an open pull request says so.

| Statement | Source |
| --- | --- |
| Trust must affect eligibility, permitted operations and verification requirements, with provenance and reviewable changes; trust is not one self-asserted score and not a substitute for access control, cryptographic verification or independent evidence | addendum line 335 |
| The trust service owns its trust-governance mechanisms where selected, and the admission path reads trust only as an eligibility input | addendum line 341; `docs/FEDERATION.md:185-188` |
| A compromised identity, node or operator must not retain authority because it was previously trusted or because a location is temporarily disconnected | addendum line 274 |
| Cross-organisation collaboration is only through explicit contracts, identity relationships, capabilities and data-sharing rules; a partner gains no ambient access | addendum line 273 |
| A compromised or revoked operator or device is an acceptance test: affected contributions and downstream verification are identified for review and revalidation | addendum line 381 |
| When a service is unavailable, Memev reports degraded capability truthfully and claims no guarantee it could not establish | addendum lines 343 and 382; `docs/FEDERATION.md:258-259` |
| A signed contribution proves a key signed it; authority and validity are checked separately | `docs/FEDERATION.md:228-230` |
| A revoked identity or capability is rejected, including queued work not yet admitted | `docs/FEDERATION.md:251` |
| The trust service is planned, runs on the engine's side of the external boundary, adds a check on merged note versions, and is not in the core; the core already checks device keys and revocation itself | `docs/PAID-TRUST.md:13-33`, `docs/PAID-TRUST.md:37-44` |
| The core sends the engine only two note versions and their base, never signatures | `docs/PAID-TRUST.md:38-40` |
| Six subject types (person, agent, device, node, operator, service), each with an owner who is a person; eight scope types from personal to organisation; keys with their own expiry and revocation | `src/engine/identity.mjs:13-14`, `src/engine/identity.mjs:42-64`; `docs/IDENTITY-AND-SCOPES.md:57-61` |
| Memberships, scope parents, subject keys checked against a request signature, and the node, operator and service subjects are planned and not enforced | `docs/IDENTITY-AND-SCOPES.md:78-84` |
| A person vouches for an agent role offline, by a signature that does not carry to another role, principal or key | `docs/AGENT-IDENTITY.md:5-8` |
| A device is enrolled, revocable alone and counted; revoking a token is a recorded timestamp | `src/engine/devices.mjs:4`, `src/engine/devices.mjs:99-105`; `src/engine/tokens.mjs:73-78` |
| A personal or home vault never federates into a company node; a person who leaves a company has their keys revoked and their devices removed | `docs/FEDERATION.md:147-151` |
| Crdt-merge stays in its own repository and is reached only across the call-out boundary; nothing from it is vendored | `docs/scope-one/DECISIONS.md:69-87` (ADR 6, decided) |

In open pull requests, not on main, and cited here at the heads named: the contribution admission (SO-F-03.3, pull request #358 at 7bc87da) runs format, an optional external check, signature, authority and replay, and appends `federation.admitted` or `federation.rejected` to the operation log (admission.mjs lines 4 to 19, 95 to 108); the relationship and policy evaluation (SO-F-04, pull request #368 at 8d3bbbc) denies a personal scope and offers a `relationshipGate` for the same external hook (policy.mjs lines 77 and 107 to 115); and the actor resolution (SO-F-09.2, pull request #362 at c85d4c5) returns a frozen actor that a caller cannot forge (identity.mjs lines 180 to 197). The open follow-up "Two users of the Admission external hook" in [RECONCILIATION.md](../RECONCILIATION.md) records that more than one check wants that hook.

## What is proposed

Everything in this section is **PROVISIONAL** until the owner decides the questions below. The numbered principles come from the sources above; the table rows and lifecycle choices are proposals.

### Principles

1. **Trust is an eligibility input, never access.** A trust record can make a subject ineligible for a purpose in a scope, or add a verification requirement. It never grants a permission, a membership, a token scope or a read. This is the rule the addendum states at line 341 and that SO-F-08 carries as a criterion.
2. **Deny by default.** A subject with no trust record is not eligible. This follows the safe default of ADR 5, that what is ungated stays denied (`docs/scope-one/DECISIONS.md:66-67`), and the deny-by-default evaluation of SO-F-04; it is not a decision that ADR 5 is decided.
3. **No score.** A record states who vouched for whom, for which purposes, in which scope, until when, with which evidence references. There is no number, and propagation is not a substitute for any check in the admission path (addendum line 335). PROVISIONAL.
4. **Local authority.** Each node decides its own eligibility from records its own operation log holds. A record from another node is evidence to review and is not applied until the owner decides how records cross nodes (questions 1, 2 and 4). PROVISIONAL.
5. **Audit by the log.** Every grant, delegation, revocation and revalidation request is an event in the node's operation log, with short fields and no evidence body, as `federation.rejected` carries no payload today. There is no second store, as ADR 7 proposes for the vault (`docs/scope-one/DECISIONS.md:93-95`). PROVISIONAL.
6. **Trust does not prove.** An eligible contributor's contribution is still checked for signature, authority and replay, and its content is not thereby true. Convergence and admission claim no more than they do today (addendum lines 333 and 334).

### Who or what is trusted at each boundary

| Boundary | What is trusted | What vouches for it today | What trust governance adds (PROVISIONAL) |
| --- | --- | --- | --- |
| Person | The person as the owner of their agents, devices and own subject | a person is its own owner (`src/engine/identity.mjs:42-64`); personal scope stays personal (`docs/IDENTITY-AND-SCOPES.md:68-70`) | A person is not made eligible by trust; the eligibility of a person for an organisational scope rests on membership, and a trust record can narrow it |
| Operator | The person or service that administers a site, a federation relationship or a vault | the operator subject type exists; no feature issues one yet (`docs/IDENTITY-AND-SCOPES.md:80`, `:83`) | An operator is the subject that may grant and revoke trust in this proposal (question 6) |
| Agent | A role under one owner | a person's offline vouch for a role and its key (`docs/AGENT-IDENTITY.md:5-8`) | An agent's eligibility is for named purposes only; it never exceeds its owner's, and revoking the owner revokes the agent |
| Service | An external service acting as a subject, including a service on the engine side of the call-out boundary | the service subject type exists; none is issued (`docs/IDENTITY-AND-SCOPES.md:80`) | A service is eligible for named purposes only; a service that gives trust advice does not become an authority by giving it (addendum line 335) |
| Device | One computer with its own key | enrolled, revocable alone, counted (`src/engine/devices.mjs:4`, `:99-105`) | A device's eligibility is separate from its owner's; the default level for a new device is open (question 3) |
| Node | A site's Memev server as a participant | node identity is planned, appropriate to its role (`docs/FEDERATION.md:52-53`) | A node is eligible for the scopes of its relationships; the relationship record of SO-F-04 is the edge, and trust records say which subjects behind the edge may contribute |
| Site | An independently governed location, a scope type | the site scope type exists (`src/engine/identity.mjs:14`); several sites are planned (`docs/FEDERATION.md:80`) | A site is trusted by relationship, not by size or name; what crosses is limited by the policy of that relationship |
| Organisation | A group of sites under one authority, a scope type | the organisation scope type exists; cross-organisation federation is planned (`docs/FEDERATION.md:82`) | No organisation gains ambient access to another (addendum line 273); whether any cross-organisation trust exists is question 2 |

### How trust is granted, scoped, delegated, revoked and audited

- **Grant.** A grant is a record: the subject that is trusted, the issuer, one scope, the purposes it covers, a start, a required expiry, and zero or more evidence references. The purposes in version 1 are `contribute` (submit a contribution into the scope) and `verify` (supply a verification or finding about the scope). The list is closed in version 1 and changes only by a version bump. A grant for the personal scope is refused, as a personal scope is never shared (SO-F-04). PROVISIONAL.
- **Scope.** A grant covers exactly the scope it names. A grant does not reach a parent or child scope, because scope parents are planned and not enforced (`docs/IDENTITY-AND-SCOPES.md:78`). PROVISIONAL.
- **Delegate.** A grant may allow re-delegation to a stated depth. A delegated grant can only narrow its parent: the same scope, the same or fewer purposes, the same or an earlier expiry and a lower depth. A depth of zero means no delegation. Whether delegation exists at all in the first release is question 9. PROVISIONAL.
- **Revoke.** A revocation is a record that names the grant it revokes, a time and a reason from a closed list (compromised, left, error, other). It takes effect from its time: an evaluation at a time before it is unchanged, which keeps a decision reproducible as of a time. Revoking a grant revokes every grant delegated from it. A revoked or expired subject, as the identity model records it (`src/engine/identity.mjs:42-64`), stays refused by the admission path whatever a trust record says. Who may revoke is question 6; how fast a revocation reaches other nodes is question 4. PROVISIONAL.
- **Audit.** Each grant and revocation is appended to the operation log as an event with short fields. When a revocation covers a subject whose contributions the node already admitted, the node appends one revalidation request per affected contribution, naming the contribution, the subject and the scope. The request starts a human or downstream review; it does not delete, reverse or quarantine anything, because what happens to admitted history is question 8. A reconstruction of who contributed what, under which authority, is the operation log read in order (addendum line 383). PROVISIONAL.

### How it composes with accountable admission and convergence

- **Admission.** The pipeline today is format, external, signature, authority and replay (admission.mjs lines 4 to 9 of pull request #358). Trust governance is proposed as one more check in the external position, ahead of the node's own steps, which is where SO-F-08 puts external admission and where the relationship check of SO-F-04 already plugs in. A refusal there is a `federation.rejected` event with the rule code and no payload. A pass does not skip any later step: signature, authority and replay still run. A node with no trust check configured behaves exactly as it does without this proposal. PROVISIONAL.
- **More than one check on one hook.** The follow-up "Two users of the Admission external hook" in [RECONCILIATION.md](../RECONCILIATION.md) names the issue. The proposal is one composition rule: checks run in a stated order, the first refusal wins, a check that throws is a refusal, and an empty list changes nothing. PROVISIONAL.
- **Findings.** A finding is a graph claim capped at theory, promoted only by a person or a verification (SO-F-09.2). Trust supplies one question to the finding path: whether a subject is eligible to `verify` in a scope. The wiring into the finding code is not part of this proposal and waits for the permission matrix (ADR 5) and the decision workflow (SO-A-05), because who may verify and dismiss is provisional there.
- **Actor resolution.** A trust record is written, and a trust question is asked, with a resolved actor and never with a name a caller supplies, so that a forged `by` cannot grant or revoke trust. The actor is the one SO-F-09.2 resolves (pull request #362). The same accountability gap is open for finding operations: the follow-up "Finding ops replay trusts the `by` field" in [RECONCILIATION.md](../RECONCILIATION.md) records that raw `applyOp` and log replay still trust `by`, and that closing it blocks the merge of the first finding writer. A trust book that rebuilds from its own log trusts that log as the Admission does, so the write path takes only resolved actors and the replay limit is stated, not hidden.
- **Convergence and the call-out boundary.** Trust governance runs in the core as local records and checks. It is not part of the merge call-out and sends nothing to the engine, which receives two note versions and their base and nothing else (`docs/PAID-TRUST.md:38-40`). Crdt-merge stays in its own repository (ADR 6, decided). The trust service of the addendum, which `docs/PAID-TRUST.md` describes as planned on the engine's side, remains an adapter boundary beside the merge boundary (`docs/EXTENSION-POINTS.md:65`); whether it becomes a source of trust records for the core is question 10. Convergence does not make anything trusted: a replicated copy grants no authority (`docs/FEDERATION.md:159`).
- **Leases.** Whether a revoked subject may finish a write that is in flight is a question of lease semantics, ADR 3 (open). The safe default of ADR 3 is a single active writer per project with no background renewal (`docs/scope-one/DECISIONS.md:46-47`); this proposal does not change it.

### Degraded mode

If the trust check cannot run (no records readable, the check throws), the node refuses the contribution and records why, keeps its local history, and reports the degraded capability; it does not admit on trust it could not establish (addendum lines 343 and 382). PROVISIONAL.

### What is not claimed

- No contract enforces any of this yet. SO-F-08 is a signed contract that requires the admission path to read trust only as an eligibility input; its code is not on main.
- Nothing here is built. The build contracts PG-W-21A and PG-W-21B are unsigned.
- The trust service of `docs/PAID-TRUST.md` is not specified here, and this page states no key format, signature scheme or release date for it.
- No tier, price or licence changes. The tiers stand (DECISIONS.md lines 104 to 111).

## Open questions for the owner

Each question lists its options and what follows from each. None is settled here, and until the owner records an answer in [DECISIONS.md](../DECISIONS.md) the safe default of ADR 8 holds: local records only, deny by default, no record crosses a node. The second build contract (PG-W-21B) marks what depends on each question as deferred; the first (PG-W-21A) depends on none of them.

1. **Trust root model.** Who is the first issuer a node accepts?
   - A. Each site is its own root. Consequence: fits local-first and independent sites, and a cross-site relationship needs an explicit exchange of roots; nothing is shared by default.
   - B. One organisation key signs the roots of its sites. Consequence: one place to revoke an organisation, and a single key whose loss is serious; it points at a hierarchical topology, one of those `docs/FEDERATION.md:100` lists, and the topology is open (row 1.3.6).
   - C. An external trust service is the root through its adapter. Consequence: reuses the service the addendum names; the core then depends on it for eligibility, and the degraded-mode rule means a node without it refuses.
   - D. The owner of the vault only (one person). Consequence: simplest, and does not scale beyond one person's devices.
2. **Whether sites federate across organisations.**
   - A. No: trust stays within one organisation in the first federated release. Consequence: smallest scope; partner collaboration waits.
   - B. Yes, only by an explicit contract between two organisations that names the scope, purposes and expiry (addendum line 273). Consequence: meets the programme requirement MV-FED-04 (`docs/scope-one/programme/REQUIREMENTS.md:63`) and needs two roots to meet; revocation must cross the boundary (question 4).
   - C. Yes, by transitive trust through a shared third party. Consequence: easiest to join, and the addendum warns against trust propagation standing in for access control (line 335).
3. **Default trust level for a new device.**
   - A. No trust until an operator grants it. Consequence: matches deny by default; every new computer needs a step.
   - B. A low level for the owner's own new devices, within the Personal limit of 3 computers. Consequence: less friction; it needs a rule that a new device acts only as its owner and never above.
   - C. The level of its owner. Consequence: simplest to explain, and a stolen device inherits everything until revoked.
4. **Revocation propagation guarantees.**
   - A. Best effort: a node applies a revocation when it learns of it. Consequence: honest and cheap, and a disconnected node keeps accepting until it reconnects, which is the case addendum line 274 says must not leave a revoked party with authority.
   - B. A bound: a node that has not heard from its relationship for a stated time refuses new contributions from the other side. Consequence: a revoked party loses authority even across a partition; local work during a long partition is limited.
   - C. Strict: a contribution is admitted only after the issuer's current status is confirmed. Consequence: strongest, and it needs a reachable issuer, which conflicts with working through partitions.
5. **Whether trust governance is a paid-tier feature.** The tiers are Free, Personal at $12/month or $120/year for up to 3 computers, and contact us for more (DECISIONS.md lines 104 to 111). There is no Federated tier (DECISIONS.md line 123).
   - A. Local trust records and checks are part of the free core, and multi-site and cross-organisation trust is part of the contact-us tiers. Consequence: consistent with federation being a planned capability above Personal (`docs/FEDERATION.md:12-13`) and with the free behaviour never changing (`docs/PAID-TRUST.md:29-30`).
   - B. All trust governance is contact-us. Consequence: simplest commercially; a single company vault with several members then has no trust records in the free core.
   - C. All of it is free, and only the external trust service on the engine's side is paid, as it is described today (`docs/PAID-TRUST.md:8-11`). Consequence: the core stays complete; the paid line is the engine, as for the merge.
6. **Who may grant and revoke trust** (couples to the permission matrix, ADR 5, open).
   - A. A person or an operator subject only. Consequence: matches the provisional dismissal rule of SO-F-09.2; agents and services cannot change trust.
   - B. The owner of the scope only. Consequence: simplest to audit; a larger organisation needs one more step to delegate administration.
   - C. Any subject with a role in a matrix. Consequence: flexible; it waits on ADR 5 and is the largest change.
7. **Purposes and verification requirements.**
   - A. Two purposes, contribute and verify, as proposed. Consequence: small; later purposes need a version bump.
   - B. An open list per organisation. Consequence: flexible; harder to test and to audit across sites.
   - C. Add a required-verification level that a grant can raise (for example two independent verifications for a given purpose). Consequence: matches "trust affects verification requirements" (addendum line 335) and needs the verification model of SO-F-09.2 to be settled first.
8. **What a revocation does to already admitted contributions.**
   - A. Review only: one revalidation request per affected contribution, nothing changes. Consequence: nothing is lost or reversed silently, and a bad contribution stays in place until a person acts.
   - B. Mark the affected contributions as under review so recall and findings show them as such. Consequence: truthful display, and a change to the knowledge status model (programme task WP10-01).
   - C. Quarantine automatically. Consequence: fastest containment, and it can remove work that was fine; it needs a defined undo.
9. **Whether delegation exists in the first release.**
   - A. No delegation. Consequence: simplest; one issuer per grant.
   - B. Delegation to a stated depth that only narrows. Consequence: scales administration; revocation must cascade and be tested.
   - C. Unbounded delegation. Consequence: the addendum's warning about propagation applies (line 335); not proposed.
10. **The role of the external trust service.**
    - A. Advisory: its answers are an input to a local record that an operator accepts. Consequence: the core never depends on it.
    - B. Source of records: the core applies what it returns. Consequence: one source of truth across sites, and a hard dependency whose failure mode is the degraded mode above.
    - C. Not used by the core: the adapter stays planned and unspecified here. Consequence: smallest; the core's local records are the whole of trust governance in this release.

## What the build contracts cover

The build is split in two unsigned contracts, so that the part that depends on nothing open can proceed alone.

PG-W-21A (work package WP21-01) is the trust record data model and its schema, the validator, and an evaluation with deny by default, delegation that only narrows and revocation that cascades, as of a stated time. It is a pure library that imports only the identity module on main, so it depends on no open owner question and on no open pull request. It has no production caller, which is stated here and not waived.

PG-W-21B (work packages WP21-02 and WP21-03) is the trust book over the operation log with its audit events and read-only reader, the eligibility gate for the Admission external hook, the composition of checks on that hook, the revalidation requests, and tests of the boundaries (trust never grants, the crdt-merge call-out is not touched, a personal scope is never shared). It builds on PG-W-21A, on the Admission of SO-F-03.3 and on the actor of SO-F-09.2, so it starts after those pull requests merge, and it is not to be signed before the owner signs off this ADR. It defers, with a pointer to the question, the trust root (1), cross-organisation trust (2), a default for new devices (3), revocation across nodes (4), any tier gate (5), the final rule for who may grant (6, shipped as one provisional table), further purposes (7), any effect on admitted history beyond a review request (8), delegation depth beyond the stated limit (9), use of the external service (10), and the wiring into the finding code. It does not close the open follow-up "Finding ops replay trusts the `by` field" in [RECONCILIATION.md](../RECONCILIATION.md), which blocks the first finding writer; its trust book reads only resolved actors on its write path. The topology of row 1.3.6 stays open and is not an input to any of it.

## How this closes

Per [DECISIONS.md](../DECISIONS.md) lines 158 to 160, an ADR moves to decided when its owner records a choice there and the matching contract lands the behaviour. Until then the safe default holds. A decision on a question above changes the deferred requirement it names and nothing else.
