# SO-2.03 Provenance, retention and invalidation of organisational knowledge: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [projects](../../PROJECTS.md), [threat model](../../THREAT-MODEL.md), [data flow](../../DATA-FLOW.md).

This is the decision record that contract SO-2.03 asks for (task T1, phase design). It builds nothing and changes no code. Every claim below cites a file and line, a section of a page in `docs/scope-one/`, or section 8.3 of the owner's baseline. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open decisions](#open-decisions). Nothing is inferred and no design is invented. Anything shaped like a permission matrix (a table of which role may do what to which record) waits on ADR 5, the permission matrix, status open (`docs/scope-one/DECISIONS.md:58-66`), and is marked open here.

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-2.03-provenance-retention-invalidation.json`. The four requirements are at lines 13 to 16, the two named lines the record must carry ("Retention classes:" and "Invalidation rules:") are checked at lines 68 and 76, and the scope (this file and `docs/README.md`) is at lines 20 and 21. The spec says (line 5) that WP10-01 and WP10-02 define the knowledge status lattice and origin fields of a note, and that this contract takes none of them.
- Code on main at `908654d`: `src/engine/oplog.mjs`, `src/engine/vault.mjs`, `src/engine/graph.mjs`, `src/engine/index.mjs`, `src/engine/tokens.mjs`, `src/engine/project-store.mjs`, `src/engine/project-state.mjs`, `src/server/http.mjs`.
- Docs: `docs/scope-one/WBS.md`, `docs/scope-one/DECISIONS.md`, `docs/THREAT-MODEL.md`, `docs/DATA-FLOW.md`, `docs/CLOUD.md`, `docs/RELAY.md`.
- Baseline: the owner's master traceability baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does. Section 8.3 lists the third contract family as "Provenance and retention": "Source attribution, derived-record provenance, retention, deletion and invalidation rules". It also says the existing vault, graph and retrieval modules are "useful foundations" that "do not by themselves establish this wider organisational intelligence capability".
- Settled decision this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, the local vault is the source of truth and the cloud is only a relay and a backup (line 72). Any retention, deletion or invalidation rule below is a rule of the vault. Every index, cache, replica and derived view is judged against the vault and none of them is a source. Providers are neutral (line 73).
- The organisational knowledge model, its entity kinds and relation kinds are the SO-2.01 decision record (docs/scope-one/design/organisational-knowledge-model.md on branch feat/so-2-01-org-knowledge-model, not yet on main). Permission-aware knowledge access, its decision point, deny rules and the read paths that carry no per-path check are the SO-2.02 decision record (docs/scope-one/design/permission-aware-knowledge-access.md on branch feat/so-2-02-permission-aware-access, not yet on main). This record cites both and restates neither. The WBS lists SO-2.01 as the one dependency of SO-2.03 (`docs/scope-one/WBS.md:533`).
- Neighbouring contracts, cited and not restated. The status lattice and origin fields of a note are WP10-01 and WP10-02 (`docs/scope-one/WBS.md:418`, `:533`): this record defines no status and no origin field of a note. Sharing classes at a site's publish boundary are WP13-01 (`docs/scope-one/WBS.md:445`). What a cross-project finding must carry is SO-2.04, which WP08-04 and WP14-04 consume (`docs/scope-one/WBS.md:419`, `:534`, `:557`). Retention and recall defaults for new projects are ADR 4, status open (`docs/scope-one/DECISIONS.md:48-56`). Policy gates and runtime security are SO-03-A and SO-09-A, signed in the owner's vault and not checkable here (`docs/scope-one/WBS.md:404`, `:337`, `:565`).
- Current state in one line: the vault keeps everything and erases nothing. The operation log is never truncated (`src/engine/oplog.mjs:11-13`), a deleted note stays in the log and in git history (`src/engine/vault.mjs:346`), and the only time-based retention is the move of old journal files to an archive folder (`src/engine/vault.mjs:733-766`). No code on main erases, redacts after the fact, or invalidates a derived record when its source access changes.

Related unsigned fold contracts: SO-F-02, SO-F-09 and SO-A-04. They are unsigned proposals that live outside this repository, so they cannot be checked from it. This record has no dependency on them and does not restate them. Whether any of them is adopted is open, needs owner decision.

Retention classes: the classes of stored material that the code on main already treats differently, each in code. (1) The operation log: every record is kept, never summarised, truncated or compacted; a sealed segment may be moved to an archive folder by rename with its hash pinned (`src/engine/oplog.mjs:11-13`, `:172-193`). (2) Notes, which are files: a delete removes the file and appends a delete record, and the content stays in the log and in git history (`src/engine/vault.mjs:341-346`). (3) Journal session files: moved to `work/archive` once older than `journal.retention_days`, which is 90 when unset, by rename and still readable at the old path (`src/engine/vault.mjs:156-161`, `:733-766`). (4) Time-limited memories: a section with a review date is left out of recall once the date has passed, and a keep or drop decision is a logged review record that does not edit the note (`src/engine/vault.mjs:437-438`, `:528-544`). (5) Derived stores, `index.jsonl` and `graph.json` under `.memev/`, which are rewritten by compaction and are not in the git backup because `.memev/` is ignored (`src/engine/vault.mjs:65`, `:689`, `:779-780`, `:816`). (6) Project store events: one append-only log per project, whose compaction drops only the backup copies a migration left (`src/engine/project-store.mjs:253-262`). (7) Usage records of recall: logged operations, with the last 20 uses of an item kept in the graph (`src/engine/vault.mjs:573-576`; `src/engine/graph.mjs:92-97`). Which of these are organisational retention classes, their periods, who may change them and whether a class can end in erasure are open, needs owner decision. Retention defaults are ADR 4, status open. Any rule of who may override or shorten a class is permission-matrix-shaped and waits on ADR 5.

Invalidation rules: the rules that invalidate something today, each in code. A delete removes the note from the recall index and removes the graph edges and co-occurrences derived from it (`src/engine/vault.mjs:345`; `src/engine/graph.mjs:72-79`). A review decision of drop leaves a section out of recall (`src/engine/vault.mjs:436`). A scope amendment marks the bound evidence of a project stale and returns verified tasks to accepted (`src/engine/project-state.mjs:177-214`). A revoked or expired token stops verifying (`src/engine/tokens.mjs:49-51`, `:60-66`). A claim's status is recomputed from its live evidence, and retracted evidence is left out (`src/engine/graph.mjs:102-114`). What does not invalidate today: a delete does not touch claims whose evidence names the deleted path (`src/engine/vault.mjs:345`; `src/engine/graph.mjs:88-89`), no function on main appends a claim or edge retraction although the graph applies one (`src/engine/graph.mjs:85`, `:90`), and a change to a credential's access invalidates no derived record. The rules for invalidating or re-evaluating an already-derived insight when its source access changes are open, needs owner decision. A rule shaped like a role-by-record table waits on ADR 5.

## Requirement 1: source attribution, derived-record provenance, retention, deletion and invalidation rules

Decided by the sources:

- The five rules are required (spec line 13; baseline 8.3, third row). The WBS gives the family one owner, SO-2.03, for retention, deletion, invalidation and derived-record provenance (`docs/scope-one/WBS.md:418`, `:533`).
- Source attribution that exists today: every operation record carries a sequence number, a time, a type, a path, the agent, the client, the device id, a hybrid clock value, the hash of the previous record of that path and its own hash (`src/engine/oplog.mjs:143-148`). A per-path hash chain and the hash of every sealed segment are checked by `verify` (`src/engine/oplog.mjs:9-12`, `:218`). A project store record carries an id, a sequence, a time, the agent, the client, the device, a clock value and a hash (`src/engine/project-store.mjs:213-235`). A transition record of a task carries actor, time, reason, previous and new state, scope version, correlation id and evidence references (`src/engine/project-state.mjs:106-131`).
- Derived-record provenance that exists today: derived graph edges are a pure function of the notes and are recomputed on every write (`src/engine/graph.mjs:9`), so their provenance is the note. Explicit edges record the client or agent and the sequence of the operation (`src/engine/graph.mjs:84`). A claim's evidence entries record stance, strength, the note path, the text, the source, the sequence and the time (`src/engine/graph.mjs:89`). A recall index section holds its path, heading, line, project, time and a snippet (`src/engine/index.mjs:109`).
- `Vault.provenance` returns, for a note, the operations that wrote it, the recalls that used it and its last git commits, and for a claim its evidence and status history (`src/engine/vault.mjs:645-656`).
- The status lattice and origin fields of a note are WP10-01 and WP10-02 and are not decided here (`docs/scope-one/WBS.md:418`).

Open, needs owner decision:

- Whether a derived record carries a link to the operations it was derived from, and which derived records count: a recall snippet, a graph entity, a co-occurrence weight, a claim status. Today the link is the path and heading.
- The unit of deletion: a note, a section, an operation, a project entity. Today the file is the unit and the log keeps every operation (`src/engine/vault.mjs:341-346`).
- What "deletion" promises, given that main keeps content in the log and in git history. Whether any class ends in erasure is open, and a rule of who may erase is permission-matrix-shaped, so it waits on ADR 5.
- The relationship between these rules and the entity kinds of the SO-2.01 record, which this record does not define.

## Requirement 2: preserve source attribution and links to the underlying evidence, and keep summaries and embeddings from becoming a side channel around source permissions

Decided by the sources:

- The rule is fixed by the spec (line 14).
- What controls the index today: a recall drops the sections a token may not read before ranking, so a hidden section cannot push a visible one out of the results, and a snippet reaches a caller only through a section that caller may read (`src/engine/index.mjs:173-178`; `src/engine/vault.mjs:428-445`). The graph hides an entity that only unreadable notes name, when the caller passes the view (`src/engine/vault.mjs:610-617`; `src/engine/graph.mjs:123`, `:134`).
- Claims keep a link to their evidence as a note path and a text of up to 500 characters (`src/engine/vault.mjs:633`; `src/engine/graph.mjs:89`). A claim's evidence path is not checked against the reader's permissions when claims are listed or when a claim's provenance is read. Those read paths are recorded in the SO-2.02 decision record (docs/scope-one/design/permission-aware-knowledge-access.md on branch feat/so-2-02-permission-aware-access, requirement 2) and are not restated here.
- No code on main produces an embedding or a generated summary (a search of `src/` for embedding and semantic finds nothing). The only derived text that leaves a note is the recall snippet (`src/engine/index.mjs:109`), the entity names in a recall hit and the claim annotation of a hit (`src/engine/vault.mjs:456-463`).

Open, needs owner decision:

- Whether the recall snippet, an entity name and a claim's subject, predicate and text are the derived records that must follow the permissions of their source note. This is the same question as open decision 17 of the SO-2.02 record.
- What a link to evidence must contain so that it can be followed without exposing the evidence: a path, a path and heading, an operation sequence. The sources define none.
- How summaries and embeddings are governed when they exist. None exists on main, and the sources define no rule for them.
- Who may follow an evidence link, which is permission-matrix-shaped and waits on ADR 5.

## Requirement 3: respect revocation, retention, deletion obligations and permission changes in indexes, caches, replicas and derived views, and define how already-derived insights are invalidated or re-evaluated when their source access changes

Decided by the sources:

- The rule is fixed by the spec (line 15). Local-first holds: the local vault is the source of truth, so indexes, caches and derived views are rebuilt from it and a replica is a backup and not a second authority (`docs/scope-one/DECISIONS.md:72`).
- Indexes: the recall index is updated for the changed note on every write and delete (`src/engine/vault.mjs:281-292`, `:345`) and can be rebuilt from the notes (`src/engine/vault.mjs:168`). Journal retention removes an archived file from the index (`src/engine/vault.mjs:754`).
- Caches: `index.jsonl` and `graph.json` are local files under `.memev/` (`src/engine/vault.mjs:65`, `:689`). The graph file holds the claims with their evidence text and the explicit edges, and is replayed from the operation log on start (`src/engine/vault.mjs:684-687`). It is a copy of what is in the log and is not a place where a retraction would be recorded.
- Replicas: the vault's git backup holds the notes and their history, so a deleted note's content stays in the remote's history (`src/engine/vault.mjs:346`; `docs/DATA-FLOW.md:15-17`). The backup is single-writer (`docs/CLOUD.md:105-106`). `.memev/`, which holds the operation log, the index and the graph, is not in git (`src/engine/vault.mjs:816`). The relay only forwards and cannot read what it carries (`docs/RELAY.md:18-20`).
- Revocation and permission change: a token can be revoked, expires and can be rotated with the same scopes and paths (`src/engine/tokens.mjs:60-78`). No function changes the paths or scopes of an existing token. Revocation takes effect on the next call and invalidates no stored derived record.
- Deletion obligations: the threat model states that deletes are records and not erasures (`docs/THREAT-MODEL.md:14`). The only after-the-fact change to stored text on main is redaction of a credential in a project store record, done at write time and flagged on the record (`src/engine/project-store.mjs:168-181`).
- Re-evaluation: a claim's status is recomputed when evidence is added (`src/engine/vault.mjs:635-636`), and retracted evidence is excluded (`src/engine/graph.mjs:103`). Nothing writes a retraction, and nothing re-evaluates a claim when the access to its evidence note changes.

Open, needs owner decision:

- How an already-derived insight is invalidated or re-evaluated when the access to its source changes, and who or what triggers it. The sources define no trigger.
- What a deletion obligation requires of the log, git history and a remote backup, and whether any of them may ever be rewritten. The code and the threat model say they are not.
- Whether a derived view such as a claim, an edge or a snippet is dropped, marked stale or recomputed when its source note is deleted or hidden. Today a delete drops the note's derived edges and leaves claims in place.
- Whether a permission change to an existing token is a new capability. No source defines one, and it is permission-matrix-shaped, so it waits on ADR 5.
- The behaviour of a replica when the vault invalidates something: a git backup remote cannot be told. Replication of organisation-level state is not decided in the SO-2.01 record, and any convergence goes only through the merge provider boundary (`src/engine/merge.mjs:27-34`).

## Requirement 4: record which identity or agent accessed, contributed, transformed or disclosed material organisational knowledge, and under which authority

Decided by the sources:

- The record is required (spec line 16).
- Contributed: every write is an operation with the agent name of the token and the client (`src/engine/vault.mjs:344`; `src/engine/oplog.mjs:145`). On a remote computer the client is chosen by a request header, because one device token serves all the apps of that computer (`src/server/http.mjs:273-275`), so the client of a remote write is as the caller states it.
- Accessed: a recall that returns hits is logged as a usage operation with the agent, client, session, query and the items returned (`src/engine/vault.mjs:464`, `:573-576`). Reading a note, listing, the claim list, the graph and the provenance read are not logged (`src/engine/vault.mjs:297-298`, `:640-656`). A remote request is also appended to `.memev/access.jsonl` with the time, a hash of the address, the route, the method and the id part of the token, and a signed device request with the device and its class (`src/server/http.mjs:115`, `:132`, `:261`). The note path is not in that line.
- Transformed: a claim's status change is a logged operation with the agent (`src/engine/vault.mjs:636`). A project transition is recorded with its actor, reason and evidence (`src/engine/project-state.mjs:106-131`). Derived graph edges are recomputed and no record says that a given recompute happened (`src/engine/graph.mjs:9`).
- Disclosed: no record says what was returned to whom, other than the recall usage line above.
- Authority: an operation records the agent name and not the token id (`src/engine/vault.mjs:344`). A transition record has an actor and a reason, not an authority (`src/engine/project-state.mjs:106-131`). Whether the identity that acted held the role or approval to do so is not recorded anywhere on main.
- Who may read these records: the files under `.memev/` are mode 0600 (`docs/THREAT-MODEL.md:9`); nothing in the sources says who may read the usage or provenance records of others. That belongs with the identity and permission questions of the SO-2.02 record.

Open, needs owner decision:

- What "material" organisational knowledge is, so that the record is made for it and not for every read.
- Which of the four events (accessed, contributed, transformed, disclosed) are recorded for which reads, writes and derived results, and whether a read of a note, a claim list or a graph query is recorded. Today they are not.
- What "authority" means as a recorded value: a token id, a role, a grant, an approval. The sources do not define it and the identity model is open in the SO-2.02 record.
- Whether the client of a remote caller may be recorded as stated by the caller, or must be bound to the device.
- Who may read the access and usage records, which is permission-matrix-shaped and waits on ADR 5.
- How long the access record is kept: it is a retention class that the list above does not contain, and retention defaults are ADR 4.

## Open decisions

Each needs an owner decision before a build contract can be written. Items that are permission-matrix-shaped are marked ADR 5.

1. Whether a derived record carries a link to the operations it came from, and which derived records count (requirement 1).
2. The unit of deletion (requirement 1).
3. What deletion promises while main keeps content in the log and git history, and whether any class ends in erasure; who may erase is ADR 5 (requirement 1).
4. Which of the seven stored classes in the "Retention classes:" line are organisational classes, their periods, who changes them and whether any can end in erasure; ADR 4 and ADR 5 (requirement 1).
5. Whether the recall snippet, an entity name and a claim are derived records that follow their source note's permissions; shared with the SO-2.02 record (requirement 2).
6. What an evidence link must contain and who may follow it; ADR 5 (requirement 2).
7. How summaries and embeddings are governed when they exist (requirement 2).
8. The invalidation or re-evaluation rule for an already-derived insight when source access changes, and its trigger (requirement 3).
9. What a deletion obligation requires of the log, git history and a remote backup (requirement 3).
10. What happens to a claim, an edge or a snippet when its source note is deleted or hidden (requirement 3).
11. Whether a permission change to an existing token is a new capability; ADR 5 (requirement 3).
12. How a replica learns of an invalidation, and whether organisation-level state is replicated at all; shared with the SO-2.01 record (requirement 3).
13. What "material" knowledge is for the access record (requirement 4).
14. Which of accessed, contributed, transformed and disclosed are recorded for which operations (requirement 4).
15. What "authority" is as a recorded value (requirement 4).
16. Whether a remote caller's client may be recorded as stated (requirement 4).
17. Who may read the access, usage and provenance records; ADR 5 (requirement 4).
18. The retention of the access record; ADR 4 (requirement 4).
19. Whether any of the unsigned fold contracts SO-F-02, SO-F-09 and SO-A-04 is adopted for this work.
20. SO-03-A and SO-09-A are signed in the owner's vault and cannot be read from this repository. Their content has to be checked against this record by the owner.
