# SO-2.01 Organisational knowledge model: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [projects](../../PROJECTS.md).

This is the decision record that contract SO-2.01 asks for (task T1, phase design). It builds nothing and changes no code. Every claim below cites a file and line, a section of a page in `docs/scope-one/`, or section 8.3 of the owner's baseline. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open decisions](#open-decisions). Nothing here is inferred from how a feature might later be built, and no design is invented.

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-2.01-organisational-knowledge-model.json`. The six requirements are at lines 13 to 18, the two named lines the record must carry ("Entity kinds:" and "Relation kinds:") are checked at lines 86 and 94, and the scope (this file and `docs/README.md`) is at lines 22 and 23.
- Code on main at `908654d`: `src/engine/vault.mjs`, `src/engine/graph.mjs`, `src/engine/index.mjs`, `src/engine/tokens.mjs`, `src/engine/project-store.mjs`, `src/engine/project-state.mjs`, `src/engine/merge.mjs`.
- Docs: `docs/scope-one/WBS.md`, `docs/scope-one/DECISIONS.md`, `docs/scope-one/REQUIREMENTS.md`, `docs/PROJECTS.md`, `docs/RELAY.md`, `docs/DATA-FLOW.md`, `docs/CLOUD.md`. The reconciliation page of the programme decomposition, [RECONCILIATION.md](../RECONCILIATION.md) (merged by pull request 325), is on main.
- Baseline: the owner's master traceability baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does. Section 8.3 (organisational intelligence and memory contracts, baseline lines 317 to 327) lists six contract families. The first, "Organisational knowledge model", is this contract: "Relationships between people, teams, departments, projects, programmes, decisions, artefacts and evidence". Section 8.3 also says: "The existing vault.mjs, graph and retrieval modules are useful foundations. They do not by themselves establish this wider organisational intelligence capability."
- Current state in one line: no code on main models a person, team, department, programme, customer, commitment or risk as an entity, and no code relates anything across projects. A search of `src/engine/` for those words finds only the teammate label on a device (`src/engine/devices.mjs:63-66`, `:306-334`) and the `person` note kind (`src/engine/vault.mjs:28`).
- Settled decisions this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, with the cloud only a relay and a backup (line 72); providers are neutral and no work depends on one (line 73). Memory authority is decided by D-SO-MEMORY-AUTHORITY, recorded as decided on 30 October 2026 at 23:11Z in the fold decisions of the owner's vault (INDEX-signed-contract-set.md of the recovered signed set, section D-SO-MEMORY-AUTHORITY): the vault and its store are the canonical memory and project-state authority, there is no second database, and external components connect only through adapter boundaries. That record lives in the owner's vault, not in this repository, so it cannot be checked from here, and `docs/scope-one/DECISIONS.md` does not carry it yet. The decision that the merge engine is reached only through the provider boundary is stated by the code (`src/engine/merge.mjs:2-7`, `:27-34`) and by RECONCILIATION.md, the reconciliation page on the branch named above (the "Conflicting" table, first row).
- Neighbouring contracts, cited and not restated: SO-1.07 owns explicit relations between project items and change propagation (`docs/scope-one/WBS.md:526`). SO-2.02 owns permission-aware retrieval and leaves sharing classes at a site's publish boundary to WP13-01 (`docs/scope-one/WBS.md:417`, `:532`). SO-2.03 owns provenance, retention, deletion and invalidation and leaves the status lattice of a note to WP10-01 and WP10-02 (`docs/scope-one/WBS.md:418`, `:533`). SO-2.04 and SO-2.05 are design records that WP08-04 and WP14-04 consume (`docs/scope-one/WBS.md:419-420`, `:534-535`, `:557`). SO-2.06 owns the acceptance tests (`docs/scope-one/WBS.md:421`, `:536`).
- Related ground, named for orientation only: this record does not depend on either and does not restate either. SO-07-A is the canonical project store, delivered in #217 (`docs/scope-one/WBS.md:501`, `:188`); the store code it describes is cited from `src/engine/project-store.mjs` above. SO-02-A is goal intake and planning, signed in the owner's vault and so not in this repository and not checkable here (`docs/scope-one/WBS.md:398-399`, dagger explained at `:11`).
- SO-2.01 depends on no other contract: this is settled by the signed spec, whose task T1 has `depends_on: []` (spec line 11), and the WBS agrees (`docs/scope-one/WBS.md:531`). That the store, state machine and coordinator are not yet wired to the daemon is a fact of the code (`contracts/scope-one/manifest.json:11`) and the wiring is SO-1.01, which this record does not depend on.
- The title of SO-2.01 in the spec, the manifest and the WBS reads "people, teams, projects, decisions, artefacts and evidence" (spec line 2; `contracts/scope-one/manifest.json:176`; `docs/scope-one/WBS.md:531`). The first requirement of the spec (spec line 13) and baseline 8.3 add departments and programmes. This record follows the requirement text. The shorter title is a documentation inconsistency to be fixed separately and is not an owner decision.

Related fold contracts: SO-F-02, SO-F-09 and SO-A-04. They are signed in pull request #341 and recorded in contracts/signed, and they are cited here by id. This record has no dependency on them and does not restate them. They are the build layer for the parts of the model they cover (owner delegation, 1 Nov 2026; the "Layer to build against" row in [RECONCILIATION.md](../RECONCILIATION.md)).

Entity kinds: the spec names these thirteen, in its second requirement (`contracts/scope-one/specs/SO-2.01-organisational-knowledge-model.json:14`): person, team, department, project, programme, customer or other business entity, commitment, decision, artefact, risk, issue, dependency, evidence. What each kind is, its fields, its identifier and where it is stored are open, needs owner decision (see requirements 1 and 2). Only person (a note kind, `src/engine/vault.mjs:28`), project, decision, artefact, dependency and evidence have anything like a counterpart in code today, and those counterparts differ from each other and from the graph and the project store (requirement 1).

Relation kinds: the spec names none. The only relation kinds in code are those of the existing memory graph: `related`, `causes`, `depends_on`, `contradicts`, `derived_from`, `part_of`, `supersedes` (`src/engine/graph.mjs:24`), plus the derived `mentions`, `co_occurs`, `in_project`, `links_to`, and `supports` and `opposes` between evidence and a claim (`src/engine/graph.mjs:6-8`). Which relation kinds an organisation-level graph carries is open, needs owner decision (see requirement 2).

## Requirement 1: relationships between people, teams, departments, projects, programmes, decisions, artefacts and evidence

Decided by the sources:

- The relationships are required (spec line 13; baseline 8.3, first row). The WBS gives the family one owner, SO-2.01 (`docs/scope-one/WBS.md:416`, `:531`), and records that the vault graph and retrieval modules are foundations only (`docs/scope-one/WBS.md:416`).
- What exists today for each named kind, from the code:
  - Person: a note kind `person` that files a memory under `memory/people/` (`src/engine/vault.mjs:28`, `:359`). A device may carry a `teammate` label (`src/engine/devices.mjs:63-66`). Neither is an entity kind of the graph or of the project store (`src/engine/graph.mjs:26-37`; `src/engine/project-store.mjs:20-29`).
  - Team, department, programme: no entity kind and no field (search of `src/engine/`, see above).
  - Project: a project entity in the project store with the required field `name` (`src/engine/project-store.mjs:21`), one store directory per project (`src/engine/project-store.mjs:53`). In the memory side a project is a text line `Project: <name>` that tags a section (`src/engine/index.mjs:131`, `:141-144`; `src/engine/vault.mjs:375`) and a graph entity of kind `project` (`src/engine/graph.mjs:31`).
  - Decision: a note kind `decision` (`src/engine/vault.mjs:28`). The project store has no decision entity (`src/engine/project-store.mjs:20-29`). The only approval record is the `approval` kind, whose required field is `task_id` (`src/engine/project-store.mjs:28`).
  - Artefact: a task may carry an `artifactHash` that evidence binds to (`src/engine/project-state.mjs:95`, `:99`). There is no artefact entity kind (`src/engine/project-store.mjs:20-29`). Artefact version relations belong to SO-1.09 (`docs/scope-one/WBS.md:528`).
  - Dependency: a task carries `dependsOn` (`src/engine/project-state.mjs:64`), and the graph has an explicit `depends_on` edge type (`src/engine/graph.mjs:24`). The two are unrelated in code.
  - Evidence: two separate things carry the name. The project store has an `evidence` entity bound to a task (`src/engine/project-store.mjs:25`; `src/engine/project-state.mjs:91-104`). The graph has evidence attached to a claim with a stance, strength, source and time (`src/engine/graph.mjs:89`).
- Relations between items inside one project (scope to milestone to task to evidence, and the like) are SO-1.07 and are not decided here (`docs/scope-one/WBS.md:526`). This record covers relations that reach people, teams, departments and programmes, and relations that cross a project boundary.

Open, needs owner decision:

- The definition of each of the thirteen entity kinds listed under "Entity kinds:" above, including which of them are new records and which are references to something that exists.
- Whether "evidence" in the model means the project-store evidence entity, the graph claim evidence, or a third thing. The two on main share a name and no field.
- Whether "decision" in the model is the `decision` note, a new entity, or the SO-1.08 decision queue item (the queue's own record is `docs/scope-one/design/decision-queue.md`).
- The relation kinds between the thirteen entity kinds (the "Relation kinds:" line above). The sources list entity kinds and no relations between them.
- The identifier scheme for an entity that is not a project: ids of the project store are opaque strings assigned at write time (`docs/scope-one/DECISIONS.md:36-37`, ADR 2, status open). The sources give no identifier for a person or a team.

## Requirement 2: an organisation-level knowledge and work graph connecting people, teams, departments, projects, programmes, customers or other business entities, commitments, decisions, artefacts, risks, issues, dependencies and evidence

Decided by the sources:

- The graph is required (spec line 14). It is the same set of kinds as requirement 1 plus customers or other business entities, commitments, risks, issues and dependencies.
- The graph that exists today is one per vault, built from the notes and from logged operations. Nodes are note sections, entities and claims; edges are derived from the Markdown or explicit and logged (`src/engine/graph.mjs:2-11`). Derived edges are recomputed from the notes on every write (`src/engine/graph.mjs:9`). Explicit edges, claims and status changes are operations in the append-only log, and a retraction is a new operation (`src/engine/graph.mjs:10-12`; `src/engine/vault.mjs:620-626`, `:627-639`).
- Entities in that graph are found by text patterns (wikilinks, `Project:` lines, tags, code names, capitalised words, identifiers), not declared (`src/engine/graph.mjs:26-37`). The graph takes entities from note text by pattern, so no person or team entity is declared anywhere.
- A work graph already exists inside one project: tasks, their dependencies, leases, attempts, evidence and approvals in the project store (`src/engine/project-store.mjs:20-29`), moved by the state machine (`src/engine/project-state.mjs:19-58`). Nothing reads more than one project store at a time: the vault opens one store per project id (`src/engine/vault.mjs:408-410`).
- Local-first: the local vault is the source of truth and the cloud is only a relay and a backup (`docs/scope-one/DECISIONS.md:72`). The relay only forwards and cannot read what it carries (`docs/RELAY.md:18-20`). The backup is git, pushed to a private remote of the user's choosing (`docs/DATA-FLOW.md:15-17`) and is single-writer (`docs/CLOUD.md:105-106`).
- Merge: the core holds no convergence logic. A conflicted note is handed to an external merge engine only through the provider boundary, and when the engine is absent or refuses, both versions are kept (`src/engine/merge.mjs:2-7`, `:27-34`). Any organisation-level state that several computers write has to converge through that boundary and nowhere else.
- Memory authority: the organisation graph cannot be a second store outside the vault. The vault and its store are the canonical authority, there is no second database, and external components connect only through adapter boundaries (D-SO-MEMORY-AUTHORITY, see the settled decisions above).
- The addendum recommends, and the owner has not accepted (`docs/scope-one/DECISIONS.md:79-80`: the addendum's other recommendations "still need explicit acceptance one by one"), a shared organisational memory made of the contributions of people and departments (addendum 13.2, lines 233 to 249 at commit a1757a0) and, for several sites, an intelligence fabric that does not assume all raw records are copied into one central database and may use synchronised authorised state, federated queries, permitted derived insights or evidence references (addendum 13.6.1, lines 309 to 330 at commit a1757a0). The addendum is docs/scope-one/ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md on branch so-01-scope-one-review-addendum and is not on main. Both are unaccepted recommendations, so this record takes no design from them.

Open, needs owner decision:

- Whether the organisation-level graph is a projection built on read from the vault and the project stores, or a record kept inside the vault's own store. It cannot be a second store outside the vault (D-SO-MEMORY-AUTHORITY). The accepted sources do not say how the vaults of several people form one organisation graph; the addendum's recommendation on this is unaccepted (see above). The vault is written by one process (`src/engine/vault.mjs:3`) and backup is single-writer (`docs/CLOUD.md:105-106`).
- Which state is replicated between computers at all, and therefore which state needs the merge boundary. Baseline 8.5 names CRDT-Merge integration "for supported replicated project and organisational state" (baseline line 345) and the WBS gives it to other work (`docs/scope-one/WBS.md:440`, row 5.5.1). Which organisation-level state is supported and replicated is not defined by any accepted source.
- Where in the vault's own store the graph is kept. The graph is inside the vault and its store and is not a second database (D-SO-MEMORY-AUTHORITY). The store schema is ADR 1, status open, with the safe default "extend the existing store in place; do not create a second store" (`docs/scope-one/DECISIONS.md:18-27`).
- The meaning of "work graph" against the existing task dependency graph, and who owns commitments, risks and issues as records. SO-1.07 may own risks and issues as project items (`docs/scope-one/WBS.md:526`); the sources do not say.
- Customers and other business entities: no source defines the term, its fields or its owner.

## Requirement 3: keep each project independently governed, and keep the distinction between a local project fact and an organisation-wide policy

Decided by the sources:

- Shared organisational awareness must not erase project scope, ownership, approval authority, confidentiality, or the distinction between a local project fact and an organisation-wide policy (spec line 15).
- What keeps a project apart today:
  - A project store lives under its own directory and takes its own lock, one writer at a time (`src/engine/project-store.mjs:1-6`, `:53`).
  - Recall is limited to one project by default: the configured scope is `project` (`src/engine/vault.mjs:32`), and a project-scoped recall returns that project's sections plus sections that name no project (`src/engine/vault.mjs:424-427`, `:428-443`). A caller can widen it with `all_projects` (`src/engine/vault.mjs:429`, `:447`).
  - Graph co-occurrence and neighbours are computed over the whole vault, not per project (`src/engine/graph.mjs:45`, `:65`, `:123-131`).
- What a change of scope does today: `amendScope` raises the project's scope version, marks the evidence bound to affected tasks stale, and returns affected verified or verifying tasks to accepted (`src/engine/project-state.mjs:177-214`). It checks no authorisation and no approval. An approval record has a task and nothing more (`src/engine/project-store.mjs:28`).
- Access today is by token scope and path glob (`src/engine/tokens.mjs:102-107`). A token limited to some paths sees a filtered graph (`src/engine/vault.mjs:610-617`). Classification, department, jurisdiction and purpose are not in code. Those controls belong to SO-2.02 (`docs/scope-one/WBS.md:532`).

Open, needs owner decision:

- Whether a record is marked as a local project fact or an organisation-wide policy, how, and who may mark it. No field, state or kind in the code or the docs separates the two.
- The rule that decides which project facts become visible at organisation level. Any rule shaped like a role-by-action or role-by-record table waits on ADR 5, the permission matrix, status open (`docs/scope-one/DECISIONS.md:58-66`). Until it is decided the safe default holds: keep the current gates, grant no new role or action, and anything ungated stays denied (`docs/scope-one/DECISIONS.md:65-66`).
- Who holds approval authority over a cross-project or organisation-level item. The sources define approval only inside a project, on a task.
- Whether the model can ever write into a project's scope or ownership. The spec forbids erasing them (spec line 15); no source says by what path an organisation-level change reaches a project.

## Requirement 4: the system may propose assumptions, identify gaps and raise potential issues, with source, context, freshness and confidence on each finding, and an inference is a hypothesis to validate

Decided by the sources:

- A model-generated inference is a hypothesis to validate, not a new organisational fact and not an authorised change (spec line 16).
- The closest existing mechanism is the claim in the graph. A claim collects evidence with a stance (support, oppose, speculate), a strength, a source and a time (`src/engine/graph.mjs:88-89`; `src/engine/vault.mjs:627-639`). Its status is derived from that evidence and is one of conjecture, theory, fact, contested, refuted (`src/engine/graph.mjs:13-19`, `:102-114`). The `fact` status needs support of at least 0.85 from at least two independent sources and opposition below 0.2 (`src/engine/graph.mjs:16`, `:110`). Speculation alone never reaches `theory` (`src/engine/graph.mjs:14`, `:105-113`).
- A claim returned with its status and with where it came from is available through `provenance` (`src/engine/vault.mjs:645-656`) and through recall annotations (`src/engine/vault.mjs:459-462`).
- A section can carry a review date, and recall leaves out a section past it (`src/engine/vault.mjs:437-438`). That is the only freshness control in the retrieval path.
- The lattice of a note's own status is not decided here: it is WP10-01 and WP10-02 (`docs/scope-one/WBS.md:418`, `:533`). What a cross-project finding must carry is SO-2.04 (`docs/scope-one/WBS.md:419`, `:534`), and routing a consequential finding to an owner is SO-2.05 (`docs/scope-one/WBS.md:420`, `:535`). This record cites those and does not restate them.

Open, needs owner decision:

- Which entity kind a hypothesis, an assumption, a gap or a potential issue is in the model, and whether it is a claim, a project item or a separate record.
- Where "context", "freshness" and "confidence" of a finding live in the model. A claim has strength and a derived support figure (`src/engine/graph.mjs:113`) and a timestamp per evidence entry (`src/engine/graph.mjs:89`); the sources do not say that these are the fields the spec means, and no field named freshness or context exists on a claim.
- How a hypothesis is validated and by whom: the spec says "validate" and the sources name no actor, step or state. The identity and permission side waits on ADR 5.
- How a model-made record is kept from ever being read as an organisational fact when it is retrieved. The recall path returns claim status but does not mark who or what produced a claim (`src/engine/vault.mjs:459-462`).

## Requirement 5: do not require staff to copy updates by hand into a central knowledge base, with explicit controls over what is shared

Decided by the sources:

- Useful work state is to be captured and reconciled through the existing project store, event history, integrations and approved agent workflows, with explicit controls over what is shared (spec line 17).
- What capture exists today, all local and all inside the vault:
  - The project store keeps an append-only event log per project and rebuilds its state from it on every open (`src/engine/project-store.mjs:1-6`, `:64-77`).
  - Progress checkpoints are appended to a per-project note by whichever client writes them (`src/engine/vault.mjs:381-392`), and session journals are appended by the clients (`src/engine/vault.mjs:413-420`).
  - Every vault write is an operation in the append-only log with the client and agent that made it (`src/engine/graph.mjs:84`, `:89`; `src/engine/vault.mjs:622`).
  - History import reads local files into notes with no model call and no network call (`docs/IMPORT.md`, opening paragraphs).
- Nothing today moves work state from a project to an organisation-level store, and no code reads another project's state (requirement 2).
- Controls over sharing that exist are token scopes and paths (`src/engine/tokens.mjs:102-107`) and the remote access switch (`docs/RELAY.md:23-24`). No control says "this record may be shared at organisation level".
- Sharing classes at a site's publish boundary are WP13-01 (`docs/scope-one/WBS.md:445`); sharing inside the organisation at retrieval and action time is SO-2.02 (`docs/scope-one/WBS.md:532`). This record takes neither.

Open, needs owner decision:

- Which existing event types and which integrations feed the organisation graph, and which are never to. The sources list the existing capture paths above and name no feed.
- What "approved agent workflows" means for capture: the sources do not define an approval for capture.
- The unit of sharing: a note section, a graph entity, a project-store entity, or an event. This is shaped like a sharing class, so it waits on SO-2.02 and, at a site boundary, WP13-01. Any permission matrix for it waits on ADR 5.
- How reconciliation works when the same fact is captured from two sources. Convergence of replicated state is reached only through the merge provider boundary (`src/engine/merge.mjs:27-34`); which state is replicated is open (requirement 2).

## Requirement 6: the existing vault, graph and retrieval modules are foundations and do not by themselves establish the organisational capability

Decided by the sources:

- This is baseline 8.3's closing sentence and is repeated by the spec (line 18) and the WBS (`docs/scope-one/WBS.md:416`). This record keeps it: nothing below is claimed as already meeting the model.
- What each foundation provides, with the limit the sources show:
  - Vault (`src/engine/vault.mjs`): Markdown notes in git with an append-only operation log, a recall index and a graph (`src/engine/vault.mjs:1-4`). One daemon process writes (`src/engine/vault.mjs:3`). A teammate invite enrols a teammate's computer into the same vault under the teammate's name, as a device label (`src/engine/devices.mjs:306-334`); that label is the only team-related field in `src/engine/`, so the vault holds no organisation or team structure beyond it.
  - Graph (`src/engine/graph.mjs`): entities found by text patterns, derived and explicit edges, and claims with derived status (see requirements 2 and 4). It is one graph per vault and has no declared entity kinds beyond those patterns (`src/engine/graph.mjs:26-37`) and `explicit` (`src/engine/vault.mjs:624`).
  - Retrieval (`src/engine/index.mjs`, `src/engine/vault.mjs:447-467`): a ranked search over note sections, filtered before ranking by project scope, token paths and review state (`src/engine/index.mjs:173-178`; `src/engine/vault.mjs:428-445`). It retrieves text and annotates it with graph context (`src/engine/vault.mjs:456-463`).
  - Project store and state machine (`src/engine/project-store.mjs`, `src/engine/project-state.mjs`): the canonical state of one project. They are not called by the daemon, the command line or the MCP routes today; making them one authority is SO-1.01 (`contracts/scope-one/manifest.json:11`).
- Memory authority is decided by D-SO-MEMORY-AUTHORITY (see the settled decisions above): the vault and its store are the canonical memory and project-state authority. The WBS still lists it as blocked (`docs/scope-one/WBS.md:62`, row 1.3.3; `docs/scope-one/WBS.md:307`, requirement 92); that entry predates the decision.

Open, needs owner decision:

- Which of the foundations the model extends in place and which it leaves untouched, all inside the vault and its store (D-SO-MEMORY-AUTHORITY). The store schema decision is ADR 1 (`docs/scope-one/DECISIONS.md:18-27`).
- The default recall, retention and compaction policy that any organisation-level retrieval inherits is ADR 4, status open (`docs/scope-one/DECISIONS.md:48-56`).

## Open decisions

Each needs an owner decision before a build contract can be written. Items marked as owned by another contract or ADR are listed so that they are not lost; the decision itself sits there.

1. Definition of each of the thirteen entity kinds, and which are new records and which are references (requirement 1).
2. Whether "evidence" is the project-store entity, the graph claim evidence, or a new thing (requirement 1).
3. Whether "decision" is the `decision` note, a new entity, or the SO-1.08 queue item (requirement 1).
4. The relation kinds between entity kinds (requirements 1 and 2).
5. The identifier scheme for non-project entities; tied to ADR 2 (requirement 1).
6. Whether the organisation graph is a projection built on read or a record kept inside the vault's own store (it cannot be a second store), and how the vaults of several people contribute (requirement 2).
7. Which state is replicated between computers and so needs the merge provider boundary (requirements 2 and 5).
8. Where in the vault's own store the graph is kept; tied to ADR 1 (requirement 2).
9. The meaning of "work graph" against the task dependency graph, and ownership of commitments, risks and issues, shared with SO-1.07 (requirement 2).
10. Definition of customers or other business entities (requirement 2).
11. How a record is marked as a local project fact or an organisation-wide policy, and who may mark it (requirement 3).
12. The rule for which project facts become visible at organisation level; any role-by-action table waits on ADR 5. Owned by SO-2.02 / ADR 5, not asked here (requirement 3).
13. Approval authority over cross-project and organisation-level items. Owned by SO-2.02 / ADR 5, not asked here (requirement 3).
14. Whether and how an organisation-level change can reach a project's scope or ownership (requirement 3).
15. Which entity kind a hypothesis, assumption, gap or potential issue is (requirement 4).
16. Where context, freshness and confidence of a finding live (requirement 4).
17. How a hypothesis is validated, by whom, and how a model-made record is marked at retrieval (requirement 4).
18. Which existing event types and integrations feed the graph, and what "approved agent workflows" means for capture (requirement 5).
19. The unit of sharing; waits on SO-2.02, WP13-01 and ADR 5. Owned by SO-2.02 / ADR 5, not asked here (requirement 5).
20. Reconciliation of one fact captured from two sources (requirement 5).
21. Which foundations are extended in place, inside the vault and its store; owned by ADR 1 / ADR 4, not asked here (requirement 6).
