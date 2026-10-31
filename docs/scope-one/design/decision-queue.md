# SO-1.08 Decision queue: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md).

This is the decision record that contract SO-1.08 asks for (task T1, phase design). It builds nothing and changes no code. Every claim below cites a file and line or a document section. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open items](#open-items).

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-1.08-decision-queue.json`. The seven requirements are at lines 13 to 19, its scope and criteria follow, and its dependencies (SO-03-A and SO-C-C) are named at line 5.
- Code on main at `908654d`: `src/engine/project-state.mjs`, `src/engine/project-store.mjs`, `src/engine/coordinator.mjs`, `src/engine/contracts.mjs`.
- Docs: `docs/PROJECTS.md`, and in `docs/scope-one/`: `WBS.md`, `REQUIREMENTS.md`, `DECISIONS.md`.
- The owner's baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does.
- SO-03-A and SO-C-C are signed in the owner's vault and are not in this repository (spec line 5; `docs/scope-one/WBS.md` line 11, the dagger). This record cannot check them and does not restate their content.
- Current state in one line: no code on main implements a decision queue. A search of `src/` for a queue of blockers or decisions finds none; the one related declaration is the `approval` entity kind of the project store (`src/engine/project-store.mjs:28`), which has no states and no fields beyond `task_id`.
- Settled decisions this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, with the cloud only a relay and a backup (line 72); providers are neutral and no work depends on one (line 73). Nothing in this record depends on a single provider.

Queue states: raised, awaiting user, answered, approved, rejected, deferred, resolved. The seven names are fixed by the spec (`contracts/scope-one/specs/SO-1.08-decision-queue.json:16`). How an item moves between them is open, needs owner decision (see requirement 4).

Queue fields: severity or urgency, concise explanation, affected milestone and tasks, dependencies, options, recommended next step, decision owner, consequence of waiting. The eight fields are fixed by the spec (`contracts/scope-one/specs/SO-1.08-decision-queue.json:13`). Their types, value sets and storage are open, needs owner decision (see requirement 1).

## Requirement 1: a dedicated blocker and decision queue with severity or urgency, explanation, affected milestone and tasks, dependencies, options, recommended next step, decision owner and consequence of waiting

Decided by the sources:

- The queue is a dedicated one, and it carries the eight fields named above (spec line 13). The baseline names the same family of work as the "Blocker and decision workflow": genuine user decisions, approvals, material scope changes and unresolved policy exceptions (baseline 8.2, row "Blocker and decision workflow"). The WBS gives it one owner, SO-1.08 (`docs/scope-one/WBS.md:408`, `docs/scope-one/WBS.md:527`).
- Today the closest existing signal is the derived project status `NEEDS_ATTENTION`, which holds when a task is `BLOCKED` or `CONFLICTED` or when an approval is pending (`src/engine/project-state.mjs:221`; `docs/PROJECTS.md:34`). It is a status, not a queue: it lists no items and none of the eight fields.
- The pending-approval input of that status is a boolean flag passed by the caller (`src/engine/project-state.mjs:217`, `:221`). No code in `src/` sets it.

Open, needs owner decision:

- Whether severity or urgency (spec line 13 allows either) is the field, and its value set.
- Where the queue is stored: a new entity kind in the project store, or the existing `approval` kind (`src/engine/project-store.mjs:20-29`). The store schema decision is ADR 1, status open, with the safe default "extend the existing store in place; do not create a second store" (`docs/scope-one/DECISIONS.md:18-27`).
- How an item names its affected milestone, tasks and dependencies. Tasks carry `dependsOn` (`src/engine/project-state.mjs:64`) and the register has a dashboard requirement for "outstanding decisions, blockers" (`docs/scope-one/REQUIREMENTS.md:61`); the sources define no project milestone record for an item to point at (`src/engine/milestones.mjs:2-8` holds product activation milestones worked out from the vault, not project milestones).

## Requirement 2: distinguish a genuine blocker requiring user action from an agent's internal retry, transient failure or routine subtask

Decided by the sources:

- The distinction is required (spec line 14). The baseline places retries, assignment, dispatch, resource health and recovery inside the internal system, and says the user cannot bypass permissions, approvals or state-machine rules (baseline 9.3, the paragraph on the internal system).
- Two register rows give the two sides. A routine reversible choice proceeds with a recorded default (`docs/scope-one/REQUIREMENTS.md:57`, SO-REQ-033). An ambiguous high-impact choice, or an action beyond a cost or permission boundary, goes to the user (`docs/scope-one/REQUIREMENTS.md:56`, `:58`; SO-REQ-032 and SO-REQ-034). A failed verification is retried within policy or reported as a blocker (`docs/scope-one/REQUIREMENTS.md:59`, SO-REQ-035).
- Today the state `BLOCKED` means "waiting on something outside the task" (`docs/PROJECTS.md:19`) and does not say whether a person or the system must act. A lease expiry, which the coordinator handles as an internal event, ends with the task set to `BLOCKED` and the reason `owner_lost` (`src/engine/coordinator.mjs:258-286`, reason at `:277`). By `src/engine/project-state.mjs:221` a `BLOCKED` task makes the project `NEEDS_ATTENTION`. So on main an internal event and a user-action blocker produce the same status.

Open, needs owner decision:

- The rule that classifies an event as a genuine blocker. The inputs it would use are not settled: policy defaults are ADR 4, status open (`docs/scope-one/DECISIONS.md:48-56`), and the retry limits in the coordinator are local defaults pending the SO-03-A policy module (`src/engine/coordinator.mjs:17-22`).

## Requirement 3: keep routine retries, agent replacement, provider failover, lease expiry and execution recovery inside Memev, and do not turn ordinary infrastructure events into customer decisions

Decided by the sources:

- These five stay inside Memev (spec line 15; baseline 9.3, the paragraph on the internal system).
- What the code does today for each, with no queue involved:
  - Retries: a retry of an external action reads the recorded outcome first and is refused once the policy limit is reached (`src/engine/coordinator.mjs:384-399`, refusal at `:397`). Writers that find the store lock held retry in place (`src/engine/coordinator.mjs:36-41`; `src/engine/project-store.mjs:139-150`).
  - Lease expiry: the sweep expires the lease and blocks the task; "Nothing is reassigned" (`src/engine/coordinator.mjs:258-259`; `docs/PROJECTS.md:128-130`).
  - Agent replacement: `reassign` needs an expired or released lease, or an authorised override (`src/engine/project-state.mjs:262-285`). No module outside the engine calls it; the integration gap is SO-1.01 (`contracts/scope-one/manifest.json:11`).
  - Execution recovery: the store rebuilds its state from the event log on open and reports a torn last line (`src/engine/project-store.mjs:102-121`).
  - Provider failover: no code in `src/` mentions failover (search of `src/` for "failover" returns nothing). Open, needs owner decision.
- The register row that sets the boundary between the two worlds: after retries within policy fail, the system "reports a blocker" (`docs/scope-one/REQUIREMENTS.md:59`, SO-REQ-035).

Open, needs owner decision:

- Provider failover behaviour, because nothing on main implements it and the sources do not describe it.
- The point at which an internal retry or replacement that keeps failing becomes a queue item (the retry limit and the replacement limit). Same dependency as requirement 2: ADR 4, and the SO-03-A policy module.
- Because `reassign` and the sweep are not called by any daemon, CLI or MCP route today (`contracts/scope-one/manifest.json:11`), whether the first queue contract changes them is a SO-1.01 sequencing question: open, needs owner decision.

## Requirement 4: give each human decision a clear state (raised, awaiting user, answered, approved, rejected, deferred or resolved) and preserve the decision and its rationale in project history

Decided by the sources:

- The seven states are the ones listed at the top of this record (spec line 16). They are separate from the eleven task states (`src/engine/project-state.mjs:19-31`) and the seven project statuses (`src/engine/project-state.mjs:33-41`); none of the seven decision states exists in code today.
- The project layer already keeps an append-only history of transitions. A transition record carries actor, time, reason, previous state, new state, scope version, correlation id and evidence references (`src/engine/project-state.mjs:106-131`; `docs/PROJECTS.md:94-96`). The event log gives every record a unique id and freezes it on entry (`src/engine/project-state.mjs:160-175`). The store holds one append-only event log per project (`src/engine/project-store.mjs:1-5`).

Open, needs owner decision:

- The transition table between the seven states: which moves are allowed, which are terminal, and what separates "answered" from "approved" and "rejected". The spec lists the names and defines none of the moves.
- Whether decision state changes reuse the transition record shape above, which is defined for tasks (`src/engine/project-state.mjs:112`), or a separate shape.
- Where the rationale text is held, and how long it is kept: retention defaults are ADR 4 (`docs/scope-one/DECISIONS.md:48-56`).

## Requirement 5: the lead agent explains the issue in plain language, presents viable options, and says what it recommends and why, without presenting its recommendation as the user's decision

Decided by the sources:

- The requirement is fixed by the spec (line 17). The baseline describes the lead as clarifying material questions and requesting approval where required (baseline 9.3, the persistent lead-agent interaction).
- The recommendation has its own field, "recommended next step", apart from "options" and "decision owner" (spec line 13). The spec's separation of recommendation from decision is therefore carried by the field list itself.
- The project lead is a different thing from the existing bus operator role unless configured otherwise (`docs/scope-one/REQUIREMENTS.md:104`, SO-REQ-080). No lead-agent module for projects exists in `src/`; lead assignment belongs to SO-1.03 and the signed contract SO-L-A (`contracts/scope-one/manifest.json:37`; `docs/scope-one/WBS.md:522`), which this repository cannot check.

Open, needs owner decision:

- Which actor identities count as "the user" for the answered, approved and rejected states, so that a recommendation by an agent can never fill them. The identity and permission model is ADR 5, status open (`docs/scope-one/DECISIONS.md:58-66`).
- The plain-language wording standard and who writes it (the lead only, or any agent that raises an item).

## Requirement 6: when a decision is made, update the canonical project record and recalculate affected dependencies, plans, task eligibility and verification freshness

Decided by the sources:

- The requirement is fixed by the spec (line 18). The canonical record is the project store (`src/engine/project-store.mjs:1-5`); making it the one authority is SO-1.01 (`contracts/scope-one/manifest.json:11`).
- Existing recalculation code, all pure functions and none called by a daemon, CLI or MCP route today:
  - Verification freshness: `amendScope` raises the scope version, marks the affected evidence stale, and moves affected `VERIFIED` and `VERIFYING` tasks back to `ACCEPTED` with a replan reason (`src/engine/project-state.mjs:177-214`).
  - Task eligibility: a task is `READY` only when every dependency is `VERIFIED` (`src/engine/project-state.mjs:63-72`), and eligible for dispatch only while `READY` and the project is not paused (`src/engine/project-state.mjs:287-289`).
  - Project status: derived from the tasks and flags (`src/engine/project-state.mjs:217-225`).
- The baseline requires that a material scope or artifact change invalidate affected evidence and approvals (baseline 9.4, the paragraph after the execution sequence). `amendScope` handles tasks and evidence only; it does not touch approval records (`src/engine/project-state.mjs:184-214`).
- Propagation of staleness through relations between project items is owned by SO-1.07 (`docs/scope-one/WBS.md:526`).

Open, needs owner decision:

- Which decision outcomes change scope (and so call `amendScope`) and which change only plan or eligibility.
- Whether a decision invalidates approvals in the queue, since the baseline requires it and `amendScope` does not do it.
- Where the SO-1.08 boundary with SO-1.07 propagation lies. The spec names its dependencies as SO-03-A and SO-C-C (spec line 5), and the WBS gives SO-1.08 only the dependency SO-1.01 (`docs/scope-one/WBS.md:527`).

## Requirement 7: never silently skip permissions, invent an approval, discard a blocker or continue a consequential action that requires human authorisation

Decided by the sources:

- The requirement is fixed by the spec (line 19). The register restates its core: an action beyond a configured cost or permission boundary stops at the policy gate and requests approval (`docs/scope-one/REQUIREMENTS.md:58`, SO-REQ-034).
- Standing rules already in code that this record keeps:
  - An agent's report is not evidence, so work cannot become `VERIFIED` on a claim alone (`src/engine/project-state.mjs:9`, `:91-104`).
  - Reassignment of a held task needs an expired or released lease or an override marked authorised (`src/engine/project-state.mjs:262-270`).
  - An approval of a signed contract is a local operator action and cannot be made by a remote caller (`src/engine/contracts.mjs:164-166`); a remote-signed contract's commands stay blocked until that approval exists (`src/engine/contracts.mjs:222-232`). This covers contract signing only, not project decisions.
- Until the permission matrix is decided, the standing safe default is: keep the current gates, grant no new role or action, and anything ungated stays denied (ADR 5, `docs/scope-one/DECISIONS.md:58-66`).

Open, needs owner decision:

- The list of consequential actions that need human authorisation: policy defaults (ADR 4, `docs/scope-one/DECISIONS.md:48-56`) and the permission matrix (ADR 5, `docs/scope-one/DECISIONS.md:58-66`) are both open.
- Whether an item can be discarded at all, and if so by whom. The spec forbids silent discard (line 19); the sources define no explicit discard path.
- How an approval is shown to be genuine (not invented) for project decisions. The contract-approval mechanism is the only precedent in code, and the sources do not say it extends to the queue.

## Open items

Each needs an owner decision before a build contract can be written.

1. Severity or urgency: which field, and its value set (requirement 1).
2. Where the queue is stored: new entity kind or the existing `approval` kind; tied to ADR 1 (requirement 1).
3. How an item references its milestone, tasks and dependencies; no project milestone record is defined in the sources (requirement 1).
4. The rule that separates a genuine blocker from an internal event; tied to ADR 4 and the SO-03-A policy module (requirement 2).
5. Provider failover: no implementation or description in the sources (requirement 3).
6. The retry and replacement limits at which an internal failure becomes a queue item (requirement 3).
7. Whether the first queue contract changes `reassign` and the lease sweep, or waits for SO-1.01 to wire them (requirement 3).
8. The transition table between the seven states, and the meaning of "answered" against "approved" and "rejected" (requirement 4).
9. Whether decision changes reuse the task transition record shape; where rationale is held and for how long (requirement 4).
10. Which identities count as "the user" for the answered, approved and rejected states; tied to ADR 5 (requirement 5).
11. The plain-language standard and the actor allowed to write queue items (requirement 5).
12. Which decision outcomes change scope, and whether a decision invalidates approvals (requirement 6).
13. The boundary between SO-1.08 and SO-1.07 propagation, and the mismatch between the dependencies in the spec (SO-03-A, SO-C-C) and in the WBS (SO-1.01) (requirement 6).
14. The list of actions that need human authorisation; tied to ADR 4 and ADR 5 (requirement 7).
15. Whether and how an item can be discarded, and how a genuine approval is proven (requirement 7).
16. SO-03-A and SO-C-C are signed in the owner's vault and cannot be read from this repository; their content has to be checked against this record by the owner (spec line 5).
