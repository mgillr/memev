# The customer security brief

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

The questions a buyer asks before a trial, answered here without a call. Each answer links to the
page that holds the detail.

## Where do the notes live?

On your computer, in the vault. The files under `.memev/` and in the config directory are created
readable by your user only, and the daemon listens on loopback. The vault is plain Markdown, and
the backup is a git push to a private repository you own. `memev github setup` gives the machine a
deploy key limited to that one repository; `memev backup set <git-url>` pushes to any private git
remote on that remote's own credentials. The layout is in [QUICKSTART.md](QUICKSTART.md), the
backup in [GITHUB.md](GITHUB.md).

## What leaves the computer?

Nothing by default, except the backup push to your own remote and the one lookup `memev init` makes
for an existing backup to join, which lists your private repositories with no opt-in. The secure
link is off until you switch it on, and the anonymous milestone report is off until you turn it on;
`memev report show` prints exactly what it would send. No telemetry. What each call carries: the
backup is the whole vault as plain Markdown on the remote, and the secure link carries what recall
returns to the cloud AI app. The setup session, the join, the relay, the cloudflared download and
the doctor probe are connections you start yourself. The full list is in [DATA-FLOW.md](DATA-FLOW.md),
and what is never counted is in [METRICS.md](METRICS.md).

## How is a credential scoped and revoked?

Every token is scoped (read, write, admin), can be limited to paths, and is stored hashed. Each one
expires, except the admin token `memev init` mints, which has no expiry until you revoke it.
`memev token revoke` and `memev token rotate` cut one token off. Each computer makes its own
Ed25519 device key, and the private half never leaves that computer; the vault mints the device
credential and sends it to the joining computer, and `memev devices rotate` or
`memev devices remove <id>` cuts off one computer alone. The detail is in
[SECURITY.md](../SECURITY.md).

## What the threat model covers, and what it leaves out

The threat model covers the vault contents, the tokens, the contract signing key and the integrity
of the log, with a mitigation for each threat: another user on the machine, a web page calling the
local API, a found tunnel address, a copied credential, a leaked token, a prompt-injected session,
a pasted secret, a quietly weakened contract, a crash mid-write, a tampered download, and a stolen
backup key. It leaves out an attacker who already runs code as your user, the AI apps themselves,
and the security of the services you connect to. The full table is in
[THREAT-MODEL.md](THREAT-MODEL.md).

## What is built and what is planned

The status table says which part is built and which is planned, and nothing is sold before it is
built: [tiers/README.md](tiers/README.md#what-is-built-and-what-is-planned). The paid tier sold
today runs on the free core; the convergence engine, which does the planned merge of concurrent
edits, is a separate component under its own licence, not in this repository:
[CONVERGENCE.md](CONVERGENCE.md).
