# SO-1.05 Workspace views and lead area: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [project layer](../../PROJECTS.md).

This is the decision record that contract SO-1.05 asks for (task T1, phase design). It builds nothing and changes no code. It cites the contracts that already specify most of this scope by id and does not restate them. Every claim cites a file and line, a contract id and criterion, or a document section. Where the sources are silent the text says "open, needs owner decision" and the item is listed under [Open items](#open-items).

## Sources and cited contracts

- Spec: `contracts/scope-one/specs/SO-1.05-workspace-views-and-lead-area.json`. The requirements are at lines 13 to 26. Its dependencies are named at line 5.
- Code on main at `908654d`: `src/engine/project-state.mjs`, `src/engine/project-store.mjs`, `src/server/http.mjs`. Docs: `docs/PROJECTS.md`, and in `docs/scope-one/`: `WBS.md`, `REQUIREMENTS.md`, `SLICE-PLAN.md`.
- Settled decisions followed (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, the cloud only a relay and a backup (line 72); providers are neutral (line 73).
- Current state: no project view and no lead-agent area exist on main. `src/server/` holds `http.mjs`, `main.mjs`, `mcp.mjs`, `oauth.mjs` and `relay-dev.mjs` and no UI directory; the dashboard is a slice still to be contracted (`docs/scope-one/SLICE-PLAN.md:71-78`). The only derived project output is the project status (`src/engine/project-state.mjs:217-225`).

Contracts cited by id. None is in this repository; each is held in the owner's vault, in the bundle and file named below (provider-neutral text, no other detail).

| Id | Status | Vault bundle and file | Cited for |
| --- | --- | --- | --- |
| SO-C-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | overview, natural-language entry point, decisions view, pause, resume, cancel, restart consistency |
| SO-C-B | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | Agents, Comms, Roadmap (AC03) and Work (AC04) views |
| SO-C-C | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | Changes, Outstanding work, Deliverables, Settings and Connections, one vocabulary |
| SO-02-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | the brief sections (AC01), amendments (AC05), replan (AC06) |
| SO-08-B | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | pause, resume and cancel semantics (AC03) |
| SO-03-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | approvals and the user-only gate |
| SO-A-08 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | brief, work breakdown and activity views; the lead-agent area; the advanced view; scope changes as proposals |
| SO-A-09 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | delivery plan, development plan, system and subsystem architecture views and their entities |
| SO-A-12 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | RAID view and entities; the artefact canvas |
| SO-A-05 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | the decisions queue (see the SO-1.08 record) |
| SO-A-06 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | the artefact registry (see the SO-1.09 record) |
| SO-A-04 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | milestone, deliverable and work package entities and the relationship model |

Because the fold contracts are unsigned, what they decide is a proposal until the owner signs them. This record cites them as the intended owner and does not treat them as settled.

View list: lead-agent area, project brief and scope, programme roadmap, delivery plan, development plan, work breakdown structure, system architecture, subsystem architecture, risks assumptions issues and dependencies, canvas and artefacts, activity and progress, blockers and decisions. The eleven views are fixed by the spec (`contracts/scope-one/specs/SO-1.05-workspace-views-and-lead-area.json:14-24`). The fold contracts split them as: SO-A-08 (brief, work breakdown, activity), SO-C-B (roadmap), SO-A-09 (delivery plan, development plan, architecture, subsystem), SO-A-12 (RAID, canvas), SO-C-A (decisions).

Lead area: one persistent interaction area on every view, passing the current project, plan, work package, task or artefact id to the lead session through the project tools (SO-A-08 AC02). The spec asks for it at lines 13 and 25.

## Requirement 1: a persistent interaction area for the lead agent

- Covered by: SO-A-08 AC02 (present on every view with context ids); SO-C-A AC03 (the natural-language entry point).
- Repo fact: no lead module for projects exists in `src/`; the project lead is distinct from the bus operator unless configured (`docs/scope-one/REQUIREMENTS.md:104`, SO-REQ-080).
- Gap: none beyond the lead selection owned by the signed lead contracts, which this record does not restate.

## Requirement 2: project brief and scope: objectives, boundaries, assumptions, exclusions, success criteria, stakeholders and approved changes

- Covered by: SO-A-08 AC01 (the view); SO-02-A AC01 (the brief sections, assumptions, exclusions, acceptance criteria) and AC05 (amendments are recorded).
- Gap: open, needs owner decision: stakeholders, and objectives and success criteria as named fields; the cited brief schema lists exclusions and acceptance criteria and names neither.

## Requirement 3: programme roadmap: phases, milestones, dependencies, target dates where known, stage gates and delivery outlook

- Covered by: SO-C-B AC03 (milestones, dependencies, status; a forecast only with a basis, no date without a source; a milestone returns scope, tasks, deliverables, blockers); SO-A-04 AC01 (milestone entities).
- Gap: open, needs owner decision: stage gates; no cited contract names them (SO-A-09 names release stages).

## Requirement 4: the integrated delivery plan

- Covered by: SO-A-09 AC04 (scope, schedule, work packages, dependencies, risks, quality and delivery together; the risks column reads not available until SO-A-12 lands).
- Gap: none beyond the sequencing with SO-A-12.

## Requirement 5: the development plan

- Covered by: SO-A-09 AC03 and AC04 (workstreams, environments, release stages; sequencing, integration strategy and technical acceptance criteria in the view).
- Gap: none.

## Requirement 6: the work breakdown structure, with movement between a roadmap milestone and its work packages and tasks

- Covered by: SO-A-08 AC01 (a milestone opens its work packages and tasks and back); SO-C-B AC04 (Work view); SO-A-04 AC01 (the entities); SO-A-08 AC03 (ownership and allocation on the advanced view only).
- Repo fact: tasks have no work package or milestone link in the store today (`src/engine/project-store.mjs:20-29`).
- Gap: none.

## Requirement 7: system architecture

- Covered by: SO-A-09 AC03 and AC05 (components, interfaces, trust boundaries and external dependencies as entities and a view).
- Gap: none.

## Requirement 8: subsystem architecture

- Covered by: SO-A-09 AC05 (the drill-down into one component).
- Gap: none.

## Requirement 9: risks, assumptions, issues and dependencies

- Covered by: SO-A-12 AC02 and AC03 (the schema, the store validation, the linked view, both ways).
- Gap: none.

## Requirement 10: canvas and artefacts

- Covered by: SO-A-12 AC04 and SO-A-06 (see the SO-1.09 record).
- Gap: the preview gaps listed in the SO-1.09 record.

## Requirement 11: activity and progress, without an agent-routing console

- Covered by: SO-A-08 AC01 (requested, accepted, observed and verified kept distinct; an observed task is never counted done); SO-C-A AC02 (no raw event or task id on the plain view); SO-C-C AC01 (Changes).
- Gap: none.

## Requirement 12: blockers and decisions

- Covered by: SO-C-A AC04 and SO-A-05 (see the SO-1.08 record).
- Gap: the gaps listed in the SO-1.08 record.

## Requirement 13: the lead area stays available across the views with context

- Covered by: SO-A-08 AC02 (the current project, plan, work package, task or artefact id is passed on).
- Gap: none.

## Requirement 14: explicit, truthful pause, resume, cancel, re-plan, approval and deliverable-acceptance semantics; scope changes through the scope-change process

- Covered by: SO-C-A AC04 and SO-08-B AC03 (requested, confirmed or unsupported per task); SO-A-08 AC05 (a scope-changing instruction becomes a proposal; deliverable acceptance is an event); SO-02-A AC05 and AC06 (amend, replan); SO-03-A AC03.
- Repo fact: pause stops dispatch and hard cancellation is claimed only on confirmation (`docs/PROJECTS.md:99-110`; `src/engine/project-state.mjs:293-327`).
- Gap: none.

## Open items

Each needs an owner decision before a build contract is written. Everything else is decided by the contracts cited above, if the owner signs the fold contracts.

1. Stakeholders, and objectives and success criteria as named brief fields (requirement 2).
2. Stage gates on the roadmap (requirement 3).
3. The owner decides whether SO-1.05 is built against the fold contracts SO-A-08, SO-A-09, SO-A-12 and the unsigned SO-A-04, SO-A-05, SO-A-06 (all requirements).
4. The sequencing: SO-A-08 depends on eight contracts, most unsigned, so the build order is the owner's to set (all requirements).
