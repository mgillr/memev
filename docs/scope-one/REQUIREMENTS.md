# Scope One requirement register

This register lists every Scope One requirement the takeover record has to account for.
Each row is one requirement, given a stable id, the handoff section it comes from, the user
outcome in plain language, and exactly one status. The [traceability matrix](TRACEABILITY.md)
carries one row per id here, so a requirement can never lose its status or its evidence.

[Back to the documentation index](../README.md)

## How to read a status

- `EXISTS_AND_VERIFIED`: the requirement is implemented on main and a test proves it.
- `EXISTS_BUT_INCOMPLETE`: part of it is on main, but a named piece is still missing.
- `DOCUMENTED_ONLY`: the handoff describes it, but nothing in the tree implements it yet.
- `MISSING`: a requirement the handoff names that has no implementation and no partial work.
- `CONFLICTING`: two sources disagree about what the requirement is.
- `UNKNOWN`: the author could not determine the state from the inputs of this set.
- `DEFERRED_BY_OWNER`: the owner explicitly deferred it; the complete-system section allows
  an explicit owner deferral and nothing else.

## Register

| id | handoff section | user outcome | status |
| --- | --- | --- | --- |
| SO-REQ-001 | Scope One acceptance criteria | A non-technical user installs and connects the initial supported clients through a guided flow. | DOCUMENTED_ONLY |
| SO-REQ-002 | Scope One acceptance criteria | A user describes a project in natural language and receives a comprehensible scope, assumptions, plan, and acceptance criteria. | DOCUMENTED_ONLY |
| SO-REQ-003 | Scope One acceptance criteria | Material ambiguity and consequential actions trigger the appropriate approval, while routine reversible work proceeds autonomously. | DOCUMENTED_ONLY |
| SO-REQ-004 | Scope One acceptance criteria | A user approves, pauses, resumes, amends, or cancels the project without manually coordinating individual agents. | DOCUMENTED_ONLY |
| SO-REQ-005 | Scope One acceptance criteria | The planner decomposes scope into dependency-aware tasks with stable ids. | DOCUMENTED_ONLY |
| SO-REQ-006 | Scope One acceptance criteria | At least two supported agent sessions execute different tasks through the shared state model. | DOCUMENTED_ONLY |
| SO-REQ-007 | Scope One acceptance criteria | Exclusive task claims and stale ownership are enforced under concurrency. | DOCUMENTED_ONLY |
| SO-REQ-008 | Scope One acceptance criteria | A daemon restart or new session reconstructs state from canonical records. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-009 | Scope One acceptance criteria | The interface distinguishes reported, inferred, and verified state and shows provenance. | DOCUMENTED_ONLY |
| SO-REQ-010 | Scope One acceptance criteria | No task becomes verified without required checks tied to current scope and artifact versions. | DOCUMENTED_ONLY |
| SO-REQ-011 | Scope One acceptance criteria | Failed checks, blocked work, conflicts, stale evidence, and missing permissions are actionable and visible. | DOCUMENTED_ONLY |
| SO-REQ-012 | Scope One acceptance criteria | Pause stops new dispatch and accurately reports in-flight task status. | DOCUMENTED_ONLY |
| SO-REQ-013 | Scope One acceptance criteria | Duplicate events and stale results do not corrupt state or repeat non-idempotent actions blindly. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-014 | Scope One acceptance criteria | Existing tests continue to pass and new deterministic failure cases are automated. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-015 | Scope One acceptance criteria | A final delivery summary includes artifacts, run and use instructions, checks performed, evidence, limitations, and unresolved items. | DOCUMENTED_ONLY |
| SO-REQ-016 | Scope One acceptance criteria | Product documentation identifies per-client capability limits and does not overclaim universal auto-registration or hard cancellation. | EXISTS_AND_VERIFIED |
| SO-REQ-017 | Failure tests F01 to F20 | When session context is compacted, scope, constraints, task state, and the next action survive resume. | MISSING |
| SO-REQ-018 | Failure tests F01 to F20 | When a different supported agent resumes the project, it receives canonical state and only eligible assignments. | MISSING |
| SO-REQ-019 | Failure tests F01 to F20 | When an agent claims completion without passing checks, the work remains unverified. | MISSING |
| SO-REQ-020 | Failure tests F01 to F20 | When stale context from another project appears, project boundaries and provenance prevent silent contamination. | MISSING |
| SO-REQ-021 | Failure tests F01 to F20 | When two agents claim an exclusive task, one claim wins and the other gets a clear conflict response. | MISSING |
| SO-REQ-022 | Failure tests F01 to F20 | When an agent disconnects mid-task, the system recovers from a checkpoint without blind duplicate dispatch. | MISSING |
| SO-REQ-023 | Failure tests F01 to F20 | When an old agent returns after reassignment, its output is retained but cannot overwrite current state. | MISSING |
| SO-REQ-024 | Failure tests F01 to F20 | When scope changes after verification, affected checks become stale and tasks are replanned. | MISSING |
| SO-REQ-025 | Failure tests F01 to F20 | When devices sync incompatible changes, the conflict is visible and resolvable, not silently overwritten. | MISSING |
| SO-REQ-026 | Failure tests F01 to F20 | When a user pauses during active execution, no new dispatch happens and in-flight cancellation state is reported honestly. | MISSING |
| SO-REQ-027 | Failure tests F01 to F20 | When a required verifier is unavailable, the task cannot become verified and the system explains why. | MISSING |
| SO-REQ-028 | Failure tests F01 to F20 | When an event is delivered twice, idempotency prevents duplicate transitions and side effects. | MISSING |
| SO-REQ-029 | Failure tests F01 to F20 | When a client lacks session discovery or cancellation, status shows the limitation accurately. | MISSING |
| SO-REQ-030 | Failure tests F01 to F20 | When evidence belongs to an old scope or artifact, it is not accepted for the current scope without explicit policy. | MISSING |
| SO-REQ-031 | Failure tests F01 to F20 | When the daemon restarts, canonical state and event history reconstruct consistently. | EXISTS_AND_VERIFIED |
| SO-REQ-032 | Failure tests F01 to F20 | When the planner encounters an ambiguous high-impact choice, it asks the user and explains the consequence. | MISSING |
| SO-REQ-033 | Failure tests F01 to F20 | When a routine reversible choice is underspecified, the system chooses a reasonable default, records the assumption, and proceeds. | MISSING |
| SO-REQ-034 | Failure tests F01 to F20 | When an action exceeds a configured cost or permission boundary, it stops at the policy gate and requests approval. | MISSING |
| SO-REQ-035 | Failure tests F01 to F20 | When verification fails, the system diagnoses, retries within policy, or reports a blocker, and does not claim success. | MISSING |
| SO-REQ-036 | Failure tests F01 to F20 | When an external side effect succeeds but acknowledgement is lost, the system checks the actual outcome before retrying to avoid duplicate side effects. | MISSING |
| SO-REQ-037 | Dashboard acceptance criteria | A first-time non-technical user identifies project status, next milestone, outstanding decisions, blockers, and the latest deliverable without engineer onboarding. | DOCUMENTED_ONLY |
| SO-REQ-038 | Dashboard acceptance criteria | Clicking a milestone or task reveals dependencies, owner, acceptance criteria, latest events, and verification evidence. | DOCUMENTED_ONLY |
| SO-REQ-039 | Dashboard acceptance criteria | The agents view reports actual runtime status and does not fabricate activity. | DOCUMENTED_ONLY |
| SO-REQ-040 | Dashboard acceptance criteria | The comms view filters and traces messages to the tasks and decisions they concern, respecting access controls and redacting secrets. | DOCUMENTED_ONLY |
| SO-REQ-041 | Dashboard acceptance criteria | Changes show scope and plan history and identify affected verification when scope or artifacts change. | DOCUMENTED_ONLY |
| SO-REQ-042 | Dashboard acceptance criteria | Outstanding work is derived from canonical state and includes blocked work, unresolved conflicts, and missing evidence. | DOCUMENTED_ONLY |
| SO-REQ-043 | Dashboard acceptance criteria | Interface status stays consistent with backend state after refresh, process restart, and reconnection. | DOCUMENTED_ONLY |
| SO-REQ-044 | Dashboard acceptance criteria | Closing the dashboard does not stop autonomous execution, and reopening it reconstructs current state from durable project data. | DOCUMENTED_ONLY |
| SO-REQ-045 | Dashboard acceptance criteria | A user starts from a natural-language goal and reaches the first meaningful plan without configuring agents, protocols, or infrastructure. | DOCUMENTED_ONLY |
| SO-REQ-046 | Onboarding acceptance criteria | A user with only a local folder starts a project without a GitHub account. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-047 | Onboarding acceptance criteria | A user with GitHub connects it once, selects permitted repositories, and uses them from the command centre without configuring each agent separately. | DOCUMENTED_ONLY |
| SO-REQ-048 | Onboarding acceptance criteria | Local folder access and GitHub access are separately scoped, visible, and revocable. | DOCUMENTED_ONLY |
| SO-REQ-049 | Onboarding acceptance criteria | Existing Git remotes and repository history are detected and preserved, with no duplicates or silent overwrites. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-050 | Onboarding acceptance criteria | Creating a remote repository or pushing local content requires explicit confirmation of owner, visibility, destination, and operation. | DOCUMENTED_ONLY |
| SO-REQ-051 | Onboarding acceptance criteria | The system never claims to create a GitHub account automatically and guides the user through provider-owned registration steps. | DOCUMENTED_ONLY |
| SO-REQ-052 | Onboarding acceptance criteria | Secret scanning and destination checks run before publishing content, and detected secrets block the push until resolved. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-053 | Onboarding acceptance criteria | Agents cannot access local paths or repositories outside the user grants, even if another agent requests access. | DOCUMENTED_ONLY |
| SO-REQ-054 | Onboarding acceptance criteria | When setup is complete, the lead and all permitted agents use the same project-scoped access layer without per-agent credentials. | DOCUMENTED_ONLY |
| SO-REQ-055 | Lead agent acceptance criteria | Setup lets the user select a supported available lead while remaining usable with sensible defaults. | DOCUMENTED_ONLY |
| SO-REQ-056 | Lead agent acceptance criteria | The chosen lead is visible in the command centre along with its provider, health, and current role. | DOCUMENTED_ONLY |
| SO-REQ-057 | Lead agent acceptance criteria | Exactly one lead has authority to dispatch work at a time, even when several AI clients are connected to the same bus. | DOCUMENTED_ONLY |
| SO-REQ-058 | Lead agent acceptance criteria | Two agents coordinating the same project cannot create competing plans or dispatch the same task under different leadership. | DOCUMENTED_ONLY |
| SO-REQ-059 | Lead agent acceptance criteria | An unavailable preferred lead triggers an explicit recovery choice, with no silent substitution. | DOCUMENTED_ONLY |
| SO-REQ-060 | Lead agent acceptance criteria | Lead handover preserves canonical project state, records an auditable event, and prevents the old lead from acting with stale authority. | DOCUMENTED_ONLY |
| SO-REQ-061 | Lead agent acceptance criteria | A lead failure does not erase work or trigger blind duplicate execution, and recovery follows the saved preference and fallback policy. | DOCUMENTED_ONLY |
| SO-REQ-062 | Lead agent acceptance criteria | The bus operator role and the project lead are independently represented unless the user explicitly configures them to be the same. | DOCUMENTED_ONLY |
| SO-REQ-063 | Release acceptance criteria | Every advertised install method has been executed successfully in a clean environment using the published artifact. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-064 | Release acceptance criteria | The npm package installs and its documented executable runs on each claimed supported platform and runtime. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-065 | Release acceptance criteria | The published Docker image starts, passes its health check, preserves configured data across restart, and follows documented configuration and permission requirements. | DOCUMENTED_ONLY |
| SO-REQ-066 | Release acceptance criteria | A clean source checkout builds and passes the documented test suite without relying on local developer state. | EXISTS_AND_VERIFIED |
| SO-REQ-067 | Release acceptance criteria | The lead agent can follow the installation runbook, verify the result, and clearly report success or failure without hard-coded provider assumptions. | DOCUMENTED_ONLY |
| SO-REQ-068 | Release acceptance criteria | Quick-start commands, package versions, image tags, environment variables, ports, and prerequisites match the actual release. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-069 | Release acceptance criteria | CI and release records provide traceable evidence, and failed mandatory gates block publication. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-070 | Release acceptance criteria | Upgrade, backup and recovery, and rollback instructions are tested for the supported release path. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-071 | Release acceptance criteria | No release is called production-ready while a mandatory advertised installation path is broken or unverified. | DOCUMENTED_ONLY |
| SO-REQ-072 | Builder handoff checklist | Confirm the baseline branch, commit, working tree, and test status. | EXISTS_AND_VERIFIED |
| SO-REQ-073 | Builder handoff checklist | Implement scoped local workspace selection and access checks before allowing agents to read or write project files. | DOCUMENTED_ONLY |
| SO-REQ-074 | Builder handoff checklist | Implement GitHub authorization, repository discovery and selection, and explicit repository-creation and push confirmation, keeping local-only use available. | DOCUMENTED_ONLY |
| SO-REQ-075 | Builder handoff checklist | Add secret scanning and destination and history checks before any initial push or publish operation. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-076 | Builder handoff checklist | Validate the source map against current code before implementation. | DOCUMENTED_ONLY |
| SO-REQ-077 | Builder handoff checklist | Agree the first supported clients and test them end to end. | DOCUMENTED_ONLY |
| SO-REQ-078 | Builder handoff checklist | Implement the state schema, transitions, and invariants first. | DOCUMENTED_ONLY |
| SO-REQ-079 | Builder handoff checklist | Implement lead selection, single-authority enforcement, and safe lead handover before parallel dispatch. | DOCUMENTED_ONLY |
| SO-REQ-080 | Builder handoff checklist | Keep the project lead distinct from the existing bus operator role unless explicitly configured. | DOCUMENTED_ONLY |
| SO-REQ-081 | Builder handoff checklist | Implement atomic ownership, idempotency, and recovery before parallel dispatch. | DOCUMENTED_ONLY |
| SO-REQ-082 | Builder handoff checklist | Connect contracts and verification before claiming autonomous delivery. | DOCUMENTED_ONLY |
| SO-REQ-083 | Builder handoff checklist | Add policy and human gates before enabling external or destructive actions. | DOCUMENTED_ONLY |
| SO-REQ-084 | Builder handoff checklist | Ship the complete vertical slice before expanding integrations. | DOCUMENTED_ONLY |
| SO-REQ-085 | Builder handoff checklist | Record the demo and metrics, and update this document as implementation decisions change. | DOCUMENTED_ONLY |
| SO-REQ-086 | The finished Scope One system | A complete, non-technical onboarding and project command centre. | DOCUMENTED_ONLY |
| SO-REQ-087 | The finished Scope One system | Local project-folder selection and safe, explicitly scoped filesystem access. | DOCUMENTED_ONLY |
| SO-REQ-088 | The finished Scope One system | Optional GitHub connection, repository discovery and selection, scoped permissions, safe Git operations, and secret scanning before publication. | DOCUMENTED_ONLY |
| SO-REQ-089 | The finished Scope One system | A user-selected supported lead agent, visible fallback handling, one active coordinator, and safe lead handover. | DOCUMENTED_ONLY |
| SO-REQ-090 | The finished Scope One system | Natural-language goal intake, clarification of material ambiguity, plan and scope review, and approval gates for consequential actions. | DOCUMENTED_ONLY |
| SO-REQ-091 | The finished Scope One system | Persistent project and task state, atomic contracts, dependencies and ownership, dispatch, progress, retries, idempotency, interruption recovery, and conflict handling. | DOCUMENTED_ONLY |
| SO-REQ-092 | The finished Scope One system | Integrated memory and shared context based on a documented architecture decision, with recall, provenance, retention, recovery, and migration guarantees. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-093 | The finished Scope One system | Specialist-agent coordination through reconciled existing bus and tool interfaces, not a competing orchestration subsystem. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-094 | The finished Scope One system | Build, test, integration, and evidence-backed verification, where a task claim alone is not completion and changes to scope or artifacts invalidate affected verification. | DOCUMENTED_ONLY |
| SO-REQ-095 | The finished Scope One system | Security and permissions enforced by runtime adapters, with least privilege, revocation, secrets protection, audit records, and human approval for destructive, external, financial, privacy-sensitive, or otherwise consequential actions. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-096 | The finished Scope One system | Complete install, first-run, upgrade, backup and recovery, rollback, and uninstall paths for every advertised supported distribution. | EXISTS_BUT_INCOMPLETE |
| SO-REQ-097 | The finished Scope One system | User-facing delivery of results, test evidence, documented limitations, remaining work, and useful troubleshooting information. | DOCUMENTED_ONLY |
| SO-REQ-098 | The finished Scope One system | Regression, integration, security, clean-install, upgrade, restart and recovery, and end-to-end acceptance tests. | EXISTS_BUT_INCOMPLETE |
