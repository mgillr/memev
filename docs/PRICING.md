# Pricing and licensing: DRAFT

> **DRAFT. Not an offer and not in force.** Prices, tiers and licence terms below are proposals.
> Only Free and Personal have a set price. Everything else is priced on your requirements: contact us.
> One thing is enforced: how many computers can use one vault, from the licence. Connectors are
> counted, not limited, and one computer with no licence gets everything
> ([CHARTER.md](../CHARTER.md)). Memev is licensed under Apache-2.0 today. Any licence change for
> future releases awaits legal review.

## Tiers (draft)

| | Free | Personal | Team | Office | Business (planned) | Enterprise |
|---|---|---|---|---|---|---|
| Price | free | $15/month or $144/year | contact us | contact us | contact us | contact us |
| Computers using one vault | 1 | up to 4 (+$4/month each) | per computer, at least 3 | 10 or 25 | 10 to 50, in blocks of 10 | based on your requirements |
| Local AI apps on a computer | unlimited | unlimited | unlimited | unlimited | unlimited | unlimited |
| Cloud AI connectors | 5 | 10 | 5 per computer | 50 or 125 | 50 per 10 computers | based on your requirements |
| Vault, recall, graph, contracts, doctor, your own tunnel | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Backup to your own GitHub (one writer) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hosted end-to-end encrypted sync between computers | | ✓ | ✓ | ✓ | | ✓ or self-hosted |
| Hosted encrypted backup and a stable relay address | | ✓ | ✓ | ✓ | | ✓ or self-hosted |
| One shared vault for a team, member keys, provenance | | | ✓ | ✓ | ✓ | ✓ |
| Company hub on your server, departments and roles from an org chart | | | | | ✓ | ✓ |
| Sign-in with Google Workspace or Microsoft Entra ID | | | | | ✓ | ✓ |
| Restricted notes served only to a local model, egress log | | | | | ✓ | ✓ |
| SCIM, SIEM and audit export, retention, legal hold, high availability | | | | | | ✓ |

Business is the tier for a company that runs its own hub; Office is several computers sharing one
vault without a hub. Hosted sync and the hosted relay are not part of Business because its hub runs
on the company's server. Sync, the relay, the hub, sign-in, roles, labels and the egress log are
planned, not built; see [tiers/](tiers/README.md) for what each tier includes and how it is set up.

For Team, Office, Business and Enterprise the number of computers comes from the licence you are
issued.

**A computer** is a machine that runs its own copy of the vault, or whose AI apps reach a vault
remotely (through a tunnel or relay). The vault's own computer is one of them. Each added computer
counts from the moment it is enrolled until it is removed with `memev devices remove <id>`, which
frees the seat at once. Phones and tablets that use a cloud AI app are covered by the connector
allowance.

## Services (draft)

Setup (remote or onsite), support plans, a named or embedded engineer, custom development, a private
deployment we run for you, a compliance pack and training. All of them are priced on your
requirements: contact us. Onsite work has travel billed on top. What each one covers, timelines and
response times are in [tiers/services.md](tiers/services.md).

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
`memev license install <file>`) with an id, tier, services, number of computers, number of
connectors, issue and expiry dates and grace days. It holds no name, e-mail, machine or vault
information. It is checked offline against the vendor public key built into
`src/engine/license.mjs`; Memev never calls home to check it. A licence that has been edited, or was
signed with any other key, is ignored and the vault counts as Free. Licences are issued with
`scripts/license/issue.mjs` by whoever holds the vendor private key, which is never in this
repository.

- **Free:** one computer, no licence, no network needed.
- **Personal:** as in the table, with the number of computers in the licence.
- **Team, Office, Business and Enterprise:** the number of computers in the licence.

When a licence lapses, its grace period (14 days unless the licence says otherwise) keeps
everything working, and computers can still be added. After the grace period no computer can be
added and the added ones can read but not write. The vault's own computer keeps reading and
writing, hosted services stop, and the vault can fall back to git backup. Installing a renewed
licence restores the rest at once.

## Source licence

The Memev client is **Apache-2.0**. A source-available licence with a free-use grant for one
computer has been proposed for future releases; it will not be adopted without legal review and a
public announcement, and releases already published stay Apache-2.0.
