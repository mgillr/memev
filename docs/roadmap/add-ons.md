# Planned add-ons and services

> **DRAFT.** Everything on this page is **planned**. None of it is built, none of it is on sale, and
> none of it has a date. Free is free and nothing here takes anything away from it
> ([CHARTER.md](../../CHARTER.md)). A price is either **quoted** (we price it on your requirements,
> contact us) or **included in** a tier. See [PRICING.md](../PRICING.md) and the [tiers](../tiers/README.md).

These are the add-ons and services we plan to offer next to the free core, mostly for Business and
Enterprise. They are ranked by how much they would do for a customer's work, the first being the one
we would start with. A planned part goes into an offer only when it is built.

| Rank | Add-on or service | What you get | Tier | Price | Status |
|---|---|---|---|---|---|
| 1 | [Custom implementation services](#1-custom-implementation-services) | Memev wired into your own tools and way of working | Business, Enterprise | quoted per job | planned |
| 2 | [Evidence Pack](#2-evidence-pack) | A signed audit log, retention rules and an export you can hand to a reviewer | Enterprise; Business as an add-on | included in Enterprise; quoted for Business | planned |
| 3 | [Governance bundle](#3-governance-bundle) | Roles, review of held writes, a share preview and an egress log | Business, Enterprise | included in Business and Enterprise | planned |
| 4 | [Profession starter packs](#4-profession-starter-packs) | Ready-made rules, note layouts, checks and example workflows for a profession | Team, Business | one pack included in Team; more packs included in Business | planned |
| 5 | [Conflict radar](#5-conflict-radar) | Contradicting decisions shown side by side, with dates and sources | Free (your own apps), Team, Business | included in each | planned |
| 6 | [Verified work add-on](#6-verified-work-add-on) | A plain verdict on whether a change's own tests prove it | Team, Business | quoted | planned |
| 7 | [Metered hosted usage](#7-metered-hosted-usage) | More hosted sync, backup and relay room without moving up a tier | Personal, Team, Business (hosted only) | quoted | planned |
| 8 | [Per-role signing keys](#8-per-role-signing-keys) | Each note says which AI app role wrote it, on which computer, vouched for by whom | Team, Business | included in Team and Business | planned |

## 1. Custom implementation services

**What it does for you.** A business gets Memev connected to its own tools and its own way of
working, by someone who knows the setup. We build it as a [custom module](../custom-modules/README.md),
agree the scope and the checks up front, and hand it over with its acceptance checks so you can run
them yourself. Every job is written down as a use case with inputs, outputs and checks, and the ones
we have drafted are in [docs/custom-modules](../custom-modules/use-cases.md).

One short example of custom work: a business connects Memev to the project software it already uses,
so that when one team changes a plan, Memev checks the change against the other teams' plans and tells
the people involved about any clash.

**Tier.** Business and Enterprise, as a service next to [services.md](../tiers/services.md).
**Price.** Quoted per job, as a fixed-scope package.
**Status.** Planned.

## 2. Evidence Pack

**What it does for you.** Security and compliance teams can show who or which AI app wrote or read
what, show that the record was not altered, and hand a reviewer an export. It gives you evidence for
your own audits. It does not make you compliant with anything on its own, and we will not describe it
as if it did. A tamper-evident record shows a record was not changed; it does not show the record is
true.

It covers a signed audit log, retention rules with legal hold, and an export of the log. The
audit and export parts of this are already on the [tier status table](../tiers/README.md).

**Tier.** Included in Enterprise. An add-on for Business.
**Price.** Included in Enterprise; quoted for Business.
**Status.** Planned.

## 3. Governance bundle

**What it does for you.** A company can limit who sees what, hold a suspicious write for a reviewer
before it lands, preview exactly what would leave before sharing it, and keep a log of what reached
each cloud AI app. This is the reason to choose Business over Team.

The company hub can read the notes it serves, so we will never call this end-to-end encrypted.

**Tier.** Business and Enterprise.
**Price.** Included in Business and Enterprise. Not sold separately.
**Status.** Planned. Sign-in and roles come first ([tiers](../tiers/README.md)).

## 4. Profession starter packs

**What it does for you.** A new team gets value on the first day: ready-made instructions, note
layouts, checks and example workflows for a profession such as project management, legal, finance or
engineering. Packs are written by us. Packs from outside authors wait until a module can be limited
to what it is allowed to do.

**Tier.** Team and Business.
**Price.** One pack included in Team; more packs included in Business.
**Status.** Planned.

## 5. Conflict radar

**What it does for you.** When one app or person records a decision that contradicts another, Memev
shows both, with dates and sources, instead of silently overwriting one. It is a good reason for a
team to share one memory. Two notes that disagree are not always an error, so it shows them and
leaves the call to a person.

A basic local list for your own apps is part of Free. A shared view comes with Team; a weekly digest
and a reviewer workflow come with Business.

**Tier.** Free (your own apps), Team, Business.
**Price.** Included in each tier.
**Status.** Planned.

## 6. Verified work add-on

**What it does for you.** Engineering teams get a plain verdict on whether a change's own tests prove
the change, and every AI app on the team remembers the verdict. The verdict says what the tests do
and do not show. It is not a security guarantee and the page will never say a change is proven safe.

**Tier.** Team and Business.
**Price.** Quoted.
**Status.** Planned.

## 7. Metered hosted usage

**What it does for you.** Heavy users of hosted sync, backup and relay can buy more room without
moving up a tier. We would meter storage and relay hours, not individual operations. The free tier is
never metered, limited or nagged, and the hosted services are not built yet.

**Tier.** Personal, Team and Business, hosted services only.
**Price.** Quoted.
**Status.** Planned.

## 8. Per-role signing keys

**What it does for you.** Every note says which AI app role wrote it, on which computer, vouched for
by which person, and a lost key can be revoked. Memev already has a key per computer; this adds a key
per role. We will say plainly where the key is stored on your machine.

**Tier.** Team and Business.
**Price.** Included in Team and Business.
**Status.** Planned.

## How we decide what ships

Nothing on this page is sold before it is built. When a part is built it moves to the status table in
[docs/tiers/README.md](../tiers/README.md), and only then goes into an offer. Custom modules and their
use cases are in [docs/custom-modules](../custom-modules/README.md).
