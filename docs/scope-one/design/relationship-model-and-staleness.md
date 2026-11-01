# SO-1.07 Relationship model and staleness: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [project layer](../../PROJECTS.md).

This is the decision record that contract SO-1.07 asks for (task T1, phase design). It builds nothing and changes no code. It cites the contracts that already specify most of this scope by id and does not restate them. Every claim cites a file and line, a contract id and criterion, or a document section. Where the sources are silent the text says "open, needs owner decision" and the item is listed under [Open items](#open-items).

## Sources and cited contracts

- Spec: `contracts/scope-one/specs/SO-1.07-relationship-model-and-staleness.json`. The requirements are at lines 13 to 20. Its dependencies are named at line 5.
- Code on main at `908654d`: `src/engine/project-state.mjs`, `src/engine/project-store.mjs`, `src/engine/coordinator.mjs`. Docs: `docs/PROJECTS.md`, and in `docs/scope-one/`: `WBS.md`, `REQUIREMENTS.md`.
- This record keeps to what the spec asks: relations and staleness. Evidence records, knowledge status and receipts are not restated here, and a query of what was authoritative at a past time is not in this spec (`docs/scope-one/WBS.md:556`).
- Settled decisions followed (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, the cloud only a relay and a backup (line 72); providers are neutral (line 73).
- Current state: the only change propagation on main is `amendScope`, which raises the scope version, marks affected evidence stale and replans affected tasks (`src/engine/project-state.mjs:177-214`). The store has nine entity kinds and none is a milestone, deliverable or work package (`src/engine/project-store.mjs:20-29`); no relationship record exists.

Contracts cited by id. None is in this repository; each is held in the owner's vault, in the bundle and file named below (provider-neutral text, no other detail).

| Id | Status | Vault bundle and file | Cited for |
| --- | --- | --- | --- |
| SO-A-04 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | milestone, deliverable and work package entities, the link types, stale markers, projection provenance, progress derivation |
| SO-A-09 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | plan and architecture entities; the stale marker on every view (AC06) |
| SO-A-12 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | RAID entities and the risk-to-work and issue-to-work links |
| SO-07-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | the store, its validators and the append-only event log |
| SO-05-D | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | evidence stale on scope or artefact change; reported, inferred, verified (AC03, AC07) |
| SO-05-C | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | projection provenance on the resume card (AC03) |
| SO-A-03 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | requested, accepted, observed and verified as four event kinds |
| SO-02-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | amendment, replan and plan version (AC05, AC06) |
| SO-C-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | the plain status vocabulary (AC02) |
| SO-C-C | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | Changes (AC01) and one status vocabulary (AC06) |

Because the fold contracts are unsigned, what they decide is a proposal until the owner signs them. This record cites them as the intended owner and does not treat them as settled.

Relation kinds: scope to milestone, milestone to plan, milestone to deliverable, deliverable to work package, work package to task, task to dependency, task to artefact, task to check, task to evidence, blocker to work, permission to resource (SO-A-04 AC01); risk to work and issue to work (SO-A-12 AC02); component to component and task to workstream (SO-A-09 AC03). The kinds the spec names are at line 14.

Staleness rules: a change to a requirement or scope version emits stale markers on every dependent plan, task, artefact, approval and evidence record; the markers clear only by a new verification or an explicit re-acceptance event (SO-A-04 AC02). Evidence bound to an earlier scope version or artefact hash is stale (SO-05-D AC03). The rules the spec asks for are at line 15.

## Requirement 1: every view is a projection of the canonical store and event history

- Covered by: SO-A-04 AC03 (every projection carries its source event id, time, scope and plan version and freshness); SO-C-A AC05 (every number comes from the store projection; the page equals the CLI after a restart); SO-C-B (nothing is a new store).
- Gap: none.

## Requirement 2: represent relationships explicitly

- Covered by: SO-A-04 AC01 (entities and eleven link types as events validated against a schema); SO-A-12 AC02 and SO-A-09 AC03 (RAID and plan links).
- Repo fact: the relations are not in the store today (`src/engine/project-store.mjs:20-29`).
- Gap: open, needs owner decision: the spec's "permissions to the resources and operations they enable"; the link type names the resource only, so whether the operation is part of the link is not decided.

## Requirement 3: propagate changes to plans, architecture, tasks, artefacts, approvals, dependencies and verification results, marking stale

- Covered by: SO-A-04 AC02 (stale markers and `memev work impact`); SO-A-09 AC06 (the marker shows on the roadmap, plan, architecture and work breakdown views); SO-A-12 AC03 (the RAID view); SO-05-D AC03 (evidence stale at once); SO-02-A AC05 (an amendment lists affected tasks and evidence).
- Repo fact: `amendScope` touches tasks and evidence only, not approvals (`src/engine/project-state.mjs:177-214`).
- Gap: none beyond the build work.

## Requirement 4: distinguish planned, queued, dispatched, accepted, running, blocked, completed, verified and delivered internally; show a simpler derived status

- Covered by: SO-A-03 AC01 (dispatch requested, accepted, observed and verified as event kinds); SO-C-A AC02 (the derived status maps to planning, working, waiting for me, verifying, delivered, blocked by one table); SO-C-C AC06 (one vocabulary).
- Repo fact: the eleven task states are PROPOSED, ACCEPTED, READY, IN_PROGRESS, BLOCKED, PAUSED, VERIFYING, VERIFIED, FAILED, CONFLICTED and CANCELLED (`src/engine/project-state.mjs:19-31`); "queued", "dispatched", "completed" and "delivered" are not among them.
- Gap: open, needs owner decision: the nine named internal states against the eleven task states and the four event kinds, and the mapping between them.

## Requirement 5: display uncertainty and freshness

- Covered by: SO-A-04 AC03 (a value that cannot be confirmed renders as not confirmed, never a guess); SO-05-D AC07 (reported, inferred and verified kept apart); SO-08-B AC06 (stale evidence in the status).
- Gap: none.

## Requirement 6: derive progress from visible, explainable milestones, work packages or completion criteria

- Covered by: SO-A-04 AC04 (progress derives from milestones, work packages and completion criteria; a free-text percentage changes no figure).
- Gap: open, needs owner decision: the derivation formula and how the figure is explained to the user; SO-A-04 AC04 states the source, not the rule.

## Requirement 7: roadmap, plans, architecture, WBS and RAID as navigable projections of one dependency model

- Covered by: SO-A-09 AC06 and SO-A-12 AC03 (one model; the stale marker on each view); SO-A-08 AC01 (the roadmap opens its work packages and tasks).
- Gap: none.

## Requirement 8: a readable history of decisions and changes: who proposed, who approved, which downstream items were affected

- Covered by: SO-C-C AC01 (an append-only history with what changed, why, who or what initiated it and which verification it invalidated); SO-03-A AC02 (approval records carry requester and approver); SO-A-04 AC02 (the impact listing).
- Gap: open, needs owner decision: whether the affected plans, tasks, artefacts and approvals are kept in the history of a change; SO-C-C AC01 records the invalidated verification, and the impact listing is current, clearing as markers clear.

## Open items

Each needs an owner decision before a build contract is written. Everything else is decided by the contracts cited above, if the owner signs the fold contracts.

1. The permission link: whether the operation, and not only the resource, is part of the relation (requirement 2).
2. The nine internal states of the spec against the eleven task states and the four event kinds (requirement 4).
3. The progress derivation rule and its explanation to the user (requirement 6).
4. Whether the downstream items affected by a change are kept in its history (requirement 8).
5. The owner decides whether SO-1.07 is built against the unsigned SO-A-04, which depends on signed SO-07-A, SO-05-D, SO-02-A and SO-05-C (all requirements).
