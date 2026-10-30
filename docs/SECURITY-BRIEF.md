# The customer security brief

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

The questions a buyer asks before a trial, answered here without a call. Each answer links to the
page that holds the detail.

## Where do the notes live?

On your computer, in the vault. The files under `.memev/` and in the config directory are created
readable by your user only, and the daemon listens on loopback. The vault is plain Markdown, and
the backup is a git push to a private repository you own, on a deploy key limited to that one
repository. The layout is in [QUICKSTART.md](QUICKSTART.md), the backup in [GITHUB.md](GITHUB.md).

## What leaves the computer?

Nothing by default. The only outbound calls a default install can make are the licence activation,
the backup to your own remote, and the secure link you switch on. The anonymous milestone report is
off until you turn it on, and `memev report show` prints exactly what it would send. No telemetry.
The full list, with what each call carries, is in [DATA-FLOW.md](DATA-FLOW.md), and what is never
counted is in [METRICS.md](METRICS.md).

## How is a credential scoped and revoked?

Every token is scoped (read, write, admin), can be limited to paths, expires, and is stored hashed.
`memev token revoke` and `memev token rotate` cut one token off. Each computer has its own device
credential, made on that computer and never sent anywhere, and `memev devices rotate` or
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
built: [tiers/README.md](tiers/README.md#what-is-built-and-what-is-planned). The paid parts rest on
the convergence engine, a separate component under its own licence, not in this repository:
[CONVERGENCE.md](CONVERGENCE.md).
