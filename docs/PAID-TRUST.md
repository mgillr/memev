# The trust service: keeping bad actors out of shared, concurrent editing

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[CONVERGENCE.md](CONVERGENCE.md), [PAID-CONVERGENCE.md](PAID-CONVERGENCE.md),
[EXTENSION-POINTS.md](EXTENSION-POINTS.md), [LICENSING-NOTICE.md](LICENSING-NOTICE.md),
[THREAT-MODEL.md](THREAT-MODEL.md).

The external engine carries the paid work that the core cannot do. The merge is one part of it,
specified in [PAID-CONVERGENCE.md](PAID-CONVERGENCE.md). The trust service is the other part,
specified here. Both are planned, and both would run on the engine's side of the external boundary in
`src/engine/merge.mjs`; neither would run in the core.

## What the trust service would do (planned)

The trust service is planned. When it ships, it would add a check on the merged note versions, on the
engine's side of the boundary, so that a computer that should no longer write is kept out of a
concurrent edit. The check would run at the same time as the merge, over the note versions the engine
is joining.

- A shared vault would accept only the note versions signed by a key that is still enrolled and has
  not been revoked. A version signed by any other key would be refused, and the vault would not be
  changed by it.
- A computer that is removed or revoked would stop being able to write. Its key would no longer be
  accepted, so the note versions it signs would be refused even when the computer still holds an old
  copy of the vault and pushes into a concurrent edit.

## What the core already does

The core already checks device keys and revocation itself, and the free behaviour never changes. It
keeps the enrolled and revoked device keys and verifies the signature on each request
(`src/engine/devices.mjs`). It refuses a write when a computer is over the seat count or the licence
has expired (`src/engine/entitlements.mjs`, `readOnlyReason`). The trust service does not replace that
work; it adds a check on the merged versions on the engine's side.

## Where it would run

The trust service would run on the engine's side of the external boundary, not in the core. The core
sends the engine only the two note versions and their common base, as one JSON line
([PAID-CONVERGENCE.md](PAID-CONVERGENCE.md)); it does not send signatures across the boundary. The
engine answers one JSON line and the core writes the result.

The boundary is the one described in [EXTENSION-POINTS.md](EXTENSION-POINTS.md): the core calls out
through `src/engine/merge.mjs`, and the engine answers. With no engine registered, the free
one-computer-at-a-time behaviour runs unchanged, and no trust service is in play.

## What a refusal would do

A refusal would follow the merge contract in [PAID-CONVERGENCE.md](PAID-CONVERGENCE.md): the refused
note version is not written, the other version is kept whole in a conflict copy, and `memev doctor`
reports the conflict. No version is lost or overwritten.

## What is not said here

This page states no key formats, no signature schemes and no release dates for the trust service,
because none are published for Memev. It does not decide where the engine runs. The engine is
crdt-merge, in its own repository under its original licence, currently BSL 1.1, called as an external
dependency and never vendored ([LICENSING-NOTICE.md](LICENSING-NOTICE.md)). A page for any of the
details above is written when the feature ships.
