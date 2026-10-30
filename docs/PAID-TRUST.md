# The trust service: keeping bad actors out of shared, concurrent editing

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[CONVERGENCE.md](CONVERGENCE.md), [EXTENSION-POINTS.md](EXTENSION-POINTS.md),
[LICENSING-NOTICE.md](LICENSING-NOTICE.md), [THREAT-MODEL.md](THREAT-MODEL.md).

The external engine carries the paid work that the core cannot do. The merge is one part of it,
described in [CONVERGENCE.md](CONVERGENCE.md). The trust service is the other part, described here.
Both run on the engine's side of the external boundary in `src/engine/merge.mjs`; neither runs in the
core.

## What the trust service does

The trust service decides which signed operations a shared vault accepts, and it keeps a computer that
should no longer write out of a concurrent edit.

- A shared vault accepts only the operations signed by a key that is still enrolled and has not been
  revoked. An operation signed by any other key is refused, and the vault is not changed by it.
- A computer that is removed or revoked stops being able to write. Its key is no longer accepted, so
  the operations it signs are refused even when the computer still holds an old copy of the vault and
  pushes into a concurrent edit.
- The check happens at the same time as the merge: the engine looks at the signatures on the versions
  it is joining, refuses the ones it does not accept, and writes back only what it accepts.

## Where it runs

The trust service runs on the engine's side of the external boundary, not in the core. The core hands
the versions and their signatures to the engine and takes back the result. It does not check
signatures, keep a list of accepted keys, or decide which operations are refused. That decision is the
engine's, made in the same call that produces the merge.

The boundary is the one described in [EXTENSION-POINTS.md](EXTENSION-POINTS.md): the core calls out
through `src/engine/merge.mjs`, and the engine answers. With no engine registered, the free
one-computer-at-a-time behaviour runs unchanged, and no trust service is in play.

## What is not said here

This page states no key formats, no signature schemes and no release dates for the trust service,
because none are published for Memev. The engine is crdt-merge, in its own repository under its own
licence, currently BSL 1.1, called as an external dependency and never vendored
([LICENSING-NOTICE.md](LICENSING-NOTICE.md)). A page for any of the details above is written when the
feature ships.
