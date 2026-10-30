# Pricing and licensing: DRAFT

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Down: [tiers/](tiers/README.md),
[CHECKOUT.md](CHECKOUT.md), [REFERRAL.md](REFERRAL.md), [CONVERGENCE.md](CONVERGENCE.md).

> **DRAFT. Not an offer and not in force.** The list below is the current table (decided 28 October
> 2026). The Memev core is free. Self-serve checkout is Personal only, through Stripe, in test mode
> first. The checkout program reads product ids, prices and the computer cap from config. Business and
> Corporate have no public price: contact us. Hosted features are planned, with no date. There is no
> Personal trial; Business has a time-limited trial (planned, see below). What the licence enforces
> today is how many computers can use one
> vault. One computer with no licence gets the Personal tier ([CHARTER.md](../CHARTER.md)). The Memev core
> is licensed under Apache-2.0 and stays that way ([LICENSING-NOTICE.md](LICENSING-NOTICE.md)).

## Tiers (draft)

| | Personal | Personal with more computers | Business | Corporate |
|---|---|---|---|---|
| Price | free | $12/month or $120/year | contact us | contact us |
| People | 1 | 1, non-transferable | counted once per organisation | counted once per organisation |
| Computers using one vault | 1 | up to 3 | counted once per organisation, by computer | counted once per organisation, by computer |
| Local AI apps on a computer | unlimited | unlimited | unlimited | unlimited |
| Cloud AI connectors | 5 | 10 | based on your requirements | based on your requirements |
| Trial | no Personal trial | no Personal trial | time-limited trial: 5 members and 10 computers, 14 days with one 14-day extension (planned), see [BUSINESS-TRIAL.md](BUSINESS-TRIAL.md) | sales-assisted pilot (planned) |
| Vault, recall, graph, contracts, doctor, your own tunnel | ✓ | ✓ | ✓ | ✓ |
| Backup to your own GitHub (one writer) | ✓ | ✓ | ✓ | ✓ |
| One memory for every AI app, and the comms bus between them | ✓ | ✓ | ✓ | ✓ |
| Several computers on one vault over the secure link, provenance | | ✓ | ✓ | ✓ |
| Automatic merge when several computers edit at once (crdt-merge) | | planned | planned | planned |
| Hosted end-to-end encrypted sync between computers | | planned | | planned, or self-hosted |
| Hosted encrypted backup and a stable relay address | | planned | | planned, or self-hosted |
| Member keys: one key per person, covering their computers | | | planned | planned |
| One company vault that all members' work data syncs into, with an admin console that sees and searches it | | | planned | planned |
| Provider policy: restrict to one provider, egress rules | | | planned | planned |
| Company server, departments and roles from an org chart | | | planned | planned |
| Sign-in with Google Workspace or Microsoft Entra ID | | | planned | planned |
| Rules for what reaches the AI provider, egress log | | | planned | planned |
| SCIM, SIEM and audit export, retention, legal hold, high availability | | | | planned |

Personal with more computers is sold for what exists today: the free core on up to 3 computers, so the
AI apps on all of them share one memory and one comms bus. A person can connect several cloud AI apps
side by side (Claude and ChatGPT today, more coming soon) and local coding tools over MCP. A cell
marked *planned* is not built and is not part of what you pay for. The Personal with more computers
price is an early-supporter price: it stays locked for as long as the subscription runs, and it is
labelled that way while sync and the relay are planned. Business and Corporate are one model at two
scales and are chosen by need (a company vault, sign-in, roles, high availability), not by size.
A team of people buys Business and contacts us for a price. Office and Team are not tiers. Hosted sync
and the hosted relay are not part of Business, because its
company server runs on the company's own server. Sync, the relay, the company server, sign-in, roles,
labels and the egress log are planned, not built, and no date is given. See [tiers/](tiers/README.md)
for how each tier is set up.

**Every tier is provider-neutral.** Members use the AI providers and tools the organisation's policy
allows, cloud AI services or an on-premises LLM; an organisation may restrict itself to one provider
by policy, with egress rules and labels (planned). Business has one company vault; all members' work
data syncs into it and the company can see and search everything in it. Members keep private work
outside Memev. Corporate has one main corporate vault.

**Several sites and federation (planned).** The architectural target is a federation of
independently operated site nodes, each owning its node and its memory and converging authorised
state through the convergence engine under its contract. The company vault above is the one-node
case of that target, and it is what the first Business release ships. Federation across sites, and
federated computation on top of it, are planned capabilities of Corporate, and of a multi-site
Business by agreement. They are not a tier, they have no column and no price cell in the table
above, and they are not sold before they are built. See [tiers/README.md](tiers/README.md),
[FEDERATION.md](FEDERATION.md) and [FEDERATED-COMPUTATION.md](FEDERATED-COMPUTATION.md).

**Licences count once per organisation, by person and by computer.** Today the vault counts
computers only; counting people is planned with Business.

**Business trial (planned):** a time-limited trial, 5 members and 10 computers, 14 days with one
14-day extension. Self-serve for an organisation that uses hosted AI providers, or a mix of hosted
providers and local tools; a sales-assisted pilot for organisations that are on-premises,
air-gapped or led by compliance. The terms, the two paths and what happens at the end:
[BUSINESS-TRIAL.md](BUSINESS-TRIAL.md).

**The paid engine.** The features marked *crdt-merge* rest on the convergence engine crdt-merge, which
lives in its own repository and is called by Memev as an external dependency. See
[CONVERGENCE.md](CONVERGENCE.md).

For Business and Corporate the number of computers comes from the licence you are issued.

**A computer** is a machine that runs its own copy of the vault, or whose AI apps reach a vault
remotely (through a tunnel or relay). The vault's own computer is one of them. Each added computer
counts from the moment it is enrolled until it is removed with `memev devices remove <id>`, which
frees the seat at once. Phones and tablets that use a cloud AI app are covered by the connector
allowance.

## Referral credit (draft)

A customer on a running Personal subscription can opt in to a referral code. When a new customer
enters that code at Stripe checkout and their first Personal payment succeeds, the referrer gets
one free month of Personal. The referred customer pays the normal price. There is no in-app
tracking and no telemetry: the code is issued and redeemed by Stripe, and Memev never sees it.
The full mechanism: [REFERRAL.md](REFERRAL.md).

## Support (draft)

Personal: community help, best effort. Personal with more computers: priority support, which starts from
`memev doctor --bundle`, the one file that tells support what it needs, with no secrets in it. How it
works and what the file holds: [SUPPORT.md](SUPPORT.md). Business and Corporate service agreements
are under [Services for Business and Corporate](#services-for-business-and-corporate). Prices there
are quoted.

## Services (draft)

Setup (remote or onsite), support plans, a named or embedded engineer, custom development, a private
deployment we run for you, a compliance pack and training. All of them are priced on your
requirements: contact us. Onsite work has travel billed on top. What each one covers, timelines and
response times are in [tiers/services.md](tiers/services.md).

## Services for Business and Corporate

These are for Business and Corporate. Each price is quoted.

**Service agreements**

- Standard: business-hours support. Quoted.
- Priority support. Quoted.
- 24/7 support with a critical-issue response target. Quoted.

**Onboarding**

- Remote setup package. Quoted.
- In-person setup. Quoted.

**Training and workshops.** Quoted.

**Managed hosting** is an option. Quoted.

## How the computer limit works

- Each added computer makes its own Ed25519 key with `memev devices keygen`. The private key stays
  on that computer. The vault admin enrolls the public key
  (`memev devices enroll --kind remote-computer --pubkey <key>`), and the computer joins with
  `memev join <url> --token <token>`.
- Every request from an added computer is signed with its key, over the method, path, time, a
  one-time nonce and the body. A token or config copied to another machine is refused there, and so
  is a replayed request.
- Enrolling past the licensed number is refused with: "This vault is licensed for N computers.
  Remove one with `memev devices remove <id>` or contact us for more." `memev devices` lists every
  device and `memev license status` shows how many of how many are in use.
- A cloud connector URL is for a cloud AI app. Pasted into a coding app on a computer it is refused,
  with a pointer to enrolling that computer with its own key.
- Apps on the vault's own computer and cloud AI connectors are not capped.

Each computer is registered with its own key, and the plan sets how many computers can join.

## Licences (draft)

A licence is a small signed file (`~/.config/memev/license.json`, installed with
`memev license install <file>`, or fetched once with `memev license activate <key>`) with an id, tier, services, number of computers, number of
connectors, issue and expiry dates and grace days. It holds no name, e-mail, machine or vault
information. It is checked offline against the vendor public key built into
`src/engine/license.mjs`; Memev never calls home to check it. A licence that has been edited, or was
signed with any other key, is ignored and the vault counts as Personal. Licences are issued with
`scripts/license/issue.mjs` by whoever holds the vendor private key, which is never in this
repository.

**Activating a key.** `memev license activate <key>` makes one HTTPS call to the licence endpoint
(`--server <url>` or `MEMEV_LICENSE_URL`; there is no built-in address, so nothing is contacted until
one is set). The call sends the key and nothing else. The answer is the signed licence file, which is
checked on this computer against the vendor public key before it is stored. A key the server refuses,
an answer that does not verify, an expired licence, or a licence that carries a name, e-mail or machine
leaves no file, and the command prints why. After that the licence is checked offline, as above.

- **Personal:** one computer, no licence, no network needed.
- **Personal with more computers:** as in the table, with the number of computers in the licence.
- **Business and Corporate:** the number of computers in the licence, issued once per organisation.

When a licence lapses, its grace period (14 days unless the licence says otherwise) keeps
everything working, and computers can still be added. After the grace period no computer can be
added and the added ones can read but not write. The vault's own computer keeps reading and
writing, hosted services stop, and the vault can fall back to git backup. Installing a renewed
licence restores the rest at once.

## Source licence

The Memev core is **Apache-2.0** and stays that way. The convergence engine, crdt-merge, is a separate
project in its own repository under its own licence, never vendored into Memev. See
[LICENSING-NOTICE.md](LICENSING-NOTICE.md) and [CONVERGENCE.md](CONVERGENCE.md).
