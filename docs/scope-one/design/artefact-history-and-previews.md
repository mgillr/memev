# SO-1.09 Artefact history and previews: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [project layer](../../PROJECTS.md).

This is the decision record that contract SO-1.09 asks for (task T1, phase design). It builds nothing and changes no code. It cites the contracts that already specify most of the artefact registry by id and does not restate them. Every claim cites a file and line, a contract id and criterion, or a document section. Where the sources are silent the text says "open, needs owner decision" and the item is listed under [Open items](#open-items). The evidence record itself, and what it holds, belong to the evidence contracts and are not restated here.

## Sources and cited contracts

- Spec: `contracts/scope-one/specs/SO-1.09-artefact-history-and-previews.json`. The five requirements are at lines 13 to 17. Its dependencies (SO-05-D and SO-02-B) are named at line 5.
- Code on main at `908654d`: `src/engine/project-state.mjs`, `src/engine/project-store.mjs`, `src/engine/coordinator.mjs`. Docs: `docs/PROJECTS.md`, and in `docs/scope-one/`: `WBS.md`, `REQUIREMENTS.md`, `DECISIONS.md`, `SLICE-PLAN.md`.
- Settled decisions followed (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, the cloud only a relay and a backup (line 72); providers are neutral (line 73).
- Current state: no artefact record, version comparison, preview or canvas exists on main. The project store has nine entity kinds and none is an artefact (`src/engine/project-store.mjs:20-29`); a search of `src/` finds no preview of a project output (the only previews are the history import, `src/cli/import.mjs:25-26`, and the usage report, `src/cli/onboarding.mjs:270`) and no canvas.

Contracts cited by id. None is in this repository; each is held in the owner's vault, in the bundle and file named below (provider-neutral text, no other detail).

| Id | Status | Vault bundle and file | Cited for |
| --- | --- | --- | --- |
| SO-A-06 | fold contract, signed by pull request #341 | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | the artefact registry, states, history, diff, previews |
| SO-A-12 | fold contract, signed by pull request #341 | same bundle and file | the artefact canvas (AC04) |
| SO-A-04 | fold contract, signed by pull request #341 | same bundle and file | deliverable, work package and milestone entities; stale markers on artefacts |
| SO-A-08 | fold contract, signed by pull request #341 | same bundle and file | deliverable acceptance recorded as an event (AC05) |
| SO-05-D | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | evidence bound to artefact hash; reported, inferred, verified |
| SO-02-B | signed | same bundle and file | deliverables with version and provenance in the delivery summary |
| SO-C-C | signed | same bundle and file | Changes (AC01) and Deliverables (AC03) views |
| SO-O-A | signed | same bundle and file | the workspace grant check (AC02) |
| SO-02-A | signed | same bundle and file | plan version, raised on replan (AC06) |

Decision D-SO-MEMORY-AUTHORITY (vault bundle `memev-fold-addendum-2026-10-30`, file `set-fold/decisions.json`) is decided: the vault and its store are the canonical authority and there is no second database. It is cited for requirement 5.

Because SO-A-06, SO-A-12, SO-A-04 and SO-A-08 are signed (pull request #341) and the fold is the build layer (owner delegation, 1 Nov 2026), this record cites them as the owner of the parts they cover.

Artefact record: originating requirement, deliverable or work package; creation event; revision events; relevant scope and plan version; verification status. The five elements are fixed by the spec (`contracts/scope-one/specs/SO-1.09-artefact-history-and-previews.json:13`) and carried by SO-A-06 AC01, which adds the state draft, reviewed or accepted.

Preview formats: documents, diagrams, flowcharts, code, web and application outputs. The five formats are fixed by the spec (`contracts/scope-one/specs/SO-1.09-artefact-history-and-previews.json:15`). SO-A-06 AC04 covers Markdown, code, diagram source and images only; the rest is open, needs owner decision (requirement 3).

## Requirement 1: link each material artefact to its originating requirement, deliverable or work package, its creation and revision events, the relevant scope and plan version, and its verification status

- Covered by: SO-A-06 AC01 (the record and its five links); SO-A-04 AC01 (deliverable, work package and milestone entities, and the task-to-artefact link) and AC03 (each projection carries source event id, time, scope and plan version, freshness); SO-02-A AC06 (the plan version rises on a replan); SO-05-D AC01 (evidence carries scope version and artefact hash).
- Repo fact: a task carries `scopeVersion` and `artifactHash` (`src/engine/project-state.mjs:91-104`), and the coordinator records artefact names per task and attempt (`src/engine/coordinator.mjs:59-96`, `:316`). No requirement, deliverable, work package or plan version field exists in the three engine modules.
- Gap, open, needs owner decision: what makes an artefact "material", and who decides.

## Requirement 2: support version history and comparison, and distinguish drafts, reviewed outputs and accepted deliverables

- Covered by: SO-A-06 AC01 (states draft, reviewed, accepted, changed only by events) and AC02 (`memev work artifact history` and `diff` between two revisions of a text artefact); SO-A-08 AC05 (deliverable acceptance is recorded as the accepted state, as an event); SO-C-C AC01 (an append-only change history that includes artefacts).
- Repo fact: `ACCEPTED` is already a task state meaning plan-accepted (`docs/PROJECTS.md:16`; `src/engine/project-state.mjs:47-48`), and the baseline says completion, verification and acceptance are separate (baseline 8.2, row "Evidence and acceptance integration").
- Gaps, open, needs owner decision: what "reviewed" means and who may set it or accept a deliverable (permission matrix, ADR 5, `docs/scope-one/DECISIONS.md:58-66`); the word for deliverable acceptance given the task-state clash; and comparison of artefacts that are not text, since SO-A-06 AC02 covers text only.

## Requirement 3: provide appropriate previews for supported formats, including documents, diagrams, flowcharts, code and web and application outputs

- Covered by: SO-A-06 AC04 (the daemon previews Markdown, code, diagram source and images through the grant check of SO-O-A AC02, with verification state and limitations beside each); SO-A-12 AC04 (the canvas renders the registry with previews, generated outputs first).
- Repo fact: no preview code for project outputs exists on main; the dashboard is a slice still to be contracted (`docs/scope-one/SLICE-PLAN.md:71-78`).
- Gaps, open, needs owner decision: previews of flowcharts and of web and application outputs, which the spec names and no cited contract covers; documents other than Markdown; how a web or application output is shown without running untrusted content (the sources are silent); and whether a preview is generated on demand or kept, given that SO-A-06 AC03 forbids content copies beyond metadata.

## Requirement 4: show verification evidence and outstanding limitations alongside the artefact, and do not imply that visual presence in the canvas means the output has passed acceptance

- Covered by: SO-A-06 AC04 (verification state and limitations beside each artefact; a present but unverified artefact is labelled so) and AC05 (the rule that presence is not acceptance is documented); SO-A-12 AC04 (an accepted and a draft artefact render with different labels); SO-05-D AC02, AC03 and AC07 (verified only on evidence at the current scope version and hash; stale evidence is not accepted; reported, inferred and verified are kept apart); SO-02-B AC03 (the same labels in the delivery summary); SO-A-04 AC02 (stale markers reach artefacts).
- Repo fact: the register requires limitations in the final delivery summary (`docs/scope-one/REQUIREMENTS.md:39`, SO-REQ-015; `:121`, SO-REQ-097).
- Gap, open, needs owner decision: where a limitation is recorded for one artefact and who writes it; the sources define limitations only for the final summary and for the view.

## Requirement 5: keep the underlying files in the user's chosen workspace or explicitly configured storage, and do not let the canvas create an opaque, proprietary copy as the only authoritative version

- Covered by: SO-A-06 AC03 (the registry stores paths and hashes, keeps files in the workspace or configured storage, and a test asserts no copy of content under the vault beyond metadata); SO-O-A AC02 (one grant check for every workspace path); decision D-SO-MEMORY-AUTHORITY (no second database); the local-first decision (`docs/scope-one/DECISIONS.md:72`) and ADR 1's safe default of no second store (`docs/scope-one/DECISIONS.md:18-27`).
- Gap, open, needs owner decision: what "explicitly configured storage" means beyond the chosen workspace, and who configures it.

## Open items

Each needs an owner decision before a build contract is written. The rest of the former list is decided by the contracts cited above, if the owner signs the fold contracts.

1. What makes an artefact "material", and who decides (requirement 1).
2. The meaning of "reviewed", who may set it and who may accept a deliverable (ADR 5), and the word for acceptance given that `ACCEPTED` is a task state (requirement 2).
3. Comparison of artefacts that are not text (requirement 2).
4. Previews of flowcharts and of web and application outputs, documents other than Markdown, and how untrusted content is shown (requirement 3).
5. Whether previews are generated on demand or kept, and where (requirements 3 and 5).
6. Where a per-artefact limitation is recorded and who writes it (requirement 4).
7. What "explicitly configured storage" means and who configures it (requirement 5).
8. Resolved: SO-A-06, SO-A-12, SO-A-04 and SO-A-08 are signed (pull request #341) and are the build layer, so SO-1.09 is built against them (all requirements; owner delegation, 1 Nov 2026).
