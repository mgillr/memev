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
  1. **Project brief / scope:** objectives, boundaries, assumptions, exclusions, success criteria, stakeholders and approved changes.
  2. **Programme roadmap:** high-level phases, milestones, dependencies, target dates where known, stage gates and delivery outlook.
  3. **Project / delivery plan:** the integrated plan showing how scope, schedule, resources/agents, dependencies, risks, quality and delivery fit together.
  4. **Development plan:** engineering workstreams, technical sequencing, environments, integration strategy, release stages and technical acceptance criteria.
  5. **Work breakdown structure:** hierarchical deliverables, work packages, tasks, owners, dependencies, acceptance criteria and status. Users should be able to move from a roadmap milestone to its constituent work packages and tasks and back.
  6. **System architecture:** the whole-system design, major components, interfaces, trust boundaries and external dependencies.
  7. **Subsystem architecture:** drill-down views for individual components, their internal structure, contracts and relationships.
  8. **Risks, assumptions, issues and dependencies:** a PMO-style RAID view with owners, impact, mitigation and status, linked to affected work.
  9. **Canvas / artefacts:** generated and user-provided documents, specifications, reports, diagrams, flowcharts, research, code and application previews, with suitable viewers and previews.
  10. **Activity / agents:** human-readable live activity, agent and engine status, assignments, communications and relevant diagnostics. Developers may drill down to logs, sessions and bus events; ordinary users should not need to understand those internals.
  11. **Blockers / decisions:** a dedicated, prominent queue of unresolved issues that require user input, approval or a decision.
- The navigation should feel like a coherent PMO/project environment, not an arbitrary collection of tabs. Group related views and allow appropriate drill-down: governance and scope; roadmap and integrated plans; work breakdown and delivery; architecture; RAID and decisions; artefacts and activity.
- Keep the lead-agent interaction area available across these views, with enough context to understand which project, plan, subsystem, task or artefact the user is discussing.
- Make pause, resume, cancel, re-plan, approval and deliverable-acceptance semantics explicit and truthful. A user instruction that changes scope must go through the scope-change process, not silently mutate the approved plan.
- Build a flexible artefact canvas, not a wholesale replacement for Figma, Notion or a general project-management suite. Prioritise rendering and interacting with the outputs Memev itself creates.

### 6. Provide a clear connections, access and availability centre

**Concern:** Users need to know what Memev can reach and which execution resources are actually available. If folder access, GitHub permissions, agent connections and remote machines are scattered across settings or inferred from successful launches, users will not understand the system's effective access or whether it is ready to work. A single green indicator can also be misleading if an agent is authenticated but unavailable, or connected but not authorised for the current project.

**Recommendation:**
- Provide a compact, persistent **Connections & Access** area in the workspace or launcher, with a fuller management view when opened. It should be easy to find without dominating the project canvas.
- Let users explicitly add and manage local access at useful levels:
  - one local folder or directory;
  - multiple selected folders/directories;
  - a selected workspace;
  - broader or full-system access where the operating system and product security model permit it.
- Make the effective scope visible before and after granting access. Explain what the permission allows, which agents/tools can use it, and whether access is read-only or permits writes. Use least privilege by default; broader access must require explicit informed consent, be revocable, and respect operating-system permission boundaries. Never imply full-system access where the OS has not granted it.
- Support GitHub connection and repository selection at several levels: one repository, multiple selected repositories, or all repositories the authenticated account is permitted to expose. Show the account/organisation identity, selected repositories and granted permission scopes. Prefer least-privilege repository access and make broad organisation/all-repository access a deliberate choice.
- Show supported agent/provider connections in one place. Examples may include Claude Code, Grok Bot, Grok Cloud, GPT-based agents, other external agents and future supported providers. Do not hard-code the interface around only today's providers.
- Show remote computers or execution nodes where the user's subscription/tier and configuration support them. Make clear which machine is local, remote, online, offline or unavailable, and which project/workspace it can access.
- For each connection/resource, distinguish at least:
  - **Connected/authenticated:** credentials or session are present and valid.
  - **Available/online:** the process, provider or machine can currently be reached.
  - **Authorised:** the required project, repository, folder or action permissions have been granted.
  - **Ready/capable:** the resource supports the operation currently needed (for example, dispatch, file access or a required model/tool capability).
  - **Degraded/unknown/error:** status cannot be confirmed or a required capability is failing.
- Use clear, restrained status indicators (including green when genuinely ready), accompanied by meaningful text and last-checked/last-seen information. Do not display green merely because a login token exists. If status cannot be verified, show unknown rather than connected.
- Provide straightforward connect, reconnect, test, inspect permissions and disconnect/revoke actions. Explain the consequence of disconnecting a resource that currently owns or is executing work.
- Surface connection failures as actionable blockers only when they affect planned work; do not flood the user with irrelevant provider diagnostics.
- Keep secrets and tokens out of the UI, logs and project artefacts. Store credentials using appropriate secure operating-system facilities, and make revocation and permission changes auditable.
- The connections view must reflect the actual adapters and permission state. It must not claim an agent, repository or machine is available merely because its name has been configured.

### 7. Make the workspace a factual, interdependent model of the project

**Concern:** A dashboard can look convincing while showing stale, inferred or contradictory information. Agent-authored progress summaries, disconnected diagrams or manually maintained task boards can diverge from actual execution. That would be especially damaging when users rely on the interface to make decisions.

**Recommendation:**
- Every view must be a projection of the canonical project store and event history. The UI is a view and command surface, never a competing source of truth.
- Represent relationships explicitly: scope items to roadmap milestones; milestones to plans and deliverables; deliverables to work packages and tasks; tasks to dependencies, agents, artefacts, checks and evidence; blockers and RAID items to the work they affect; connections and permissions to the resources and operations they enable.
- Propagate changes through these relationships. A changed requirement should visibly identify affected plans, architecture, tasks, artefacts, approvals, dependencies and verification results. Mark affected work or evidence stale where appropriate; do not silently leave old results looking current.
- Distinguish **planned, queued, dispatched, accepted, running, blocked, completed, verified and delivered** states where relevant. Do not collapse agent claims, observed execution and verified completion into one green tick.
- Show provenance for material project facts: source event, timestamp, responsible actor or agent, relevant scope/plan version and supporting evidence.
- Display uncertainty and freshness. If a provider is disconnected, a status is unknown, evidence is missing or an update has not been reconciled, say so plainly rather than guessing.
- Derive progress from defined milestones, task weights or completion criteria that are visible and explainable. Never use an agent's unsupported percentage estimate as authoritative project progress.
- Make the roadmap, plans, architecture diagrams, WBS and RAID views navigable projections of the same dependency model. They must not become independent documents that drift from live state.
- Preserve a readable history of decisions and changes, including who or what proposed a change, who approved it and which downstream items were affected.

### 8. Treat blockers and user decisions as a first-class workflow

**Concern:** If the system encounters a permission boundary, conflicting instruction, failed dependency, uncertain requirement or consequential action, it must not bury the issue in logs or continue as though nothing happened. Equally, users should not be overwhelmed with routine implementation details that agents can resolve safely within the approved scope.

**Recommendation:**
- Maintain a dedicated blocker/decision queue with severity or urgency, concise explanation, affected milestone/tasks, dependencies, options, recommended next step, decision owner and the consequence of waiting.
- Distinguish a genuine blocker requiring user action from an agent's internal retry, transient failure or routine subtask.
- Give each decision a clear state: raised, awaiting user, answered, approved, rejected, deferred or resolved. Preserve the decision and its rationale in project history.
- Let the lead agent explain the issue in plain language, present viable options and identify what it recommends and why. It must not present its recommendation as the user's decision.
- When a decision is made, update the canonical project record and recalculate affected dependencies, plans, task eligibility and verification freshness.
- Never silently bypass permissions, invent an approval, discard a blocker or continue a consequential action that requires human authorisation.

### 9. Make artefacts inspectable and attributable

**Concern:** A project canvas that merely displays files does not establish whether they are current, who produced them or whether they satisfy the approved requirement.

**Recommendation:**
- Link each material artefact to its originating task, producing agent/tool, creation and revision events, relevant scope/plan version and verification status.
- Support version history and comparison, and distinguish drafts, reviewed outputs and accepted deliverables.
- Provide appropriate previews for supported formats, including documents, diagrams, flowcharts, code and web/application outputs.
- Show verification evidence and outstanding limitations alongside the artefact. Do not imply that visual presence in the canvas means the output has passed acceptance.
- Keep the underlying files in the user's chosen workspace or explicitly configured storage; the canvas should not create an opaque, proprietary copy as the only authoritative version.

### 10. Separate the core single-machine delivery path from optional commercial infrastructure

**Concern:** Paid convergence, cloud relay, entitlement, licensing and enterprise services are important to the wider Memev roadmap, but they are not automatically prerequisites for proving a single-machine Scope One workflow. Coupling them too tightly could delay the core outcome.

**Recommendation:**
- Preserve the full agreed Scope One scope, but identify which capabilities are hard dependencies for the first end-to-end delivery loop and which are parallel or later deployment/commercial tracks.
- Prove local project execution and recovery without requiring hosted infrastructure.
- Keep paid multi-device convergence behind a stable, tested interface.
- Document the relationship between `converge` and `crdt-merge`, including ownership, trust boundaries, failure behaviour and licensing, before treating them as interchangeable.
- Do not let cloud availability become a hidden dependency for local project integrity.

### 11. Make recovery and security first-class acceptance criteria

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
- stale or out-of-order events, ensuring views do not regress or show a false current status;
- revoked folder, GitHub or provider permissions while work is queued or executing;
- loss of a remote machine or agent session and recovery without falsely reporting work as complete.

Recovery must preserve history and surface unresolved conflicts; it must not silently convert uncertainty into deletion, success or last-write-wins.

### 12. Prove the whole user journey, not a collection of isolated features

**Recommendation:** Use one reproducible reference project for the integration gate:
1. A non-technical user connects one local directory, selects additional directories if needed, and chooses the intended GitHub repository scope.
2. The user connects at least two supported agent providers and confirms which local or remote execution resources are available.
3. Memev clarifies material ambiguity and obtains scope approval.
4. The lead agent creates a versioned project brief, roadmap, integrated project plan, development plan, system architecture outline and work breakdown structure with acceptance criteria.
5. The workspace renders those views from canonical project state and lets the user navigate between them.
6. A selected lead agent delegates a specialist task to another supported provider.
7. Both work under explicit ownership and shared project state; the activity view reflects observed events.
8. A generated document or diagram appears in the artefact canvas with provenance and verification state.
9. Introduce a blocker requiring a user decision; the lead agent explains options, records the user's choice and updates affected work.
10. Interrupt one agent and restart or resume it.
11. Revoke or disconnect one resource and confirm the workspace accurately reflects the impact and does not dispatch work through it.
12. Introduce a failed verification and require repair.
13. Change scope and confirm affected roadmap items, plans, architecture, tasks, approvals and evidence are updated or marked stale.
14. Reconcile a conflicting edit without silently losing work.
15. Produce a final report linking delivered artefacts, checks, evidence, decisions and outstanding limitations.

Repeat with different lead/specialist combinations. Record which steps are automated, provider-dependent or require human intervention.

## Competitive implication

The closest product-level threats are autonomous engineering and multi-agent execution platforms, particularly OpenHands, Factory and Devin; Conductor and Replit are also relevant. Memory products are subsystem competitors, not the primary category for Scope One.

Memev should not compete merely on launching more agents or storing more context. Its intended differentiation should be the combination of:
- user-owned, provider-neutral project authority;
- explicit scope, task ownership and policy;
- durable coordination and recoverable execution;
- a PMO-grade, factual and navigable project model spanning scope, roadmap, integrated plans, development plans, WBS, architecture, RAID, artefacts and decisions;
- transparent, permission-aware access to local workspaces, repositories, agents and remote execution resources;
- evidence-bound verification and auditable history;
- an accessible non-technical workspace alongside deep developer visibility;
- local-first operation with optional cloud/commercial capabilities.

These are positioning hypotheses, not established advantages. They must be demonstrated through the integration and fault-injection tests above.

## Recommended sequencing

1. Reconcile the live repository, contracts and requirement register.
2. Integrate and test the state machine, canonical store and coordinator.
3. Define the agent adapter contract and complete a small number of real integrations.
4. Implement scope resolution, planning, lead authority and approval boundaries.
5. Define the canonical project, plan, architecture, artefact, decision, connection and permission relationship model and event projections needed by the workspace.
6. Deliver the minimum usable workspace early: lead-agent interaction, project brief/scope, overview/roadmap, WBS, activity, connections/access and blockers. Add integrated/development plan views, architecture drill-down, RAID and rich artefact previews as the underlying models support them.
7. Complete evidence-bound verification, recovery and adversarial tests, including UI reconstruction, permission revocation and consistency.
8. Complete onboarding, supported workflows and release paths.
9. Progress cloud, paid convergence and enterprise capabilities on stable interfaces without making them accidental blockers to local-first delivery.

Workstreams may proceed in parallel when their interfaces and ownership are stable. Do not create parallel implementations of the same authority or data model. Do not build elaborate visualisations before the underlying project relationships and event semantics are reliable.

## Review and adoption protocol

Claude A and Claude B should review this addendum independently against the current repository and Scope One requirements. Each should classify every recommendation as **agree**, **disagree** or **needs evidence**, identify omissions and cite concrete files, contracts or tests.

The new workspace, PMO-style project structure, lead-agent interaction, connections/access centre, tab structure, blocker workflow and project-consistency requirements should be reviewed as explicit product requirements, not assumed to be implied by the existing command-centre recommendation.

Ryan should resolve disagreements. Only recommendations with explicit consensus and acceptance should be converted into development contracts or changes to the requirement register. Record rejected or deferred recommendations with a short rationale. This document itself is advisory until that review is complete.

**Non-goal:** This addendum does not authorise cutting agreed Scope One scope, claiming unfinished capabilities as delivered, or merging implementation work without the repository's normal tests and review.
