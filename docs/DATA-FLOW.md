# Data flow: what passes between an install and our side

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

One page, the whole answer. What passes between an install and the operator's side is licence
information only, plus the opt-in milestone report.
[CONVERGENCE.md](CONVERGENCE.md#what-passes-between-an-install-and-our-side) and
[METRICS.md](METRICS.md) state it, and this page does not add to it.

## Every outbound call a default install can make

- The licence activation: the one call `memev license activate <key>` makes to the licence endpoint
  you configure. The key goes out, a signed licence comes back, and no vault data ever does.
- The backup to your own remote: git pushes to the private repository you set up, on a deploy key
  the threat model scopes to that one repository.
- The secure link: the tunnel you switch on with `memev cloud on`, off by default on every install.

Nothing else. No telemetry: nothing in the product reports anything unless you turn on a report
that is off by default. The anonymous milestone report is opt-in, off by default, and holds only
milestone names, days and a random id; `memev report show` prints exactly what it would send. It is
not a default call, and it is the only report.

## What never leaves

Vault data never goes to the licence server: no notes, no file names, no vault id, and no machine
name. The backup goes to your own private repository, and the report, if you turn it on, holds only
milestone names, days and a random id.
