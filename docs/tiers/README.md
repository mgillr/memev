# Tiers: how each one is set up

Part of the [Memev documentation](../README.md). Up: the [README](../../README.md). Charts for all
three tiers: [ARCHITECTURE.md](../ARCHITECTURE.md#the-three-tiers).

> **DRAFT.** Packages and services on these pages are proposals, not offers. The Memev core is free;
> Personal with more computers has a set price. Business, Corporate and the fifth **Federated** tier
> are planned contact-us offers. Licence and service entitlements for those tiers require implementation.
> See [PRICING.md](../PRICING.md).

The owner explicitly superseded the 31 October tier decision on 2 November 2026: the four existing offers remain, and **Federated is added as a fifth named tier** for cross-organisation networks. The original decision remains in the record as historical context; the superseding decision is appended in [DECISIONS.md](../scope-one/DECISIONS.md).

There are five tiers: Personal (one computer), Personal with more computers, Business, Corporate and Federated. The app and licence tooling currently implement only the Personal offers; the higher tiers remain planned.

| | [Personal](free.md) | [Personal with more computers](free.md#personal-with-more-computers-draft) | [Business](business.md) | [Corporate](corporate.md) | Federated |
|---|---|---|---|---|---|
| For | one person, one computer at a time | one person, several computers at once | one organisation; one company vault | one organisation across multiple sites and jurisdictions | multiple independent organisations working together |
| How it is counted | one computer | up to 3 computers | contact us | contact us | contact us; participant organisations and scope |
| Where Memev runs | your computer, backed up to your own GitHub | your computers | company server or managed host (coming) | data centre or private cloud, multiple sites (coming) | participant-controlled nodes and approved federation services (planned) |
| Who can see what | you | you | company members and administrators under company policy (coming) | corporate roles and site policies (coming) | only what each participant's agreement and local policy permits (planned) |
| AI apps and models | supported cloud AI apps and local coding tools via MCP | same, on each computer | providers and tools allowed by organisation policy | same, including on-premises/air-gapped option | each participant chooses permitted providers; cross-org context is policy-scoped |
| Two computers | one at a time; git backup is single-writer | simultaneous multi-computer merge planned | coming | coming | per-node convergence and state exchange planned |
| Several sites | | | one company vault is first release; multi-site service can be scoped | independently operated sites within one organisation (planned) | multiple autonomous organisations with bilateral federation agreements (planned) |
| Price | free | $12/month or $120/year, early-supporter price | contact us | contact us | contact us |
| Trial | no Personal trial | no Personal trial | Business trial planned | sales-assisted pilot planned | scoped pilot planned; no offer until acceptance criteria pass |
| Setup | you, in minutes | you, in minutes on each computer | remote, 2 to 4 weeks | remote or onsite, 6 to 12 weeks | multi-party discovery, policy and integration plan; scoped |
| Support | GitHub issues | priority support | business-hours support | named or embedded engineer | agreed federation operations and support model |
| Status | built | built for current capabilities; convergence and hosted services planned | coming | coming | planned; not operational end to end |

Business and Corporate address work within one organisation: Business begins with one company node; Corporate extends that organisation across sites, programmes and jurisdictions. Federated is different: participants remain independent organisations with separate authorities, and share only what their bilateral agreements and local policies permit. Every tier is provider-neutral. Members use the AI providers and tools their organisation's policy allows. All three organisational tiers are planned.

The paid parts all rest on one engine, crdt-merge, which is not in this repository:
see [CONVERGENCE.md](../CONVERGENCE.md).

Services, remote and onsite work, travel and response times are in [services.md](services.md).

Planned add-ons and services, and the custom module use cases, are in [the add-ons roadmap](../roadmap/add-ons.md).

## Several sites and federation (planned)

Nothing in this section is built. The architectural target is a federation of independently
operated site nodes: each site owns its node and its memory, sites converge the state they are
authorised to share through the convergence engine under its contract, and no central coordinator
sequences ordinary updates. The company vault and the main corporate vault above are the one-node
case of that target, and the one-node case is what the first Business release ships.

Corporate covers federation across sites within one organisation. Business may separately scope a multi-site service. Cross-organisation federation is the fifth tier, Federated, and is not interchangeable with either of those offers. The trust service and the
admission service that the federation pages name are planned adapter boundaries beside the merge
boundary ([EXTENSION-POINTS.md](../EXTENSION-POINTS.md)). The pages:
[FEDERATION.md](../FEDERATION.md), [ORGANISATIONAL-INTELLIGENCE.md](../ORGANISATIONAL-INTELLIGENCE.md),
[FEDERATED-COMPUTATION.md](../FEDERATED-COMPUTATION.md) and
[DATA-SOVEREIGNTY.md](../DATA-SOVEREIGNTY.md); the architecture chart is in
[ARCHITECTURE.md](../ARCHITECTURE.md#several-sites-and-federation-planned).

## Personal and company vaults never mix

A personal or home vault never crosses into a business or corporate vault. They have separate
identities and separate keys, and there are no grants, mounts or mixing between them. An AI app that
works in both reaches each one on its own terms; nothing moves from one to the other by itself.

## When someone leaves a company

Anyone who leaves a company loses all vault access:

- access ends
- keys are revoked
- devices are removed
- the local cache is wiped
- what the member synced stays in the company vault

This is planned, with Business and Corporate. Memev cannot recall what a person has already read or
copied outside Memev.

## What is built and what is planned

| Part | Status | Notes |
|---|---|---|
| Vault, recall, graph, hooks, contracts, doctor | built | every tier |
| Quality check, review inbox, audit, `why` | built | every tier |
| Hard project scope, path-limited tokens, graph filtered by path | built | every tier |
| Per-computer and per-app credentials, removal | built | `memev devices`, `memev devices remove <id>` |
| Secure link for cloud AI apps | built | optional and off by default on every install: `memev init` offers it once, `memev cloud on` and `memev cloud off` switch it; an `--org` install needs `memev cloud on --yes` |
| Backup to your own private GitHub repository | built | git sync is single-writer backup: a second computer that pushes gets a warning that concurrent edits can conflict (shown in `memev doctor`), and nothing is blocked. A new computer can join the backup repository from `memev init` |
| Several computers using one vault through the secure link | built | per-computer keys, `memev join`; no user accounts |
| Comms bus between AI apps: seats, automatic join, heartbeats, roster, comms checks, tasks and holds | built | every tier; stored in the vault and its own git backup ([BUS.md](../BUS.md)) |
| Offline licence and computer limit | built | each added computer has its own key; the vault refuses computers past the licensed number. One computer needs no licence. Counting once per organisation, by person and by computer, is planned with Business |
| End-to-end encrypted sync between one person's computers | planned | |
| Concurrent edits on several computers merged with nothing to resolve | planned | done by the crdt-merge convergence engine, which lives in its own repository under its own licence and which Memev calls as an external dependency; it is never vendored into this repository, and the free core does not do this merging itself ([CONVERGENCE.md](../CONVERGENCE.md)) |
| Hosted encrypted backup | planned | the backup to your own GitHub repository is built |
| Hosted relay with a stable address | planned | the relay protocol and the `memev cloud relay` client are built; the hosted relay is not |
| Member keys: one key per person, covering that person's computers | planned | today each computer has its own key |
| One company vault that all members' work data syncs into | planned | Business; Corporate has one main corporate vault. Members keep private work outside Memev |
| Company knowledge comes back down to members' apps | planned | from the company vault to each member's apps |
| Provider policy: restrict the organisation to one provider, egress rules | planned | every tier is provider-neutral; members use the AI providers and tools the organisation's policy allows, over MCP, and a Business or Corporate policy may restrict the organisation to one cloud AI service or one on-premises LLM |
| Company admin console that sees and searches everything | planned | the admin view of the company vault |
| Business trial: 5 members and 10 computers, 14 days with one 14-day extension | planned | self-serve for hosted AI providers or a mix, a sales-assisted pilot for on-premises, air-gapped or compliance-led organisations; the terms are in [BUSINESS-TRIAL.md](../BUSINESS-TRIAL.md) |
| Separate identities and keys for personal and company vaults | planned | no grants, mounts or mixing between them |
| Leaving a company: access ends, keys revoked, devices removed, local cache wiped | planned | what the member synced stays in the company vault |
| Invites from an org admin into the company vault | planned | the only way a teammate joins; there is no Team tier |
| Company server with user accounts | planned | the host of the company vault |
| Sign-in with Google Workspace or Microsoft Entra ID, SCIM | planned | |
| Departments, roles and path grants from an org chart | planned | |
| Labels on notes and rules for what reaches the AI provider | planned | |
| Pseudonymising names and amounts before a cloud AI service | planned | |
| Egress log of what reached the AI provider | planned | |
| Connectors that bring CRM, ticketing and chat data into the vault | planned | AI apps can use those vendors' own MCP servers next to Memev today |
| High-availability servers, air-gapped package | planned | |
| SIEM and audit export, retention rules, legal hold | planned | |
| Project state machine | planned | the code is present in `src/engine/project-state.mjs` and nothing imports it yet ([PROJECTS.md](../PROJECTS.md)) |
| Federation of independently operated site nodes | planned | Corporate, and a Business licence whose services list includes the multi-site federation design ([services.md](services.md)); the company vault is the one-node case and the first release ([FEDERATION.md](../FEDERATION.md)) |
| Federated computation across sites | planned | Corporate, and a Business licence whose services list includes the multi-site federation design; workload-specific algorithms, the engine converges supported state only ([FEDERATED-COMPUTATION.md](../FEDERATED-COMPUTATION.md)) |
| The trust service and the admission service | planned | two adapter boundaries beside the merge boundary, named generically until they are published ([EXTENSION-POINTS.md](../EXTENSION-POINTS.md)) |

Nothing on these pages is sold before it is built. A planned part goes into an offer only with a
delivery date.

## Limits that apply to every tier

- Cloud models are outside Memev's control. Once a note is sent to a cloud AI app or service, the provider
  holds it under its own terms. Memev can decide what is sent; it cannot recall it afterwards.
- The company server can read your notes. To search notes, the server must decrypt them. Encryption
  protects them in transit and on disk, not from the server or whoever runs it. A self-hosted server is
  not end-to-end encrypted, and we will not call it that. The company vault is held there, so
  whoever runs it can read what members promote or share into it.
- GitHub backup is a copy at GitHub. The vault is pushed as plain Markdown to a private
  repository. Use a self-hosted git server instead if the notes must not leave your network.
- The AI app decides what it asks for. Memev controls what it returns, not what the app does
  with it.
