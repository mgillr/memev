# SO-1.08 Decision queue: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md).

This is the decision record that contract SO-1.08 asks for (task T1, phase design). It builds nothing and changes no code. It cites the contracts that already specify most of the queue by id and does not restate them. Every claim cites a file and line, a contract id and criterion, or a document section. Where the sources are silent the text says "open, needs owner decision" and the item is listed under [Open items](#open-items).

## Sources and cited contracts

- Spec: `contracts/scope-one/specs/SO-1.08-decision-queue.json`. The seven requirements are at lines 13 to 19. Its dependencies (SO-03-A and SO-C-C) are named at line 5.
- Code on main at `908654d`: `src/engine/project-state.mjs`, `src/engine/project-store.mjs`, `src/engine/coordinator.mjs`. Docs: `docs/PROJECTS.md`, and in `docs/scope-one/`: `WBS.md`, `REQUIREMENTS.md`, `DECISIONS.md`.
- Settled decisions followed (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, the cloud only a relay and a backup (line 72); providers are neutral (line 73).
- Current state: no code on main implements a decision queue. The one related declaration is the `approval` entity kind of the project store, with no states and no fields beyond `task_id` (`src/engine/project-store.mjs:28`).

Contracts cited by id. None is in this repository; each is held in the owner's vault, in the bundle and file named below (provider-neutral text, no other detail).

| Id | Status | Vault bundle and file | Cited for |
| --- | --- | --- | --- |
| SO-A-05 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | the decision entity, its states, fields and rules |
| SO-A-04 | fold contract, unsigned, proposed | same bundle and file | milestone entities, stale markers on approvals |
| SO-A-07 | fold contract, unsigned, proposed | same bundle and file | rerouting when a resource becomes unavailable (AC04) |
| SO-03-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | risk classes, approvals, the user-only gate, decision events, `pending()` |
| SO-C-A | signed | same bundle and file | the decisions endpoint (AC04) |
| SO-C-C | signed | same bundle and file | outstanding work (AC02), sparse notifications (AC05) |
| SO-O-A | signed | same bundle and file | access requests in the queue (AC05) |
| SO-05-D | signed | same bundle and file | failed checks retry within policy, then FAILED or BLOCKED (AC05) |
| SO-08-B | signed | same bundle and file | `recover()` and its plan: resume, reassign or ask the user (AC01) |

Because SO-A-05, SO-A-04 and SO-A-07 are unsigned, what they decide is a proposal until the owner signs them. This record cites them as the intended owner and does not treat them as settled.

Queue states: raised, awaiting user, answered, approved, rejected, deferred, resolved. The names are fixed by the spec (`contracts/scope-one/specs/SO-1.08-decision-queue.json:16`) and by SO-A-05 AC01. The table of moves between them is not defined by either: open, needs owner decision (requirement 4).

Queue fields: severity or urgency, concise explanation, affected milestone and tasks, dependencies, options, recommended next step, decision owner, consequence of waiting. The eight fields are fixed by the spec (`contracts/scope-one/specs/SO-1.08-decision-queue.json:13`) and carried by SO-A-05 AC02, with severity as the chosen name and the order "severity then age". The severity value set is open, needs owner decision (requirement 1).

## Requirement 1: a dedicated blocker and decision queue with severity or urgency, explanation, affected milestone and tasks, dependencies, options, recommended next step, decision owner and consequence of waiting

- Covered by: SO-A-05 AC01 (the decision entity added to the store validators) and AC02 (all eight fields, `memev work decisions` and `/api/decisions` serve one record); SO-03-A AC02 (`pending()` carries the choice, why it matters, the recommended option, the consequences and what proceeds while waiting); SO-C-A AC04 (the endpoint); SO-A-04 AC01 (milestone, deliverable and work package entities that an item can name).
- Repo fact: today the nearest signal is the derived project status `NEEDS_ATTENTION`, set when a task is `BLOCKED` or `CONFLICTED` or when a pending-approval flag is passed in (`src/engine/project-state.mjs:221`; `docs/PROJECTS.md:34`). It lists no items, and no code in `src/` sets the flag.
- Gap, open, needs owner decision: the severity value set.

## Requirement 2: distinguish a genuine blocker requiring user action from an agent's internal retry, transient failure or routine subtask

- Covered by: SO-A-05 AC03 (only a recovery plan of "ask the user" creates a decision; the test injects each internal event and asserts the queue is unchanged); SO-08-B AC01 (`recover()` returns resume, reassign or ask the user); SO-C-A AC02 (needs-my-attention holds only real decisions, missing access, material ambiguity and blockers); SO-C-C AC05 (only genuine blockers notify).
- Register rows that set the two sides: a routine reversible choice proceeds with a recorded default, an ambiguous high-impact choice or a boundary breach goes to the user (`docs/scope-one/REQUIREMENTS.md:56-58`).
- Repo fact: on main a lease expiry sets the task `BLOCKED` with reason `owner_lost` (`src/engine/coordinator.mjs:258-286`), and a `BLOCKED` task makes the project `NEEDS_ATTENTION` (`src/engine/project-state.mjs:221`). An internal event and a user-action blocker give the same status today. SO-A-05 AC03 is the contract that separates them.
- Gap, open, needs owner decision: the conditions under which a recovery counts as "ask the user". They depend on policy defaults (ADR 4, `docs/scope-one/DECISIONS.md:48-56`).

## Requirement 3: keep routine retries, agent replacement, provider failover, lease expiry and execution recovery inside Memev

- Covered by: SO-A-05 AC03 (retries, provider failover, transient failures, lease expiry and reassignment never create a decision); SO-08-B AC01 (recovery inspects, then resumes or reassigns); SO-05-D AC05 (retries within the policy limit for idempotent verifiers only, then FAILED or BLOCKED); SO-A-07 AC04 (a resource that becomes unavailable updates the registry, dispatch is prevented, work is rerouted within policy where another eligible resource exists, and a user blocker is raised only when a reconnect or new grant is needed).
- Repo fact: retries, lease expiry, replacement and recovery exist as engine functions with no caller outside the engine (`src/engine/coordinator.mjs:36-41`, `:258-286`, `:384-399`; `src/engine/project-state.mjs:262-285`; `src/engine/project-store.mjs:102-121`; `contracts/scope-one/manifest.json:11`). Wiring them is SO-1.01.
- Gap, open, needs owner decision: the retry and replacement limits at which an internal failure becomes a queue item. They are policy values (ADR 4); the contracts above name the policy module and set no figure.

## Requirement 4: give each human decision a clear state (raised, awaiting user, answered, approved, rejected, deferred or resolved) and preserve the decision and its rationale in project history

- Covered by: SO-A-05 AC01 (the seven states, a transition table enforced by the store, an invalid transition refused and recorded) and AC05 (the answer is kept in history with its rationale); SO-03-A AC04 (every policy decision, refusals included, is an event with its inputs and outcome).
- Repo fact: the seven decision states do not exist in code. They are separate from the eleven task states (`src/engine/project-state.mjs:19-31`) and the seven project statuses (`src/engine/project-state.mjs:33-41`).
- Gap, open, needs owner decision: the transition table itself (which moves are allowed, which are terminal) and what separates "answered" from "approved" and "rejected". SO-A-05 requires the table and does not define it. Retention of decision history is a policy default (ADR 4).

## Requirement 5: the lead agent explains the issue in plain language, presents viable options, and says what it recommends and why, without presenting its recommendation as the user's decision

- Covered by: SO-A-05 AC02 (a plain explanation, the options, and the recommended option with its reason) and AC04 (the recommendation is stored in its own field and no code path copies it into the answer); SO-03-A AC03 (an agent principal approving a user-only gate is refused and recorded; the user's decision carries the principal); SO-03-A AC02 (`pending()` carries the recommended option and consequences).
- Repo fact: the project lead is a different role from the bus operator unless configured (`docs/scope-one/REQUIREMENTS.md:104`, SO-REQ-080); no lead module for projects exists in `src/`.
- Gap, open, needs owner decision: the plain-language standard and which actors may raise an item. Which principals count as "the user" follows the permission matrix (ADR 5, `docs/scope-one/DECISIONS.md:58-66`).

## Requirement 6: when a decision is made, update the canonical project record and recalculate affected dependencies, plans, task eligibility and verification freshness

- Covered by: SO-A-05 AC05 (an answer updates the record and recalculates dependencies, plan versions, eligibility and verification freshness through the relationship model); SO-A-04 AC02 (a change emits stale markers on every dependent plan, task, artifact, approval and evidence record, cleared only by a new verification or an explicit re-acceptance); SO-C-C AC01 (the change history shows which verification a change invalidated).
- Repo fact: `amendScope` marks evidence stale and replans tasks and does not touch approval records (`src/engine/project-state.mjs:177-214`); eligibility and status are pure functions (`src/engine/project-state.mjs:63-72`, `:217-225`, `:287-289`).
- Gaps, open, needs owner decision: which decision outcomes change scope (and so amend it) and which change only plan or eligibility; and the dependency lists disagree: the spec names SO-03-A and SO-C-C (spec line 5), the WBS names SO-1.01 (`docs/scope-one/WBS.md:527`), SO-A-05 names five others.

## Requirement 7: never silently skip permissions, invent an approval, discard a blocker or continue a consequential action that requires human authorisation

- Covered by: SO-03-A AC01 (risk classes; irreversible and externally visible actions ask), AC03 (the user-only gate cannot be bypassed by an agent) and AC04 (an external side effect with no policy decision reference is refused by the coordinator); SO-O-A AC05 (the lead cannot grant an access request); SO-A-05 AC04.
- Repo fact: until the permission matrix is decided the standing default is to keep current gates and leave anything ungated denied (ADR 5, `docs/scope-one/DECISIONS.md:58-66`).
- Gaps, open, needs owner decision: the assignment of each action to a risk class and the limits, which are policy defaults and the permission matrix (ADR 4 and ADR 5); and whether an item may ever be discarded, since none of the seven states is a discard and the spec forbids a silent one.

## Open items

Each needs an owner decision before a build contract is written. The rest of the former list is decided by the contracts cited above, if the owner signs the fold contracts.

1. Severity value set (requirement 1).
2. The transition table between the seven states, and the meaning of "answered" against "approved" and "rejected" (requirement 4).
3. The conditions under which a recovery becomes "ask the user", and the retry and replacement limits (requirements 2 and 3; ADR 4).
4. The plain-language standard, and which actors may raise an item (requirement 5).
5. Which decision outcomes change scope and which only plan or eligibility (requirement 6).
6. Whether an item may be discarded, and by whom (requirement 7).
7. The action-to-risk-class assignments and limits, and the retention of decision history (requirements 4 and 7; ADR 4 and ADR 5).
8. The dependency mismatch between the spec, the WBS and SO-A-05 (requirement 6).
9. SO-A-05, SO-A-04 and SO-A-07 are unsigned; the owner decides whether SO-1.08 is built against them (all requirements).
