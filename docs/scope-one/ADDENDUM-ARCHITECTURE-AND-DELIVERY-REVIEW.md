# Scope One Addendum — Architecture, Delivery and Competitive Risks

**Status:** Proposal for independent review  
**Applies to:** Scope One  
**Purpose:** Record additional concerns and recommendations for review by Ryan, Claude A and Claude B. This addendum does not silently change the agreed Scope One requirements or authorise implementation. Recommendations become development decisions only after explicit consensus and acceptance.

## Product outcome

Scope One remains the complete product target: a user describes an outcome; Memev resolves ambiguity and obtains approval for material scope; coordinates supported agents and tools; manages durable project/task state; and returns a deliverable with independently checkable evidence.

The first end-to-end demonstration is an integration gate, not a replacement for the full Scope One scope. Do not reduce the product to a memory store, agent launcher or coding-only workbench.

## Findings and recommendations

### 1. Establish one trustworthy development baseline

**Concern:** The takeover inventory and requirement register can drift as branches and pull requests advance. The inventory snapshot recorded open work that had not been individually reconciled; the live repository query subsequently returned a different open-PR count. Branch existence, a draft PR, a passing isolated test, a merge and verified integration are different states.

**Recommendation:**
- Reconcile every Scope One branch and open PR against current `main` before commissioning overlapping work.
- Give each canonical requirement one owner, one implementation path, explicit dependencies and acceptance tests.
- Mark work as implemented, merged, integrated and verified separately; do not use these terms interchangeably.
- Close or supersede duplicate/twin contracts explicitly, preserving links and rationale.
- Reconcile the takeover register whenever the baseline changes. Treat counts in old snapshots as historical, not live status.

### 2. Integrate the state machine, store and coordinator before expanding orchestration

**Concern:** The project/task state machine is a valuable foundation, but by itself it is not a persistent, distributed execution system. A coordinator or store that is implemented independently can introduce a second source of truth or weaken the transition and evidence rules.

**Recommendation:**
- Make the project store the durable authority for project entities and append-only events.
- Make the coordinator the authority for claims, leases, generations, dependency-aware dispatch and ownership.
- Route state changes through the existing transition rules; do not allow adapters or UI code to mutate authoritative state directly.
- Define transaction and crash boundaries, idempotency keys, replay/recovery behaviour and schema migration rules.
- Treat stale generations, expired leases, duplicate delivery and concurrent claims as normal adversarial test cases.

### 3. Define a provider-neutral agent adapter contract

**Concern:** Shared state and task claims do not, by themselves, prove that Memev can reliably operate real AI clients. Provider-specific lifecycle differences, unavailable sessions, partial results and unsupported cancellation can undermine the product.

**Recommendation:**
- Define one adapter contract with declared capabilities, identity, session discovery, dispatch, progress/result reporting, checkpointing, cancellation semantics and recovery.
- Implement a small number of real integrations end to end before broadening the provider list.
- Keep provider-specific behaviour inside adapters; the planner and coordinator must consume capability declarations rather than provider-specific conditionals.
- Distinguish a requested action, an accepted dispatch, an observed execution and a verified outcome in the event history.
- Never report successful completion merely because a provider returned a success-shaped response.

### 4. Keep planning, execution, policy and verification separate

**Concern:** If one agent both plans work, performs it and declares it complete, the system cannot independently establish that the approved outcome was achieved.

**Recommendation:** Keep explicit boundaries for:
- **Intake and scope resolution:** identify ambiguity, assumptions, constraints and decisions requiring user approval.
- **Planning:** create a versioned dependency-aware task graph and acceptance criteria.
- **Coordination:** own the authoritative plan, claims and dispatch.
- **Agent adapters:** perform work within declared capabilities and permissions.
- **Policy and approvals:** enforce filesystem, network, credentials, spend and consequential-action boundaries.
- **Verification:** run checks independently where possible and bind evidence to the relevant scope version and artifact identity.
- **Project store:** preserve authoritative state, decisions and event history.

A material scope change must invalidate affected approvals and verification evidence. An agent's assertion is evidence to inspect, not proof by itself.

### 5. Bring a minimal command centre forward

**Concern:** Deferring the user-facing command centre until late risks building a backend that is technically elaborate but difficult to understand or control. The UI is part of the product's safety and usability model, not just presentation.

**Recommendation:**
- Deliver a minimal, real command centre alongside the first integrated execution slice.
- Show the approved outcome, plan, task owner, current state, blockers, approvals, evidence and remaining work.
- Make pause, resume, cancel, re-plan and human approval semantics explicit and truthful.
- Keep the UI as a view and command surface over canonical state; it must not become a competing source of truth.
- Expand the experience incrementally without delaying backend correctness.

### 6. Separate the core single-machine delivery path from optional commercial infrastructure

**Concern:** Paid convergence, cloud relay, entitlement, licensing and enterprise services are important to the wider Memev roadmap, but they are not automatically prerequisites for proving a single-machine Scope One workflow. Coupling them too tightly could delay the core outcome.

**Recommendation:**
- Preserve the full agreed Scope One scope, but identify which capabilities are hard dependencies for the first end-to-end delivery loop and which are parallel or later deployment/commercial tracks.
- Prove local project execution and recovery without requiring hosted infrastructure.
- Keep paid multi-device convergence behind a stable, tested interface.
- Document the relationship between `converge` and `crdt-merge`, including ownership, trust boundaries, failure behaviour and licensing, before treating them as interchangeable.
- Do not let cloud availability become a hidden dependency for local project integrity.

### 7. Make recovery and security first-class acceptance criteria

**Concern:** Happy-path demonstrations are insufficient for a system that coordinates autonomous agents and edits user projects. Silent data loss, duplicate side effects, stale writes or privilege escalation would undermine trust.

**Recommendation:** Include automated fault-injection and adversarial tests for:
- process termination during writes, dispatch and verification;
- network loss, reconnect, duplicate messages and replay;
- expired leases, stale generations and competing agents;
- conflicting edits to the same artifact;
- scope changes after approval or partial completion;
- missing, corrupt or unreadable evidence;
- permission denial and attempted access outside the approved workspace;
- retries of consequential external actions.

Recovery must preserve history and surface unresolved conflicts; it must not silently convert uncertainty into deletion, success or last-write-wins.

### 8. Prove the whole user journey, not a collection of isolated features

**Recommendation:** Use one reproducible reference project for the integration gate:
1. A non-technical user selects a local workspace and describes an outcome.
2. Memev clarifies material ambiguity and obtains scope approval.
3. Memev creates a versioned plan with acceptance criteria.
4. A selected lead agent delegates a specialist task to another supported provider.
5. Both work under explicit ownership and shared project state.
6. Interrupt one agent and restart or resume it.
7. Introduce a failed verification and require repair.
8. Change scope and confirm affected evidence becomes stale.
9. Reconcile a conflicting edit without silently losing work.
10. Produce a final report linking delivered artifacts, checks, evidence and outstanding limitations.

Repeat with different lead/specialist combinations. Record which steps are automated, provider-dependent or require human intervention.

## Competitive implication

The closest product-level threats are autonomous engineering and multi-agent execution platforms, particularly OpenHands, Factory and Devin; Conductor and Replit are also relevant. Memory products are subsystem competitors, not the primary category for Scope One.

Memev should not compete merely on launching more agents or storing more context. Its intended differentiation should be the combination of:

- user-owned, provider-neutral project authority;
- explicit scope, task ownership and policy;
- durable coordination and recoverable execution;
- evidence-bound verification and auditable history;
- local-first operation with optional cloud/commercial capabilities.

These are positioning hypotheses, not established advantages. They must be demonstrated through the integration and fault-injection tests above.

## Recommended sequencing

1. Reconcile the live repository, contracts and requirement register.
2. Integrate and test the state machine, canonical store and coordinator.
3. Define the agent adapter contract and complete a small number of real integrations.
4. Implement scope resolution, planning, lead authority and approval boundaries.
5. Integrate the minimal command centre early.
6. Complete evidence-bound verification, recovery and adversarial tests.
7. Complete onboarding, supported workflows and release paths.
8. Progress cloud, paid convergence and enterprise capabilities on stable interfaces without making them accidental blockers to local-first delivery.

Workstreams may proceed in parallel when their interfaces and ownership are stable. Do not create parallel implementations of the same authority or data model.

## Review and adoption protocol

Claude A and Claude B should review this addendum independently against the current repository and Scope One requirements. Each should classify every recommendation as **agree**, **disagree** or **needs evidence**, identify omissions and cite concrete files, contracts or tests.

Ryan should resolve disagreements. Only recommendations with explicit consensus and acceptance should be converted into development contracts or changes to the requirement register. Record rejected or deferred recommendations with a short rationale. This document itself is advisory until that review is complete.

**Non-goal:** This addendum does not authorise cutting agreed Scope One scope, claiming unfinished capabilities as delivered, or merging implementation work without the repository's normal tests and review.
