# Memev Strategy

Memev is the provider-neutral operating infrastructure that helps people and organisations adopt AI today and coordinate increasingly autonomous systems tomorrow across applications, functions, sites and independent organisations, without surrendering control of their data, authority or operational state.

Part of the [Memev documentation](docs/README.md). Up: the [README](README.md). Related:
[tiers](docs/tiers/README.md), [architecture](docs/ARCHITECTURE.md), [organisational intelligence](docs/ORGANISATIONAL-INTELLIGENCE.md),
[federation](docs/FEDERATION.md), [data sovereignty](docs/DATA-SOVEREIGNTY.md),
[convergence](docs/CONVERGENCE.md), [pricing](docs/PRICING.md).

> **Strategic direction, not a statement of shipped capability or a forecast.**
> This document maps the long-term market thesis to Memev's existing five-tier model and a
> capability-led adoption sequence. Each feature remains subject to its implementation status,
> contract, security review and acceptance criteria in the relevant product documents.

## Executive thesis

**Memev is provider-neutral operating infrastructure for organisations adopting, coordinating and
governing AI across people, applications, agents, sites and independent organisations.**

AI capability will be developed by many external model laboratories, application providers,
open-source communities and organisations. Memev does not need to predict which provider leads,
which model architecture prevails, or when a particular capability such as superintelligence
arrives. It should enable customers to use the systems they choose while preserving their own
identity, authority, policies, operational state, evidence and sovereignty.

The long-term opportunity is to support two ends of the economic transition:

1. **Adoption and automation:** help individuals and organisations put today's AI systems to work
   across real workflows, rather than leaving each application isolated.
2. **AI-operated economic activity:** enable increasingly capable and autonomous systems to
   coordinate work within organisations and between independent organisations under explicit
   authority, policy and verifiable commitments.

The development of frontier intelligence is an external capability curve, not a Memev product
tier. Memev is the independent operating layer around the models and applications, not a competing
frontier model laboratory.

This thesis is compatible with scenarios such as *AI 2027*, but is not dependent on that scenario,
its dates, or the arrival of superintelligence. It remains relevant if progress is slower, uneven,
regulated differently by jurisdiction, or led by multiple competing providers.

## The three economic-transition stages

These stages describe how customers may adopt AI and how the market may evolve. They are not
predictions, fixed dates, or a claim that every organisation follows the same sequence.

### Stage 1 — Organisations adopt and automate with AI

AI applications and agents are introduced into existing work: software development, research,
engineering, finance, procurement, customer operations, administration and other functions.

The immediate problem is fragmentation. People use different providers and tools; work context,
decisions, permissions, task state and evidence are scattered across applications and departments.

Memev's role is to provide a common operational environment around those tools:

- connect supported AI applications and agents without requiring one model provider;
- maintain authorised shared context and work state;
- coordinate people and agents through communications, tasks and defined work;
- represent identity, permissions, scope and delegated authority;
- preserve provenance and distinguish a reported result from a verified outcome;
- make dependencies, changes, decisions and unresolved work easier to inspect.

The value proposition is not simply automating a task. It is helping an organisation coordinate
the work that automation creates and understand its effects across functions.

### Stage 2 — Frontier AI capability advances

External laboratories and providers develop more capable models, agents, tools and applications.
These systems may become able to perform longer, more complex and more autonomous work.

Memev does not need to train or own those frontier systems. Its strategic role is to remain a
provider-neutral integration and operating environment in which customers can use different
capabilities under their own rules.

The architecture should allow:

- different hosted and locally operated models to participate through supported interfaces;
- providers and applications to be replaced without rebuilding the customer's operational model;
- agents to act through explicit identities, scopes, permissions and delegated authority;
- model outputs to remain distinguishable from accepted facts, approvals and verified evidence;
- execution to be bounded by contracts, policies, review gates and revocation;
- customer data and operational state to remain under the customer's chosen authority.

Frontier providers may build their own orchestration, identity, memory and governance features.
Memev's differentiation must therefore be demonstrated at the boundaries those providers do not
share: cross-provider operation, customer-controlled policy, portable state, independent
organisational authority, federation and verifiable exchange.

Stage 2 is an ecosystem condition that Memev must accommodate. It is not a dependency on a
particular laboratory, model, API or timetable.

### Stage 3 — AI participates in and operates economic functions

As AI systems become more capable, organisations may delegate a growing proportion of operational
and professional functions to agents and automated services. Economic activity will increasingly
involve systems acting across departments, companies, suppliers, customers, infrastructure and
jurisdictions.

The need for governance does not disappear when the human execution of a task is delegated.
Questions of authority, ownership, liability, policy, commitments, evidence, data boundaries,
continuity and dispute resolution become more important.

Memev's intended role is to provide the coordination and trust boundaries for that activity:

- coordinate authorised agents and services across business functions;
- represent commitments, dependencies, approvals and operational state;
- exchange only the information and evidence each participant is permitted to share;
- preserve each organisation's independent identity, policies, trust roots and source ownership;
- support verifiable workflows and workload-specific computation under explicit contracts;
- reconcile authorised distributed state without requiring one global owner or central sequencer;
- provide operational visibility, recovery and audit evidence.

The goal is not to make every organisation dependent on one central Memev-hosted database.
The goal is to make independent systems interoperable while each participant retains meaningful
control.

## Mapping the strategy to Memev's five tiers

The tiers are deployment and commercial scopes, not separate AI maturity levels. A customer may
enter at the tier that matches its current topology and move as its requirements change. All tiers
remain provider-neutral.

| Tier | Customer scope | Stage 1 value | Stage 3 role | Status boundary |
|---|---|---|---|---|
| **Personal — Free Core** | One person, one computer at a time | Connect the person's AI tools around local context, projects, communications and evidence | A personal control and continuity point for the person's AI-assisted or delegated work | Core is built; see [Personal](docs/tiers/free.md) and [CHARTER](CHARTER.md) |
| **Personal with more computers** | One person, up to three computers | Keep the person's tools and work coordinated across devices | Portable personal operating context across devices and providers | Current tier capabilities and price are documented; automatic concurrent merge and hosted services remain planned |
| **Business** | One organisation, initially one company node | Coordinate members, approved AI tools and business work in a company-controlled environment | Govern AI-operated functions within one organisation, with organisational identity, policy and evidence | Coming; company vault, administration and associated services remain planned |
| **Corporate** | One organisation across sites, departments and jurisdictions | Apply organisational controls, deployment policy, audit and resilience across larger operations | Coordinate autonomous operations across independently operated sites while retaining corporate authority and jurisdiction controls | Coming/planned; multi-site federation is not shipped end to end |
| **Federated** | Multiple independent organisations | Establish governed collaboration across suppliers, customers, contractors, research partners and consortia | Coordinate cross-company AI workflows, commitments and authorised computation without merging organisations or their private vaults | Planned; no operational cross-organisation federation or licence issuance until acceptance criteria pass |

### Personal: prove the daily value at the edge

The free Personal tier is the adoption and developer-distribution entry point. It should remain useful in its own right and must not become a crippled demonstration of enterprise features.

Its role is to establish the habit and interface of provider-neutral AI work: one person can use supported tools together while retaining local control of their own vault. The paid multi-computer tier extends that personal scope; it does not turn a personal vault into a company vault.

### Business: make AI operational inside one organisation

Business is the first organisational commercial scope: one organisation, one company vault in the first release, its own policies and approved AI providers. It should make coordinated AI work useful to a real team and provide a credible entry point for enterprise adoption.

Business is not the cross-organisation tier. A supplier or customer does not become part of the company's authority merely because it participates in a workflow.

### Corporate: extend authority across sites and jurisdictions

Corporate addresses one organisation operating across multiple sites, departments, programmes, portfolios and jurisdictions. The deployment may need local site operation, identity integration, audit export, retention, high availability, air-gapped operation and jurisdiction-aware policy.

Corporate federation is intra-organisation: sites remain operationally meaningful, but are governed within the same organisation's authority model. It is distinct from cross-company federation.

### Federated: connect independent economic participants

Federated is the long-term strategic extension from enterprise infrastructure to economic-network infrastructure.

Participants may be manufacturers, suppliers, logistics operators, customers, contractors, research institutions, public bodies or industry consortia. Each participant retains its own node, source data, identity, trust roots, policies and legal responsibilities.

Only explicitly authorised work, commitments, evidence, query results or computation outputs cross the agreed boundary. Trust is bilateral and non-transitive. A shared programme view does not give a participant access to another participant's underlying vault.

This is the tier most directly aligned with the possibility of AI-operated supply chains, industrial networks, research programmes and cross-company services.

## Capability phases and delivery gates

The economic-transition stages above explain the market. The following capability phases describe how Memev should establish the product and earn the right to address that market. They are capability gates, not calendar promises.

### Phase 0 — Establish the personal operating core

**Primary tier:** Personal.

Prove that a user can install Memev, connect supported AI clients, retain useful local context, coordinate sessions and agents, and inspect provenance and work state.

Gate evidence:
- repeatable installation and recovery on supported platforms;
- documented client integrations and working interoperability tests;
- reliable local vault, backup, identity and permission boundaries;
- useful work coordination beyond simple recall;
- clear product status, security documentation and reproducible tests.

### Phase 1 — Extend personal continuity across devices

**Primary tier:** Personal with more computers.

Prove that one person's authorised devices can share state safely and resolve concurrent changes through the separately licensed convergence engine.

Gate evidence:
- stable external engine interface and versioned contract;
- deterministic merge and conflict behaviour under adversarial and reordered inputs;
- device identity, revocation and recovery tests;
- clear separation between free single-computer behaviour and paid multi-computer entitlements;
- deployment and support processes that do not require bespoke engineering for every user.

### Phase 2 — Make one organisation operational

**Primary tier:** Business.

Prove that one company can deploy Memev for a real team, connect its permitted AI providers and business systems, govern access, and coordinate work across functions.

Gate evidence:
- company identity, membership, roles and permission enforcement;
- company vault and administrator controls with explicit data boundaries;
- policy-controlled provider access and auditable egress;
- cross-functional work and dependency scenarios with source-linked evidence;
- independent security review, recovery tests and paid customer deployments.

### Phase 3 — Operate across sites and jurisdictions

**Primary tier:** Corporate.

Prove that one organisation can coordinate independently operated sites without assuming that every site is always connected or that one central service must sequence every ordinary update.

Gate evidence:
- node identity, membership, policy and revocation;
- tested authorised state exchange and convergence across sites;
- partition, outage, replay, recovery and stale-state handling;
- jurisdiction, retention, residency and local-authority controls;
- enterprise observability, audit export and operational support;
- successful multi-site customer deployments.

### Phase 4 — Federate independent organisations

**Primary tier:** Federated.

Prove that two or more independent organisations can complete a useful shared workflow while retaining separate operators, trust roots, policies, source systems and legal responsibilities.

Gate evidence:
- bilateral, scoped, expiring and revocable agreements;
- participant admission and trust validation at each boundary;
- authorised contribution and query exchange with provenance;
- non-transitive trust and explicit human or policy approval for delegated actions;
- workload-specific federated computation with a documented privacy and threat model;
- cross-participant recovery, audit, dispute and exit procedures;
- independently verified end-to-end pilots and a commercial operating model.

No phase is complete because a diagram, interface or partial implementation exists. A capability moves from planned to available only after its implementation, tests, security review and acceptance criteria pass. The status in the tier, architecture and feature documents remains authoritative.

## Architectural responsibilities and boundaries

The strategy depends on keeping distinct responsibilities composable and replaceable.

| Responsibility | Intended role |
|---|---|
| Memev Core | Local operating environment, interfaces, work context, communications, identity and policy integration |
| External AI providers and applications | Model capability, inference and domain-specific applications; selected by the customer |
| CRDT-Merge | External convergence engine called through a controlled boundary; not vendored into Memev |
| E4 and evidence mechanisms | Verifiable records and evidence for defined operations, where integrated and accepted |
| ACFA-RS | Deterministic computation/convergence capability where a defined workload requires it and integration is validated |
| Proofline and contract workflows | Scope, execution conditions, verification and acceptance for defined work |
| Federation services | Membership, admission, trust, policy-scoped exchange, discovery and operational controls |

These components are not interchangeable and do not collectively prove that the full architecture is already integrated. Each integration must have a defined interface, owner, licence, threat model, failure behaviour, conformance suite and acceptance criteria. A component is described as available only where the relevant implementation and tests support that statement.

Convergence is not truth. Evidence integrity is not proof that a claim is correct. A model output is not an approval. A valid identity is not unlimited authority. A local computation is not automatically private. The product must preserve these distinctions at every tier.

## Provider neutrality as a strategic requirement

Provider neutrality is a product and governance property, not a marketing adjective.

Memev should:
- support multiple providers and locally operated models through documented interfaces;
- avoid making customer state dependent on one provider's proprietary memory or agent format;
- let each customer choose, restrict or replace providers under its own policy;
- preserve portable identity, work state, provenance and contracts independently of a model vendor;
- make adapters replaceable and test interoperability through conformance suites;
- avoid granting any provider privileged authority over the customer's Memev environment;
- disclose where a provider receives data, what is retained and which controls remain outside Memev.

Memev may integrate with a provider's proprietary interface, but the customer-facing operating model and the core governance boundary should not depend on that provider remaining dominant or available.

## Market entry and distribution

The product should earn adoption in stages, with a distribution strategy matched to each tier.

1. **Personal adoption:** developer communities, technical publications, open-source distribution, integrations and useful demonstrations. Measure activation, retained use, connected clients and organic recommendation.
2. **Business design partners:** target organisations with fragmented AI use and cross-functional workflows. Sell a measurable pilot, not a general promise of autonomous transformation.
3. **Corporate deployments:** work with enterprise architects, security teams and systems integrators on multi-site, regulated, private and jurisdiction-sensitive deployments.
4. **Federated programmes:** begin with a concrete multi-party workflow in which participants have a reason to share selected commitments or evidence but cannot merge their internal systems.
5. **OEM and ecosystem distribution:** allow AI application providers, enterprise software vendors, cloud/private infrastructure providers and systems integrators to embed or deploy Memev through stable interfaces and commercial agreements.

International expansion should follow repeatable deployments, local legal and data-residency requirements, support capacity and credible partners. Opening offices in many countries is not a substitute for distribution.

## How progress is demonstrated

Progress is demonstrated through working deployments and independently checkable results, not through diagrams or claims of future capability.

- **Technical reliability:** interoperability, deterministic convergence where specified, fault recovery, security and reproducible tests.
- **Operational reliability:** installation, deployment repeatability, recovery, upgrade safety and supportability.
- **Customer value:** consequential workflows completed, measurable improvements, continued use and expansion across functions or sites.
- **Ecosystem reach:** working integrations, documented interfaces and deployments with independent technology and delivery partners.
- **Defensible implementation:** reliable cross-provider operation, customer-controlled state, governed federation and independently validated component boundaries.

A capability is ready to expand when customers can use it reliably and its implementation, security properties and acceptance criteria have been demonstrated.

## Strategic invariants

The following principles should remain true regardless of which AI capabilities arrive or which providers lead:

1. **Provider-neutral:** no single model or application vendor controls the customer's operating environment.
2. **Customer sovereignty:** each person and organisation retains authority over its own data, identities and policies.
3. **Explicit delegation:** agents act within defined scopes and permissions; capability does not imply authority.
4. **Evidence over assertion:** reports, inferences, approvals and verified outcomes remain distinguishable.
5. **Convergence without a global owner:** supported distributed state can reconcile under defined semantics without requiring one central sequencer.
6. **Federation without forced consolidation:** independent organisations share only what they authorise.
7. **Composable architecture:** external engines and services are called through documented boundaries and can be independently tested or replaced.
8. **Honest maturity labels:** planned, in development, tested and available are not interchangeable.
9. **Human accountability:** legal, commercial and safety responsibilities remain assigned to accountable people and organisations, even when execution is delegated to AI.
10. **Capability-led expansion:** each new tier and phase is earned through working deployments and acceptance evidence.

## Positioning statement

**Memev is the provider-neutral operating infrastructure that helps people and organisations adopt AI today and coordinate increasingly autonomous systems tomorrow — across applications, functions, sites and independent organisations, without surrendering control of their data, authority or operational state.**

The strategic destination is operating infrastructure for an AI-enabled economy. The route is to prove useful personal workflows, one organisation, multiple sites and finally independent organisations working together under verifiable agreements.
