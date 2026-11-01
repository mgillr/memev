# SO-2.05 Cross-functional issue discovery without unrestricted access to private records: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [projects](../../PROJECTS.md), [threat model](../../THREAT-MODEL.md).

This is the decision record that contract SO-2.05 asks for (task T1, phase design). It builds nothing and changes no code. Every claim below cites a file and line, a section of a page in `docs/scope-one/`, or section 8.3 of the owner's baseline. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open decisions](#open-decisions). Nothing is inferred and no design is invented. Anything shaped like a permission matrix (a table of who may do what to which record) waits on ADR 5, the permission matrix, status open (`docs/scope-one/DECISIONS.md:58-66`), and is marked open here.

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-2.05-cross-functional-issue-discovery.json`. The four requirements are at lines 13 to 16, the two named lines the record must carry ("Routing rules:" and "Owner of a finding:") are checked at lines 68 and 76, and the scope (this file and `docs/README.md`) is at lines 20 and 21. The spec names no dependency (line 11).
- Code on main at `908654d`: `src/engine/vault.mjs`, `src/engine/index.mjs`, `src/engine/graph.mjs`, `src/engine/project-store.mjs`, `src/engine/project-state.mjs`, `src/server/mcp.mjs`.
- Docs: `docs/scope-one/WBS.md`, `docs/scope-one/DECISIONS.md`.
- Baseline: the owner's master traceability baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does. Section 8.3 lists the fifth contract family as "Cross-functional issue discovery": "Surface relevant information between departments without granting unrestricted access to their private records". It also says the existing vault, graph and retrieval modules are "useful foundations" that "do not by themselves establish this wider organisational intelligence capability".
- Settled decisions this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, with the cloud only a relay and a backup (line 72); providers are neutral and no work depends on one (line 73).
- Neighbouring records, cited and not restated. The organisational knowledge model is the SO-2.01 record (docs/scope-one/design/organisational-knowledge-model.md on branch feat/so-2-01-org-knowledge-model, not yet on main). The access rules are the SO-2.02 record (docs/scope-one/design/permission-aware-knowledge-access.md on branch feat/so-2-02-permission-aware-access, not yet on main). The finding is the SO-2.04 record (docs/scope-one/design/cross-project-intelligence.md on branch feat/so-2-04-cross-project-intelligence, not yet on main). The WBS lists SO-2.02 and SO-2.04 as the dependencies of SO-2.05 (`docs/scope-one/WBS.md:535`); the spec lists none. The acceptance tests are SO-2.06 (`docs/scope-one/WBS.md:421`). The blocker and decision workflow is SO-1.08, whose own record is not on main (`docs/scope-one/WBS.md:408`). A prototype and the demonstrator that build on this record are WP08-04 and WP14-04 (`docs/scope-one/WBS.md:420`, `:557`).
- Layer: the fold contracts SO-F-13 and SO-F-09, signed by pull request #341, are the build layer for the detection and for the finding. This record cites them by id and acceptance criterion, restates none of their text, and keeps only what they do not cover. The question of which layer is built against is recorded as pending in RECONCILIATION.md at the head of pull request 325 (commit 79cbaae, docs/scope-one/RECONCILIATION.md, not on main).
- Current state in one line: no code on main surfaces anything between departments or projects, there is no decision workflow, and no task or project entity carries an owner (a search of `src/engine/project-store.mjs` and `src/engine/project-state.mjs` for owner and assignee finds none).

Related fold contracts: SO-F-13 and SO-F-09. They are signed in pull request #341 and recorded in contracts/signed, and they are cited here by id. This record has no dependency on them and does not restate them. Where a requirement below says "Covered by", the part named is owned by that contract and is not decided here. Whether they are adopted as the build layer is open, needs owner decision; if they are not, the parts marked covered return to this record as open.

Routing rules: covered by SO-F-13 AC01 for one bounded case, the routing of a detected conflict as a decision with neither plan changed. All other routing is open, needs owner decision (requirement 4). On main there is no routing: the only decision-like records are an approval bound to a task (`src/engine/project-store.mjs:28`) and the memory review inbox, which lists flagged and short-lived memories for a keep or drop decision (`src/engine/vault.mjs:516`, `:528-544`; `src/server/mcp.mjs:133`). Who may receive a routed finding is permission-matrix-shaped and waits on ADR 5.

Owner of a finding: covered by SO-F-09 AC01, which lists the affected entities and owners as links of a finding. How the owner is determined is open, needs owner decision. On main no entity has an owner field, and the entity kinds that a person or a team would need are the SO-2.01 record's.

## Requirement 1: surface relevant information between departments without granting unrestricted access to their private records

Decided by the sources:

- The rule is required (spec line 13; baseline 8.3, fifth row). The WBS gives the family one owner, SO-2.05, for the routing and access rules only (`docs/scope-one/WBS.md:420`, `:535`).
- Covered by SO-F-09: a finding never discloses a record its reader has no permission for in the source's scope (AC03). The access rules themselves are the SO-2.02 record and its fold contracts, and are not restated.
- What exists today: recall drops the sections a token may not read before ranking (`src/engine/index.mjs:173-178`; `src/engine/vault.mjs:428-445`), so a reader sees only sections of notes they may read. There is no mechanism that shows a reader anything about a record they may not read, and no department as a unit (SO-2.01).

Open, needs owner decision:

- What may be surfaced about a record the reader cannot read: nothing, its existence, a pointer to its owner, or a summary. No source says. A rule per kind of record is permission-matrix-shaped and waits on ADR 5.
- Whether surfacing is done by the finding of SO-F-09 only, or also by other results.

## Requirement 2: let an authorised person or agent discover relevant work elsewhere in the organisation

Decided by the sources:

- The discovery by an authorised person or agent is required (spec line 14). The spec's examples are a delivery constraint from engineering, a contractual commitment from operations, a pricing assumption from finance and a previous customer issue.
- Covered by SO-F-13: the detection of a conflict between two plans of one programme on a fixture, with both source versions linked and the affected tasks, milestones and owners listed (AC01). Covered by SO-F-09: what a finding links (AC01).
- What exists today: a project-scoped recall returns that project's sections and sections that name no project, and a caller can widen it with `all_projects` (`src/engine/vault.mjs:424-443`, `:429`). Nothing relates one project to another, and the vault opens one project store at a time (`src/engine/vault.mjs:408-410`). A commitment, a constraint, a pricing assumption and a customer issue are not kinds in the code.

Open, needs owner decision:

- Whether the four examples of the spec (a constraint, a commitment, an assumption, a previous issue) are covered by the conflict detection of SO-F-13, which is bounded to a conflict between two plans of one programme, or need a discovery of their own. No fold criterion names them.
- Which entity kinds of the SO-2.01 record carry them, and who counts as "authorised" for each. The second waits on the SO-2.02 record and ADR 5.

## Requirement 3: support both explicit retrieval and proactive discovery

Decided by the sources:

- Both modes are required (spec line 15): agents query the relevant organisational context, and background analysis may surface material relationships, anomalies, risks and opportunities for review.
- What exists today: explicit retrieval is the recall and the memory tools (`src/engine/vault.mjs:447-467`; `src/server/mcp.mjs:133-149`). The session start builds a card from the north-star note, recent decisions, the last session, active projects and open contracts (`src/engine/vault.mjs:579-590`); it is the closest thing to something surfaced without a query, and it reads this vault only. No code on main analyses in the background or surfaces a relationship, an anomaly, a risk or an opportunity.
- Nothing in SO-F-13 or SO-F-09 states what triggers a detection or an analysis: the SO-F-13 criterion is a test on a fixture.

Open, needs owner decision:

- What triggers a background analysis, how often, and over which projects.
- Where a proactively surfaced item appears for review and to whom it is shown; this is the routing of requirement 4 and the access rules of SO-2.02.
- How long an unreviewed item is kept, which is the SO-2.03 record's question.

## Requirement 4: route consequential findings into the appropriate owner or decision workflow, and never silently edit approved scope, alter commitments, disclose restricted information or change business policy

Decided by the sources:

- The routing and the four prohibitions are required (spec line 16).
- Covered by SO-F-13: routing a detected conflict as a decision and asserting that neither plan changed (AC01). The decision workflow it routes into is SO-A-05, which SO-F-13 names, and SO-1.08 on the repository side (`docs/scope-one/WBS.md:408`, `:334`). Neither is restated.
- What exists today for the four prohibitions: a scope change is applied by `amendScope`, which raises the scope version, marks bound evidence stale and returns affected verified tasks to accepted, and which checks no authorisation and no approval (`src/engine/project-state.mjs:177-214`). Nothing calls it from any discovery, because no discovery exists. No code changes commitments or business policy.

Open, needs owner decision:

- What makes a finding "consequential", and the threshold above which it must be routed.
- How "the appropriate owner" is determined (see "Owner of a finding:"), and what happens when no owner exists or two disagree.
- What a routed item contains and what is withheld from it, given the access rules.
- Which decisions can ever be taken from a routed finding. The spec forbids silent edits; whether an approved edit is permitted, and by whom, is permission-matrix-shaped and waits on ADR 5.

## Open decisions

Each needs an owner decision before a build contract can be written. Items that are permission-matrix-shaped are marked ADR 5. What the fold covers is not listed here.

1. What may be surfaced about a record the reader cannot read; ADR 5 (requirement 1).
2. Whether surfacing is by the SO-F-09 finding only (requirement 1).
3. Whether the four examples of the spec are covered by SO-F-13 or need their own discovery (requirement 2).
4. Which entity kinds carry them, and who is authorised for each; SO-2.01, SO-2.02, ADR 5 (requirement 2).
5. What triggers a background analysis, how often, and over which projects (requirement 3).
6. Where a proactive item appears and to whom (requirement 3).
7. How long an unreviewed item is kept; SO-2.03 (requirement 3).
8. What makes a finding consequential (requirement 4).
9. How the owner of a finding is determined, and what happens with none or two (requirement 4).
10. What a routed item contains and what is withheld (requirement 4).
11. Which decisions may be taken from a routed finding and by whom; ADR 5 (requirement 4).
12. Whether SO-F-13 and SO-F-09 are adopted as the build layer for this scope (the layer question in RECONCILIATION.md at pull request 325 head 79cbaae).
13. The spec lists no dependency and the WBS lists SO-2.02 and SO-2.04 (`docs/scope-one/WBS.md:535`). The signed spec governs this record, and the difference is a documentation inconsistency to be fixed separately.
