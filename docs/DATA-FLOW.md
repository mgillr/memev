# Data flow: what passes between an install and our side

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

One page, the whole answer. By default, what passes between an install and the operator's side is
licence information only, plus the opt-in milestone report, as
[CONVERGENCE.md](CONVERGENCE.md#what-passes-between-an-install-and-our-side) and
[METRICS.md](METRICS.md) state. This page lists that default, and the connections you start
yourself, which carry what they carry.

## Every outbound call a default install can make

- The licence activation: the one call `memev license activate <key>` makes to the licence endpoint
  you configure. The key goes out, a signed licence comes back, and no vault data ever does.
- The backup to your own remote: git pushes to the private repository you set up. `memev github
  setup` gives this machine a deploy key the threat model scopes to that one repository, and
  `memev backup set <git-url>` backs up to any private git remote on that remote's own credentials.
  `memev init` on a new root also looks for an existing Memev backup to join, listing your private
  repositories and checking each README, with no opt-in.
- The secure link: the tunnel you switch on with `memev cloud on`, off by default on every install.

Nothing else by default. No telemetry: nothing in the product reports anything unless you turn on a
report that is off by default. The anonymous milestone report is opt-in, off by default, and holds
only milestone names, days and a random id; `memev report show` prints exactly what it would send.
It is not a default call, and it is the only report.

## Connections you start yourself

These are not default calls. You start each one, and each carries what it carries:

- The setup session: `memev setup remote --code <setup-code>` lets the operator run a short
  allowlist of commands (doctor, status, deployment, license, devices, connect, ready) and sends the
  output, up to 64000 characters, to the operator.
- The join: `memev join <code>` makes an Ed25519 key on the computer, keeps the private key there,
  and sends the public key and the invite code to the vault, which mints a device credential and
  sends it back.
- The relay: `memev cloud relay on --url relay://host:port --domain NAME` routes calls through the
  relay you name.
- The cloudflared download: `memev cloud on` downloads cloudflared from GitHub releases, verified by
  sha256.
- The doctor probe: `memev doctor` opens a TCP connection to github.com on 22 and to ssh.github.com
  on 443 when the backup remote is a GitHub ssh URL.

## What never leaves

Vault data never goes to the licence server: no notes, no file names, no vault id, and no machine
name. The backup goes to your own private repository, and the report, if you turn it on, holds only
milestone names, days and a random id.
