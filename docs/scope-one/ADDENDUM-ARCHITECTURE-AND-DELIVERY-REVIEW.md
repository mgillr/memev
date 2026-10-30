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

### 5. Make the project workspace a first-class product surface

**Concern:** A terminal-centric launcher may be excellent for developers but will be opaque to non-technical users. Deferring the user-facing workspace until late risks building a capable backend that customers cannot understand, inspect or safely control. A generic task list is also insufficient for projects with nested architecture, deliverables and interdependent work.

**Recommendation:**
- Deliver a usable visual project workspace alongside the first integrated execution slice. Treat it as a core product surface and part of the safety model, not a cosmetic frontend.
- Provide two complementary experiences over the same project: a straightforward non-technical workspace and an advanced developer/diagnostic view. The existing terminal-based launcher remains valuable; it should expose the same underlying state rather than becoming a separate system.
- Give the workspace a persistent interaction area for the **lead agent**. Users must be able to ask questions, give instructions, request explanations, challenge assumptions and propose changes in ordinary language. The lead agent should answer from the current project record, identify uncertainty and distinguish suggestions from committed project changes.
- Organise the project canvas into navigable views/tabs, at minimum:
  1. **Overview / roadmap:** intended outcome, approved scope, milestones, high-level phases, progress and delivery outlook.
  2. **System architecture:** the whole-system design, major components, interfaces, trust boundaries and external dependencies.
  3. **Subsystem architecture:** drill-down views for individual components, their internal structure, contracts and relationships.
  4. **Work breakdown structure:** hierarchical deliverables, work packages, tasks, owners, dependencies, acceptance criteria and status. Users should be able to move from a roadmap milestone to its constituent tasks and back.
  5. **Canvas / artefacts:** generated and user-provided documents, specifications, reports, diagrams, flowcharts, research, code and application previews, with suitable viewers and previews.
  6. **Activity / agents:** human-readable live activity, agent and engine status, assignments, communications and relevant diagnostics. Developers may drill down to logs, sessions and bus events; ordinary users should not need to understand those internals.
  7. **Blockers / decisions:** a dedicated, prominent queue of unresolved issues that require user input, approval or a decision.
- Keep the lead-agent interaction area available across these views, with enough context to understand which project, subsystem, task or artefact the user is discussing.
- Make pause, resume, cancel, re-plan, approval and deliverable-acceptance semantics explicit and truthful. A user instruction that changes scope must go through the scope-change process, not silently mutate the approved plan.
- Build a flexible artefact canvas, not a wholesale replacement for Figma, Notion or a general project-management suite. Prioritise rendering and interacting with the outputs Memev itself creates.

### 6. Make the workspace a factual, interdependent model of the project

**Concern:** A dashboard can look convincing while showing stale, inferred or contradictory information. Agent-authored progress summaries, disconnected diagrams or manually maintained task boards can diverge from actual execution. That would be especially damaging when users rely on the interface to make decisions.

**Recommendation:**
- Every view must be a projection of the canonical project store and event history. The UI is a view and command surface, never a competing source of truth.
- Represent relationships explicitly: scope items to milestones; milestones to deliverables; deliverables to work packages and tasks; tasks to dependencies, agents, artefacts, checks and evidence; blockers to the work they affect.
- Propagate changes through these relationships. A changed requirement should visibly identify affected architecture, tasks, artefacts, approvals, dependencies and verification results. Mark affected work or evidence stale where appropriate; do not silently leave old results looking current.
- Distinguish **planned, queued, dispatched, accepted, running, blocked, completed, verified and delivered** states where relevant. Do not collapse agent claims, observed execution and verified completion into one green tick.
- Show provenance for material project facts: source event, timestamp, responsible actor or agent, relevant scope/plan version and supporting evidence.
- Display uncertainty and freshness. If a provider is disconnected, a status is unknown, evidence is missing or an update has not been reconciled, say so plainly rather than guessing.
- Derive progress from defined milestones, task weights or completion criteria that are visible and explainable. Never use an agent's unsupported percentage estimate as authoritative project progress.
- Make the architecture diagrams, roadmap and work breakdown structure navigable projections of the same dependency model. They must not become independent documents that drift from live state.
- Preserve a readable history of decisions and changes, including who or what proposed a change, who approved it and which downstream items were affected.

### 7. Treat blockers and user decisions as a first-class workflow

**Concern:** If the system encounters a permission boundary, conflicting instruction, failed dependency, uncertain requirement or consequential action, it must not bury the issue in logs or continue as though nothing happened. Equally, users should not be overwhelmed with routine implementation details that agents can resolve safely within the approved scope.

**Recommendation:**
- Maintain a dedicated blocker/decision queue with severity or urgency, concise explanation, affected milestone/tasks, dependencies, options, recommended next step, decision owner and the consequence of waiting.
- Distinguish a genuine blocker requiring user action from an agent's internal retry, transient failure or routine subtask.
- Give each decision a clear state: raised, awaiting user, answered, approved, rejected, deferred or resolved. Preserve the decision and its rationale in project history.
- Let the lead agent explain the issue in plain language, present viable options and identify what it recommends and why. It must not present its recommendation as the user's decision.
- When a decision is made, update the canonical project record and recalculate affected dependencies, plans, task eligibility and verification freshness.
- Never silently bypass permissions, invent an approval, discard a blocker or continue a consequential action that requires human authorisation.

### 8. Make artefacts inspectable and attributable

**Concern:** A project canvas that merely displays files does not establish whether they are current, who produced them or whether they satisfy the approved requirement.

**Recommendation:**
- Link each material artefact to its originating task, producing agent/tool, creation and revision events, relevant scope/plan version and verification status.
- Support version history and comparison, and distinguish drafts, reviewed outputs and accepted deliverables.
- Provide appropriate previews for supported formats, including documents, diagrams, flowcharts, code and web/application outputs.
- Show verification evidence and outstanding limitations alongside the artefact. Do not imply that visual presence in the canvas means the output has passed acceptance.
- Keep the underlying files in the user's chosen workspace or explicitly configured storage; the canvas should not create an opaque, proprietary copy as the only authoritative version.

### 9. Separate the core single-machine delivery path from optional commercial infrastructure

**Concern:** Paid convergence, cloud relay, entitlement, licensing and enterprise services are important to the wider Memev roadmap, but they are not automatically prerequisites for proving a single-machine Scope One workflow. Coupling them too tightly could delay the core outcome.

**Recommendation:**
- Preserve the full agreed Scope One scope, but identify which capabilities are hard dependencies for the first end-to-end delivery loop and which are parallel or later deployment/commercial tracks.
- Prove local project execution and recovery without requiring hosted infrastructure.
- Keep paid multi-device convergence behind a stable, tested interface.
- Document the relationship between `converge` and `crdt-merge`, including ownership, trust boundaries, failure behaviour and licensing, before treating them as interchangeable.
- Do not let cloud availability become a hidden dependency for local project integrity.

### 10. Make recovery and security first-class acceptance criteria

**Concern:** Happy-path demonstrations are insufficient for a system that coordinates autonomous agents and edits user projects. Silent data loss, duplicate side effects, stale writes or privilege escalation would undermine trust.

**Recommendation:** Include automated fault-injection and adversarial tests for:
- process termination during writes, dispatch and verification;
- network loss, reconnect, duplicate messages and replay;
- expired leases, stale generations and competing agents;
- conflicting edits to the same artifact;
- scope changes after approval or partial completion;
- missing, corrupt or unreadable evidence;
- permission denial and attempted access outside the approved workspace;
- retries of consequential external actions;
- UI refresh, reconnection and restart while events are arriving, ensuring the workspace reconstructs the same authoritative state;
- stale or out-of-order events, ensuring views do not regress or show a false current status.

Recovery must preserve history and surface unresolved conflicts; it must not silently convert uncertainty into deletion, success or last-write-wins.

### 11. Prove the whole user journey, not a collection of isolated features

**Recommendation:** Use one reproducible reference project for the integration gate:
1. A non-technical user selects a local workspace and describes an outcome.
2. Memev clarifies material ambiguity and obtains scope approval.
3. The lead agent creates a versioned roadmap, system architecture outline and work breakdown structure with acceptance criteria.
4. The workspace renders those views from canonical project state and lets the user navigate between them.
5. A selected lead agent delegates a specialist task to another supported provider.
6. Both work under explicit ownership and shared project state; the activity view reflects observed events.
7. A generated document or diagram appears in the artefact canvas with provenance and verification state.
8. Introduce a blocker requiring a user decision; the lead agent explains options, records the user's choice and updates affected work.
9. Interrupt one agent and restart or resume it.
10. Introduce a failed verification and require repair.
11. Change scope and confirm affected roadmap items, architecture, tasks, approvals and evidence are updated or marked stale.
12. Reconcile a conflicting edit without silently losing work.
13. Produce a final report linking delivered artefacts, checks, evidence, decisions and outstanding limitations.

Repeat with different lead/specialist combinations. Record which steps are automated, provider-dependent or require human intervention.

## Competitive implication

The closest product-level threats are autonomous engineering and multi-agent execution platforms, particularly OpenHands, Factory and Devin; Conductor and Replit are also relevant. Memory products are subsystem competitors, not the primary category for Scope One.

Memev should not compete merely on launching more agents or storing more context. Its intended differentiation should be the combination of:
- user-owned, provider-neutral project authority;
- explicit scope, task ownership and policy;
- durable coordination and recoverable execution;
- a factual, navigable project model spanning roadmap, architecture, work breakdown, artefacts and decisions;
- evidence-bound verification and auditable history;
- an accessible non-technical workspace alongside deep developer visibility;
- local-first operation with optional cloud/commercial capabilities.

These are positioning hypotheses, not established advantages. They must be demonstrated through the integration and fault-injection tests above.

## Recommended sequencing

1. Reconcile the live repository, contracts and requirement register.
2. Integrate and test the state machine, canonical store and coordinator.
3. Define the agent adapter contract and complete a small number of real integrations.
4. Implement scope resolution, planning, lead authority and approval boundaries.
5. Define the canonical project/artefact/decision relationship model and event projections needed by the workspace.
6. Deliver the minimum usable workspace early: lead-agent interaction, overview/roadmap, work breakdown, activity and blockers. Add architecture drill-down and rich artefact previews as the underlying models support them.
7. Complete evidence-bound verification, recovery and adversarial tests, including UI reconstruction and consistency.
8. Complete onboarding, supported workflows and release paths.
9. Progress cloud, paid convergence and enterprise capabilities on stable interfaces without making them accidental blockers to local-first delivery.

Workstreams may proceed in parallel when their interfaces and ownership are stable. Do not create parallel implementations of the same authority or data model. Do not build elaborate visualisations before the underlying project relationships and event semantics are reliable.

## Review and adoption protocol

Claude A and Claude B should review this addendum independently against the current repository and Scope One requirements. Each should classify every recommendation as **agree**, **disagree** or **needs evidence**, identify omissions and cite concrete files, contracts or tests.

The new workspace, lead-agent interaction, tab structure, blocker workflow and project-consistency requirements should be reviewed as explicit product requirements, not assumed to be implied by the existing command-centre recommendation.

Ryan should resolve disagreements. Only recommendations with explicit consensus and acceptance should be converted into development contracts or changes to the requirement register. Record rejected or deferred recommendations with a short rationale. This document itself is advisory until that review is complete.

**Non-goal:** This addendum does not authorise cutting agreed Scope One scope, claiming unfinished capabilities as delivered, or merging implementation work without the repository's normal tests and review.
