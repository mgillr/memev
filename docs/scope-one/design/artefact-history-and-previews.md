# SO-1.09 Artefact history and previews: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [project layer](../../PROJECTS.md).

This is the decision record that contract SO-1.09 asks for (task T1, phase design). It builds nothing and changes no code. Every claim below cites a file and line or a document section. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open items](#open-items). The record covers only what the five requirements of the spec ask for. The evidence record itself, and what it holds, belong to the evidence contracts and are not restated here.

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-1.09-artefact-history-and-previews.json`. The five requirements are at lines 13 to 17. Its dependencies (SO-05-D and SO-02-B) are named at line 5.
- Code on main at `908654d`: `src/engine/project-state.mjs`, `src/engine/project-store.mjs`, `src/engine/coordinator.mjs`, `src/engine/diff.mjs`, `src/engine/oplog.mjs`, `src/engine/graph.mjs`.
- Docs: `docs/PROJECTS.md`, and in `docs/scope-one/`: `WBS.md`, `REQUIREMENTS.md`, `DECISIONS.md`, `SLICE-PLAN.md`.
- The owner's baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does.
- SO-05-D and SO-02-B are signed in the owner's vault and are not in this repository (spec line 5; `docs/scope-one/WBS.md` line 11, the dagger). This record cannot check them and does not restate their content.
- Current state in one line: no artefact record, version comparison or preview exists on main. The project store has nine entity kinds and none is an artefact (`src/engine/project-store.mjs:20-29`); no code in `src/` renders a preview of a project output (the only "preview" in `src/` is the history import preview, `src/cli/import.mjs:25-26`, and the usage report preview, `src/cli/onboarding.mjs:270`); and no canvas or dashboard exists in `src/` (a search for "canvas" returns nothing). The dashboard is a planned slice (`docs/scope-one/SLICE-PLAN.md:71-78`).
- Settled decisions this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, with the cloud only a relay and a backup (line 72); providers are neutral (line 73). Nothing in this record depends on a single provider.

Artefact record: originating requirement, deliverable or work package; creation event; revision events; relevant scope and plan version; verification status. The five elements are fixed by the spec (`contracts/scope-one/specs/SO-1.09-artefact-history-and-previews.json:13`). Their field names, types and storage are open, needs owner decision (see requirement 1).

Preview formats: documents, diagrams, flowcharts, code, web and application outputs. The five formats are fixed by the spec (`contracts/scope-one/specs/SO-1.09-artefact-history-and-previews.json:15`). Which formats are "supported", and how each is previewed, is open, needs owner decision (see requirement 3).

## Requirement 1: link each material artefact to its originating requirement, deliverable or work package, its creation and revision events, the relevant scope and plan version, and its verification status

Decided by the sources:

- The five links are required (spec line 13). The baseline names the family of work as "Artefact and deliverable management": documents, diagrams, reports, specifications, previews, provenance and version relationships (baseline 8.2, row "Artefact and deliverable management"). The WBS gives it one owner, SO-1.09 (`docs/scope-one/WBS.md:409`, `docs/scope-one/WBS.md:528`).
- What the code carries today for each link:
  - Scope version: a task carries `scopeVersion` (`src/engine/project-state.mjs:95`) and every transition record carries it (`src/engine/project-state.mjs:112-131`).
  - Artefact identity: a task carries an `artifactHash`, and evidence binds to the scope version and that hash (`src/engine/project-state.mjs:91-104`; `docs/PROJECTS.md:82`). The coordinator records a task's `artifacts` list when the task is created and per attempt (`src/engine/coordinator.mjs:59-96`, `:316`), and treats two attempts that changed the same artifact as a conflict (`src/engine/coordinator.mjs:327-334`; `docs/PROJECTS.md:135`).
  - Creation and revision events: the project store keeps one append-only event log per project (`src/engine/project-store.mjs:1-5`), and an attempt records the artifacts it changed and the time (`src/engine/coordinator.mjs:316`).
  - Verification status: the task state `VERIFIED` holds only with evidence bound to the current scope version and artifact hash (`src/engine/project-state.mjs:91-104`); a scope change marks affected evidence stale (`src/engine/project-state.mjs:177-214`).
- There is no link to a requirement, deliverable or work package, and no plan version: a task requires only a title in the store (`src/engine/project-store.mjs:22`), and no field named for a requirement, a deliverable, a work package or a plan version exists in `src/engine/project-state.mjs`, `src/engine/project-store.mjs` or `src/engine/coordinator.mjs` (a search of the three files). Open, needs owner decision.

Open, needs owner decision:

- What makes an artefact "material", and who decides.
- The originating link: to a requirement id, a deliverable, a work package, or all three, and where those records live. They are planned by the intake and planning contracts (baseline 8.2, rows "Project intake and scope resolution" and "Project decomposition and planning"), which are not in this repository.
- What "plan version" means, since the code versions only the scope.
- Whether the artefact record is a new entity kind in the project store or a view derived from existing events. The store schema decision is ADR 1, status open, with the safe default "extend the existing store in place; do not create a second store" (`docs/scope-one/DECISIONS.md:18-27`).

## Requirement 2: support version history and comparison, and distinguish drafts, reviewed outputs and accepted deliverables

Decided by the sources:

- History, comparison and the three-way distinction are required (spec line 14).
- What exists today for history and comparison, for notes and not for project artefacts: the vault is plain Markdown kept in git (`README.md:195`); the operation log is append-only (`src/engine/oplog.mjs:2-12`) and in the graph a retraction is a new operation (`src/engine/graph.mjs:10-11`); and `lineSplice` computes the smallest replaced line range between two texts (`src/engine/diff.mjs:1-5`). Whether any of these serves project artefacts is open, needs owner decision.
- The word "accepted" already has a meaning in the state machine. A task state `ACCEPTED` means "accepted work, planned against the current scope version" and is a state before dispatch (`docs/PROJECTS.md:16`; `src/engine/project-state.mjs:47-48`); a verified task can also move back to `ACCEPTED` (`src/engine/project-state.mjs:54`). Acceptance of a deliverable is a different thing: the baseline says completion, verification and acceptance are separate (baseline 8.2, row "Evidence and acceptance integration"; baseline 9.4, "Verification and acceptance are separate").
- No state for an artefact exists. The only verification vocabulary in code belongs to tasks (`src/engine/project-state.mjs:19-31`).

Open, needs owner decision:

- The three states of an artefact (draft, reviewed, accepted) and the moves between them. The spec names them and defines none.
- What "reviewed" means and who may set it, and who may accept a deliverable. The permission matrix is ADR 5, status open (`docs/scope-one/DECISIONS.md:58-66`).
- What a comparison compares (two revisions of one artefact, or an artefact against its plan), and for which formats.
- Whether history for project artefacts reuses git, the operation log or the store's event log.
- The word to use for deliverable acceptance, given that `ACCEPTED` is taken by tasks.

## Requirement 3: provide appropriate previews for supported formats, including documents, diagrams, flowcharts, code and web and application outputs

Decided by the sources:

- The five formats are named by the spec (line 15), and the baseline lists documents, diagrams, reports, code and previews as the artefact family (baseline 9.3, "Artefacts and deliverables").
- No preview code for project outputs exists on main (see the current-state line above). The surface that would show previews, the dashboard, is a slice to be contracted (`docs/scope-one/SLICE-PLAN.md:71-78`).

Open, needs owner decision:

- The list of supported formats, within the five the spec names, and what is shown for a format that is not supported.
- How each of the five is previewed, in particular web and application outputs, where the sources say nothing about running or isolating them.
- Whether a preview is generated on demand or kept; if kept, where, in view of requirement 5.

## Requirement 4: show verification evidence and outstanding limitations alongside the artefact, and do not imply that visual presence in the canvas means the output has passed acceptance

Decided by the sources:

- The requirement is fixed by the spec (line 16). Its core rule is already a project invariant: an agent's report is not evidence, and `VERIFIED` needs evidence bound to the current scope version and artifact hash (`src/engine/project-state.mjs:9-10`, `:91-104`). Evidence belonging to an old scope or artefact is not accepted without explicit policy (`docs/scope-one/REQUIREMENTS.md:54`, SO-REQ-030).
- Limitations are required in the final delivery summary: "artifacts, run and use instructions, checks performed, evidence, limitations, and unresolved items" (`docs/scope-one/REQUIREMENTS.md:39`, SO-REQ-015; `docs/scope-one/REQUIREMENTS.md:121`, SO-REQ-097).
- The baseline requires that a material scope or artefact change invalidate affected evidence and approvals (baseline 9.4, the paragraph after the execution sequence). `amendScope` marks evidence stale and replans tasks; it does not handle an artefact record, which does not exist (`src/engine/project-state.mjs:177-214`).
- Evidence and verification status exist today only as task state and bound records; no view shows them (see the current-state line).

Open, needs owner decision:

- Where a limitation is recorded for one artefact (the sources define limitations only for the final summary), and who writes it.
- The visible distinction between "shown" and "accepted", in wording and in layout. The spec states the rule and not the display.
- Whether a stale-evidence marker is shown on the artefact itself, since the baseline requires invalidation and the code marks only tasks and evidence.

## Requirement 5: keep the underlying files in the user's chosen workspace or explicitly configured storage, and do not let the canvas create an opaque, proprietary copy as the only authoritative version

Decided by the sources:

- The requirement is fixed by the spec (line 17) and is consistent with the settled local-first decision (`docs/scope-one/DECISIONS.md:72`).
- The register has the matching requirement for the workspace: local project-folder selection with safe, explicitly scoped filesystem access (`docs/scope-one/REQUIREMENTS.md:111`, SO-REQ-087).
- A second store is not allowed by default: ADR 1's safe default is to extend the existing store in place and not to create a second store (`docs/scope-one/DECISIONS.md:18-27`). The vault is plain Markdown in git (`README.md:195`).
- The coordinator already holds shared artefacts as named resources that two tasks cannot write at once (`src/engine/coordinator.mjs:47-48`); it records names of artefacts and not copies of their content (`src/engine/coordinator.mjs:316`).

Open, needs owner decision:

- What "explicitly configured storage" means beyond the chosen workspace, and who configures it.
- Whether previews or derived views may be cached, and where, so that they never become the only authoritative copy.
- How the authoritative file is identified when it is outside the vault (the hash alone, the path, or both).

## Open items

Each needs an owner decision before a build contract can be written.

1. What makes an artefact "material" and who decides (requirement 1).
2. The originating link: requirement, deliverable or work package, and where those records live (requirement 1).
3. The meaning of "plan version", since only the scope is versioned (requirement 1).
4. Whether the artefact record is a new store entity kind or a derived view; tied to ADR 1 (requirement 1).
5. The three artefact states and their moves, including who may set "reviewed" and who may accept; tied to ADR 5 (requirement 2).
6. The word for deliverable acceptance, because `ACCEPTED` is a task state (requirement 2).
7. What a comparison compares, and for which formats (requirement 2).
8. Whether artefact history reuses git, the operation log or the store's event log (requirement 2).
9. The supported formats within the five named, and the fallback for others (requirement 3).
10. How each format is previewed, in particular web and application outputs (requirement 3).
11. Whether previews are generated on demand or kept, and where (requirements 3 and 5).
12. Where a per-artefact limitation is recorded, and who writes it (requirement 4).
13. How "shown" is told apart from "accepted" on screen, and whether stale evidence is marked on the artefact (requirement 4).
14. The meaning of "explicitly configured storage" and who configures it (requirement 5).
15. How the authoritative file is identified when it lies outside the vault (requirement 5).
16. SO-05-D and SO-02-B are signed in the owner's vault and cannot be read from this repository; their content has to be checked against this record by the owner (spec line 5).
