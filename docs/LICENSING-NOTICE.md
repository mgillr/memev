# Licensing notice

Part of the [Memev documentation](README.md). Related: [CONVERGENCE.md](CONVERGENCE.md), [PRICING.md](PRICING.md).

This notice states the licence position.

## The Memev core is Apache-2.0 and free

The Memev core in this repository is **Apache-2.0** and free. Nothing in this repository changes
licence.

## The convergence engine is crdt-merge, in its own repository

The convergence engine, crdt-merge, with its merge strategies, is not part of this repository. It
lives in its own repository under its original licence, currently BSL 1.1. It is never vendored into
the Memev core: Memev calls it as an external dependency.

## Where the paid value stays

The paid value stays in the engine-backed and hosted features (automatic merge across several
computers at once, vault convergence for a company), in hosted services, in support and in company
features, not in a lock on this code.
