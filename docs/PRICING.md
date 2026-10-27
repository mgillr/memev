# Pricing and licensing: DRAFT

> **DRAFT. Not an offer and not in force.** Prices, tiers and licence terms below are proposals.
> Nothing is enforced: Memev reports computers and connectors and never limits them
> ([CHARTER.md](../CHARTER.md)). Memev is licensed under Apache-2.0 today. Any licence change for
> future releases awaits legal review.

## Tiers (draft)

| | Free | Personal | Team | Office | Enterprise |
|---|---|---|---|---|---|
| Price (draft) | $0 | $15/month or $144/year | $12 per computer per month, at least 3 | $99/month for 10 computers, $219/month for 25 | by contract |
| Computers using one vault | 1 | up to 4 (+$4/month each) | per computer | 10 or 25 | by contract |
| Local AI apps on a computer | unlimited | unlimited | unlimited | unlimited | unlimited |
| Cloud AI connectors | 5 | 10 | 5 per computer | 50 or 125 | by contract |
| Vault, recall, graph, contracts, doctor, your own tunnel | ✓ | ✓ | ✓ | ✓ | ✓ |
| Backup to your own GitHub (one writer) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hosted end-to-end encrypted sync between computers | | ✓ | ✓ | ✓ | ✓ or self-hosted |
| Hosted encrypted backup and a stable relay address | | ✓ | ✓ | ✓ | ✓ or self-hosted |
| One shared vault for a team, member keys, provenance | | | ✓ | ✓ | ✓ |
| SSO, SCIM, audit export | | | | | ✓ |

**A computer** is a machine that runs its own copy of the vault, or whose AI apps reach a vault
remotely (through a tunnel or relay). It counts while it is enrolled and has been seen in the last
30 days; `memev devices revoke` frees it at once. Phones and tablets that use a cloud AI app are
covered by the connector allowance.

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
