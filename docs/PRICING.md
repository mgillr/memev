# Pricing and licensing: DRAFT

> **DRAFT. Not an offer and not in force.** Prices, tiers and licence terms below are proposals.
> Nothing is enforced: Memev reports computers and connectors and never limits them
> ([CHARTER.md](../CHARTER.md)). Memev is licensed under Apache-2.0 today. Any licence change for
> future releases awaits legal review.

## Tiers (draft)

| | Free | Personal | Team | Office | Business (planned) | Enterprise |
|---|---|---|---|---|---|---|
| Price (draft) | $0 | $15/month or $144/year | $12 per computer per month, at least 3 | $99/month for 10 computers, $219/month for 25 | $199/month per 10 computers, plus $2,500 remote setup | by contract |
| Computers using one vault | 1 | up to 4 (+$4/month each) | per computer | 10 or 25 | 10 to 50, in blocks of 10 | by contract |
| Local AI apps on a computer | unlimited | unlimited | unlimited | unlimited | unlimited | unlimited |
| Cloud AI connectors | 5 | 10 | 5 per computer | 50 or 125 | 50 per 10 computers | by contract |
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

**A computer** is a machine that runs its own copy of the vault, or whose AI apps reach a vault
remotely (through a tunnel or relay). It counts while it is enrolled and has been seen in the last
30 days; `memev devices revoke` frees it at once. Phones and tablets that use a cloud AI app are
covered by the connector allowance.

## Services (draft)

| Service | Draft price |
|---|---|
| Onboarding | $750 small; $2,500 Business setup ($3,500 with a local model server); from $12,000 Enterprise |
| Business support | 20% of the yearly subscription, at least $2,400/year |
| Named engineer | $1,950/month |
| Embedded engineer | $6,500/month |
| Custom development | $1,600/day |
| Private deployment | from $6,000/year |
| Compliance pack | $5,000 once or $15,000/year |
| Training | $1,200 workshop, $2,400 admin day |
| Onsite work | $1,600 per engineer per day, travel days $800, travel and expenses at cost |

Details, timelines and response times: [tiers/services.md](tiers/services.md).

## How counting works (report only)

- Every computer and app has its own credential (`memev devices`); there is no shared key.
- Requests are classified as a local app, a cloud AI connector or a remote computer. A connector
  credential used by something that is not a cloud AI app is counted as a computer.
- A computer credential used from two networks within minutes is flagged as possibly copied.
- `memev license status` and `memev doctor` show the counts and notes. **Nothing is refused.**

## Licences (draft)

A licence is a small signed file (`~/.config/memev/license.json`) with an id, tier, services,
number of computers, number of connectors, issue and expiry dates and grace days. It holds no name,
e-mail, machine or vault information and is checked offline with Ed25519 (`src/engine/license.mjs`).
Today a licence changes only what the status report says.

When a licence lapses: hosted services stop after the grace period; the local vault keeps working,
read and write, and can fall back to git backup.

## Source licence

The Memev client is **Apache-2.0**. A source-available licence with a free-use grant for one
computer has been proposed for future releases; it will not be adopted without legal review and a
public announcement, and releases already published stay Apache-2.0.
