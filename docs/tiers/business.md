# Business (coming)

Part of the [tiers pages](README.md). Up: the [README](../../README.md). Architecture chart:
[ARCHITECTURE.md](../ARCHITECTURE.md#business-coming).

> **DRAFT and coming.** Business is not built yet: the company vault, the admin console, the company
> server, sign-in with Google or Microsoft, departments, labels, pseudonymising and the egress log are
> all planned. Several computers can already share one vault through the secure link with a
> credential each; see the [status table](README.md#what-is-built-and-what-is-planned). A Business
> trial is planned: 5 members and 10 computers, 14 days with one 14-day extension. The terms are in
> [BUSINESS-TRIAL.md](../BUSINESS-TRIAL.md).

For a company that wants one memory for its members and their AI apps, on its own server, with the
company able to see and search what its members' AI apps have learned.

Corporate extends this model across multiple sites within one organisation. Federated is the separate fifth tier for independent organisations that need governed cross-organisation work and intelligence; participants do not merge into one company vault. See [Corporate](corporate.md) and [Federation](../FEDERATION.md).

## How it works

Every member's computer runs Memev and the member's local AI tools, which reach it over MCP. The
work data of all members syncs into **one company vault**. The company can see and search everything
in it through the company admin console. Members keep private work outside Memev.

Every tier is provider-neutral. Members use the AI providers and tools the organisation's policy
allows, cloud AI services or an on-premises LLM, over MCP. An organisation may restrict itself to
**one provider by policy**, with egress rules and labels (planned); the policy is the organisation's,
not one choice per member.

```mermaid
flowchart LR
    subgraph members["Members' computers"]
        subgraph a["Member computer"]
            ma["Memev app"]
            ta["Local tools"]
            ta <-->|MCP| ma
        end
        subgraph b["Member computer"]
            mb["Memev app"]
            tb["Local tools"]
            tb <-->|MCP| mb
        end
        subgraph c["Member computer"]
            mc["Memev app"]
            tc["Local tools"]
            tc <-->|MCP| mc
        end
    end
    cv[("ONE company vault")]
    admin["Company admin console<br/>sees and searches everything"]
    provider["AI providers the organisation's policy allows<br/>cloud AI services or an on-premises LLM<br/>(a one-provider policy: planned)"]
    engine["crdt-merge convergence engine and relay<br/>separate repository, external dependency<br/>(paid): merges edits"]
    lic["Licence server<br/>licence information only,<br/>no vault data"]
    ma & mb & mc -->|"work data syncs in"| cv
    cv -->|"company knowledge"| ma & mb & mc
    cv <--> admin
    cv <-->|"MCP"| provider
    cv <-.->|"merge"| engine
    cv -.->|"licence only"| lic
```

The architecture overview, including the Federated tier, is in [ARCHITECTURE.md](../ARCHITECTURE.md#personal-business-and-corporate). The merge
engine is crdt-merge, in its own repository and never part of Memev; see
[CONVERGENCE.md](../CONVERGENCE.md). An org admin invites members into the company vault. There is no Team
tier: teammates belong here, on the business side.

### One company vault

There is one company vault, not a vault for each member. What members' AI apps learn at work syncs
into it, and what the company knows comes back down to each member's apps. Because it is one vault,
the company can see and search everything in it. Members keep private work outside Memev: anything a
member does not want the company to see does not go through Memev on a work computer.

### One AI provider

Memev does not choose a provider for the organisation. Members use the AI providers and tools the
organisation's policy allows, over MCP, and an organisation may restrict itself to one provider by
policy, with egress rules and labels (planned). The two common policies:

| Policy | What it means |
|---|---|
| Hosted AI providers allowed | members' AI apps call the hosted providers the policy allows, with the organisation's keys, next to the company vault over MCP; a self-serve trial is planned for this case |
| Only an on-premises LLM | a model the organisation runs itself, and nothing else; air-gapped and compliance-led organisations choose this, and get a sales-assisted pilot |

### Personal vaults stay out

A member's personal or home vault never crosses into the company. It has its own identity and keys,
and the company side has its own. There are no grants, mounts or mixing between them.

### When a member leaves

Someone who leaves the company loses all vault access. Their access ends, their keys are revoked,
their devices are removed and the local cache on those devices is wiped. What they synced stays in
the company vault. Memev cannot recall what the person already read or copied outside it.

### Several sites (planned)

The company vault above is one node, and the one-node case is what the first Business release
ships. The architectural target behind it is a federation of independently operated site nodes,
each owning its node and its memory and converging authorised state through the convergence
engine under its contract. A Business with several sites can have that by agreement, as planned
work; it is a planned capability of Corporate, or a separately scoped Business service; cross-organisation relationships belong to the Federated tier. None is sold before it is built. See
[FEDERATION.md](../FEDERATION.md) and the
[architecture chart](../ARCHITECTURE.md#several-sites-and-federation-planned).

### Licence and trial

The terms of a Business licence are agreed with you: contact us. The Business trial is a
time-limited trial: 5 members and 10 computers, 14 days with one 14-day extension. It is self-serve
when the organisation uses hosted AI providers, or a mix of hosted providers and local tools.
Organisations that need an on-premises LLM, an air-gapped install or a compliance-led rollout get a
sales-assisted pilot instead, sized from the order form, with the term starting when the licence is
installed. Both paths are planned, as is Business itself. The full terms, the cost model and what
happens at the end: [BUSINESS-TRIAL.md](../BUSINESS-TRIAL.md). Business has no public price:
contact us.

## Where it runs: cloud-hosted or on your own servers

| | Cloud-hosted | On your own servers |
|---|---|---|
| Who runs the server | the operator, on a host the operator manages | you, on your own servers |
| Where AI provider calls go | your own AI apps call a hosted provider with your own keys | your own AI apps call a model inside your environment |
| Which trial path | the self-serve Business trial, free with no card (planned) | the sales-assisted pilot, size set by order form, term starts at licence install (planned) |
| Status | planned, no date | the vault server and its container image (docs/DOCKER.md) are built; the company server and the Business trial are planned |

The two pages: [deploy-cloud.md](../deploy-cloud.md) and [deploy-on-prem.md](../deploy-on-prem.md).

## Worked example: 20 people

A firm of 20: a CEO, a senior leadership team of 3, and Sales (5), Operations (5), Finance (2), HR
(1) and Legal (1), plus 2 in IT and admin.

```mermaid
flowchart TB
    subgraph office["Your office or your cloud account"]
        hub["Company server (planned)<br/>Memev, ONE company vault<br/>and the admin console"]
        model["On-premises LLM, if chosen<br/>Ollama or vLLM"]
        audit[("Egress log (planned)")]
        hub --- audit
    end
    subgraph staff["20 computers"]
        pcs["Memev on each computer<br/>local tools: Claude Code, Cursor,<br/>Claude Desktop"]
    end
    idp["Google Workspace or<br/>Microsoft Entra ID<br/>(sign-in, planned)"]
    git[("Your company's<br/>GitHub organisation<br/>private backup")]
    cloud["OR the cloud AI services<br/>the policy allows"]
    tools["Company tools<br/>CRM, ticketing, Slack or Teams,<br/>Google Workspace or Microsoft 365,<br/>internal databases"]

    pcs <-->|"per-computer credential"| hub
    idp -->|"who is who, which groups"| hub
    hub -->|"push every few minutes"| git
    hub <-->|"MCP, by policy"| model
    hub <-.->|"MCP, by policy"| cloud
    pcs <-->|"the vendors' own MCP servers"| tools
```

### Who sees what

The company sees and searches everything in the company vault through the admin console (planned).
The org chart can then become the permission map for what each member's own AI apps get back
(planned): each department gets its own area of the company vault, and a person's apps receive their
department, the company area and anything granted to them.

```mermaid
flowchart TB
    ceo["CEO"] --> slt["Senior leadership team (3)"]
    slt --> sales["Sales (5)"]
    slt --> ops["Operations (5)"]
    slt --> fin["Finance (2)<br/>restricted"]
    slt --> hr["HR (1)<br/>restricted"]
    slt --> legal["Legal (1)<br/>restricted"]
    slt --> it["IT and admin (2)"]
```

| Role | Member's apps receive | Writes | Notes |
|---|---|---|---|
| CEO | everything, except HR case files | company, leadership | HR files need a second approver |
| Senior leadership | company, leadership, their own departments | company, leadership | |
| Sales, Operations | company, own department | own department | |
| Finance, HR, Legal | company, own department | own department | restricted notes carry a label (planned) |
| IT and admin | company, own department | settings | run the admin console; can revoke any computer |
| Contractors | a named project area | that area | expiry date on the grant |

Today this can be approximated with path-limited tokens (`memev token issue <name> --paths 'sales/**,company/**'`):
recall and the graph already respect them. User accounts, groups from the identity provider, the
admin console and approvals need the company server.

### Sensitive work and the one AI provider

The provider policy is the organisation's (planned). An organisation whose notes must not reach a
cloud AI service restricts itself by policy to an on-premises LLM, so that no member's app can send
work notes to a cloud model. Memev does not run models: it decides which notes a provider receives.
Labels on notes and rules for what reaches each provider are planned.

Where the policy allows a cloud AI service, names, e-mail addresses and amounts can be replaced with
placeholders first (planned), and every note returned to a provider is written to the egress log:
which note, which person, which provider, when.

### Company tools

AI apps can already use the official MCP servers for CRM, ticketing, chat and office suites alongside
Memev; Memev keeps what was decided, the tool keeps the record. Connectors that copy selected data
into the vault, with the department label applied, are planned. Internal databases are reached
through an MCP server your team runs, with a read-only database user.

### Hardware

| Machine | Suggested spec | Notes |
|---|---|---|
| Company vault server | 4 to 8 CPU cores, 16 to 32 GB RAM, 500 GB SSD, Linux. A small VM is enough: one Memev process used 160 MB of heap after a 170-million-token growth test. | an existing server is usually enough |
| On-premises LLM, small | one 24 GB GPU (for example RTX 4090 or L4), 64 GB RAM, 1 TB NVMe. Runs 7B to 14B models with Ollama for a few people at a time. | a workstation-class machine |
| On-premises LLM, larger | one or two 48 GB GPUs (for example RTX 6000 Ada or L40S), 128 GB RAM. Runs 30B to 70B quantised models with vLLM for several people at once. | a server-class machine |
| Backup | your company's GitHub organisation, or a git server on your network | existing |

The two on-premises LLM rows apply only if the organisation's policy includes an on-premises LLM. These are starting points. Test the model you choose with your own work before buying.

### Cost for this example (draft)

Priced on your requirements: contact us for a quote. The quote covers the Business subscription for
20 people, remote setup (the company server, sign-in, departments, computers and backup, with or
without an on-premises LLM), the support plan, and an admin training day if you want one. Hardware is
yours; see above.

## What's included

- Everything in Personal on every computer
- One company vault that all members' work data syncs into, with company knowledge coming back down to
  members' apps (planned)
- A company admin console that sees and searches everything in the company vault (planned)
- Provider policy: members use the AI providers the organisation allows, cloud AI services or an
  on-premises LLM over MCP, and the organisation may restrict itself to one provider, with egress
  rules (planned)
- Merging of members' edits by the paid crdt-merge convergence engine, which lives in its own
  repository and is called as an external dependency ([CONVERGENCE.md](../CONVERGENCE.md)) (planned)
- Invites from an org admin into the company vault (planned)
- Separate identities and keys from any personal vault, with no grants, mounts or mixing (planned)
- When someone leaves: access ends, keys are revoked, devices are removed, the local cache is wiped
  and what they synced stays in the company vault (planned)
- Sign-in with Google Workspace or Microsoft Entra ID, offboarding (planned)
- Departments, roles and grants from your org chart (planned)
- Labels, rules for what reaches the AI provider, pseudonymising, egress log (planned)
- Backup to your company's GitHub organisation or your own git server (built)
- Cloud AI connectors are counted, not refused

## Limits

- The terms of a licence are agreed with you. The trial is 5 members and 10
  computers, 14 days with one 14-day extension. There is no public price: contact us. For identity
  sync, SIEM export, retention, legal hold or high availability, see [Corporate](corporate.md).
- Every app on every enrolled computer gets a seat on the comms bus. IT or a team lead can run a
  comms check and hand out tasks from one session; a removed computer drops off the bus.
- Each computer has its own device key, and IT frees a computer with `memev devices remove <id>`.
  Past the licensed count the vault refuses the next one.
- The provider policy is the organisation's: it may allow several AI providers or restrict itself to
  one cloud AI service or one on-premises LLM (planned). Memev enforces the policy; it does not pick
  the provider.
- One company server. If it is down, each computer keeps working on its own notes and catches up
  after; a second server for failover is Corporate.
- The company server decrypts notes to index them, so whoever runs it can read them. The company can
  see and search everything in the company vault by design.
- Pseudonymising catches patterns (names it knows, e-mail addresses, amounts). It will miss things,
  which is why organisations with sensitive notes choose an on-premises LLM.

## Setup

| Week | Remote setup |
|---|---|
| 1 | call to agree departments, roles, the provider policy and what counts as restricted; check the server |
| 2 | install the company server (and the on-premises LLM, if the policy includes one), connect sign-in and the GitHub organisation |
| 3 | install Memev on the computers (IT runs one command per machine, or pushes it with their usual tool), import the org chart |
| 4 | check permissions with test accounts, hand over, one hour of training for staff |

Onsite setup is the same plan with days on site; rates and travel are in [services.md](services.md).

## Support

Without a plan: GitHub issues and paid hours. With the Business support plan: e-mail and a ticket
queue in business hours, a first reply within 4 business hours for an outage, 1 business day for a
fault and 3 business days for a question. Details in [services.md](services.md#response-times).

## Sovereignty

Notes stay on your server and computers, and in your git backup. With a policy that allows only an
on-premises LLM, notes never leave your network. Where the policy allows a cloud AI service, what it receives
leaves your control once sent, even pseudonymised; the egress log tells you what went where, and it
can't bring anything back. Only licence information passes between your install and ours, never vault
data.
