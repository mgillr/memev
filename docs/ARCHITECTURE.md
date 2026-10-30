# Architecture

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Down: the
[module map](MODULES.md) (generated from the real imports) and the per-topic pages linked below.

This page has two parts. The first shows what is built and running today, module by module. The
second shows the three tiers side by side with one diagram each: [Personal](#personal),
[Business](#business-coming) and [Corporate](#corporate-coming). Business and Corporate are coming; their
diagrams show the design, not shipped code. A last section shows the planned extension of the same
design to [several sites and federation](#several-sites-and-federation-planned); nothing in it is
built.

## What runs today

Memev is one background process per vault, the daemon, and a small command that every AI app calls.
The daemon is the only writer of the vault. Everything else talks to it over HTTP on `127.0.0.1`.

```mermaid
flowchart LR
    subgraph computer["Your computer"]
        apps["AI apps<br/>Claude Code, Codex, Gemini CLI,<br/>Cursor, Claude Desktop, Windsurf,<br/>VS Code, Zed"]
        proxy["memev mcp, memev hook<br/>src/cli: mcp-stdio, hooks"]
        daemon["Memev daemon on 127.0.0.1:7787<br/>src/server: main, http, mcp<br/>and the background jobs in src/cli/sync"]
        engine["Engine, src/engine<br/>oplog, index, graph, quality,<br/>secrets, tokens, devices,<br/>bus, contracts, license"]
        vault[("Vault ~/memev<br/>Markdown + git<br/>.memev: log, index, config")]
        apps -->|"MCP over stdio or HTTP"| proxy
        proxy -->|"HTTP, bearer token"| daemon
        daemon --> engine
        engine --> vault
    end
    gh[("Your private GitHub repository<br/>or any private git remote")]
    tunnel["Secure link, off until you switch it on<br/>Tailscale serve, a named Cloudflare tunnel,<br/>or a quick tunnel; optional relay"]
    cloud["Cloud AI apps<br/>Claude, ChatGPT"]
    other["Your other computers<br/>each with its own device key"]
    lic["Licence endpoint<br/>licence key in, signed licence out"]
    vault -->|"push every few minutes"| gh
    daemon <--> tunnel
    tunnel <-->|"per-app token"| cloud
    tunnel <-->|"signed requests"| other
    lic -.->|"memev license activate, once"| engine
```

| Part | Where | Documented in |
|---|---|---|
| The command and its hooks | `bin/memev.mjs`, `src/cli/main.mjs`, `src/cli/hooks.mjs`, `src/cli/mcp-stdio.mjs` | [QUICKSTART.md](QUICKSTART.md), [CLIENTS.md](CLIENTS.md) |
| App registration | `src/cli/clients.mjs` | [CLIENTS.md](CLIENTS.md), [clients/](clients/claude-code.md) |
| The daemon, HTTP and MCP | `src/server/main.mjs`, `src/server/http.mjs`, `src/server/mcp.mjs` | [DESIGN.md](DESIGN.md), [THREAT-MODEL.md](THREAT-MODEL.md) |
| The vault, log, index and graph | `src/engine/vault.mjs`, `oplog.mjs`, `index.mjs`, `graph.mjs`, `quality.mjs` | [DESIGN.md](DESIGN.md) |
| Tokens, device keys and the licence | `src/engine/tokens.mjs`, `devices.mjs`, `license.mjs`, `entitlements.mjs` | [PRICING.md](PRICING.md), [CHARTER.md](../CHARTER.md) |
| The comms bus | `src/engine/bus.mjs`, `src/cli/bus-cli.mjs` | [BUS.md](BUS.md) |
| Signed contracts | `src/engine/contracts.mjs`, `vendor/attest` | [CONTRACTS.md](CONTRACTS.md) |
| Secure link and relay | `src/cli/tunnel.mjs`, `src/cli/relay.mjs`, `src/cli/remote.mjs`, `src/cli/invite.mjs` | [CLOUD.md](CLOUD.md), [RELAY.md](RELAY.md) |
| Backup and sync | `src/cli/github.mjs`, `src/cli/sync.mjs`, `src/engine/git.mjs` | [GITHUB.md](GITHUB.md) |
| Doctor, onboarding, milestones | `src/cli/doctor.mjs`, `src/cli/onboarding.mjs`, `src/engine/milestones.mjs` | [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [METRICS.md](METRICS.md) |

### What happens on one prompt

```mermaid
sequenceDiagram
    participant App as AI app
    participant Hook as memev hook (src/cli/hooks)
    participant D as Daemon (src/server)
    participant V as Vault engine (src/engine)
    App->>Hook: prompt submitted
    Hook->>D: POST hook route, bearer token
    D->>V: recall, project and permission filter first
    V-->>D: the few matching notes
    D->>V: bus heartbeat and unread check
    D-->>Hook: notes + new bus messages
    Hook-->>App: context added to the prompt
    App->>D: remember, checkpoint (MCP tools)
    D->>V: quality check, secret scan, append to log, write Markdown, commit
```

Every write is appended to the checksummed operation log before the Markdown file changes; see
[DESIGN.md](DESIGN.md).

## The three tiers

All three tiers use the same engine. Personal on one computer is the free core and is complete
([CHARTER.md](../CHARTER.md)). Anything marked *coming* or *planned* is not built, and nothing is
sold before it is built ([tiers/README.md](tiers/README.md#what-is-built-and-what-is-planned)).

Three things are the same in every tier:

- **Memev core is open source (Apache-2.0) and free.** It lives in this repository.
- **The convergence engine, crdt-merge, is not in this repository.** It lives in its own repository under
  its own licence, is never vendored into Memev, and Memev calls it as an external dependency. It
  powers the paid features: automatic merge when several computers edit at once, and vault convergence
  for a company. See [CONVERGENCE.md](CONVERGENCE.md).
- **Only licence information passes between an install and our side.** The licence server hands out a
  signed licence and nothing else; vault data never goes there.

### Personal

Personal is one person. On one computer it is free. Personal with more computers is the paid step: a
second computer joins the vault over the secure link with its own device key (built), and several
computers editing at once with the convergence engine merging them is planned. A person can connect
several cloud AI apps side by side, and local coding tools, all to the same memory.

```mermaid
flowchart LR
    subgraph person["One person"]
        subgraph pc1["Computer 1"]
            m1["Memev app"]
            t1["Local coding tools<br/>Claude Code, Cursor, Codex,<br/>Gemini CLI via MCP"]
            t1 <-->|MCP| m1
        end
        subgraph pc2["Computer 2, 3 (Personal with more computers)"]
            m2["Memev app"]
            t2["Local coding tools via MCP"]
            t2 <-->|MCP| m2
        end
        vault[("Your vault<br/>Markdown + git")]
        m1 <--> vault
        m2 <-->|"secure link, device key"| vault
    end
    cloud["Cloud AI apps side by side<br/>Claude, ChatGPT,<br/>more coming soon"]
    gh[("Your own private<br/>GitHub repository")]
    engine["crdt-merge convergence engine<br/>separate repository, called as an<br/>external dependency (paid, planned)"]
    lic["Licence server<br/>licence information only"]
    cloud <-->|"secure link, one token per app"| vault
    vault -->|"backup every few minutes"| gh
    vault <-.->|"merges edits made at once"| engine
    vault -.->|"licence key in,<br/>signed licence out"| lic
```

Free users get one computer at a time. They move between computers through their own GitHub: git sync
is single-writer backup, it never force-pushes, and a merge that conflicts is left as it is for you to
resolve ([CONVERGENCE.md](CONVERGENCE.md#what-free-users-get)). Tier page: [tiers/free.md](tiers/free.md).

### Business (coming)

Business is one organisation. Every member's computer runs Memev and their local tools. All members'
work data syncs into **one company vault**, which the company can see and search everything in
through the admin console. Members use the AI providers and tools the organisation's policy allows,
cloud AI services or an on-premises LLM, over MCP; an organisation may restrict itself to one provider
by policy, with egress rules and labels (planned). Members keep private work outside Memev.

```mermaid
flowchart LR
    subgraph members["Members' computers, counted once per organisation"]
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

Licences count once per organisation, by person and by computer. The trial is 5 members and 10 computers.
Details: [tiers/business.md](tiers/business.md).

### Corporate (coming)

Corporate is the same model as Business at larger scale and with stricter control: one **main
corporate vault**, the AI providers the organisation's policy allows (cloud AI services or an
on-premises LLM, which can be air-gapped; a one-provider policy is planned), identity sign-in, and
audit export to your own systems.

```mermaid
flowchart LR
    subgraph members["Members' computers, counted once per organisation"]
        ma["Memev app + local tools"]
        mb["Memev app + local tools"]
        mc["Memev app + local tools"]
    end
    subgraph dc["Your data centre or private cloud"]
        cv[("ONE main corporate vault<br/>replicated storage, more than one server")]
        admin["Admin console<br/>sees and searches everything"]
        engine["crdt-merge convergence engine and relay<br/>(paid, external dependency)"]
    end
    provider["AI providers the policy allows<br/>cloud AI services or<br/>an on-premises LLM<br/>(air-gapped option)"]
    idp["Identity provider<br/>SSO and SCIM"]
    siem["SIEM and audit export"]
    lic["Licence server<br/>licence information only,<br/>checked offline"]
    ma & mb & mc -->|"work data syncs in"| cv
    cv -->|"company knowledge"| ma & mb & mc
    cv <--> admin
    cv <-->|"MCP"| provider
    cv <-.->|"merge"| engine
    idp --> cv
    cv -->|"audit and egress events"| siem
    cv -.->|"licence only"| lic
```

Details: [tiers/corporate.md](tiers/corporate.md).

### Several sites and federation (planned)

Nothing in this section is built. The architectural target is a federation of independently
operated site nodes: each site owns its node and its memory, sites converge the state they are
authorised to share through the convergence engine under its contract, and no central coordinator
sequences ordinary updates. The company vault and the main corporate vault above are the one-node
case of that target, and the one-node case is what the first Business release ships. Federation
across sites, and federated computation on top of it, are planned capabilities of Corporate, and
of a Business licence whose services list includes the multi-site federation design
([tiers/services.md](tiers/services.md)); they are not a tier.

```mermaid
flowchart LR
    subgraph siteA["Site A (planned)"]
        a["Memev node A"]
        am[("Site memory A")]
        a <--> am
    end
    subgraph siteB["Site B (planned)"]
        b["Memev node B"]
        bm[("Site memory B")]
        b <--> bm
    end
    subgraph siteC["Site C (planned)"]
        c["Memev node C"]
        cm[("Site memory C")]
        c <--> cm
    end
    a <-->|"authorised state, planned"| b
    b <-->|"authorised state, planned"| c
    a <-->|"authorised state, planned"| c
    engine["crdt-merge convergence engine<br/>separate repository, external dependency<br/>(paid, planned): converges authorised state"]
    regional["Regional service (planned)<br/>routing, discovery, permitted caching;<br/>never the owner of a site's memory"]
    a & b & c <-.-> engine
    a & b & c -.-> regional
```

What the planned extension needs, beside the merge boundary that exists today
([EXTENSION-POINTS.md](EXTENSION-POINTS.md)):

- **Node identity and membership (planned):** each site has an operator and a key; sites establish
  and revoke scoped relationships.
- **Per-scope operation-log streams (planned):** the replication unit, each entry carrying its
  classification and causal context; the engine converges the streams it is contracted for. Git
  stays the single-writer backup of the whole local vault for Personal and for the one-node
  Business, and there are no per-scope git repositories.
- **The trust service and the admission service (planned):** two adapter boundaries beside the
  merge boundary, one for trust governance between participants and one for accountable admission
  of contributions. Both are named generically until they are published.
- **A regional service (planned):** may help with routing, discovery or permitted caching. It is not
  a relay, which only forwards ([RELAY.md](RELAY.md)), and it never becomes the owner of a site's
  memory or the sequencer of ordinary updates.
- **The project state machine (planned):** the code is present in `src/engine/project-state.mjs`,
  and nothing imports it yet ([PROJECTS.md](PROJECTS.md)); the planned multi-site work wires it in.
- **Federated computation (planned):** authorised computational work coordinated across sites,
  with workload-specific algorithms; the engine converges supported state only and does not replace
  those algorithms.

A personal or home vault never federates into a company or site node: separate identities and
keys, no grants, mounts or mixing
([tiers/README.md](tiers/README.md#personal-and-company-vaults-never-mix)). The pages:
[FEDERATION.md](FEDERATION.md), [ORGANISATIONAL-INTELLIGENCE.md](ORGANISATIONAL-INTELLIGENCE.md),
[FEDERATED-COMPUTATION.md](FEDERATED-COMPUTATION.md),
[DATA-SOVEREIGNTY.md](DATA-SOVEREIGNTY.md) and
[ARCHITECTURAL-INTERDEPENDENCIES.md](ARCHITECTURAL-INTERDEPENDENCIES.md).

## Where each tier is documented

| | Personal | Business | Corporate |
|---|---|---|---|
| Overview | [tiers/free.md](tiers/free.md) | [tiers/business.md](tiers/business.md) | [tiers/corporate.md](tiers/corporate.md) |
| Price and licence | [PRICING.md](PRICING.md) | contact us | contact us |
| Services | [tiers/services.md](tiers/services.md) | [tiers/services.md](tiers/services.md) | [tiers/services.md](tiers/services.md) |
| Several sites (planned) | | with the multi-site federation design in [tiers/services.md](tiers/services.md): [FEDERATION.md](FEDERATION.md) | [FEDERATION.md](FEDERATION.md), [FEDERATED-COMPUTATION.md](FEDERATED-COMPUTATION.md) |
