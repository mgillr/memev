# Tiers: how each one is set up

> **DRAFT.** Packages and services on these pages are proposals, not offers. A licence sets one
> thing, how many computers can join a vault ([CHARTER.md](../../CHARTER.md)). Free is free;
> Business, Enterprise and every service are priced on your requirements: contact us. See
> [PRICING.md](../PRICING.md).

| | [Free](free.md) | [Business](sme.md) | [Enterprise](enterprise.md) |
|---|---|---|---|
| For | one person | a company with 10 to 20 computers | larger or regulated organisations |
| Where Memev runs | your computer | a server in your office or your cloud account | your data centre or private cloud, more than one server |
| Who can see what | you | departments and roles from your org chart (planned) | the same, plus your identity provider's groups (planned) |
| AI models | whatever your apps use | cloud models, plus a local model for sensitive departments | the same, or local models only (air-gapped) |
| Price | free | contact us | contact us |
| Setup | you, in minutes | remote, 2 to 4 weeks | remote or onsite, 6 to 12 weeks |
| Support | GitHub issues | business hours by priority (support plan quoted with the tier) | named or embedded engineer |
| Status | built | planned (the shared vault over a secure link works today) | planned |

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
