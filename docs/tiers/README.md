# Tiers: how each one is set up

> **DRAFT.** Packages and services on these pages are proposals, not offers. A licence sets one
> thing, how many computers can join a vault ([CHARTER.md](../../CHARTER.md)). Personal on one
> computer is free. Personal with more computers has a set price. Business and Corporate are coming,
> and are priced on your requirements: contact us. See [PRICING.md](../PRICING.md).

There are four tiers: Personal (one computer), Personal with more computers, Business and Corporate.
There is no Team tier. Teammates belong on the business side: an org admin invites members into the
company vault.

| | [Personal](free.md) | [Personal with more computers](free.md#personal-with-more-computers-draft) | [Business](business.md) | [Corporate](corporate.md) |
|---|---|---|---|---|
| For | one person, one computer at a time | one person, several computers at once | a company: every member has a work vault, and the company has a shared vault | the same model as Business, at larger scale |
| How it is counted | one computer | up to 3 computers | per member | on your requirements |
| Where Memev runs | your computer, backed up to your own GitHub | your computers | a server in your office or your cloud account (coming) | your data centre or private cloud, more than one server (coming) |
| Who can see what | you | you | each member sees their own work vault and the company vault as the org admin allows (coming) | the same, plus your identity provider's groups (coming) |
| Two computers | one at a time: you switch computers through your own GitHub. Git sync is single-writer backup, so a second computer that pushes gets a warning that concurrent edits can conflict | at once: edit on two machines, nothing to resolve. A separately licensed merge engine, outside this repository, does the merging (planned) | coming | coming |
| AI models | whatever your apps use | whatever your apps use | cloud models, plus a local model for sensitive departments | the same, or local models only (air-gapped) |
| Price | free | $15/month or $144/year, early-supporter price | contact us; a Business trial is planned | contact us |
| Setup | you, in minutes | you, in minutes on each computer | remote, 2 to 4 weeks | remote or onsite, 6 to 12 weeks |
| Support | GitHub issues | priority support | business hours by priority (support plan quoted with the tier) | named or embedded engineer |
| Status | built | built; the merge engine, hosted sync, backup and relay planned | coming | coming |

Business and Corporate are one model at two scales. Each member has a work vault inside the company,
and the company has a shared vault. The two interact in two directions: a member promotes or shares
a note up into the company vault, and company knowledge comes down to the member. Both are marked
coming.

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
- the work vault stays with the company

This is planned, with Business and Corporate. Memev cannot recall what a person has already read or
copied outside Memev.

## What is built and what is planned

| Part | Status | Notes |
|---|---|---|
| Vault, recall, graph, hooks, contracts, doctor | built | every tier |
| Quality check, review inbox, audit, `why` | built | every tier |
| Hard project scope, path-limited tokens, graph filtered by path | built | every tier |
| Per-computer and per-app credentials, removal | built | `memev devices`, `memev devices remove <id>` |
| Secure link for cloud AI apps | built | optional: `memev cloud on` and `memev cloud off`; an `--org` install starts with it off |
| Backup to your own private GitHub repository | built | git sync is single-writer backup: a second computer that pushes gets a warning that concurrent edits can conflict (shown in `memev doctor`), and nothing is blocked. A new computer can join the backup repository from `memev init` |
| Several computers using one vault through the secure link | built | per-computer keys, `memev join`; no user accounts |
| Comms bus between AI apps: seats, automatic join, heartbeats, roster, comms checks, tasks and holds | built | every tier; stored in the vault and its own git backup ([BUS.md](../BUS.md)) |
| Offline licence and computer limit | built | each added computer has its own key; the vault refuses computers past the licensed number. One computer needs no licence |
| End-to-end encrypted sync between one person's computers | planned | |
| Concurrent edits on several computers merged with nothing to resolve | planned | done by a separately licensed merge engine that Memev calls; the engine is not part of this repository, and the free core does not do this merging itself |
| Hosted encrypted backup | planned | the backup to your own GitHub repository is built |
| Hosted relay with a stable address | planned | the relay protocol and the `memev cloud relay` client are built; the hosted relay is not |
| Member keys: one key per person, covering that person's computers | planned | today each computer has its own key |
| A work vault for each member and a shared company vault | planned | Business and Corporate, marked coming |
| Promote and share up, company knowledge down | planned | between a member's work vault and the company vault |
| Separate identities and keys for personal and company vaults | planned | no grants, mounts or mixing between them |
| Leaving a company: access ends, keys revoked, devices removed, local cache wiped | planned | the work vault stays with the company |
| Invites from an org admin into the company vault | planned | the only way a teammate joins; there is no Team tier |
| Company hub with user accounts | planned | the host of the company vault |
| Sign-in with Google Workspace or Microsoft Entra ID, SCIM | planned | |
| Departments, roles and path grants from an org chart | planned | |
| Labels on notes and local-model-only routing | planned | |
| Pseudonymising names and amounts before cloud models | planned | |
| Egress log of what reached each cloud app | planned | |
| Connectors that bring CRM, ticketing and chat data into the vault | planned | AI apps can use those vendors' own MCP servers next to Memev today |
| High-availability hub, air-gapped package | planned | |
| SIEM and audit export, retention rules, legal hold | planned | |

Nothing on these pages is sold before it is built. A planned part goes into an offer only with a
delivery date.

## Limits that apply to every tier

- Cloud models are outside Memev's control. Once a note is sent to a cloud AI app, the provider
  holds it under its own terms. Memev can decide what is sent; it cannot recall it afterwards.
- The company hub can read your notes. To search notes, the hub must decrypt them. Encryption
  protects them in transit and on disk, not from the hub or whoever runs it. A self-hosted hub is
  not end-to-end encrypted, and we will not call it that. The company vault is held there, so
  whoever runs it can read what members promote or share into it.
- GitHub backup is a copy at GitHub. The vault is pushed as plain Markdown to a private
  repository. Use a self-hosted git server instead if the notes must not leave your network.
- The AI app decides what it asks for. Memev controls what it returns, not what the app does
  with it.
