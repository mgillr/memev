# Memev documentation

Up: the [README](../README.md). Every page in
this folder links back here, and this page links down to every page.

## Start here

| Page | What it holds |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | install, first session, everyday commands, the vault layout, Windows (preview) |
| [OFFICE.md](OFFICE.md) | one vault, inviting teammates, the lead, the roster and what is shared |
| [INSTALL-FOR-AI.md](INSTALL-FOR-AI.md) | the install steps written for an AI app to follow |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | `memev doctor` and the fix for each symptom |
| [SUPPORT.md](SUPPORT.md) | `memev doctor --bundle` and who answers |

## How Memev works

| Page | What it holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | what runs today, and the Personal, Business and Corporate charts |
| [MODULES.md](MODULES.md) | the module interdependency map, generated from the real imports |
| [DESIGN.md](DESIGN.md) | the log, the index, recall, memory quality, the graph, scale |
| [MAPPING.md](MAPPING.md) | everything Memev does without being asked |
| [BUS.md](BUS.md) | the comms bus: seats, the lead, roster, comms checks, tasks |
| [CONTRACTS.md](CONTRACTS.md) | signed, immutable work contracts |
| [PROJECTS.md](PROJECTS.md) | the project layer: task states, the transition table, derived project status |
| [CLIENTS.md](CLIENTS.md) | what is added to each AI app; per-app pages below |
| [CLOUD.md](CLOUD.md) | the secure link, devices, invites, joining another computer |
| [AGENT-IDENTITY.md](AGENT-IDENTITY.md) | a person vouches for an agent role, and a third party checks it offline |
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
| [tiers/README.md](tiers/README.md) | the four tiers side by side, what is built and what is planned |
| [tiers/free.md](tiers/free.md) | Personal, one computer, free; Personal with more computers |
| [tiers/business.md](tiers/business.md) | Business (coming) |
| [tiers/corporate.md](tiers/corporate.md) | Corporate (coming) |
| [tiers/services.md](tiers/services.md) | services, support plans, response times |
| [CONVERGENCE.md](CONVERGENCE.md) | the paid core: the crdt-merge convergence engine |
| [PAID-CONVERGENCE.md](PAID-CONVERGENCE.md) | the specification of the paid convergence service: what the engine does, and the boundary it is called across |
| [PAID-TRUST.md](PAID-TRUST.md) | the trust service (planned): which signed operations a shared vault would accept, and how a computer that should no longer write would be kept out of a concurrent edit |
| [EXTENSION-POINTS.md](EXTENSION-POINTS.md) | the one place the core hands work to an outside program: the merge engine boundary |
| [PRICING.md](PRICING.md) | the tier table, the computer limit, licences |
| [CHECKOUT.md](CHECKOUT.md) | how checkout and licence keys fit together |
| [REFERRAL.md](REFERRAL.md) | the referral credit |
| [LICENSING-NOTICE.md](LICENSING-NOTICE.md) | which licence covers what |
| [../CHARTER.md](../CHARTER.md) | the free tier is never limited |

## For buyers

| Page | What it holds |
|---|---|
| [SECURITY-BRIEF.md](SECURITY-BRIEF.md) | the customer security brief: where notes live, what leaves the computer, credentials, the threat model, built against planned |
| [DATA-FLOW.md](DATA-FLOW.md) | the one-page data-flow map: every outbound call a default install can make, and nothing else |
| [PILOT-CHECKLIST.md](PILOT-CHECKLIST.md) | the two to four week pilot checklist, week for week with the Business setup table |

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

## Scope One takeover record

The record a builder takes over with: what exists, what is missing, and the order to build it.

| Page | What it holds |
|---|---|
| [scope-one/REQUIREMENTS.md](scope-one/REQUIREMENTS.md) | the full requirement register, one row per requirement |
| [scope-one/TRACEABILITY.md](scope-one/TRACEABILITY.md) | each requirement traced to code, contract, dependency and test |
| [scope-one/INVENTORY.md](scope-one/INVENTORY.md) | every branch, contract and source, with status and disposition |
| [scope-one/BASELINE.md](scope-one/BASELINE.md) | the commit, working tree and test run the record is taken from |
| [scope-one/DEPENDENCIES.md](scope-one/DEPENDENCIES.md) | the build-order edges between contracts |
| [scope-one/DECISIONS.md](scope-one/DECISIONS.md) | the open ADRs and the questions only the owner can answer |
| [scope-one/SLICE-PLAN.md](scope-one/SLICE-PLAN.md) | the ordered slices and the deferred work |
| [scope-one/WBS.md](scope-one/WBS.md) | the work breakdown: every requirement, contract, pull request and branch once, with its status and owner |
| [scope-one/design/organisational-knowledge-model.md](scope-one/design/organisational-knowledge-model.md) | the SO-2.01 decision record: the organisational knowledge model, with its open owner decisions |
| [scope-one/design/permission-aware-knowledge-access.md](scope-one/design/permission-aware-knowledge-access.md) | the SO-2.02 decision record: permission-aware knowledge access, with its open owner decisions |
| [scope-one/design/provenance-retention-invalidation.md](scope-one/design/provenance-retention-invalidation.md) | the SO-2.03 decision record: provenance, retention and invalidation, with its open owner decisions |
| [scope-one/design/cross-project-intelligence.md](scope-one/design/cross-project-intelligence.md) | the SO-2.04 decision record: cross-project intelligence, with its open owner decisions |
| [scope-one/design/cross-functional-issue-discovery.md](scope-one/design/cross-functional-issue-discovery.md) | the SO-2.05 decision record: cross-functional issue discovery, with its open owner decisions |
