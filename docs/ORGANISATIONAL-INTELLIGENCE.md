# Organisational intelligence (planned)

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[Federation](FEDERATION.md), [Projects](PROJECTS.md), [Contracts](CONTRACTS.md),
[Data sovereignty](DATA-SOVEREIGNTY.md).

> **Planned. Architectural target, not shipped code.** The local knowledge graph and the contracts
> are built; everything that crosses a site or an organisation on this page rests on the planned
> federation ([FEDERATION.md](FEDERATION.md)) and carries the planned label.

## Purpose

Memev is intended to maintain an evolving, evidence-linked understanding of authorised work
across one person, a business, a multi-site organisation (planned) or a federation of independent
organisations (planned).

The unit of understanding is not limited to a chat, a person or a project. Work may be connected
through projects, programmes, portfolios, departments, business functions, suppliers, systems,
sites and organisations. The same model should work from one person's projects through to a
corporate portfolio.

People continue to use the AI assistants and tools they prefer. Memev is meant to provide the shared
context, relationships, state and coordination mechanisms that let independently operating tools
and participants work against the same authorised picture (planned beyond one vault).

## The work model

The intended canonical work graph can represent:

- people, roles, teams and organisational units;
- AI agents, service identities, devices and delegated capabilities;
- projects, programmes, portfolios and workstreams;
- tasks, milestones, deliverables and dependencies;
- requirements, constraints, interfaces and technical artefacts;
- decisions, approvals, assumptions and unresolved questions;
- procurement, budgets, commercial commitments and delivery obligations;
- risks, issues, incidents and change requests;
- evidence, provenance, versions, verification and ownership;
- sites, jurisdictions, organisations and federation relationships.

The graph connects information that remains in different systems. It does not require every source
document or database to be copied into one central repository. A node may hold the source, a
permitted projection, a reference, a verified summary or a query interface, depending on policy.

## Cross-functional reasoning

Memev should be able to detect when a change in one work area may affect other work areas, even
when the participants did not manually connect them.

Example: a project updates a component's dimensions and thermal constraints. Another project
contains an installation plan that depends on the previous dimensions. A programme milestone,
procurement order and portfolio delivery commitment may also depend on the old specification.

The system should:
1. identify the changed source and exact version;
2. locate related requirements, artefacts, tasks and commitments;
3. distinguish direct evidence from inferred relationships;
4. calculate or explain potential downstream effects;
5. identify owners and the decisions that may be required;
6. present the evidence, uncertainty and last-confirmed time;
7. request validation where the relationship or consequence is not proven;
8. track the accepted resolution and its effect on dependent work.

The same reasoning applies outside engineering: a procurement change can affect finance and
delivery; a staffing change can affect capacity and programme dates; a contractual change can
affect sales commitments, operations and compliance.

## Evidence and authority

Memev must not silently convert a hypothesis into a fact or change an approved commitment merely
because an agent inferred a dependency.

Every important relationship should carry its basis: source references, versions, timestamps,
provenance, confidence or verification status, and the identity or process that accepted it.
Inferred dependencies remain hypotheses until validated by an authorised person or an approved
verification process.

The finding model below is where this rule is written down for the graph: a finding is a claim that evidence alone caps at theory.

Convergence is not truth. A converged task state is not proof of completion; a signed statement is
not automatically an authorised approval; a model-generated explanation is not evidence by itself.

## Personal, Business and Corporate scale

| Scope | Intelligence context |
|---|---|
| Personal | connect the person's projects, tools, decisions, files and ongoing work across AI sessions and computers |
| Business, one node | relate projects, customers, suppliers, staff capacity, finance, operations and delivery commitments in the one company vault (coming) |
| Business, several sites (planned, with the multi-site federation design) | identify dependencies across sites and teams while respecting local ownership |
| Corporate (planned) | reason across programmes, portfolios, functions, risk, governance and international sites |
| Cross-organisation federation (planned) | coordinate selected work and commitments between independent participants without merging their private organisational memories |

The graph's scale changes; its underlying concepts of identity, scope, provenance, evidence and
authority do not.

## The finding model

How a shared workspace can notice something across otherwise independent work without becoming an unbounded inference engine. This section defines the one record the layer produces, a finding, and the three events that let people dismiss, correct and decide it. The code is the finding part of `src/engine/graph.mjs`, and `test/findings.test.mjs` pins what is written here.

The model is the first built piece of the evidence-and-authority rule above: what the layer produces is a finding, which evidence can take no further than theory, and which a person or a verification record has to confirm before it counts as a fact.

### Status of the finding model

Planned. The finding model is built and tested as a data model on the memory graph: raising, dismissing, correcting, adjudicating and verifying a finding are graph operations, a reader sees a finding only as far as their scope allows, and `resolveActor` with `Graph.bindFindingEvent` make the operations from a credential. Nothing raises a finding yet, and nothing calls that entry point: the vault does not write finding operations, so the step that makes `by` trustworthy in a running product is unbuilt (see "The cap and who counts"). No code watches work across projects, detects a conflict or a link, ranks findings or routes a decision; that detection, with its precision and recall, is the next contract (SO-F-13) and stays an architectural target until it lands. The product does not offer this layer today, and the names and shapes here may change before it does.

### What a finding is

A finding is a claim in the memory graph, the same claim `src/engine/graph.mjs` already holds for `memev_claim`, with more attached to it:

- the source events it rests on, each with the version of the record it was read at, and the scope that record lives in;
- the entities it affects and the owners who would act on it, each tied to the source it came from, or to the finding as a whole;
- its own scope, and a time context (from, and until or open);
- a confidence between 0 and 1 set by whatever raised it. The confidence is advice to a reader. It does not set the status.

The status is the claim status the graph already derives: conjecture, theory, fact, contested or refuted. Findings are stored as claims, so they are saved with the graph snapshot and rebuilt from the log the same way.

### The cap and who counts

For an ordinary claim, support of 0.85 or more from at least two independent sources, with opposition under 0.2, makes it a fact. That rule is unchanged.

For a finding, evidence alone stops at theory, however strong and however many the sources. A finding is a fact only when a person has confirmed it (an adjudication) or a verification record has passed. Contested and refuted stand as the graph derives them from the evidence, because the cap guards the step to fact and nothing else. The same evidence on an ordinary claim and on a finding therefore gives fact and theory.

Who counts is decided from the subject named in the event, and that subject is meant to come from a credential, not from what a session says about itself:

- an adjudication takes effect only from a person subject (SO-F-01). The same event from an agent, a device, a node, an operator or a service is recorded and does nothing;
- a verification record names an `outcome.verified` event and a result. It must name one of the source events the finding rests on, or it is refused and nothing is recorded. It takes effect only when the result is a pass, it comes from a person, operator or service subject, and no person's decision stands (below). A failed result, or one from an agent, is recorded and does nothing;
- a status change written straight to the log does not set a finding's status. It is derived, so the log cannot be used to skip the cap;
- the latest effective decision stands, with one rule: a verification never replaces a person's decision. After a person's rejection a passing verification from a service is recorded and does nothing, and the finding stays refuted. Only a person can change a person's decision, so a later confirmation makes it a fact;
- a decision stands over the evidence. A person's confirmation makes the finding a fact even when the evidence against it is strong (opposition of 0.99, say), and a rejection makes it refuted even when the evidence is strong enough for a fact. The status then says it overrode the evidence: `overridden` holds the status the evidence implied (refuted, contested or fact). This is provisional until the knowledge status lattice of PG-10.1 lands, where such a case may need its own state.

**Where `by` comes from.** The graph sets it from the resolved credential, and ignores any `by` the caller passes. `resolveActor` (`src/engine/identity.mjs`) resolves a credential to an actor: what `tokens.verify` returned for a request that is already verified, or a role binding that `agentid-bind.mjs` verified. `Graph.bindFindingEvent(actor, type, data)` is the one credential-bound entry point. It builds the operation a writer appends (`claim.finding` to raise, or one of the four events), sets `by` to the actor's subject, and refuses an actor that `resolveActor` did not make, one that did not resolve included (`no_credential`), so an `{ ok: true, subject, scope }` built by hand records nothing. It refuses a credential that does not reach the finding's scope; a finding it cannot reach is reported as not found, the same as a missing one. The same actor is the reader `viewFinding` and `listFindings` take.

`resolveRequest` is as it was: it maps every token with no identity scope, an agent's included, to the owner person. `resolveActor` does not: a token of the personal scope that names an agent resolves, through `resolveBinding`, to the agent subject `agent:<name>` owned by `person:owner`, and its adjudications are recorded and do nothing. A personal-scope credential that carries a person subject is that person. Any other scope resolves as `resolveRequest` does, to the subject the credential names, so a person comes from a credential that names one. A role binding is an agent subject owned by the person who vouched for it, so its decisions do nothing as well.

**What is unbuilt.** `resolveActor` does not authenticate a credential, and nor does the graph: it trusts that the token or binding it is given was verified by the boundary that received it. The log is replayed as it was written, so a record that did not come through `bindFindingEvent` carries whatever `by` its writer set, and is as trusted as the log file. Nothing in the product writes these operations yet and no module outside `graph.mjs` names them; when a writer does, it must call `bindFindingEvent`, and until it does the guarantee holds only for callers that use them. A source event named in a finding is the raiser's claim and is not looked up in the log.

### The three events

Each is an append-only operation in the same log as claims, named for what it does. Nothing is deleted; each leaves an entry in the finding's own history with who acted, when, an optional reason and whether it took effect.

- **Dismissal** (`claim.finding.dismiss`). A person or an operator says a finding is not wanted (provisional, see below). A dismissal from any other subject, an agent or a service included, is recorded in the history and changes nothing, so the finding stays in the listing and can be raised again. A dismissed finding leaves the default listing and stays in the record. A finding raised later on the same set of sources at the same versions, in the same scope, is not taken in again, in any order of the sources, and nothing undoes a dismissal. A new version of a source, a different source, an extra source or another scope is new evidence and may raise a finding again. The refusal says that a dismissal exists and does not name the finding that was dismissed.
- **Correction** (`claim.finding.correct`). Changes the statement (subject, predicate, object), the confidence, the time context, or the entities and owners. The history entry holds each changed field with its old and new value. Sources and scope are provenance and cannot be corrected: a finding on other sources is a new finding.
- **Adjudication** (`claim.finding.adjudicate`). A decision, confirm or reject, with a reason. It sets the status as described under the cap when a person makes it.

Verification (`claim.finding.verify`) is a separate record, not one of the three. It is how a passing verification record reaches a finding without a person.

### What is provisional

These are placeholders until the decisions that own them land, and they may change with them:

- **Who may adjudicate, verify and dismiss.** One frozen table, `FINDING_AUTHORITY` in `src/engine/graph.mjs`, holds the rules, and each of the three reads its rule from it, so deciding them changes one place. An adjudication counts from a person, a verification from a person, an operator or a service, and a dismissal from a person or an operator. This is provisional until ADR 5 (the permission matrix) and SO-A-05 (the decision workflow) are decided. Correcting a finding is not in the table: any subject may, which is provisional too. The service and operator subjects cannot be issued yet, so today a passing verification or a dismissal comes from a person. A dismissal is permanent for its sources, versions and scope, so one careless dismissal blocks the finding until a source changes; that is the reason to settle ADR 5 before anything raises findings.
- **The confirm and reject outcomes.** They are in `FINDING_AUTHORITY` as the outcomes of an adjudication, and stand in for the seven decision states of the decision queue (SO-A-05, SO-1.08), which are not in code yet. When they land, adjudication moves onto them.
- **A decision over the evidence** (`overridden`), as above, until the knowledge status lattice of PG-10.1.

### What a reader sees

A finding never discloses a record its reader has no permission for. Permission is the scope rule of SO-F-01: a reader's scope reads a source only when it is that source's scope.

- A reader whose scope does not reach the finding's scope gets nothing: not the finding, and not a hint that one exists. A missing finding and a forbidden one look the same. A reader is the actor `resolveActor` returned; any other object gets nothing.
- A reader who may read every source sees the finding whole: its id, the statement, the sources with their versions and paths, the status (and `capped` and `overridden`), the confidence, the time context, whether it was dismissed, and the full history.
- A reader who may read only some sources gets a partial view, and it fails closed. It shows the finding's scope, those sources, how many are withheld, and the entities and owners drawn from them. Everything drawn from the whole of the sources is withheld, because the status, the confidence and the id (which the raiser chose, and may have named after the statement) say as much as the statement does: the id, statement, status, `capped`, `overridden`, confidence, time context and dismissed flag are all null, and the history keeps only the kind and time of each entry, not who acted, whether it took effect, the outcome, the reason or the correction. An entity or owner tied to the finding as a whole, with no source, counts as drawn from all of them, so it is shown only in a whole view.
- A listing applies its status filter and its dismissed filter to whole views only, because a partial view shows neither. A partial view is listed whatever the filter says, so a filter cannot be used to find out what it withholds. A partial view has no id, so a reader who needs the finding's id asks a reader that may read every source.

This is a view over the graph. The ordinary claim listing and provenance calls of the vault do not know about it and are not changed here, so nothing may raise a finding through them until they route through this view.

### What the finding model does not do

- Detecting anything: conflicts, links between projects, decision routing, precision and recall (SO-F-13).
- A fact lattice. The knowledge status lattice is owned by the programme package that defines it; when it lands, the cap here maps into it as at most corroborated.
- Any merge engine. Findings travel as operations like any other graph operation, and convergence stays behind the provider boundary of `src/engine/merge.mjs`.
- A second store. Findings live in the vault's graph.

### Change log

- Version 1: the finding model, the cap, the four events and the scoped view.

## Status and implementation boundary

The current repository contains a local knowledge graph and the contract mechanisms (built). The
project state machine is planned: its code is present in `src/engine/project-state.mjs` and
nothing imports it yet ([PROJECTS.md](PROJECTS.md)). The finding model ([above](#the-finding-model)) is built and tested as a data model on the local graph, and nothing raises a finding yet. Those are foundations, not proof that a
complete organisation-wide graph or continuous cross-site reasoning engine is already implemented.

The wider work graph, cross-system dependency discovery, federated queries, impact analysis and
continuous portfolio-level reasoning are architectural targets, all planned. They require
canonical schemas, source adapters, policy evaluation, provenance, evaluation datasets and
measurable precision/recall criteria.

A first useful implementation should focus on a bounded project or programme: ingest versioned
sources, map explicit dependencies, identify a real change impact, show its evidence and obtain
human validation. Expansion to cross-functional and cross-site reasoning should follow demonstrated
accuracy and safe authority handling.
