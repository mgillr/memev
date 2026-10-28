# Pricing and licensing: DRAFT

> **DRAFT. Not an offer and not in force.** The list below is the current table.
> Self-serve checkout is Personal only, through Stripe, in test mode first. The checkout program
> reads product ids, prices and the computer cap from config.
> Team and Business have a list price and stay contact us until the features they need are built.
> Enterprise is contact us. Hosted features are planned, with no date. There is no trial.
> What the licence enforces today is how many computers can use one vault. One computer with no
> licence gets the Free tier ([CHARTER.md](../CHARTER.md)). Memev is licensed under Apache-2.0
> today. Any licence change for future releases awaits legal review.

## Tiers (draft)

| | Free | Personal | Team | Business | Enterprise |
|---|---|---|---|---|---|
| Price | free | $15/month or $144/year | $18/seat/month billed yearly ($216/seat/year), or $22/seat/month billed monthly. Contact us until member keys ship. | $24/seat/month billed yearly, setup quoted. Contact us. | contact us |
| People | 1 | 1, non-transferable | 2 to 20 | from 10 | contact us |
| Computers using one vault | 1 | up to 3 | 3 per seat, pooled | 3 per seat, pooled | based on your requirements |
| Local AI apps on a computer | unlimited | unlimited | unlimited | unlimited | unlimited |
| Cloud AI connectors | 5 | 10 | 10 per seat, pooled | based on your requirements | based on your requirements |
| Vault, recall, graph, contracts, doctor, your own tunnel | ✓ | ✓ | ✓ | ✓ | ✓ |
| Backup to your own GitHub (one writer) | ✓ | ✓ | ✓ | ✓ | ✓ |
| One memory for every AI app, and the comms bus between them | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hosted end-to-end encrypted sync between computers | | planned | planned | | planned, or self-hosted |
| Hosted encrypted backup and a stable relay address | | planned | planned | | planned, or self-hosted |
| One shared vault for a team over the secure link, provenance | | | ✓ | ✓ | ✓ |
| Member keys: one key per person, covering their computers | | | planned | planned | planned |
| Company hub on your server, departments and roles from an org chart | | | | planned | planned |
| Sign-in with Google Workspace or Microsoft Entra ID | | | | planned | planned |
| Restricted notes served only to a local model, egress log | | | | planned | planned |
| SCIM, SIEM and audit export, retention, legal hold, high availability | | | | | planned |

Personal is sold for what exists today: the Free core on up to 3 computers, so the AI apps on all of
them share one memory and one comms bus. A cell marked *planned* is not built and is not part of what
you pay for. Personal and Team prices are early-supporter prices: the price stays locked for as long as the
subscription runs, and it is labelled that way while sync and the relay are planned. Team and
Business overlap at 10 to 20 people on purpose. You choose by need (a hub, sign-in, roles), not by
size. Office is not a tier. Hosted sync and the hosted relay are not part of Business, because its
hub runs on the company's server. Sync, the relay, the hub, sign-in, roles, labels and the egress
log are planned, not built, and no date is given. See [tiers/](tiers/README.md) for how each tier
is set up.

A Team licence count is seats times 3. For Team, Business and Enterprise the number of computers
comes from the licence you are issued.

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

Free: community help, best effort. Personal and Team: priority support, which starts from
`memev doctor --bundle`, the one file that tells support what it needs, with no secrets in it. How it
works and what the file holds: [SUPPORT.md](SUPPORT.md). Business and Enterprise service agreements
are under [Services for Business and Enterprise](#services-for-business-and-enterprise). Prices there
are quoted.

## Services (draft)

Setup (remote or onsite), support plans, a named or embedded engineer, custom development, a private
deployment we run for you, a compliance pack and training. All of them are priced on your
requirements: contact us. Onsite work has travel billed on top. What each one covers, timelines and
response times are in [tiers/services.md](tiers/services.md).

## Services for Business and Enterprise

These are for Business and Enterprise. Each price is quoted.

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
signed with any other key, is ignored and the vault counts as Free. Licences are issued with
`scripts/license/issue.mjs` by whoever holds the vendor private key, which is never in this
repository.

**Activating a key.** `memev license activate <key>` makes one HTTPS call to the licence endpoint
(`--server <url>` or `MEMEV_LICENSE_URL`; there is no built-in address, so nothing is contacted until
one is set). The call sends the key and nothing else. The answer is the signed licence file, which is
checked on this computer against the vendor public key before it is stored. A key the server refuses,
an answer that does not verify, an expired licence, or a licence that carries a name, e-mail or machine
leaves no file, and the command prints why. After that the licence is checked offline, as above.

- **Free:** one computer, no licence, no network needed.
- **Personal:** as in the table, with the number of computers in the licence.
- **Team, Business and Enterprise:** the number of computers in the licence. A Team licence count is seats times 3.

When a licence lapses, its grace period (14 days unless the licence says otherwise) keeps
everything working, and computers can still be added. After the grace period no computer can be
added and the added ones can read but not write. The vault's own computer keeps reading and
writing, hosted services stop, and the vault can fall back to git backup. Installing a renewed
licence restores the rest at once.

## Source licence

The Memev client is **Apache-2.0**. A source-available licence with a free-use grant for one
computer has been proposed for future releases; it will not be adopted without legal review and a
public announcement, and releases already published stay Apache-2.0.
