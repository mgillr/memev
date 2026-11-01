# SO-2.02 Permission-aware knowledge access: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [projects](../../PROJECTS.md), [threat model](../../THREAT-MODEL.md).

This is the decision record that contract SO-2.02 asks for (task T1, phase design). It builds nothing and changes no code. Every claim below cites a file and line, a section of a page in `docs/scope-one/`, or section 8.3 of the owner's baseline. Where the sources say nothing, the text says "open, needs owner decision" and the item is listed under [Open decisions](#open-decisions). Nothing is inferred and no design is invented. Anything shaped like a permission matrix (a table of which role may do what to which kind of record) waits on ADR 5, the permission matrix, status open (`docs/scope-one/DECISIONS.md:58-66`), and is marked open here.

## Sources and how to read this record

- Spec: `contracts/scope-one/specs/SO-2.02-permission-aware-knowledge-access.json`. The six requirements are at lines 13 to 18, the two named lines the record must carry ("Access decision point:" and "Deny rules:") are checked at lines 86 and 94, and the scope (this file and `docs/README.md`) is at lines 22 and 23. The spec says (line 5) that WP13-01 enforces sharing classes at the publish boundary of a site, and that this contract is retrieval and action time inside the organisation and takes none of WP13-01.
- Code on main at `908654d`: `src/engine/tokens.mjs`, `src/engine/vault.mjs`, `src/engine/graph.mjs`, `src/engine/index.mjs`, `src/engine/devices.mjs`, `src/engine/entitlements.mjs`, `src/engine/secrets.mjs`, `src/engine/project-store.mjs`, `src/server/http.mjs`, `src/server/mcp.mjs`, `src/server/oauth.mjs`.
- Docs: `docs/scope-one/WBS.md`, `docs/scope-one/DECISIONS.md`, `docs/scope-one/REQUIREMENTS.md`, `docs/THREAT-MODEL.md`.
- Baseline: the owner's master traceability baseline of 31 October 2026, cited as "baseline" and by section, as `docs/scope-one/WBS.md` line 13 does. Section 8.3 lists the second contract family as "Permission-aware knowledge access": "Retrieval governed by identity, project membership, classification, policy and jurisdiction". It also says the existing vault, graph and retrieval modules are "useful foundations" that "do not by themselves establish this wider organisational intelligence capability".
- Settled decisions this record follows (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, with the cloud only a relay and a backup (line 72); providers are neutral and no work depends on one (line 73). Access decisions are made on the computer that holds the vault. This record puts no decision in the cloud or in one provider.
- The organisational knowledge model, its entity kinds, relation kinds and its open decisions are the SO-2.01 decision record (docs/scope-one/design/organisational-knowledge-model.md on branch feat/so-2-01-org-knowledge-model, not yet on main). This record cites it and does not restate it. It names no entity kind of its own: where a requirement needs an entity such as a team or a department, the definition is SO-2.01's. The WBS lists SO-2.01 as the one dependency of SO-2.02 (`docs/scope-one/WBS.md:532`).
- Neighbouring contracts, cited and not restated: sharing classes at a site's publish boundary and the disclosure policy are WP13-01 and WP13-02 (`docs/scope-one/WBS.md:417`, `:445`, `:532`). Provenance, retention, deletion, invalidation and derived-record provenance are SO-2.03 (`docs/scope-one/WBS.md:418`, `:533`). Multi-person project permissions and team administration are SO-2.14, which waits on ADR 5 (`docs/scope-one/WBS.md:457`, `:544`). The routing and access rules for cross-functional discovery are SO-2.05 (`docs/scope-one/WBS.md:420`, `:535`). Acceptance tests for access leakage are SO-2.06 (`docs/scope-one/WBS.md:421`, `:536`). The execution policy and human approval gates are SO-03-A and the security of runtime adapters is SO-09-A. Both are signed in the owner's vault, are not in this repository, cannot be checked here, and are not restated (`docs/scope-one/WBS.md:404`, `:337`, `:565`).
- Current state in one line: access control on main is by capability token, a set of scopes (read, write, admin) and a list of path globs, checked inside the vault on each call. No code on main holds a role, a department, a team, a classification, a jurisdiction, a purpose or a data consent, and there is no federation code (a search of `src/engine/` and `src/server/` for classification, jurisdiction, department and purpose finds none; a search of `src/` for federation finds none).

- Layer: the fold contracts SO-F-01, SO-F-04 and SO-F-05, signed by pull request #341, are the build layer for most of this scope. This record cites them by id, restates none of their text, and keeps only what they do not cover. The question of which layer is built against is decided (owner delegation, 1 Nov 2026): the fold is the build layer, as recorded in [RECONCILIATION.md](../RECONCILIATION.md).

Related fold contracts: SO-F-01, SO-F-04 and SO-F-05. They are signed in pull request #341 and recorded in contracts/signed, and they are cited here by id. This record has no dependency on them and does not restate them. Where a requirement below says "Covered by", the part named is owned by that contract and is not decided here. They are adopted as the build layer (owner delegation, 1 Nov 2026), so the parts marked covered stay with them.

Access decision point: on main the decision is made inside the vault, per call, from the caller's token identity and the note path. `Vault._need` (`src/engine/vault.mjs:267-270`) calls `allowed` (`src/engine/tokens.mjs:102-107`). Recall drops sections the token may not read before ranking (`src/engine/vault.mjs:428-445`), and the graph is filtered through an optional view that the caller passes (`src/engine/vault.mjs:610-617`; `src/engine/graph.mjs:123`, `:134`). Where the single decision point of an organisation-level model sits, and which inputs it takes beyond token scope and note path, is open, needs owner decision (see requirement 2).

Deny rules: the rules that refuse today, each in code. A request with no valid token is refused (`src/server/http.mjs:230-231`); a revoked token, a wrong secret and an expired token do not verify (`src/engine/tokens.mjs:48-51`); a token without the scope, or with no path glob that matches the note, is refused (`src/engine/tokens.mjs:102-107`; `src/engine/vault.mjs:269`); a read-only identity cannot write (`src/engine/vault.mjs:268`); a token minted for this machine only is refused from a remote caller, and a remote caller needs remote access switched on (`src/server/http.mjs:129`, `:233`); a remote computer must sign each request with its own device key (`src/server/http.mjs:251-265`); a computer over the licensed seat count, or on a lapsed licence, can read but not write (`src/engine/entitlements.mjs:121-126`); no token writes under `bus/` or to the signed-contract paths (`src/engine/vault.mjs:272-278`); text that looks like a credential is refused on write (`src/engine/vault.mjs:279`; `src/engine/secrets.mjs:3-12`). Deny rules for purpose, jurisdiction and consent are open, needs owner decision. Deny rules by classification and by scope type are covered by SO-F-05 and SO-F-04, and are not decided here. Any deny rule shaped like a role-by-action or role-by-record table waits on ADR 5 and is open.

## Requirement 1: retrieval governed by identity, project membership, classification, policy and jurisdiction

Decided by the sources:

- The five governing inputs are required (spec line 13; baseline 8.3, second row). The WBS gives the family one owner, SO-2.02, covering retrieval and action time (`docs/scope-one/WBS.md:417`, `:532`).
- Covered by SO-F-01: identity and membership (AC02: subjects, scope types and membership records; AC03: every request resolves to a subject and a scope). Covered by SO-F-05: classification (AC02). Covered by SO-F-04: policy per data class and its evaluation (AC02, AC03).
- What exists today for the inputs the fold does not settle:
  - Project membership: none. The only project control in retrieval is a filter by project tag: a project-scoped recall returns that project's sections plus sections that name no project (`src/engine/vault.mjs:424-443`), with the configured scope `project` by default (`src/engine/vault.mjs:32`), and a caller can widen it with `all_projects` (`src/engine/vault.mjs:429`). It is a filter on content, not a membership of a person in a project.
  - Policy: three vault-level switches act on access: remote access on or off (`src/server/http.mjs:129`), the licence seat policy (`src/engine/entitlements.mjs:121-126`) and the recall scope (`src/engine/vault.mjs:32`). The policy module for execution (SO-03-A) is not in this repository.
  - Jurisdiction: none in code.

Open, needs owner decision:

- How the project tag filter above relates to the membership records of SO-F-01 AC02, and which one retrieval uses for the input "project membership". It depends on the entity kinds of SO-2.01.
- Whether "jurisdiction" as a retrieval input is the same as the classes "in-jurisdiction" and "cross-border permitted" of SO-F-05 AC02, or a separate value set. No source says who assigns it.
- Which policy inputs apply at retrieval inside the organisation and who sets them, and whether the evaluation of SO-F-04 AC03 (written for a federation relationship) also governs retrieval inside one organisation. Policy defaults are ADR 4, status open (`docs/scope-one/DECISIONS.md:48-56`).
- The precedence between the five inputs when they disagree. This is permission-matrix-shaped, so it waits on ADR 5.

## Requirement 2: enforce identity, role, project membership, department, purpose, data classification, jurisdiction, consent and explicit resource permissions at retrieval and action time

Decided by the sources:

- Enforcement at both retrieval time and action time is required (spec line 14).
- Covered by SO-F-01: every store write and every authenticated request resolves to a subject and a scope (AC03), and a role binding resolves to a subject (AC05). Covered by SO-F-04: an evaluation of subject, scope, action and class that denies when no rule matches (AC03). Covered by SO-F-05: a query from a subject without clearance returns nothing derived from the class (AC03).
- What is enforced at retrieval time today: reading a note checks the token's read scope and path (`src/engine/vault.mjs:297`); listing returns only the notes the token may read (`src/engine/vault.mjs:298`); recall filters before ranking, so a hidden section cannot push a visible one out (`src/engine/index.mjs:173-178`; `src/engine/vault.mjs:428-445`); the review inbox and the audit report keep only paths the token may read (`src/engine/vault.mjs:520`, `:547`); entities in the graph are hidden when only unreadable notes name them (`src/engine/vault.mjs:610-617`).
- What is enforced at action time today: writing, appending, deleting and reviewing check the write scope for the path (`src/engine/vault.mjs:301`, `:324`, `:342`, `:360`, `:533`). Contract signing and verification are local operator actions (`src/engine/contracts.mjs:164-166`).
- Of the nine inputs the spec lists, only the credential's scopes (read, write, admin) and path globs are checked on main (`src/engine/tokens.mjs:3`, `:102-107`). The word consent appears in code only for the OAuth connection of an app, a page on the vault's own computer where the user allows or denies one client (`src/server/http.mjs:180-194`; `src/server/oauth.mjs:3`). It is not a consent of the person whose data a record holds.
- Read paths on main where no per-path check appears at the cited lines, recorded as facts and not as findings:
  - `Vault.claims` checks the read scope with no path and lists every claim in the graph with its subject, predicate and object (`src/engine/vault.mjs:640-643`). `Vault.provenance` by claim id returns the claim's evidence entries, with their paths and text, with no path check on those paths (`src/engine/vault.mjs:645-647`). The MCP tools that call them pass only the identity (`src/server/mcp.mjs:145`, `:148`).
  - `Vault.sessionStart` checks the read scope with no path and builds a card from the north-star note, recent decisions, the last session, active projects and open contracts (`src/engine/vault.mjs:579-590`). The helpers it calls take no identity (`src/engine/vault.mjs:157`, `:163`, `:591-606`), and the open contracts are listed through a fixed internal identity with read scope on every path (`src/engine/vault.mjs:607`).
  - The graph filter depends on the caller passing a view. Called without one, `neighbours` and `explain` return everything (`src/engine/graph.mjs:123`, `:134`). The two MCP tools that call them pass the view (`src/server/mcp.mjs:146-147`).
  - The project store takes no identity: it is opened by project id (`src/engine/vault.mjs:408-410`; `src/engine/project-store.mjs:44`). No route or tool opens it today (`contracts/scope-one/manifest.json:11`).
- Whether a path-limited token is meant to see those results is not stated in the sources.

Open, needs owner decision:

- Where the single decision point sits, which inputs it takes beyond the subject and scope that SO-F-01 AC03 resolves, and whether it replaces the per-method checks above or sits over them. This is the content of the "Access decision point:" line.
- Whether each read path listed above is to apply the token's paths. The sources are silent, and SO-F-01 AC03 resolves a subject and a scope but does not name a path check.
- What "purpose" means for retrieval inside an organisation. SO-F-04 AC02 carries a purpose on a federation relationship only.
- Whether the spec's "consent" means the OAuth connection consent that exists, the consent of the person a record is about, or both. No fold criterion covers it.
- How "explicit resource permissions" are stored: the only resource permission today is the path glob on a token. No fold criterion covers it. Role-by-action rules are permission-matrix-shaped and wait on ADR 5.
- Whether the project store (not wired to any route; SO-1.01) checks access itself or relies on its caller. It depends on SO-1.01 sequencing (`contracts/scope-one/manifest.json:11`).

## Requirement 3: least privilege and deny by default across organisational and federation boundaries, with enforcement in the underlying services and data paths

Decided by the sources:

- Least privilege and deny by default are required across organisational and federation boundaries, and filtering the display alone is not enough (spec line 15). The standing safe default for permissions is: keep the current gates, grant no new role or action, and anything ungated stays denied (`docs/scope-one/DECISIONS.md:65-66`, ADR 5).
- Covered by SO-F-04: deny by default when no rule matches, and a personal scope or vault refused as a party (AC02, AC03, AC04). Covered by SO-F-01: personal and organisational scopes kept apart (AC04).
- Where enforcement lives today: in the vault, which every HTTP route and MCP tool calls with the caller's identity (`src/server/http.mjs:289-325`; `src/server/mcp.mjs:130-147`). There is no user interface layer that filters. The graph view is the one place where enforcement is a parameter that a caller can omit (requirement 2).
- What is least privilege today: a remote computer's token and a cloud connector token are limited to `memory/**`, `work/**`, `contracts/**` and `bus/**` (`src/engine/devices.mjs:85`; `src/server/oauth.mjs:16-17`). The threat model lists path and scope limits for a leaked token (`docs/THREAT-MODEL.md:13`).
- What is not deny by default today: a token issued without paths gets `**` (`src/engine/tokens.mjs:32`), an enrolled local client gets `**` (`src/engine/devices.mjs:85`), and the admin token minted at vault creation has the admin scope with no expiry (`src/engine/vault.mjs:825`). An identity with the admin scope passes every scope check, and the path check still applies (`src/engine/tokens.mjs:104-106`).
- Federation: no federation code is on main (search of `src/`). The federation architecture (#224, merged 1 Nov 2026) is not accepted (`docs/scope-one/WBS.md:445`, `:469`).

Open, needs owner decision:

- Whether the default for a new token, device or organisation-level resource inside one organisation becomes deny, and what the grant step is. The safe default of ADR 5 is "anything ungated stays denied"; the token defaults above are broader, and the sources do not say which governs.
- Where enforcement sits for organisation-level retrieval that crosses several vaults or projects, so that no caller can omit it. No source defines such a path.
- Any list of denied-unless-granted actions, because it is permission-matrix-shaped: it waits on ADR 5.

## Requirement 4: distinguish raw source records, confidential artefacts, shared summaries, metadata, derived insights and public organisational knowledge, each with its own sharing rules

Decided by the sources:

- The six kinds are named by the spec (line 16) with the statement that each may have different sharing rules. None of the six is a field, a state or a kind in the code on main.
- What exists that bears on them:
  - Raw source records: notes are files in the vault, read and written by path (`src/engine/vault.mjs:297-300`). The project store holds events and entities per project (`src/engine/project-store.mjs:1-6`).
  - Derived data: the graph's derived edges are a pure function of the notes (`src/engine/graph.mjs:9`), and the recall index holds a snippet of each section (`src/engine/index.mjs:109`). A recall result is filtered by the readability of its source section, and carries entity names and claim annotations for that section (`src/engine/vault.mjs:456-463`). Claims and explicit edges are logged operations, not derived from a note (`src/engine/graph.mjs:10-12`).
  - Metadata: a recall result carries path, heading, line, snippet, score and project (`src/engine/index.mjs:203`). Whether that counts as metadata with its own rule is not in the sources.
  - Shared summaries, confidential artefacts, public organisational knowledge: nothing on main.
- Covered by SO-F-05: a classification on a note or project entity, and the rule that the index, graph edges, caches and logs carry the source classification (AC02, AC03). Covered by SO-F-04: allowed actions per data class (AC02). Covered by SO-F-09: a finding discloses no record its reader may not see (AC03).
- Derived-record provenance, and how derived insights are invalidated when source access changes, are SO-2.03 (`docs/scope-one/WBS.md:418`, `:533`). Sharing classes at a site's publish boundary are WP13-01 (`docs/scope-one/WBS.md:445`). This record takes neither.

Open, needs owner decision:

- How the six kinds named by the spec relate to the six replication classes of SO-F-05 AC02: whether the kinds are classes of a record, properties of a retrieval result, or both, and where each is stored. No fold criterion maps one to the other.
- The sharing rule of each of the six kinds. This is permission-matrix-shaped (which role may see which kind), so it waits on ADR 5.
- Whether a recall snippet, an entity name and a claim's subject, predicate and object are covered by the "index, graph edges, caches and logs" of SO-F-05 AC03. Claims and explicit edges are logged operations and not derived from a note (`src/engine/graph.mjs:10-12`). It overlaps SO-2.03.
- What makes an artefact confidential. No source defines it, and the artefact record is not decided (SO-2.01 and SO-1.09).

## Requirement 5: keep secrets, credentials, personal data and restricted material out of general organisational retrieval unless explicitly authorised and necessary for the task

Decided by the sources:

- The rule is fixed by the spec (line 17). The words "explicitly authorised" and "necessary for the task" are the spec's.
- What exists for secrets and credentials, all on the write side:
  - A write is refused when its text matches one of eight credential patterns (`src/engine/secrets.mjs:3-12`; `src/engine/vault.mjs:279`). A caller may pass `allow_secrets` to skip the check (`src/engine/vault.mjs:300`, `:271`).
  - The session journal redacts credential patterns before it writes (`src/engine/vault.mjs:418`).
  - A project-store record that looks like a credential is refused and the refusal is recorded, unless the store is opened with `allowSecrets`, in which case it is redacted (`src/engine/project-store.mjs:168-176`).
  - History import skips files named like secret files (`src/engine/importers/project.mjs:11-15`).
  - A token is stored only as a hash (`src/engine/tokens.mjs:2`, `:38`), and the files that hold tokens and keys are mode 0600 (`docs/THREAT-MODEL.md:9`).
- Nothing on main scans or filters at retrieval time. The secret check runs when text is written.
- Personal data and restricted material: no detection, no field and no rule on main (search of `src/` for personal data and classification).
- The publish-time secret scan before a push is a separate requirement (`docs/scope-one/REQUIREMENTS.md:76`, SO-REQ-052) and is not part of this contract.
- None of SO-F-01, SO-F-04 and SO-F-05 covers this requirement: their criteria carry no rule on secrets, personal data or restricted material at retrieval.

Open, needs owner decision:

- What counts as personal data and as restricted material, and who decides.
- What "explicitly authorised" means (a grant by whom, recorded where) and what "necessary for the task" means. The second needs the notion of a task or purpose at retrieval, which no source defines; the project store has tasks (`src/engine/project-store.mjs:22`) but nothing links a retrieval to one.
- Whether the credential patterns are applied again at retrieval for organisational results, and whether `allow_secrets` remains available to a caller of an organisation-level write.
- How a secret that is already stored is kept out of organisational retrieval. Retention and deletion of stored material are SO-2.03.

## Requirement 6: let administrators define organisation-wide defaults while retaining narrower project, team, department, location and jurisdiction controls

Decided by the sources:

- The layering is required (spec line 18): administrators set organisation-wide defaults, and narrower controls stay.
- Covered by SO-F-01: the scope types (team, department, project, programme, site and organisation) that a default or a narrower control can attach to (AC02). Covered by SO-F-04: a policy document per data class (AC02).
- What exists today: a vault has one administrator credential, the admin token minted at creation (`src/engine/vault.mjs:825`), and the admin scope (`src/engine/tokens.mjs:3`, `:35`). The last admin token is never revoked, because every admin route would then be refused (`src/engine/tokens.mjs:62-64`). The licence admin decides the seat count (`src/engine/entitlements.mjs:121-126`). The vault-wide default that reaches retrieval is the recall scope, set in the vault configuration (`src/engine/vault.mjs:32`). A narrower control is the path list on a token (`src/engine/tokens.mjs:106`).
- Multi-person project permissions and team administration are SO-2.14, which waits on ADR 5 (`docs/scope-one/WBS.md:457`, `:544`).
- Local-first: the local vault is the source of truth, so a default set at organisation level has to reach each computer's vault by a path the sources do not describe. Convergence of replicated state goes only through the merge provider boundary (`src/engine/merge.mjs:27-34`).

Open, needs owner decision:

- Who an administrator is at organisation level, as distinct from the vault's admin token, and how that authority is held and revoked.
- The order in which organisation, project, team, department, location and jurisdiction controls apply, and which may narrow or widen another. Any such table is permission-matrix-shaped and waits on ADR 5. "Location" is not among the scope types of SO-F-01 AC02.
- How an organisation-wide default reaches a local-first vault, and whether it is replicated state, which would need the merge boundary. The sources name no such state.

## Open decisions

Each needs an owner decision before a build contract can be written. Items that are permission-matrix-shaped are marked ADR 5. What the fold covers is not listed here.

1. How the project tag filter relates to membership records, and which one retrieval uses (requirement 1; SO-2.01 entity kinds).
2. Whether jurisdiction as an input is the same as the classes of SO-F-05 AC02 or a separate value set, and who assigns it (requirement 1).
3. Which policy inputs apply at retrieval inside an organisation, who sets them, and whether the evaluation of SO-F-04 AC03 governs it; ADR 4 (requirement 1).
4. The precedence between the five governing inputs; ADR 5 (requirement 1).
5. The place and inputs of the single access decision point, and whether it replaces or sits over the per-method checks (requirement 2).
6. Whether each read path listed under requirement 2 applies the token's paths: claims, provenance by claim, the session card, the graph without a view, and the project store (requirement 2; SO-1.01).
7. What "purpose" means for retrieval inside an organisation (requirement 2).
8. Whether "consent" means the OAuth connection consent, the consent of the person a record is about, or both (requirement 2).
9. How explicit resource permissions are stored; role-by-action rules are ADR 5 (requirement 2).
10. Whether new tokens, devices and organisation-level resources default to deny, and the grant step; the token defaults differ from the ADR 5 safe default (requirement 3).
11. Where enforcement sits for organisation-level retrieval across vaults or projects so that no caller can omit it (requirement 3).
12. Any list of actions denied unless granted; ADR 5 (requirement 3).
13. How the six knowledge kinds relate to the six classes of SO-F-05 AC02, and where each is stored (requirement 4).
14. The sharing rule of each kind; ADR 5, and WP13-01 at a site boundary (requirement 4).
15. Whether a recall snippet, a graph entity name and a claim are covered by SO-F-05 AC03; overlap with SO-2.03 (requirement 4).
16. What makes an artefact confidential (requirement 4).
17. What personal data and restricted material are, and who decides (requirement 5).
18. What "explicitly authorised" and "necessary for the task" mean, and how a retrieval is tied to a task or purpose (requirement 5).
19. Whether secret patterns are applied at retrieval and whether `allow_secrets` stays for organisation-level writes (requirement 5).
20. Who an organisation administrator is, and how that authority is held and revoked (requirement 6).
21. The order in which organisation, project, team, department, location and jurisdiction controls apply, and the place of "location"; ADR 5 (requirement 6).
22. How an organisation-wide default reaches a local-first vault, and whether it needs the merge boundary (requirement 6).
23. Resolved: SO-F-01, SO-F-04 and SO-F-05 are adopted as the build layer for this scope (owner delegation, 1 Nov 2026; the layer row in RECONCILIATION.md).
24. SO-03-A and SO-09-A are signed in the owner's vault and cannot be read from this repository. Their content has to be checked against this record by the owner.
