# Memev documentation

Up: the [README](../README.md). Every page in
this folder links back here, and this page links down to every page.

## Start here

| Page | What it holds |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | install, first session, everyday commands, the vault layout, Windows (preview) |
| [INSTALL-FOR-AI.md](INSTALL-FOR-AI.md) | the install steps written for an AI app to follow |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | `memev doctor` and the fix for each symptom |
| [SUPPORT.md](SUPPORT.md) | `memev doctor --bundle` and who answers |

## How Memev works

| Page | What it holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | what runs today and how the same design extends to multi-site federation and computation |
| [MODULES.md](MODULES.md) | the source-code import map, generated from real imports; do not edit by hand |
| [ARCHITECTURAL-INTERDEPENDENCIES.md](ARCHITECTURAL-INTERDEPENDENCIES.md) | how current components and planned federation capabilities depend on one another |
| [FEDERATION.md](FEDERATION.md) | local ownership, site topologies, membership, replication and cross-organisation boundaries |
| [ORGANISATIONAL-INTELLIGENCE.md](ORGANISATIONAL-INTELLIGENCE.md) | connected work across people, projects, programmes, portfolios and business functions |
| [FEDERATED-COMPUTATION.md](FEDERATED-COMPUTATION.md) | distributed execution, analytics, optimisation, evaluation and federated learning |
| [DATA-SOVEREIGNTY.md](DATA-SOVEREIGNTY.md) | jurisdiction-aware processing, derived data, replication, retention and recovery |
| [DESIGN.md](DESIGN.md) | the log, the index, recall, memory quality, the graph, scale |
| [MAPPING.md](MAPPING.md) | everything Memev does without being asked |
| [BUS.md](BUS.md) | the comms bus: seats, the lead, roster, comms checks, tasks |
| [CONTRACTS.md](CONTRACTS.md) | signed, immutable work contracts |
| [PROJECTS.md](PROJECTS.md) | the project layer: task states, the transition table, derived project status |
| [CLIENTS.md](CLIENTS.md) | what is added to each AI app; per-app pages below |
| [CLOUD.md](CLOUD.md) | the secure link, devices, invites, joining another computer |
| [RELAY.md](RELAY.md) | the relay protocol and the `memev cloud relay` client |
| [GITHUB.md](GITHUB.md) | backup to your own private repository |
| [DOCKER.md](DOCKER.md) | running Memev in a container |
| [SETUP-SESSION.md](SETUP-SESSION.md) | the customer-started remote setup session, and how to stop it |
| [ISOLATION.md](ISOLATION.md) | how this repository is kept separate from earlier work |
| [THREAT-MODEL.md](THREAT-MODEL.md) | assets, threats and mitigations; also [SECURITY.md](../SECURITY.md) |
| [SOLUTIONS.md](SOLUTIONS.md) | the problems users report, what Memev does, the check for each |
| [COMPARISON.md](COMPARISON.md) | how Memev compares with hosted memory services |

### Per-app pages

[Claude Code](clients/claude-code.md), [Claude Desktop](clients/claude-desktop.md),
[Codex](clients/codex.md), [Cursor](clients/cursor.md), [Gemini CLI](clients/gemini-cli.md),
[VS Code](clients/vscode.md), [Windsurf](clients/windsurf.md), [Zed](clients/zed.md). Each links back to
[CLIENTS.md](CLIENTS.md).

## Tiers, pricing and licences

| Page | What it holds |
|---|---|
| [tiers/README.md](tiers/README.md) | Personal through Corporate, Federation and Federated Computation deployment levels and status |
| [tiers/free.md](tiers/free.md) | Personal, one computer, free; Personal with more computers |
| [tiers/business.md](tiers/business.md) | Business (coming) |
| [tiers/corporate.md](tiers/corporate.md) | Corporate (coming) |
| [tiers/services.md](tiers/services.md) | services, support plans, response times |
| [CONVERGENCE.md](CONVERGENCE.md) | the paid core: the crdt-merge convergence engine |
| [PAID-CONVERGENCE.md](PAID-CONVERGENCE.md) | the specification of the paid convergence service: what the engine does, and the boundary it is called across |
| [EXTENSION-POINTS.md](EXTENSION-POINTS.md) | the one place the core hands work to an outside program: the merge engine boundary |
| [PRICING.md](PRICING.md) | the tier table, the computer limit, licences |
| [CHECKOUT.md](CHECKOUT.md) | how checkout and licence keys fit together |
| [REFERRAL.md](REFERRAL.md) | the referral credit |
| [LICENSING-NOTICE.md](LICENSING-NOTICE.md) | which licence covers what |
| [../CHARTER.md](../CHARTER.md) | the free tier is never limited |

## Plans and drafts

| Page | What it holds |
|---|---|
| [roadmap/add-ons.md](roadmap/add-ons.md) | planned add-ons and services |
| [custom-modules/README.md](custom-modules/README.md) | custom modules: [use cases](custom-modules/use-cases.md) and [walk-throughs](custom-modules/examples/README.md) |
| [directories/mcp.md](directories/mcp.md), [directories/cloud-connector.md](directories/cloud-connector.md) | draft directory listings |

## For people working on Memev

| Page | What it holds |
|---|---|
| [DEVELOPING.md](DEVELOPING.md) | tests, the leak scan, changelog notes, regenerating the module map |
| [RELEASING.md](RELEASING.md) | the release checklist |
| [METRICS.md](METRICS.md) | how activations and downloads are counted |
| [BENCH.md](BENCH.md) | the recall benchmark (not in the npm package) |
| [testing/LAB-TEST-PLAN.md](testing/LAB-TEST-PLAN.md) | every test to run in a lab before a release |
| [READINESS-REVIEW.md](READINESS-REVIEW.md) | the readiness review that started this repository |
| [../CHANGELOG.md](../CHANGELOG.md) | what changed; notes for the next release are in `changelog.d/` |
| [../contracts/README.md](../contracts/README.md) | signed contracts for work on Memev itself |
