# Organisational intelligence

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[Federation](FEDERATION.md), [Projects](PROJECTS.md), [Contracts](CONTRACTS.md),
[Data sovereignty](DATA-SOVEREIGNTY.md).

## Purpose

Memev is intended to maintain an evolving, evidence-linked understanding of authorised work
across an individual, a small business, a multi-site organisation or a federation of independent
organisations.

The unit of understanding is not limited to a chat, a person or a project. Work may be connected
through projects, programmes, portfolios, departments, business functions, suppliers, systems,
sites and organisations. The same model should work from one person's projects through to an
enterprise portfolio.

People continue to use the AI assistants and tools they prefer. Memev provides the shared context,
relationships, state and coordination mechanisms that let independently operating tools and
participants work against the same authorised picture.

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

Convergence is not truth. A converged task state is not proof of completion; a signed statement is
not automatically an authorised approval; a model-generated explanation is not evidence by itself.

## Individual, business and enterprise scale

| Scope | Intelligence context |
|---|---|
| Individual | connect the person's projects, tools, decisions, files and ongoing work across AI sessions and devices |
| Small business | relate projects, customers, suppliers, staff capacity, finance, operations and delivery commitments |
| Multi-site business | identify dependencies across sites and teams while respecting local ownership |
| Enterprise | reason across programmes, portfolios, functions, risk, governance and international sites |
| Cross-organisation | coordinate selected work and commitments between independent participants without merging their private organisational memories |

The graph's scale changes; its underlying concepts of identity, scope, provenance, evidence and
authority do not.

## Status and implementation boundary

The current repository contains a local knowledge graph, project-state and contract mechanisms.
Those are foundations, not proof that a complete enterprise-wide graph or continuous cross-site
reasoning engine is already implemented.

The wider work graph, cross-system dependency discovery, federated queries, impact analysis and
continuous portfolio-level reasoning are architectural targets. They require canonical schemas,
connectors, policy evaluation, provenance, evaluation datasets and measurable precision/recall
criteria.

A first useful implementation should focus on a bounded project or programme: ingest versioned
sources, map explicit dependencies, identify a real change impact, show its evidence and obtain
human validation. Expansion to cross-functional and cross-site reasoning should follow demonstrated
accuracy and safe authority handling.
