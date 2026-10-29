# Tiers: how each one is set up

Part of the [Memev documentation](../README.md). Up: the [README](../../README.md). Charts for all
three tiers: [ARCHITECTURE.md](../ARCHITECTURE.md#the-three-tiers).

> **DRAFT.** Packages and services on these pages are proposals, not offers. A licence sets one
> thing, how many computers can join a vault ([CHARTER.md](../../CHARTER.md)). The Memev core is
> free. Personal with more computers has a set price. Business and Corporate are coming and have no
> public price: contact us. See [PRICING.md](../PRICING.md).

There are four tiers: Personal (one computer), Personal with more computers, Business and Corporate.
There is no Team tier. Teammates belong on the business side: an org admin invites members into the
company vault.

| | [Personal](free.md) | [Personal with more computers](free.md#personal-with-more-computers-draft) | [Business](business.md) | [Corporate](corporate.md) |
|---|---|---|---|---|
| For | one person, one computer at a time | one person, several computers at once | a company: all members' work data in one company vault that the company can see and search | the same model as Business, at larger scale, with one main corporate vault |
| How it is counted | one computer | up to 3 computers | once per organisation, by person and by computer | once per organisation, by person and by computer |
| Where Memev runs | your computer, backed up to your own GitHub | your computers | a server in your office or your cloud account, or cloud-hosted on a host the operator manages ([deploy-cloud.md](../deploy-cloud.md), [deploy-on-prem.md](../deploy-on-prem.md); both coming) | your data centre or private cloud, more than one server (coming) |
| Who can see what | you | you | the company, through the admin console, sees and searches everything in the company vault (coming) | the same, plus your identity provider's groups (coming) |
| AI apps and models | several cloud AI apps side by side (Claude, ChatGPT; more coming soon) and local coding tools via MCP | the same, on each computer | ONE AI provider for the organisation: one cloud AI service or an on-premises LLM, over MCP (coming) | the same, with an air-gapped on-premises option (coming) |
| Two computers | one at a time: you switch computers through your own GitHub. Git sync is single-writer backup, so a second computer that pushes gets a warning that concurrent edits can conflict | at once: edit on two machines, nothing to resolve. The crdt-merge convergence engine, in its own repository and called as an external dependency, does the merging (planned) | coming | coming |
| Price | free | $12/month or $120/year, early-supporter price | contact us | contact us |
| Trial | no Personal trial | no Personal trial | time-limited trial: 5 members and 10 computers, 14 days with one 14-day extension; self-serve for hosted AI providers or a mix, a sales-assisted pilot for on-premises, air-gapped or compliance-led organisations (planned); the terms: [BUSINESS-TRIAL.md](../BUSINESS-TRIAL.md) | a sales-assisted pilot (planned) |
| Setup | you, in minutes | you, in minutes on each computer | remote, 2 to 4 weeks | remote or onsite, 6 to 12 weeks |
| Support | GitHub issues | priority support | business hours by priority (support plan quoted with the tier) | named or embedded engineer |
| Status | built | built; the convergence engine, hosted sync, backup and relay planned | coming | coming |

Business and Corporate are one model at two scales. Every member's computer syncs its work data into
one vault: the company vault for Business, the main corporate vault for Corporate. The company sees
and searches everything in it, and company knowledge comes down to each member's apps. The organisation
connects to one AI provider. Members keep private work outside Memev. Both are marked coming.

The paid parts all rest on one engine, crdt-merge, which is not in this repository:
see [CONVERGENCE.md](../CONVERGENCE.md).

Services, remote and onsite work, travel and response times are in [services.md](services.md).

Planned add-ons and services, and the custom module use cases, are in [the add-ons roadmap](../roadmap/add-ons.md).

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
| One AI provider per organisation, over MCP | planned | one cloud AI service or an on-premises LLM, Business and Corporate |
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
