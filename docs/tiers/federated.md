# Federated (planned)

Part of the [Memev tiers](README.md). Up: the [README](../../README.md). Architecture:
[ARCHITECTURE.md](../ARCHITECTURE.md#federated-tier-planned). Core design:
[FEDERATION.md](../FEDERATION.md).

> **Planned. Not available for purchase or operational deployment.** Federated is the fifth named
> Memev tier. Its product and commercial model are defined here; cross-organisation transport,
> admission, trust exchange, policy enforcement, federated intelligence and computation still
> require implementation and end-to-end acceptance testing. The licence issuer refuses to issue a
> Federated licence until those requirements are met.

## Who it is for

Federated is for independent organisations that need to coordinate work without becoming one
organisation or handing their internal systems and data to a shared central owner. Participants may
include customers, suppliers, manufacturers, engineering partners, contractors, logistics operators,
research institutions, public bodies and industry consortia.

It is distinct from:

- **Business:** one organisation, initially operating through one company node.
- **Corporate:** one organisation coordinating departments, programmes, portfolios and sites across
  jurisdictions.
- **Federated:** multiple independent organisations coordinating selected work and intelligence
  across their own administrative, commercial and jurisdictional boundaries.

## What it is intended to provide

- Participant nodes controlled by the participating organisations.
- Bilateral, signed, scoped, expiring and revocable federation agreements.
- Separate trust roots and local policy approval; no transitive trust.
- Authorised exchange of project and programme work, commitments, specifications, dependencies,
  risks, evidence and permitted query results.
- A shared, evidence-linked programme and portfolio view built from authorised contributions,
  without copying every participant's internal vault into one global database.
- Cross-organisation reasoning that exposes source, version, provenance, freshness, uncertainty and
  accountable owners.
- Operational visibility into participant status, rejected contributions, policy decisions,
  replication freshness and degraded connectivity.
- Optional workload-specific federated analysis, optimisation, simulation, model evaluation or
  learning, each governed by its own execution contract and privacy model.
- Deployment, support and governance scoped to participant count, trust relationships, sites,
  jurisdictions, workload criticality and service requirements.

## Example

A manufacturer in Germany, an engineering partner in Switzerland, a component supplier in Japan, a
logistics operator in the UK and a research institution in the US work on one programme. Each keeps
its own people records, commercial terms, models, source systems and internal projects. They agree
to share only selected specifications, delivery commitments, quality evidence, capacity windows,
dependencies, risks and approved computation results.

Memev's intended shared programme context relates those contributions. A specification change can
be traced to the procurement order, manufacturing plan, cost forecast and delivery commitment that
it may affect. Each finding retains its evidence and owner; it remains a candidate until the
appropriate participant validates it. A partner's internal vault does not become visible merely
because it participates in the programme.

## Commercial model

Federated is a contact-us tier. It is scoped by:

- participating organisations and their operating roles;
- bilateral trust relationships and shared work scopes;
- sites, jurisdictions, residency and processing constraints;
- source systems, adapters and permitted data views;
- project, programme and portfolio complexity;
- federated computation workloads and their threat models;
- deployment topology, resilience, audit and recovery requirements;
- onboarding, support and operational service levels.

It is not priced as a simple number of computers, and it does not imply one shared company vault.

## Governance boundaries

Every participant retains authority over its own node and source data. Access to a shared view does
not confer access to the underlying source. Derived information, indexes, embeddings, model context,
caches, backups and computational outputs remain subject to the relevant source and derivation
policies. Local data processing is not automatically privacy-preserving, and convergence does not
prove truth, authorisation, safety or approval.

Trust is bilateral and non-transitive. Agents may propose grants or work; an authorised person or
operator must approve them under the applicable contract. Revocation stops future authorised
exchange where possible, but cannot recall information already copied or observed outside Memev.

## Licence and availability

The product catalogue recognises Federated, but the current licence format does not yet accept a
Federated licence and the issuer explicitly refuses to create one. This is intentional: the current
licence model counts computers, while Federated commercial terms must also represent participants,
trust relationships, scopes, jurisdictions and workloads. Those entitlements need a separate
contract and acceptance design.

No Federated capability should be sold or represented as live until the relevant implementation,
security review and acceptance criteria in [FEDERATION.md](../FEDERATION.md) and
[FEDERATED-COMPUTATION.md](../FEDERATED-COMPUTATION.md) pass.
