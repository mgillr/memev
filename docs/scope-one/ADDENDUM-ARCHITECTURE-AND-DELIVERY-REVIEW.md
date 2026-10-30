# Scope One Addendum — Architecture, Delivery and Competitive Risks

**Status:** Proposal for independent review  
**Applies to:** Scope One  
**Purpose:** Record additional concerns and recommendations for review by Ryan, Claude A and Claude B. This addendum does not silently change the agreed Scope One requirements or authorise implementation. Recommendations become development decisions only after explicit consensus and acceptance.

## Product outcome

Scope One remains the complete product target: a user describes an outcome and its intended scope; Memev resolves ambiguity, formalises the requirements and obtains approval for material scope; Memev decomposes the outcome into contracts, deliverables, work packages, dependencies and acceptance criteria; its state machine and coordinator manage execution across supported agents and tools; and Memev returns deliverables with independently checkable evidence.

**The user manages the outcome. Memev manages the machinery.** The customer should not be expected to allocate tasks to agents, select an execution engine, understand provider capability differences, monitor communications buses, manage leases or decide how work is distributed. Those are internal Memev responsibilities.

The first end-to-end demonstration is an integration gate, not a replacement for the full Scope One scope. Do not reduce the product to a memory store, agent launcher or coding-only workbench.

The final product direction also extends beyond individual project execution: Memev is intended to become a shared, permission-governed organisational memory and coordination environment. It must support an individual working across local and cloud agents, a multi-person business whose departments can learn from and scrutinise one another's work, and federated enterprises coordinating activity across offices, locations and jurisdictions. This is a progressive scale-out of one coherent architecture, not a set of unrelated products.

## Findings and recommendations

### 1. Establish one trustworthy development baseline

**Concern:** The takeover inventory and requirement register can drift as branches and pull requests advance. The inventory snapshot recorded open work that had not been individually reconciled; the live repository query subsequently returned a different open-PR count. Branch existence, a draft PR, a passing isolated test, a merge and verified integration are different states.

**Recommendation:**
- Reconcile every Scope One branch and open PR against current `main` before commissioning overlapping work.
- Give each canonical requirement one owner, one implementation path, explicit dependencies and acceptance tests.
- Mark work as implemented, merged, integrated and verified separately; do not use these terms interchangeably.
- Close or supersede duplicate/twin contracts explicitly, preserving links and rationale.
- Reconcile the takeover register whenever the baseline changes. Treat counts in old snapshots as historical, not live status.

### 2. Integrate the state machine, store and coordinator as Memev's execution authority

**Concern:** The project/task state machine is a valuable foundation, but by itself it is not a persistent, distributed execution system. A coordinator or store implemented independently can introduce a second source of truth or weaken transition and evidence rules. Exposing these internal mechanics as user decisions would also transfer orchestration responsibility to the customer.

**Recommendation:**
- Make the project store the durable authority for project entities and append-only events.
- Make the state machine and coordinator responsible for task lifecycle, claims, leases, generations, dependency-aware dispatch, resource selection, ownership, retries, recovery and execution scheduling.
- Route state changes through the existing transition rules; adapters and UI code must not mutate authoritative state directly.
- Define transaction and crash boundaries, idempotency keys, replay/recovery behaviour and schema migration rules.
- Treat stale generations, expired leases, duplicate delivery and concurrent claims as normal adversarial test cases.
- Memev, not the end user, decides which eligible connected resource or agent should perform each task, based on declared capabilities, policy, availability, workload, cost/latency constraints and task requirements.
- **Default agent suitability analysis:** During scope analysis and planning, Memev should assess each work package and task against the capabilities required to complete it, then evaluate the connected agents and execution resources against those requirements. Consider demonstrated capability and relevant context, supported tools, permissions, reliability, availability, workload and applicable cost/latency constraints. Use this analysis to recommend and make the default assignment. Do not make the user perform this matching exercise.
- **Optional user-directed assignment and control:** The user must nevertheless be able to influence or override the default through the persistent lead-agent prompt, in ordinary language. For example: "Use Claude for the architecture review", "Keep all code changes on my local machine", "Give this task to the agent I connected for testing", or "I want to handle this task myself." The lead agent should interpret the instruction, identify the affected work, assess feasibility and policy implications, and update the proposed plan or assignment preference. It should confirm material consequences where appropriate and explain when a request cannot be honoured; it must not silently ignore the instruction or imply that an unavailable or unsuitable resource can perform the work.
- **State-machine enforcement:** User preferences and overrides are inputs to the canonical project policy/plan, not direct mutations of execution state. The state machine and coordinator remain authoritative for validating permissions, dependencies, resource eligibility, claims, dispatch, reassignment and recovery. A user preference cannot bypass access controls, safety policy, required approvals or valid task transitions. If the requested assignment becomes unavailable or ineligible, Memev should explain the issue and propose a safe alternative rather than silently switching in a way that violates the user's expressed constraint.
- **Progressive control:** The default experience should require no agent-management knowledge. Users who want more control can specify preferred agents, tools, machines, constraints or human ownership at project, workstream or individual-task level through the same lead-agent interaction area. Memev should make the effective preference visible and editable without turning routine orchestration into a mandatory configuration workflow.
- Keep assignment, dispatch, reassignment, fallback, retry and recovery internal. Escalate to the user only when a genuine approval, scope decision, permission grant or other human judgement is required.
- Do not ask the user to select an agent or manually resolve ordinary provider availability. If an execution resource fails, Memev should attempt safe recovery or an alternative within policy before raising a meaningful blocker.

### 3. Define a provider-neutral agent adapter contract

**Concern:** Shared state and task claims do not, by themselves, prove that Memev can reliably operate real AI clients. Provider-specific lifecycle differences, unavailable sessions, partial results and unsupported cancellation can undermine the product.

**Recommendation:**
- Define one adapter contract with declared capabilities, identity, session discovery, dispatch, progress/result reporting, checkpointing, cancellation semantics and recovery.
- Implement a small number of real integrations end to end before broadening the provider list.
- Keep provider-specific behaviour inside adapters; the planner and coordinator must consume capability declarations rather than provider-specific conditionals.
- Distinguish a requested action, an accepted dispatch, an observed execution and a verified outcome in the event history.
- Never report successful completion merely because a provider returned a success-shaped response.
- Provider selection and routing are internal orchestration decisions. The lead agent may explain the approach at a high level when asked, but should not require the user to understand or approve routine agent allocation.

### 4. Keep intake, planning, execution, policy and verification separate

**Concern:** If one agent both plans work, performs it and declares it complete, the system cannot independently establish that the approved outcome was achieved. Likewise, a free-form lead-agent response must not bypass the contracts and controlled state transitions that govern delivery.

**Recommendation:** Keep explicit boundaries for:
- **Intake and scope resolution:** identify ambiguity, assumptions, constraints and decisions requiring user approval.
- **Planning and decomposition:** translate the approved outcome into versioned requirements/contracts, deliverables, work packages, dependencies, acceptance criteria, roadmap and work breakdown structure.
- **Coordination and state machine:** own authoritative plans, task lifecycle, resource selection, claims, dispatch, retries, recovery and execution.
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
- Give the workspace a persistent interaction area for the **lead agent**. This is the primary user interface for describing desired outcomes, defining scope, asking questions, giving instructions, requesting explanations and proposing changes in ordinary language.
- The lead agent should clarify the desired outcome, surface assumptions and constraints, and translate the user's intent into a formal proposed scope. It should then create or update the contracts, deliverables, work packages, dependencies, acceptance criteria, roadmap, plans and work breakdown structure needed to deliver that outcome.
- Present the proposed scope and meaningful trade-offs for user approval before execution where required. Once approved, hand control to the state machine and coordinator for end-to-end execution. The user should not have to dispatch tasks, select providers, assign agents or monitor engine sessions.
- Organise the project canvas into navigable views/tabs, at minimum:
  1. **Project brief / scope:** objectives, boundaries, assumptions, exclusions, success criteria, stakeholders and approved changes.
  2. **Programme roadmap:** high-level phases, milestones, dependencies, target dates where known, stage gates and delivery outlook.
  3. **Project / delivery plan:** the integrated plan showing how scope, schedule, work packages, dependencies, risks, quality and delivery fit together.
  4. **Development plan:** engineering workstreams, technical sequencing, environments, integration strategy, release stages and technical acceptance criteria.
  5. **Work breakdown structure:** hierarchical deliverables, work packages, tasks, dependencies, acceptance criteria and status. Users should be able to move from a roadmap milestone to its constituent work packages and tasks and back. Internal task ownership and agent allocation remain Memev-managed.
  6. **System architecture:** the whole-system design, major components, interfaces, trust boundaries and external dependencies.
  7. **Subsystem architecture:** drill-down views for individual components, their internal structure, contracts and relationships.
  8. **Risks, assumptions, issues and dependencies:** a PMO-style RAID view with impact, mitigation and status, linked to affected work.
  9. **Canvas / artefacts:** generated and user-provided documents, specifications, reports, diagrams, flowcharts, research, code and application previews, with suitable viewers and previews.
  10. **Activity / project progress:** human-readable updates on completed work, work in progress, milestones, outputs and meaningful changes. Do not make the ordinary customer interface a live agent-routing console or require the user to interpret engine activity.
  11. **Blockers / decisions:** a dedicated, prominent queue of unresolved issues that genuinely require user input, approval or a decision.
- The navigation should feel like a coherent PMO/project environment, not an arbitrary collection of tabs. Group related views and allow appropriate drill-down: governance and scope; roadmap and integrated plans; work breakdown and delivery; architecture; RAID and decisions; artefacts and project activity.
- Keep the lead-agent interaction area available across these views, with enough context to understand which project, plan, subsystem, task or artefact the user is discussing.
- Make pause, resume, cancel, re-plan, approval and deliverable-acceptance semantics explicit and truthful. A user instruction that changes scope must go through the scope-change process, not silently mutate the approved plan.
- Build a flexible artefact canvas, not a wholesale replacement for Figma, Notion or a general project-management suite. Prioritise rendering and interacting with the outputs Memev itself creates.

### 6. Provide a simple Connections & Access settings area; keep orchestration internal

**Concern:** Users need to configure what Memev is permitted to access and connect the services they want it to use. But exposing connection readiness, agent eligibility, routing or resource assignment as a project-management responsibility would make the product unnecessarily technical. Connection setup is a user permission/configuration concern; deciding how to execute approved work is Memev's concern.

**Recommendation:**
- Provide a compact **Connections & Access** area in settings or the launcher, with a clear summary of configured integrations. It should be easy to find but should not dominate the project workspace or become an execution control panel.
- Let users explicitly grant local access at useful levels:
  - one local folder or directory;
  - multiple selected folders/directories;
  - a selected workspace;
  - broader or full-system access where the operating system and product security model permit it.
- Make the effective access scope clear when the user grants it. Explain what Memev is permitted to access and whether access is read-only or permits writes. Use least privilege by default; broader access must require explicit informed consent, be revocable, and respect operating-system permission boundaries. Never imply full-system access where the OS has not granted it.
- Support GitHub connection and repository selection at several levels: one repository, multiple selected repositories, or all repositories the authenticated account is permitted to expose. Show the account/organisation identity, selected repositories and granted permission scopes. Prefer least-privilege repository access and make broad organisation/all-repository access a deliberate choice.
- Allow users to connect supported providers and tools (for example Claude Code, Grok Bot, Grok Cloud, GPT-based services and other supported integrations) and remote computers where their tier and configuration permit them. This is configuration of available resources, not a request for users to decide which resource gets which task.
- Provide straightforward connect, reconnect, test, inspect permissions and disconnect/revoke actions. Keep secrets and tokens out of the UI, logs and project artefacts; use appropriate secure operating-system facilities and make permission changes auditable.
- The settings area may confirm that an integration is configured and that its permission grant is valid. It should not expose internal task eligibility, routing scores, agent assignments, leases or provider-specific execution states as things the customer must manage.
- Internally, Memev must continuously determine whether a resource is authenticated, reachable, authorised for the relevant operation, capable of performing it and currently usable. These checks feed the state machine and scheduler. They are internal operational facts, not user-facing workflow states.
- If a configured resource becomes unavailable, Memev should update its internal resource registry, prevent invalid dispatch, safely retry or route work to another eligible resource where policy permits, and preserve project continuity.
- Surface a user-facing blocker only if the issue cannot be resolved within the granted permissions and configured policy — for example, the user must reconnect an account, grant access to a new folder, approve a consequential action or make a genuine project decision. Explain the required user action in plain language without asking them to debug agents.
- Never claim that an integration or permission is available unless Memev has verified it. Unknown state must remain unknown internally and must not be represented as ready.

### 7. Make the workspace a factual, interdependent model of the project

**Concern:** A dashboard can look convincing while showing stale, inferred or contradictory information. Agent-authored progress summaries, disconnected diagrams or manually maintained task boards can diverge from actual execution. That would be especially damaging when users rely on the interface to make decisions.

**Recommendation:**
- Every view must be a projection of the canonical project store and event history. The UI is a view and command surface, never a competing source of truth.
- Represent relationships explicitly: scope items to roadmap milestones; milestones to plans and deliverables; deliverables to work packages and tasks; tasks to dependencies, artefacts, checks and evidence; blockers and RAID items to the work they affect; configured permissions to the resources and operations they enable.
- Keep internal agent/resource allocation in the execution model and diagnostic history. The ordinary project workspace should report meaningful work and outcomes without requiring users to understand which engine performed each task.
- Propagate changes through these relationships. A changed requirement should visibly identify affected plans, architecture, tasks, artefacts, approvals, dependencies and verification results. Mark affected work or evidence stale where appropriate; do not silently leave old results looking current.
- Distinguish **planned, queued, dispatched, accepted, running, blocked, completed, verified and delivered** states in the internal execution model. Present users with a simpler, accurate project status derived from those states; do not expose internal transitions as decisions the user must manage.
- Show provenance for material project facts and deliverables when useful: source event, timestamp, relevant scope/plan version and supporting evidence. Provide deeper diagnostic detail in the advanced view.
- Display uncertainty and freshness. If project status cannot be confirmed, evidence is missing or an update has not been reconciled, say so plainly rather than guessing.
- Derive progress from defined milestones, work packages or completion criteria that are visible and explainable. Never use an agent's unsupported percentage estimate as authoritative project progress.
- Make the roadmap, plans, architecture diagrams, WBS and RAID views navigable projections of the same dependency model. They must not become independent documents that drift from live state.
- Preserve a readable history of decisions and changes, including who or what proposed a change, who approved it and which downstream items were affected.

### 8. Treat blockers and user decisions as a first-class workflow

**Concern:** If the system encounters a permission boundary, conflicting instruction, failed dependency, uncertain requirement or consequential action, it must not bury the issue in logs or continue as though nothing happened. Equally, users should not be overwhelmed with routine implementation details that agents can resolve safely within the approved scope.

**Recommendation:**
- Maintain a dedicated blocker/decision queue with severity or urgency, concise explanation, affected milestone/tasks, dependencies, options, recommended next step, decision owner and the consequence of waiting.
- Distinguish a genuine blocker requiring user action from an agent's internal retry, transient failure or routine subtask.
- Keep routine retries, agent replacement, provider failover, lease expiry and execution recovery inside Memev. Do not turn ordinary infrastructure events into customer decisions.
- Give each human decision a clear state: raised, awaiting user, answered, approved, rejected, deferred or resolved. Preserve the decision and its rationale in project history.
- Let the lead agent explain the issue in plain language, present viable options and identify what it recommends and why. It must not present its recommendation as the user's decision.
- When a decision is made, update the canonical project record and recalculate affected dependencies, plans, task eligibility and verification freshness.
- Never silently bypass permissions, invent an approval, discard a blocker or continue a consequential action that requires human authorisation.

### 9. Make artefacts inspectable and attributable

**Concern:** A project canvas that merely displays files does not establish whether they are current, who produced them or whether they satisfy the approved requirement.

**Recommendation:**
- Link each material artefact to its originating requirement, deliverable or work package, creation and revision events, relevant scope/plan version and verification status.
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
- loss of a remote machine or agent session and recovery without falsely reporting work as complete;
- provider failure during a task, ensuring safe internal retry, reassignment or escalation according to policy.

Recovery must preserve history and surface unresolved conflicts; it must not silently convert uncertainty into deletion, success or last-write-wins.

### 12. Prove the whole user journey, not a collection of isolated features

**Recommendation:** Use one reproducible reference project for the integration gate:
1. A user connects the local directory/directories and GitHub repository scope required for the project.
2. The user connects the supported services and grants the access they want Memev to have. They are not asked to allocate agents or select execution resources.
3. The user describes the desired outcome and scope in the lead-agent prompt.
4. Memev clarifies material ambiguity, assumptions, constraints and acceptance criteria, then presents the proposed scope for approval.
5. Memev decomposes the approved scope into contracts, deliverables, a project brief, roadmap, integrated project plan, development plan, system architecture, subsystem architecture as needed, work breakdown structure and dependency graph.
6. The user reviews the project definition and approves it. The state machine takes over execution.
7. Memev internally selects eligible resources, dispatches work, manages dependencies, handles provider/session failures, retries or reallocates work where policy permits, and records actual execution events.
8. The workspace reflects factual project progress and makes generated documents, diagrams and previews available with verification state.
9. A genuine blocker requiring human judgement is raised; the lead agent explains options, records the user's choice and updates affected work.
10. Interrupt an execution resource and confirm Memev recovers or reallocates work without asking the user to manage the agent.
11. Revoke a required permission and confirm Memev safely pauses or reroutes affected work, then asks the user only if a new grant is necessary.
12. Introduce a failed verification and require repair.
13. Change scope and confirm affected roadmap items, plans, architecture, tasks, approvals and evidence are updated or marked stale.
14. Reconcile a conflicting edit without silently losing work.
15. Produce a final report linking delivered artefacts, checks, evidence, decisions and outstanding limitations.

Repeat with different provider and machine configurations. Record which steps are automatic, policy-gated or genuinely require human intervention.


### 13. Define the final-state architecture: shared organisational memory, cross-functional intelligence and federation

**Product direction:** Memev must scale from a personal multi-agent work environment into the shared operational memory and coordination layer for an entire business, and ultimately a federation of businesses or enterprise units. It is not only a mechanism for completing isolated projects. It should allow people and agents working on different tasks, projects, programmes and business activities to contribute to, retrieve and reason over a coherent organisational body of knowledge, subject to explicit permissions and trust boundaries.

#### 13.1 Personal deployment: one person, one or several machines, many agents

The personal use case is one person working on one computer, potentially with several local agents and cloud-based agents, or the same person working across two or three computers. Examples include Claude Code, Codex and other local/terminal-oriented clients alongside cloud services such as Claude, Grok and other supported providers.

- Treat the person as the owner of a coherent personal work environment, not as an operator who must manually move context between clients, sessions or machines.
- Provide a common, durable memory and project context across the person's permitted agents and devices. Agents should be able to discover relevant prior work, decisions, artefacts, constraints and unfinished obligations without requiring the user to repeat them.
- Preserve local-first operation and useful single-machine functionality. Multi-device synchronisation must not make a hosted service a hidden prerequisite for local project integrity.
- Keep agent-specific execution and provider sessions replaceable. The durable unit is the user's work, its state and evidence, not a particular chat or agent session.
- A single computer may run multiple agents without needing the full distributed business infrastructure. Two or three computers introduce device synchronisation and recovery requirements, but do not by themselves imply an enterprise trust domain.

#### 13.2 Small business: a shared memory and intelligence layer across people and departments

For a small business, imagine approximately ten people working across different functions: engineering, operations, sales, finance, customer support, research, management or other departments. Each person may use different computers, agents, providers and tools. They may be working on entirely different projects and routine business activities.

Memev should allow those separately operating people and systems to contribute relevant work state, decisions, artefacts, events and evidence into a coherent, shared organisational memory. This is more than a shared folder or a collection of project summaries.

- Establish an organisation-level knowledge and work graph connecting people, teams, departments, projects, programmes, customers or other business entities, commitments, decisions, artefacts, risks, issues, dependencies and evidence.
- Let an authorised person or agent discover relevant work elsewhere in the organisation. For example, an agent assisting with a new customer proposal could discover a delivery constraint identified by engineering, a contractual commitment recorded by operations, a pricing assumption from finance, or a previous customer issue that materially changes the proposal.
- Enable cross-functional reasoning. Agents should be able to identify inconsistent assumptions, duplicated effort, conflicting commitments, overlooked dependencies, emerging risks, reusable work and opportunities that are not visible when each project is considered in isolation.
- Allow insights from one project or department to inform another. A technical decision, operational incident, customer requirement or failed approach should become discoverable organisational knowledge where policy permits, rather than remaining trapped in the original agent session or project.
- Make organisational memory cumulative: each new piece of work can improve the context available to future work. The value should compound as the organisation uses Memev across more activities, not only as it creates more projects.
- Support both explicit retrieval and proactive discovery. Agents should be able to query the relevant organisational context, while background analysis may surface material cross-project relationships, anomalies, risks and opportunities for review.
- Keep each project independently governed. Shared organisational awareness must not erase project scope, ownership, approval authority, confidentiality or the distinction between a local project fact and an organisation-wide policy.
- The system may propose assumptions, identify gaps and raise potential issues, but it must show the source, context, freshness and confidence of each finding. A model-generated inference is a hypothesis to validate, not a new organisational fact or an authorised change.
- Do not require staff to manually copy every update into a central knowledge base. Capture and reconcile useful work state through the existing project store, event history, integrations and approved agent workflows, with explicit controls over what is shared.

The intended result is an integrated but distributed team: people and agents can work independently, while the organisation benefits from a coherent understanding of what is happening across the business.

#### 13.3 Larger businesses: offices, clusters and operational domains

The architecture must continue to work as a business grows beyond a single office. A representative progression might be a cluster of roughly 29 computers across several offices, with people and agents working across multiple departments and programmes.

- Support multiple Memev nodes and execution resources at each location, with local work continuing during WAN outages or remote-service disruption where possible.
- Reconcile shared work and organisational knowledge across locations without assuming that all nodes are continuously connected.
- Represent location, department, team, project and programme as distinct scopes. A user may participate in several of them, with different permissions and responsibilities in each.
- Permit local operational state to remain local where necessary while publishing approved shared facts, references, evidence or derived views to the wider organisation.
- Preserve causal history and provenance when updates cross office boundaries. Delayed, duplicated or reordered messages must not create false progress, erase accepted work or silently overwrite a more authoritative decision.
- Allow organisation-wide agents and authorised departmental agents to reason across permitted scopes, while preventing a department's local assumptions from being silently promoted to company policy.

#### 13.4 Enterprise and international federation

At enterprise scale, Memev must support many offices, clusters, business units and countries. Some locations may operate under different legal, contractual, security or data-residency requirements. The system must therefore federate authority and knowledge without requiring indiscriminate centralisation.

- Model federation as an explicit relationship between independently governed nodes, offices, business units or organisations. Each federation relationship defines what identities, state, evidence, metadata, artefacts and derived knowledge may cross the boundary, for what purpose and under whose authority.
- Support multiple trust and policy domains. An enterprise-wide project may span several offices while each office retains control over local resources, sensitive records and jurisdiction-specific obligations.
- Allow controlled exchange of shared project state, approved evidence, commitments, dependency information and derived insights. Where raw data or artefacts cannot cross a boundary, use policy-approved metadata, references, proofs or locally computed results where technically and legally appropriate.
- Preserve data sovereignty, access control, retention and audit requirements at the relevant boundary. Federation must not imply that every node receives every underlying record.
- Support partial connectivity, asynchronous reconciliation, independent operation and explicit conflict handling between locations.
- Permit cross-organisation collaboration only through explicit contracts, identity relationships, capabilities and data-sharing rules. A partner organisation must not gain ambient access to another organisation's memory merely because it participates in one joint project.
- Make trust changes and revocation meaningful across the federation. A compromised identity, node or operator must not retain authority simply because it was previously trusted or because a location is temporarily disconnected.
- Provide an enterprise-level view of projects, programmes, operations, risks and commitments without flattening local authority or hiding uncertainty.

#### 13.5 Shared organisational memory is governed, not unrestricted

The phrase "shared memory" must mean that relevant work becomes discoverable across the organisation under its access and sharing policy. It must not mean that every person, agent, provider or computer can read every record.

- Enforce identity, role, project membership, department, purpose, data classification, jurisdiction, consent and explicit resource permissions at retrieval and action time.
- Apply least privilege and deny by default across organisational and federation boundaries. Do not rely on UI filtering alone; access control must be enforced by the underlying services and data paths.
- Distinguish raw source records, confidential artefacts, shared summaries, metadata, derived insights and public organisational knowledge. Each may have different sharing rules.
- Preserve source attribution and links to the underlying evidence. Summaries and embeddings must not become an uncontrolled side channel around source permissions.
- Respect revocation, retention, deletion obligations and permission changes in indexes, caches, replicas and derived views. Define how already-derived insights are invalidated or re-evaluated when their source access changes.
- Keep secrets, credentials, personal data and restricted material out of general organisational retrieval unless explicitly authorised and necessary for the task.
- Record which identity or agent accessed, contributed, transformed or disclosed material organisational knowledge, and under which authority.
- Allow administrators to define organisation-wide defaults while retaining narrower project, team, department, location and jurisdiction controls.

#### 13.6 Cross-project intelligence and proactive issue discovery

Memev's organisational memory should do more than answer questions. It should help an integrated distributed team notice what isolated teams may miss.

Examples include:
- Detecting that two departments are making incompatible assumptions about the same customer, product, delivery date, cost or technical dependency.
- Identifying that a proposed commitment conflicts with capacity, an existing programme milestone, a known supplier issue or a previously recorded contractual obligation.
- Finding duplicated research, repeated failed approaches, reusable components or decisions that should be reconsidered in light of newer evidence.
- Noticing that a change in one project creates downstream risk for another project or business process.
- Identifying missing ownership, missing evidence, unverified claims or unresolved decisions that affect multiple workstreams.
- Surfacing opportunities where work in one department can accelerate or improve work in another.

These capabilities must be evidence-led and appropriately cautious:
- Every material finding should link to the source records, relevant scope and time context, affected entities and reasoning basis.
- Distinguish observed facts, recorded decisions, agent-generated inferences, assumptions and recommendations.
- State uncertainty, conflicting sources and missing context. Do not manufacture consensus from repetition or from multiple agents that share the same underlying source.
- Route consequential findings into the appropriate owner or decision workflow. Do not silently edit approved project scope, alter commitments, disclose restricted information or change business policy.
- Support dismissal, correction, adjudication and feedback so that false positives do not become permanent organisational memory.

#### 13.6.1 Federated site memory and organisation-wide intelligence

The intended Business and Enterprise topology is decentralised by site, not a single central company memory server.

For example, Building A may operate its own Memev server and canonical local memory for its battery engineering teams, repositories, plans, artefacts and operational activity. Building B may operate a separate Memev server and memory for its mechanical fitting teams and their work. Building C may do the same for its own people and activities. Each site remains an independently useful operational environment and retains local authority over its own records and workflows.

The sites participate in a governed federation:

- Each site maintains and serves its own local Memev memory and project/operational state. Local users and agents interact with that site even when another site or the wider network is unavailable.
- Site memories synchronise authorised, contractually defined state through CRDT-Merge so independently updated replicas converge under the engine's stated semantics. This is peer/site-to-peer federation; the target architecture must not require one central coordinator to sequence every ordinary update or act as the sole owner of organisational memory.
- ACFA-RS is used for the accountable admission, reconciliation and reconstruction of signed contributions where its guarantees are required. It complements convergence; it is not a substitute for CRDT-Merge and should not be described as a general-purpose memory synchronisation engine.
- E4 governs the relevant trust relationships and eligibility across participating people, agents, devices, services and sites. Trust governance does not replace identity, access policy or data classification.
- Memev's intelligence fabric operates across the federated sites. It can discover and reason over the organisation's authorised work as a whole, while respecting each site's authority, sharing rules, confidentiality, jurisdiction and data-residency constraints.
- The intelligence fabric must not assume that all raw records need to be copied into one central database. Depending on policy, it may use synchronised authorised state, federated queries, permitted derived insights or evidence references, while keeping restricted source data at its originating site.
- An employee can use their normal AI assistant at their own site and still receive relevant, evidence-linked understanding of work elsewhere in the organisation when the organisation's policy authorises that access. They should not have to know which building, server, repository or team holds the relevant information.
- Sites must continue local operation during network partitions. Reconciliation after reconnection must preserve provenance, identify conflicts and respect authority and policy; convergence must never silently grant access or turn an unapproved proposal into an approved business decision.

This is the intended operating model across the business: **each site owns and operates its local memory; the federation makes authorised organisational state interoperable; Memev provides organisation-wide intelligence across it.** There is no single central memory server or central coordinator on which every site depends.

Concrete example: a battery engineer in Building A updates a Git-backed battery enclosure plan and records that the design is 67% complete, including dimensions, thermal limits, mounting positions, weight constraints and milestones. Independently, a mechanical fitting engineer in Building B asks their own AI assistant to prepare an installation plan. Memev's intelligence fabric detects that the proposed mounting arrangement may conflict with the battery enclosure dimensions. It links the relevant versions and evidence from both sites, identifies affected tasks, milestones, owners and possible downstream procurement, assembly or schedule impacts, states its confidence and uncertainty, and routes the finding to the appropriate people. It does not silently change either approved plan. The same mechanism applies across engineering, procurement, finance, sales, HR, operations, compliance and other business activities—not only formal projects.

The acceptance target is not merely that one user can search another site's documents. It is that independently working people and teams can continue using their own environments while their authorised work contributes to a continuously updated organisation-wide model. Memev proactively evaluates how changes interact across sites and business functions, identifies previously undeclared relationships and conflicts, and helps the organisation coordinate a resolution without requiring employees to manually copy information into a central knowledge base.

#### 13.7 The distributed systems research becomes core infrastructure at multi-system scale

CRDT-Merge, ACFA-RS and E4 should be treated as complementary infrastructure for the Business and Enterprise deployment model, not as unrelated optional research demonstrations. Their importance increases as Memev moves from one person's local environment to independently operating devices, people, departments, offices and federated organisations.

- **CRDT-Merge — convergence of replicated work state:** the existing paid convergence engine is the convergence mechanism for supported distributed state. Its role should extend through a well-defined Memev integration contract from the initial supported conflict types to the structured project and organisational state required by the product: project and scope versions, requirements, plans, tasks and dependencies, assignments, execution attempts, artefact manifests, decisions, receipts and evidence references. Memev remains authoritative for project semantics, permissions, approvals and legal task transitions. CRDT-Merge does not decide whether work is correct, authorised or VERIFIED. Convergence of state is not proof of truth.
- **ACFA-RS — accountable admission and reconciliation of contributions:** use it where independently operating nodes and operators submit signed structured contributions, verifier findings, test results, measurements, compliance evidence or competing claims. Its role is to provide accountable admission, equivocation evidence and deterministic reconstruction under its stated assumptions. It is not a generic natural-language voting system and does not turn admitted evidence into proof of correctness.
- **E4 — distributed trust and eligibility governance:** use it to govern the trust relationships and evidence associated with people, agents, devices, services and participating organisations. Trust must affect eligibility, permitted operations and verification requirements, with provenance and reviewable changes. Do not collapse trust into one self-asserted score or treat trust propagation as a substitute for access control, cryptographic verification or independent evidence.

The integration boundaries must remain explicit:
- Memev owns project and organisational authority, canonical schemas, access policy, task lifecycle, approvals, verification semantics and user-facing decisions.
- CRDT-Merge owns its defined convergence mechanics behind the paid service boundary.
- ACFA-RS owns its defined accountable contribution-admission and reconstruction mechanisms where selected.
- E4 owns its defined trust-governance mechanisms where selected.
- The event, receipt and evidence model links these systems without allowing one subsystem to claim guarantees that belong to another.
- The system must remain useful locally and degrade safely if a paid or remote service is unavailable. It must not falsely claim distributed convergence, trust verification or evidence admission while those services are unavailable.

The Business tier should make multi-person, multi-device shared work state and organisational memory a first-class supported deployment, using the paid convergence integration where required. Enterprise should extend this into multi-office, multi-domain and international federation, with stronger trust, policy, sovereignty, audit and cross-boundary controls. Personal should remain approachable and local-first, supporting one person's agents and a small number of devices without forcing enterprise infrastructure onto an individual.

These are target architecture and integration requirements. They do not claim that the current Memev codebase or the existing service contracts already implement the full structured organisational-state or federation model. The exact schemas, APIs, policy model, failure semantics and guarantees must be specified, tested and accepted before being described as delivered.

#### 13.8 Scale is determined by topology and trust boundaries, not fixed device counts

Illustrative deployment profiles:
- **Personal:** one person, one computer, multiple local and cloud agents.
- **Personal multi-device:** one person across two or three computers, with shared personal work context and continuity.
- **Small business:** approximately ten people across multiple functions, sharing governed organisational memory and cross-functional intelligence.
- **Growing business:** a cluster of approximately 29 computers across several offices, with distributed execution and replicated organisational state.
- **Enterprise:** many offices and locations, multiple departments and programmes, with federated policy and trust domains.
- **International enterprise or inter-enterprise federation:** multiple countries, legal jurisdictions and independently governed organisations.

These are examples, not licensing or technical thresholds. A smaller deployment may need federation because of its legal or trust topology; a larger deployment in one controlled environment may not. Tier boundaries should reflect the capabilities, support, governance and operational complexity supplied, not arbitrary machine counts.

#### 13.9 Acceptance tests for the final-state architecture

Extend the integration and adversarial test programme to cover:
- One person using several different local and cloud agents on one computer, with shared context, consistent project state and no dependence on a single provider session.
- One person moving between two or three computers, with offline work, reconnection, duplicate and reordered updates, and correct recovery of personal project state.
- A representative small business with approximately ten people across different departments, each working on separate projects and activities, where authorised agents can discover relevant shared knowledge and identify a seeded cross-department conflict.
- A decentralised multi-building business in which Buildings A, B and C each operate independent Memev servers and local memories, with no central coordinator; prove that authorised state converges across sites through the defined CRDT-Merge integration and that ACFA-RS provides accountable admission/reconstruction for selected signed contributions.
- A partition test in which each building continues local work independently, then reconnects; prove deterministic reconciliation, provenance preservation, duplicate/reordered update handling and no implicit expansion of permissions or approval authority.
- The battery-engineering / mechanical-fitting scenario: a 67%-complete battery enclosure plan in Building A conflicts with a separately authored installation plan in Building B. Memev must discover the undeclared relationship, link both source versions, identify affected work and owners, explain uncertainty and possible downstream effects, and route the issue without silently changing either plan.
- An employee using their ordinary AI assistant at one site receives relevant organisation-wide answers and proactive warnings based on authorised work at other sites, without needing to know where the source server or repository resides.
- A restricted source record remains at its originating site while permitted metadata, evidence references or derived insights support a cross-site finding; prove that federated reasoning does not bypass classification, purpose, jurisdiction or revocation rules.
- Continuous and change-triggered analysis detects a newly introduced cross-site conflict without waiting for an employee to ask a question or manually submit the plans to a central knowledge base.
- A finding that correctly links the source evidence, affected projects, relevant owners and uncertainty, and is routed for review without silently changing either project.
- Confidential departmental or project information that must not be exposed to an unauthorised person or agent, including through summaries, search, embeddings, caches or derived insights.
- A growing business with several offices and independently operating nodes, including WAN partitions, delayed reconciliation, conflicting updates and local continuation.
- A multi-office enterprise with separate policy and trust domains, proving that approved state and evidence cross boundaries while restricted records remain local.
- A cross-border federation scenario with different data-residency or retention rules, proving that prohibited data is not replicated merely to simplify convergence.
- A compromised or revoked operator/device whose trust and permissions change, with affected contributions and downstream verification identified for review and revalidation.
- An unavailable CRDT-Merge, ACFA-RS or E4 service, proving that Memev reports degraded capability truthfully, preserves local history and does not claim guarantees it could not establish.
- Reproducible reconstruction of who contributed what, under which authority, which evidence was admitted, what was shared across each boundary and why a cross-project issue was raised.
- Growth in the number of people, projects, departments and nodes without turning the user experience into manual agent routing or requiring a central operator to reconcile every ordinary change.

Measure convergence and recovery, prohibited information disclosure, duplicate side effects, false or unsupported findings, evidence traceability, trust-change propagation, scoped re-verification, time to detect cross-project conflicts, operational overhead and the ability to continue through partial failure.

## Competitive implication

The closest product-level threats are autonomous engineering and multi-agent execution platforms, particularly OpenHands, Factory and Devin; Conductor and Replit are also relevant. Memory products are subsystem competitors, not the primary category for Scope One.

Memev should not compete merely on launching more agents or storing more context. Its intended differentiation should be the combination of:
- user-owned, provider-neutral project authority;
- outcome-led intake and formal scope decomposition;
- autonomous, state-machine-governed execution across eligible resources;
- explicit policy, approval and human-intervention boundaries;
- durable coordination and recoverable execution;
- a PMO-grade, factual and navigable project model spanning scope, roadmap, integrated plans, development plans, WBS, architecture, RAID, artefacts and decisions;
- simple permission configuration without exposing orchestration as a customer burden;
- evidence-bound verification and auditable history;
- an accessible non-technical workspace alongside deep developer visibility;
- local-first operation with optional cloud/commercial capabilities.
- shared organisational memory that connects people, departments, projects, programmes and business activities under explicit access and sovereignty rules;
- cross-functional intelligence that discovers evidence-backed conflicts, assumptions, risks, dependencies and reusable knowledge across otherwise independent work;
- progressive scale from personal multi-agent use to multi-person businesses and federated, international enterprises;
- distributed convergence, accountable contribution admission and trust governance through clearly separated CRDT-Merge, ACFA-RS and E4 integration boundaries.

These are positioning hypotheses, not established advantages. They must be demonstrated through the integration and fault-injection tests above.

## Recommended sequencing

1. Reconcile the live repository, contracts and requirement register.
2. Integrate and test the state machine, canonical store and coordinator as the execution authority.
3. Define the agent adapter/resource capability contract and complete a small number of real integrations.
4. Implement outcome intake, scope resolution, formal decomposition, lead authority and approval boundaries.
5. Define the canonical project, plan, architecture, artefact, decision, connection and permission relationship model and event projections needed by the workspace.
6. Deliver the minimum usable workspace early: lead-agent interaction, project brief/scope, roadmap, WBS, project progress, connections/access settings and genuine blockers. Add integrated/development plan views, architecture drill-down, RAID and rich artefact previews as the underlying models support them.
7. Complete autonomous dispatch, recovery, evidence-bound verification and adversarial tests, including UI reconstruction and permission revocation.
8. Complete onboarding, supported workflows and release paths.
9. Progress cloud, paid convergence and enterprise capabilities on stable interfaces without making them accidental blockers to local-first delivery.
10. Define and implement the governed organisational memory and cross-project knowledge graph, including identity-aware retrieval, provenance, classification, retention, derived-insight invalidation and cross-functional issue discovery.
11. Extend the paid CRDT-Merge integration contract to structured project and organisational state; define where ACFA-RS contribution admission and E4 trust governance participate, with explicit service failure and degraded-mode behaviour.
12. Deliver Business multi-person/multi-device operation and then Enterprise multi-office and international federation, validating each deployment profile with partition, confidentiality, trust and recovery tests.

Workstreams may proceed in parallel when their interfaces and ownership are stable. Do not create parallel implementations of the same authority or data model. Do not build elaborate visualisations before the underlying project relationships and event semantics are reliable.

## Review and adoption protocol

Claude A and Claude B should review this addendum independently against the current repository and Scope One requirements. Each should classify every recommendation as **agree**, **disagree** or **needs evidence**, identify omissions and cite concrete files, contracts or tests.

The outcome-led user experience, Memev-owned decomposition and orchestration, PMO-style project structure, lead-agent interaction, simple connections/access settings, blocker workflow and separation between user decisions and internal execution management should be reviewed as explicit product requirements.

Ryan should resolve disagreements. Only recommendations with explicit consensus and acceptance should be converted into development contracts or changes to the requirement register. Record rejected or deferred recommendations with a short rationale. This document itself is advisory until that review is complete.

**Non-goal:** This addendum does not authorise cutting agreed Scope One scope, claiming unfinished capabilities as delivered, or merging implementation work without the repository's normal tests and review.
