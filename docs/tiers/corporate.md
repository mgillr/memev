# Corporate (coming)

Part of the [tiers pages](README.md). Up: the [README](../../README.md). Architecture chart:
[ARCHITECTURE.md](../ARCHITECTURE.md#corporate-coming).

> **DRAFT and coming.** Everything specific to this tier is planned; see the
> [status table](README.md#what-is-built-and-what-is-planned).

Corporate is the same model as [Business](business.md) at larger scale and with stricter control.
There is **one main corporate vault**. The work data of every member's computer syncs into it, and
the company can see and search everything in it through the admin console. Members use the AI
providers and tools the organisation's policy allows: cloud AI services or an on-premises LLM, which
can be air-gapped; an organisation may restrict itself to **one provider by policy**, with egress
rules and labels (planned). Members keep private work outside Memev. An org admin invites members into the company vault. A personal or
home vault never crosses into it: separate identities and keys, with no grants, mounts or mixing.
Anyone who leaves loses all vault access: access ends, keys are revoked, devices are removed, the
local cache is wiped and what they synced stays in the main vault.

The terms of a Corporate licence are agreed with you. Corporate has no public price:
contact us. Organisations that are on-premises, air-gapped or led by compliance get a sales-assisted
pilot rather than a self-serve trial. The trial terms: [BUSINESS-TRIAL.md](../BUSINESS-TRIAL.md).

What Corporate adds is scale: identity sync by SCIM, audit export to a SIEM, retention rules, legal
hold and high availability, often with several sites or rules about where data may go:
banks, health, law firms, public bodies, defence suppliers. It is chosen by need, not by size.

```mermaid
flowchart LR
    subgraph members["Members' computers, counted once per organisation"]
        ma["Memev app + local tools"]
        mb["Memev app + local tools"]
        mc["Memev app + local tools"]
    end
    subgraph dc["Your data centre or private cloud"]
        lb["Load balancer"]
        hubA["Server A"]
        hubB["Server B"]
        store[("ONE main corporate vault<br/>replicated storage")]
        admin["Admin console<br/>sees and searches everything"]
        engine["crdt-merge convergence engine and relay<br/>(paid, external dependency)"]
        gitsrv[("Your git server<br/>backup")]
        lb --> hubA & hubB
        hubA & hubB --- store
        store -->|backup| gitsrv
        store <--> admin
        store <-.->|merge| engine
    end
    provider["AI providers the policy allows<br/>cloud AI services or<br/>an on-premises LLM<br/>(air-gapped option)"]
    idp["Identity provider<br/>Entra ID, Okta, Google<br/>SSO and SCIM"]
    siem["SIEM<br/>Splunk, Sentinel, Elastic"]
    lic["Licence server<br/>licence information only,<br/>checked offline"]
    custom["Custom connectors<br/>to internal systems"]

    ma & mb & mc -->|"work data syncs in"| lb
    idp --> lb
    store <-->|"MCP"| provider
    hubA & hubB -->|"audit and egress events"| siem
    store -.->|"licence only"| lic
    custom --> hubA & hubB
```

The same chart, next to Personal and Business, is in [ARCHITECTURE.md](../ARCHITECTURE.md#corporate-coming).

## What's included (planned)

- Two or more servers behind a load balancer, with replicated storage for the one main vault and failover
- Private deployment: we install and maintain the server in your data centre or your cloud account
- An air-gapped package: installs without internet, updates by signed bundle, no secure link, git
  backup to a server inside the network, and a policy that allows only an on-premises LLM
- Sign-in through your identity provider, with users and groups kept in step by SCIM
- Audit and egress events streamed to your SIEM, and exportable on request
- Retention rules per department and legal hold that stops deletion for named people or matters
- Custom connectors to internal systems
- A named engineer, or an engineer embedded with your team
- Source escrow and a written succession plan, on request

## Several sites and federation (planned)

The main corporate vault above is one node, and the one-node case is what ships first. The
architectural target behind it is a federation of independently operated site nodes: each site
owns its node and its memory, sites converge the state they are authorised to share through the
convergence engine under its contract, and no central coordinator sequences ordinary updates.
Federation across sites, and federated computation on top of it, are planned capabilities of
Corporate; they are not a tier and are not sold before they are built.

What the planned extension adds, each part planned: node identity and membership between sites;
per-scope operation-log streams as the replication unit, each entry carrying its classification
and causal context; jurisdiction-aware replication, retention and recovery; a regional service for
routing, discovery and permitted caching, which never owns a site's memory; the trust service and
the admission service as two adapter boundaries beside the merge boundary
([EXTENSION-POINTS.md](../EXTENSION-POINTS.md)); and federated computation with workload-specific
algorithms, where the engine converges supported state only. A site keeps its permitted local work
going through a partition, and a site that is down does not make its unreplicated changes appear
anywhere else. The pages: [FEDERATION.md](../FEDERATION.md),
[DATA-SOVEREIGNTY.md](../DATA-SOVEREIGNTY.md),
[FEDERATED-COMPUTATION.md](../FEDERATED-COMPUTATION.md) and the
[architecture chart](../ARCHITECTURE.md#several-sites-and-federation-planned).

## Limits

- The number of computers comes from the agreement you are issued a licence under, checked offline with no call home. Air-gapped
  installs work the same way.
- Everything above is planned. An offer for any of it will carry a delivery date and acceptance
  checks.
- The servers decrypt notes to index them. Admins of those servers can read them; separate duties and
  log admin access through your SIEM.
- Air-gapped installs can't use a cloud AI service or the hosted relay, by design: the policy allows only an on-premises LLM.
- Legal hold stops Memev from deleting; it can't stop a cloud AI service keeping what it was sent
  before the hold.

## Price

Priced on your requirements: contact us. A quote usually covers onboarding, a private deployment
if we run it for you, a compliance pack, a named or embedded engineer and any custom development.
See [services.md](services.md).

## Setup

| Phase | Typical length |
|---|---|
| Discovery: architecture, identity, data classes, security review | 1 to 2 weeks |
| Build: servers, storage, identity, SIEM, the AI provider, connectors | 2 to 6 weeks |
| Pilot with one department | 2 weeks |
| Rollout by department, with training | 1 to 4 weeks |

6 to 12 weeks in total, remote, onsite or mixed.

## Support

A named engineer who knows your setup, or an embedded engineer working with your team. First reply
within 1 hour around the clock for an outage, 4 hours for a fault, 1 business day for a question
(draft). See [services.md](services.md#response-times).

## Sovereignty

All data can stay inside your network, and in the air-gapped package nothing leaves it. Where the policy allows a
cloud AI service, what is sent to it is out of Memev's control once sent; rules decide what may
go, and the SIEM records what did. Only licence information passes between your install and ours,
never vault data.
