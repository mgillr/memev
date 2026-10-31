<div align="center">

<a href="media/memev-tiers.mp4"><img src="media/memev-tiers-poster.png" alt="Memev demo video, 4 min 55 s: how each tier works and how the tiers connect. Click to watch." width="720"></a>

<sub><a href="media/memev-tiers.mp4">Watch the demo video</a> (4 min 55 s): how each tier works and how the tiers connect.</sub>

<h1>Memev</h1>

<p><strong>One shared, durable memory for the people, computers and AI agents working on a project.</strong><br>
Context that survives every session, coordination between agents, and work that is checked against what was asked.</p>

<p>
<img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue">
<img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen">
<img alt="Speaks MCP" src="https://img.shields.io/badge/protocol-MCP-informational">
<img alt="No runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-none-success">
</p>

<p>
<code>npm install -g . && memev init</code>
</p>

<p>
<a href="docs/QUICKSTART.md">Quickstart</a> &middot;
<a href="docs/README.md">Documentation</a> &middot;
<a href="docs/ARCHITECTURE.md">Architecture</a> &middot;
<a href="docs/tiers/README.md">Tiers</a> &middot;
<a href="docs/PRICING.md">Pricing</a> &middot;
<a href="CHANGELOG.md">Changelog</a>
</p>

</div>

## What Memev is, and why it matters

AI work is spread across tools, sessions, computers and people, and each one starts from a blank page. A decision made in one app is unknown to the next. Two agents edit the same thing and one silently loses. A task is reported done and nobody can say what was checked.

Memev is the shared layer underneath. It keeps project knowledge as plain Markdown that you own, makes the relevant part of it available to every connected tool, lets those tools coordinate through a communications bus, and records what a piece of work had to deliver and what was checked. It works with the AI tools you already use, over MCP, and it does not replace them.

Three ideas run through everything:

- **Shared, durable memory.** Decisions, constraints and prior work live in a vault on your own computer, written to a checksummed log first and kept in git. Any connected app can recall them. A new session starts from a resume card instead of from nothing.
- **Merging that does not need a judge.** When several computers or agents change the same state, the convergence engine crdt-merge combines the copies with deterministic rules. The result does not depend on the order the changes arrive in, it works offline, deletes are explicit, and no language model is asked to decide what to keep. This is the direction for Memev state, and it is partly built: see [Plans and roadmap](#plans-and-roadmap) for what runs today.
- **Work that is checked.** A work contract states the task, the deliverables, the acceptance criteria and the stop conditions. Memev keeps the outcome of the checks next to the work, so a task being assigned is not mistaken for a task being proven.

Federation, where independent sites each keep their own records and still reconcile, is the roadmap, not something Memev ships today. The decisions behind the plans are recorded in [docs/scope-one/DECISIONS.md](docs/scope-one/DECISIONS.md), and how the plans line up with the work breakdown is in [docs/scope-one/RECONCILIATION.md](docs/scope-one/RECONCILIATION.md).

## Who it is for

| If you are | What you get | Why it matters |
|---|---|---|
| One person using several AI tools | One vault that Claude Code, Codex, Gemini CLI, Cursor, Claude Desktop, Windsurf, VS Code and Zed can all read, plus cloud AI apps over the optional secure link | You stop re-explaining the project to every tool, and you can read and edit every note yourself |
| One person on several computers | The same vault on up to 3 computers over the secure link, each computer with its own key (Personal) | Your work follows you. Automatic merging of simultaneous edits is planned, and today git sync is single-writer backup |
| A developer building agents | An MCP server, a communications bus with seats, heartbeats and task handoffs, and work contracts with checks | A shared place for agents to coordinate, and a record that separates "assigned" from "verified" |
| A team or an organisation | A conversation with us about a company vault, one AI provider for the organisation, sign-in and roles, services and support (contact us) | These are planned. We scope them with you rather than sell them before they exist |
| An organisation with several sites | Federation across independent sites (contact us) | Planned, with no date. Each site would keep its own records and reconcile on reconnect |

## Plans by tier

The tier decision of 31 October 2026 is recorded in [docs/scope-one/DECISIONS.md](docs/scope-one/DECISIONS.md). There is no Federated tier: everything above Personal is a conversation.

| | Free (core) | Personal | Contact us |
|---|---|---|---|
| For | one person, one computer at a time | one person, up to 3 computers | teams, organisations, and sites that want to federate |
| Price | free, for good | $12/month or $120/year (CHF 10 or CHF 100), early-supporter price | contact us |
| What it includes | the whole core: vault, recall, graph, hooks, contracts, comms bus, doctor, GitHub backup, several cloud AI apps side by side | everything in Free, with the same vault on up to 3 computers over the secure link, priority support | scoped with you: see below |
| Trial | the free core is the trial | none | a Business trial and a sales-assisted pilot are planned ([docs/BUSINESS-TRIAL.md](docs/BUSINESS-TRIAL.md)) |
| Status | available now | available now for what exists today; merging, hosted sync, backup and relay are planned | planned, no dates |

The tier names in the app and the licence tooling today are Personal for the free core and Personal with more computers for the paid tier. [docs/PRICING.md](docs/PRICING.md) and [docs/tiers/README.md](docs/tiers/README.md) use those names and say what is built and what is planned for each. The free core is never limited ([CHARTER.md](CHARTER.md)).

## How it fits together

Memev connects three parts of AI work that are usually handled separately:

- **Shared context:** keep project decisions, constraints and useful prior work available across supported tools and sessions.
- **Coordination:** let connected sessions discover one another, check presence and hand off tasks through a shared communications bus.
- **Defined work:** describe expected outcomes and acceptance criteria in work contracts, then retain verification results where those checks are available.

The vault and coordination bus provide the common working layer. What happens next depends on the connected AI client and workflow: Memev supplies the shared context and coordination mechanisms, while agents and people carry out the work.

```mermaid
flowchart LR
    subgraph computer["Your computer"]
        apps["AI apps<br/>Claude Code, Codex, Gemini CLI,<br/>Cursor, Claude Desktop and more"]
        vault[("Shared context<br/>Markdown vault, decisions,<br/>project state and recall")]
        bus["Coordination bus<br/>presence, messages,<br/>task handoffs"]
        apps <--> vault
        apps <--> bus
        bus --- vault
    end
    github[("Your private GitHub repository<br/>backup and history")]
    cloud["Cloud AI apps side by side<br/>Claude, ChatGPT, more coming soon"]
    laptop["Your other computers<br/>each with its own key"]
    vault -- "backup every few minutes" --> github
    cloud -. "optional secure link,<br/>off until you switch it on" .-> vault
    laptop -. "the same secure link" .-> vault
```

## How shared context and coordination work

```mermaid
flowchart TD
    a["Open a supported AI session"] --> b["Load relevant project context"]
    b --> c["Work on a task"]
    c --> d["Record useful decisions and state"]
    d --> e["Share task or status through the comms bus"]
    e --> f["Another connected session picks up the handoff"]
    f --> g["Check the result against task requirements"]
    g --> h["Save the outcome for the next session"]
    h --> b
```

Memev keeps project context available without making you copy the same background into every new session. Retrieval is scoped and relevance-based, so the shared context stays useful rather than becoming a transcript dump. Connected sessions can coordinate through the communications bus, and work contracts provide a way to state what a task must deliver and retain verification results where the relevant checks are available.

<p align="center">
<img src="docs/assets/demo.gif" alt="Tell Claude, Cursor knows: one app saves a fact, the next session in another app recalls it" width="480">
</p>

## Install

You need Node 22 or newer and git. Every path below sets up the same thing: it creates your notes
folder, starts Memev, connects the AI apps it finds on your computer and runs a self-test. The
command at the top of this page installs Memev from this folder with npm; run it in a copy of this
repository. The rest of this section covers the other paths.

Memev runs on macOS and Linux. **Windows (preview):** setup, app connections, hooks and the doctor
have Windows code paths and tests, and a Windows job runs them on every change to `main`, but
Windows has not had a full lab run yet. Memev starts at login there through a per-user Task Scheduler
entry that `memev service install` creates. [docs/QUICKSTART.md](docs/QUICKSTART.md#windows-preview) says
what differs.

### All the install paths

| Path | Who it's for | What happens on its own |
|---|---|---|
| Ask your AI app to do it | anyone already using Claude Code, Codex, Gemini CLI or Cursor | the app downloads Memev and runs the setup; you read the checklist it shows you |
| One command in a download | anyone comfortable with a terminal | the same setup, run by you |
| npm, from a download | people who like a global `memev` command | the same, plus `memev` on your PATH |
| Docker | an always-on server or a home lab | Memev runs in a container; you connect apps by hand |
| `npx memev init` | everyone | coming soon (not on the npm registry yet) |
| One-line installer for macOS, Linux and Windows | everyone | coming soon |

To have your AI app do it, paste this into a session:

> Download the Memev repository, run `node bin/memev.mjs init` inside it, and show me the checklist
> it prints.

To do it yourself, run this in the folder you downloaded:

```sh
node bin/memev.mjs init
```

For a global `memev` command, run `npm install -g . && memev init` there instead. For Docker,
`docker compose up -d` builds the image on your machine; see [docs/DOCKER.md](docs/DOCKER.md).

After setup, two things may need you: one browser sign-in for the GitHub backup
(`memev github setup`), and a click in apps that ask before they trust a new tool. The checklist
says which. Details are in [docs/QUICKSTART.md](docs/QUICKSTART.md).

To see shared context working, run `memev ready` and open a new session in each app. It prints each
app as it joins, then confirms that connected apps share project context when one recalls something
another saved. For coordination, see [docs/BUS.md](docs/BUS.md); for defined work and verification,
see [docs/CONTRACTS.md](docs/CONTRACTS.md).

## Plans and roadmap

Every line below says whether it exists. Nothing in the second and third lists is available to use today.

### Available now

- The vault: Markdown notes in git, a checksummed log, project-aware recall, provenance and the entity graph. `memev import` brings in existing project folders, AI history and chat exports.
- MCP access for the supported AI apps, with hooks where an app supports them, and optional cloud AI connectors over a secure link.
- The communications bus: seats, roster, heartbeats, communications checks, task handoffs and holds.
- Work contracts with signed, immutable specs and checks that run through `memev verify`.
- Device keys, a licence checked offline, and the computer limit.
- Backup to your own private GitHub repository.
- The call-out boundary to a separately licensed convergence engine (WO-05-A, [docs/CONVERGENCE.md](docs/CONVERGENCE.md)). The engine itself is not in this repository and no released Memev merges through it yet.

### In progress

- The project engine: the project store, the project state machine and the coordinator are merged and tested, and are being wired into one execution path. Tracked in the Scope One work breakdown (pull request [#324](https://github.com/mgillr/memev/pull/324)) and in [docs/scope-one/RECONCILIATION.md](docs/scope-one/RECONCILIATION.md).
- The paid-engine client behind a flag, off by default (pull request [#201](https://github.com/mgillr/memev/pull/201)), with the trial licence and entitlement work ([#154](https://github.com/mgillr/memev/pull/154), [#163](https://github.com/mgillr/memev/pull/163), [#177](https://github.com/mgillr/memev/pull/177)).
- Correctness fixes in the crdt-merge engine itself, in its own repository.
- The programme decomposition of the wider plan, as proposed and unsigned contracts: [docs/scope-one/programme/README.md](docs/scope-one/programme/README.md).
- Documentation and tier alignment to the owner decisions of 31 October 2026.

### Planned

- Automatic merging when several computers edit one vault at once, through crdt-merge (Personal).
- Hosted end-to-end encrypted sync, hosted encrypted backup and a stable relay address.
- A company vault with an admin console, one AI provider per organisation, sign-in with Google Workspace or Microsoft Entra ID, roles, an egress log, and a Business trial.
- A single replicated event model across the log, the bus and project state, and evidence receipts for accepted work.
- Federation across independent sites, an architecture under review in pull request [#224](https://github.com/mgillr/memev/pull/224), and decided only in part. It is not available, and Memev makes no claim about it beyond this line.

## What you get

### Shared context

Your project knowledge lives as plain Markdown in `~/memev`, kept in git. Every change is written to a checksummed log first. Claude Code, Codex, Gemini CLI, Cursor, Claude Desktop, Windsurf, VS Code and Zed can use the same notes, and cloud AI apps such as Claude and ChatGPT can connect side by side through the optional secure link. Session resume cards, project-aware recall, provenance and the graph help connected tools pick up relevant context instead of starting from scratch. To start with what you have already worked on, `memev import` reads project folders, AI history files, and chat export zips, previews what it found, and writes tagged, undoable notes with no model or network calls ([docs/IMPORT.md](docs/IMPORT.md)). See [docs/DESIGN.md](docs/DESIGN.md) and [docs/CLIENTS.md](docs/CLIENTS.md).

### Coordination between connected sessions

Each connected app gets a seat on Memev's communications bus, joins the roster and reports a heartbeat. From one session, you can see which peers are present, run a communications check, hand out tasks and put an app on hold. The bus gives supported agents a shared coordination channel; the exact execution of a handoff depends on the connected client and workflow. See [docs/BUS.md](docs/BUS.md).

### Defined work and verification

Work contracts let you record the task, expected deliverables, acceptance criteria and stop conditions. Where checks are run, their outcomes and receipts can be retained alongside the work. This makes it possible to distinguish a task being assigned from evidence that its requirements were met. See [docs/CONTRACTS.md](docs/CONTRACTS.md).

### Trust and control

You can inspect what Memev holds. `memev why` shows why a note came back, and `memev audit` lists junk and stale notes. Notes from one project are scoped away from another, and notes in Chinese, Japanese, Korean, Cyrillic, Greek or Arabic are searchable like any other. The vault stays on your computer and can be backed up to your own private GitHub repository. Cloud access is optional and off until you enable it; when you connect a cloud AI provider, that provider's own data handling still applies. Memev has no telemetry by default. The anonymous milestone report is off unless you turn it on with `memev report on`, and `memev report show` prints exactly what it would send ([docs/METRICS.md](docs/METRICS.md)).

## Documentation

Everything is indexed in [docs/README.md](docs/README.md), from this page down to each module and back
up. The main pages:

| | |
|---|---|
| [Quickstart](docs/QUICKSTART.md) | install, first session, everyday commands |
| [Architecture](docs/ARCHITECTURE.md) | what runs today, and the Personal, Business and Corporate charts |
| [Module map](docs/MODULES.md) | every module and what imports what, generated from the code |
| [AI apps](docs/CLIENTS.md) | what is changed in each app, hooks vs instructions, undoing it |
| [Cloud access](docs/CLOUD.md) | the secure link, connector URLs, other computers, turning it on |
| [Comms bus](docs/BUS.md) | how your AI apps talk to each other, the roster and comms checks |
| [Set up your office](docs/OFFICE.md) | one vault, inviting teammates, the lead, the roster and what is shared |
| [GitHub backup](docs/GITHUB.md) | `memev github setup` |
| [Docker](docs/DOCKER.md) | running Memev in a container |
| [Tiers and setup](docs/tiers/README.md) | Free core, Personal, and the contact-us tiers, and the services around them (draft) |
| [The paid core: crdt-merge](docs/CONVERGENCE.md) | what is open, what is paid, what passes between an install and us |
| [Pricing (draft)](docs/PRICING.md) | the Personal price; everything above on request; the computer limit |
| [Decisions](docs/scope-one/DECISIONS.md) | the owner decisions on the engine and the tiers |
| [Reconciliation](docs/scope-one/RECONCILIATION.md) | how the plans line up with the Scope One work breakdown |
| [Problems and solutions](docs/SOLUTIONS.md) | what users complain about and what Memev does about it |
| [Contracts](docs/CONTRACTS.md) | signed, immutable work contracts |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | `memev doctor` and common fixes |
| [Lab test plan](docs/testing/LAB-TEST-PLAN.md) | every test to run in a lab before a release, with expected results |
| [Security](SECURITY.md) and [threat model](docs/THREAT-MODEL.md) | |
| [Charter](CHARTER.md) | the free tier is never limited |
| [Design](docs/DESIGN.md) | log, index, graph, recall, scale |
| [Hands-off runtime](docs/MAPPING.md) | everything Memev does without being asked |
| [Developing Memev](docs/DEVELOPING.md) | tests, the leak scan, changelog notes, regenerating the module map |

## For developers

Memev is a local MCP server and coordination layer built around a Markdown vault. Each session starts with a resume card, supported prompts can receive relevant project context (in apps with hooks), and state is saved before a compaction. The same core exposes the communications bus and work-contract mechanisms, bringing context, coordination and verification into one project workflow.
The graph holds entities, links and claims with a status (fact, theory, conjecture) and provenance.
Recall is BM25 over note sections, filtered by project and permissions before ranking. Node 22,
nothing else. See [docs/DESIGN.md](docs/DESIGN.md), the [module map](docs/MODULES.md) and
[docs/DEVELOPING.md](docs/DEVELOPING.md).

## Licensing

- **Memev core: Apache-2.0.** The code in this repository is Apache-2.0 and stays that way. It includes a modified copy of Proofline (Apache-2.0); see [NOTICE](NOTICE).
- **crdt-merge: BSL 1.1, separately licensed.** The convergence engine is a separate project in its own repository, licensed under the Business Source License 1.1 by its Licensor, Ryan Gillespie / Optitransfer, and it carries patents (see its PATENTS file). It is never copied or vendored into Memev. Memev reaches it only across the provider boundary, so including it can never relicense it. Its change date to Apache-2.0 is 2028-03-29; a lawyer review of that date is an open item.
- **Commercial terms:** anything beyond the free core and Personal, including federated services, is agreed through contact us.

See [docs/LICENSING-NOTICE.md](docs/LICENSING-NOTICE.md), [docs/CONVERGENCE.md](docs/CONVERGENCE.md) and [docs/PRICING.md](docs/PRICING.md).
