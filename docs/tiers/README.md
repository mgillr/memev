# Tiers: how each one is set up

> **DRAFT.** Packages and services on these pages are proposals, not offers. Tiers are sold by
> person; a licence sets one thing, how many computers can join a vault
> ([CHARTER.md](../../CHARTER.md)). Free is free and Personal has a set price. Team is contact us
> until member keys ship. Business, Enterprise and every service are priced on your requirements:
> contact us. See [PRICING.md](../PRICING.md).

| | [Free](free.md) | [Personal](free.md#personal-draft) | [Team](team.md) | [Business](sme.md) | [Enterprise](enterprise.md) |
|---|---|---|---|---|---|
| For | one person, one computer | one person, up to 3 computers | 2 to 20 people | from 10 people | organisations with compliance needs |
| How it is counted | one computer | 3 computers | per person: 3 computers and 10 cloud AI connectors each, pooled | per person: 3 computers each, pooled | on your requirements |
| Where Memev runs | your computer | your computers | one shared vault, on a computer or server you choose | a server in your office or your cloud account | your data centre or private cloud, more than one server |
| Who can see what | you | you | the team; a key for each person is planned | departments and roles from your org chart (planned) | the same, plus your identity provider's groups (planned) |
| AI models | whatever your apps use | whatever your apps use | whatever your apps use | cloud models, plus a local model for sensitive departments | the same, or local models only (air-gapped) |
| Price | free | $15/month or $144/year, early-supporter price | contact us until member keys ship | contact us | contact us |
| Setup | you, in minutes | you, in minutes on each computer | you, or a short onboarding | remote, 2 to 4 weeks | remote or onsite, 6 to 12 weeks |
| Support | GitHub issues | priority support | priority support | business hours by priority (support plan quoted with the tier) | named or embedded engineer |
| Status | built | built; hosted sync, backup and relay planned | the shared vault over a secure link works today; member keys planned | planned (the shared vault over a secure link works today) | planned |

Team and Business overlap at 10 to 20 people on purpose: choose by what you need (a company hub,
sign-in, departments and roles), not by size.

Services, remote and onsite work, travel and response times are in [services.md](services.md).

## What is built and what is planned

| Part | Status | Notes |
|---|---|---|
| Vault, recall, graph, hooks, contracts, doctor | built | every tier |
| Quality check, review inbox, audit, `why` | built | every tier |
| Hard project scope, path-limited tokens, graph filtered by path | built | every tier |
| Per-computer and per-app credentials, removal | built | `memev devices`, `memev devices remove <id>` |
| Secure link for cloud AI apps | built | on for personal installs, off for `--org` installs |
| Backup to your own private GitHub repository | built | one writer per vault |
| Several computers using one vault through the secure link | built | per-computer keys, `memev join`; no user accounts |
| Comms bus between AI apps: seats, automatic join, heartbeats, roster, comms checks, tasks and holds | built | every tier; stored in the vault and its own git backup ([BUS.md](../BUS.md)) |
| Offline licence and computer limit | built | each added computer has its own key; the vault refuses computers past the licensed number. One computer needs no licence |
| End-to-end encrypted sync between one person's computers | planned | |
| Hosted encrypted backup | planned | the backup to your own GitHub repository is built |
| Hosted relay with a stable address | planned | the relay protocol and the `memev cloud relay` client are built; the hosted relay is not |
| Member keys: one key per person, covering that person's computers | planned | today each computer has its own key |
| Company hub with user accounts | planned | |
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
  not end-to-end encrypted, and we will not call it that.
- GitHub backup is a copy at GitHub. The vault is pushed as plain Markdown to a private
  repository. Use a self-hosted git server instead if the notes must not leave your network.
- The AI app decides what it asks for. Memev controls what it returns, not what the app does
  with it.
