# SO-2.04 Cross-project intelligence: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [projects](../../PROJECTS.md).

This is the decision record that contract SO-2.04 asks for (task T1, phase design). It builds nothing and changes no code. Every claim below cites a file and line, a section of a page in `docs/scope-one/`, or section 8.3 of the owner's baseline. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open decisions](#open-decisions). Nothing is inferred and no design is invented. Anything shaped like a permission matrix (a table of who may do what to which record) waits on ADR 5, the permission matrix, status open (`docs/scope-one/DECISIONS.md:58-66`), and is marked open here.

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-2.04-cross-project-intelligence.json`. The five requirements are at lines 13 to 17, the two named lines the record must carry ("Finding record:" and "Status of a finding:") are checked at lines 77 and 85, and the scope (this file and `docs/README.md`) is at lines 21 and 22. The spec names no dependency (line 11).
- Code on main at `908654d`: `src/engine/graph.mjs`, `src/engine/vault.mjs`, `src/server/mcp.mjs`.
- Docs: `docs/scope-one/WBS.md`, `docs/scope-one/DECISIONS.md`.
- Baseline: the owner's master traceability baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does. Section 8.3 lists the fourth contract family as "Cross-project intelligence": "Evidence-backed discovery of recurring risks, dependencies, conflicts, assumptions and reusable knowledge". It also says the existing vault, graph and retrieval modules are "useful foundations" that "do not by themselves establish this wider organisational intelligence capability".
- Settled decisions this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, with the cloud only a relay and a backup (line 72); providers are neutral and no work depends on one (line 73).
- Neighbouring records, cited and not restated. The organisational knowledge model and its entity kinds are the SO-2.01 record (docs/scope-one/design/organisational-knowledge-model.md on branch feat/so-2-01-org-knowledge-model, not yet on main). Permission-aware knowledge access is the SO-2.02 record (docs/scope-one/design/permission-aware-knowledge-access.md on branch feat/so-2-02-permission-aware-access, not yet on main). Provenance, retention, deletion and invalidation are the SO-2.03 record (docs/scope-one/design/provenance-retention-invalidation.md on branch feat/so-2-03-provenance-retention, not yet on main). The WBS lists SO-2.01 and SO-2.03 as the dependencies of SO-2.04 (`docs/scope-one/WBS.md:534`); the spec lists none. Routing of a consequential finding to an owner is SO-2.05, and the acceptance tests are SO-2.06 (`docs/scope-one/WBS.md:420`, `:421`). The status lattice and origin fields of a note are WP10-01 and WP10-02 (`docs/scope-one/WBS.md:418`, `:533`) and are not decided here. A prototype that consumes this record is WP08-04, and the demonstrator is WP14-04 (`docs/scope-one/WBS.md:419`, `:557`).
- Layer: the fold contract SO-F-09, signed by pull request #341, is the build layer for the finding. This record cites it by id and acceptance criterion, restates none of its text, and keeps only what it does not cover. The question of which layer is built against is recorded as pending in RECONCILIATION.md at the head of pull request 325 (commit 79cbaae, docs/scope-one/RECONCILIATION.md, not on main).
- Current state in one line: no code on main discovers anything across projects. The graph holds claims with a derived status, and the vault opens one project store per project id and never reads two at once (`src/engine/vault.mjs:408-410`).

Related fold contracts: SO-F-09. It is signed in pull request #341 and recorded in contracts/signed, and it is cited here by id. This record has no dependency on it and does not restate it. Where a requirement below says "Covered by", the part named is owned by that contract and is not decided here. Whether it is adopted as the build layer is open, needs owner decision; if it is not, the parts marked covered return to this record as open.

Finding record: covered by SO-F-09 AC01, which defines a finding as a claim of the graph with its links and context. This record adds no field to it. What is left open is only what AC01 does not name: a reasoning basis and the meaning of "material" (requirement 2).

Status of a finding: covered by SO-F-09 AC01, which sets the cap on the status a finding can reach by evidence alone and who may raise it. The statuses of a claim on main are conjecture, theory, fact, contested and refuted, derived from its live evidence (`src/engine/graph.mjs:13-19`, `:102-114`), and a status change is a logged operation (`src/engine/vault.mjs:635-636`). The status lattice of a note is WP10-01 and WP10-02 and is not decided here.

## Requirement 1: evidence-backed discovery of recurring risks, dependencies, conflicts, assumptions and reusable knowledge

Decided by the sources:

- Discovery of the five things is required (spec line 13; baseline 8.3, fourth row). The WBS gives the family one owner, SO-2.04, as a design record that the prototype WP08-04 consumes (`docs/scope-one/WBS.md:419`, `:534`).
- Covered by SO-F-09: the finding as the evidence-backed result of a discovery (AC01). SO-F-09 states that conflict detection is a separate contract, SO-F-13. Routing and acceptance are SO-2.05 and SO-2.06 (`docs/scope-one/WBS.md:420`, `:421`).
- What exists today, from the code:
  - No code discovers a recurring item or compares two projects. The graph's co-occurrence and neighbours are computed over the whole vault and not per project (`src/engine/graph.mjs:45`, `:65`, `:123-131`).
  - A recall can be widened from the configured project to all projects with `all_projects` (`src/engine/vault.mjs:429`, `:447`); that reads notes, not project stores.
  - Of the five kinds, the graph has edge types `depends_on` and `contradicts` (`src/engine/graph.mjs:24`) and claims with a stance of support, oppose or speculate (`src/engine/vault.mjs:630`). Risk, assumption and reusable knowledge are not kinds in the code.

Open, needs owner decision:

- What makes an item "recurring" (a count, a time window, a number of projects). No source gives one.
- What "otherwise independent work" is: which projects and which records count as independent, against the independence rule of requirement 4.
- How a risk, an assumption and a piece of reusable knowledge are represented. They depend on the entity kinds of the SO-2.01 record.
- Which sources discovery may read, which depends on the access rules of the SO-2.02 record. The claim list on main checks the read scope with no path (`src/engine/vault.mjs:640-643`), as that record notes.

## Requirement 2: every material finding links to the source records, relevant scope and time context, affected entities and reasoning basis

Decided by the sources:

- The links are required for every material finding (spec line 14).
- Covered by SO-F-09: links to source events and versions, affected entities and owners, scope and time context, and a confidence (AC01). Disclosure of a finding to a reader without permission for a source is AC03.
- What a claim's evidence carries on main: stance, strength, the note path, a text of up to 500 characters, a source, a sequence and a time (`src/engine/graph.mjs:89`; `src/engine/vault.mjs:633`). The source is the client or agent name of the caller (`src/engine/vault.mjs:633`). There is no field for a reasoning basis.

Open, needs owner decision:

- What "material" means: what makes a finding one that must carry the links. No source defines a threshold.
- What the "reasoning basis" of a finding is and where it is stored. SO-F-09 AC01 does not name one and no field on main carries one.

## Requirement 3: distinguish observed facts, recorded decisions, agent-generated inferences, assumptions and recommendations

Decided by the sources:

- The five categories are required to be distinguishable (spec line 15).
- Covered by SO-F-09: that a finding's status is capped and that fact needs a person's event or a verification record (AC01).
- What exists today: a note can have the kind `decision` or `fact` (`src/engine/vault.mjs:28`), and a claim has a derived status (`src/engine/graph.mjs:13-19`). Nothing marks that a record was produced by an agent or by a person. Recall returns the claim status and does not mark who or what produced the claim (`src/engine/vault.mjs:456-463`). Assumption and recommendation are not kinds in the code.
- The lattice of a note's own status and its origin fields are WP10-01 and WP10-02 (`docs/scope-one/WBS.md:418`, `:533`). This record takes neither.

Open, needs owner decision:

- How an assumption and a recommendation are distinguished from the other three categories, and which entity kind of the SO-2.01 record each is. This is the same question as open decisions 15 and 17 of that record.
- How the five categories are shown to a reader at retrieval, given that origin fields are WP10-01 and WP10-02.

## Requirement 4: state uncertainty, conflicting sources and missing context, and do not manufacture consensus from repetition or from agents that share one underlying source

Decided by the sources:

- The rule is fixed by the spec (line 16).
- Covered by SO-F-09: a confidence on the finding (AC01). SO-F-09 keeps the promotion rule of `src/engine/graph.mjs` for ordinary claims (AC01).
- What exists today:
  - Uncertainty and conflict are in the status: `contested` when support and opposition are both at least 0.3, and `refuted` when opposition is at least 0.6 and above support (`src/engine/graph.mjs:17-18`, `:108-109`).
  - Independence is counted by label. Evidence is grouped by the pair of a source label and a note path, support is combined across the pairs, and the number of sources is the number of distinct source labels among supporting evidence (`src/engine/graph.mjs:104-106`). The label is the client or agent name of the caller (`src/engine/vault.mjs:633`). Two labels that cite the same note path count as two sources, so the code does not tell whether they share one underlying source. A status of `fact` needs two sources, support of at least 0.85 and opposition below 0.2 (`src/engine/graph.mjs:16`, `:110`).
  - Nothing records missing context. A recall states what was found and does not state what was not (`src/engine/vault.mjs:447-467`).

Open, needs owner decision:

- How the underlying source of a piece of evidence is identified, so that repetition and agents sharing a source are not counted as independent. SO-F-09 does not address it and keeps the rule above for ordinary claims.
- How missing context is stated on a finding.
- How conflicting sources are presented beyond the `contested` status.

## Requirement 5: support dismissal, correction, adjudication and feedback so that false positives do not become permanent organisational memory

Decided by the sources:

- The four are required (spec line 17).
- Covered by SO-F-09: dismissal, correction and adjudication as events, a dismissed finding not recurring for the same sources and versions, and a correction kept in the history (AC02).
- What exists today:
  - Feedback on recall: a caller can say whether recalled items helped, a logged operation that tunes recall ranking (`src/engine/vault.mjs:659-666`; `src/server/mcp.mjs:149`). It is about recalled sections and not about claims.
  - Keep or drop of a memory: a logged review decision that does not edit the note (`src/engine/vault.mjs:528-544`).
  - Retraction of a claim's evidence is applied by the graph (`src/engine/graph.mjs:90`), and no function on main appends one.
  - Nothing is ever deleted from the operation log (`src/engine/graph.mjs:10-12`). Retention of anything dismissed is the SO-2.03 record.

Open, needs owner decision:

- Who may dismiss, correct or adjudicate a finding. This is permission-matrix-shaped, so it waits on ADR 5.
- Whether the feedback of this requirement is the recall feedback that exists, a feedback on findings, or both, and whether it changes ranking or status. SO-F-09 AC02 names three events and not feedback.
- How long a dismissed finding is kept, which is the SO-2.03 record's question and is not decided here.

## Open decisions

Each needs an owner decision before a build contract can be written. Items that are permission-matrix-shaped are marked ADR 5. What the fold covers is not listed here.

1. What makes an item recurring (requirement 1).
2. What "otherwise independent work" is (requirement 1).
3. How a risk, an assumption and a piece of reusable knowledge are represented; SO-2.01 entity kinds (requirement 1).
4. Which sources discovery may read, given the access rules of SO-2.02 (requirement 1).
5. What "material" means for a finding (requirement 2).
6. What the reasoning basis of a finding is and where it is stored (requirement 2).
7. How an assumption and a recommendation are distinguished from facts, decisions and inferences (requirement 3; SO-2.01).
8. How the five categories are shown at retrieval, with origin fields owned by WP10-01 and WP10-02 (requirement 3).
9. How the underlying source of evidence is identified so that shared sources are not counted as independent (requirement 4).
10. How missing context is stated on a finding (requirement 4).
11. How conflicting sources are presented beyond the contested status (requirement 4).
12. Who may dismiss, correct or adjudicate a finding; ADR 5 (requirement 5).
13. Whether feedback is the recall feedback, a feedback on findings, or both, and what it changes (requirement 5).
14. How long a dismissed finding is kept; SO-2.03 (requirement 5).
15. Whether SO-F-09 is adopted as the build layer for this scope (the layer question in RECONCILIATION.md at pull request 325 head 79cbaae).
16. The spec lists no dependency and the WBS lists SO-2.01 and SO-2.03 (`docs/scope-one/WBS.md:534`). The signed spec governs this record, and the difference is a documentation inconsistency to be fixed separately.
