# Licensing notice

Part of the [Memev documentation](README.md). Related: [CONVERGENCE.md](CONVERGENCE.md), [PRICING.md](PRICING.md).

This notice announces the decided licence direction.

## The Memev core stays Apache-2.0

The Memev core in this repository stays **Apache-2.0**. Nothing in this repository changes
licence.

## The convergence engine is a separate component

The convergence engine, with its merge strategies, is not part of this repository. It is a separate
component under its own licence, in its own repository. It is never vendored into the Memev core:
Memev calls it as an external dependency.

## Where the paid value stays

The paid value stays in the engine-backed and hosted features (automatic merge across several
computers at once, vault convergence for a company), in hosted services, in support and in company
features, not in a lock on this code.

## The trial is a time-limited entitlement

A Business trial is a time-limited entitlement to call the separately licensed convergence engine.
The engine's source and licence are not part of this repository, and the engine is not part of the
free core: the free core works without it. The trial does not change the licence of either side.
