# The paid core: the crdt-merge convergence engine

Part of the [Memev documentation](README.md). Up: the [README](../README.md#the-paid-core-crdt-merge). Related:
[ARCHITECTURE.md](ARCHITECTURE.md), [PRICING.md](PRICING.md), [tiers/](tiers/README.md),
[LICENSING-NOTICE.md](LICENSING-NOTICE.md).

## What is open and what is paid

- **Memev core is open source and free.** It is Apache-2.0 and lives in this repository. One person on
  one computer gets all of it, and that never changes ([CHARTER.md](../CHARTER.md)).
- **The convergence engine is crdt-merge**, with its merge strategies. It lives in its own repository
  under its original licence, currently BSL 1.1. It is **never vendored into Memev**: no copy of it is
  in this repository, and Memev calls it as an external dependency.
- **It powers the paid features.** crdt-merge is what merges edits when several computers change a
  vault at the same time, and what brings a company vault into one state:
  - **Personal with more computers:** automatic merge across several computers at once.
  - **Business and Corporate:** vault convergence for a team or company (both coming).
  - **Several sites (planned):** convergence of authorised state between independently operated
    site nodes, under the engine's contract ([FEDERATION.md](FEDERATION.md)).

Today the engine is not built into any released Memev. The paid features that depend on it are
planned and are not sold until they are built ([tiers/README.md](tiers/README.md#what-is-built-and-what-is-planned)).

```mermaid
flowchart LR
    subgraph repo["This repository: Apache-2.0, free"]
        core["Memev core<br/>vault, recall, graph, bus, doctor,<br/>git backup, device keys"]
    end
    subgraph other["Its own repository: original licence, currently BSL 1.1"]
        engine["crdt-merge<br/>convergence engine and its merge strategies"]
    end
    core -. "calls it as an external dependency;<br/>never vendored" .-> engine
    engine --> paid["Paid features<br/>automatic merge across several computers (Personal),<br/>vault convergence for a team or company (Business, Corporate)"]
```

## What free users get

Free users have one computer at a time and move between computers through their own GitHub
([GITHUB.md](GITHUB.md)). Nothing is overwritten:

- Git sync is single-writer backup. It commits, pulls with a merge and pushes. It never force-pushes.
- Notes under `memory/` and `work/` are Markdown, merged with git's union driver, which keeps both
  sides' lines when two copies changed the same file (`.gitattributes` in the vault).
- A merge that still conflicts is aborted and left as it is. Both versions are kept, in your working
  copy and in the remote, and `memev doctor` reports it for you to resolve.
- When a second computer also pushes the same vault, `memev doctor` warns that concurrent edits can
  conflict. Nothing is blocked.

## What passes between an install and our side

Only licence information. The licence server takes a licence key and returns a signed licence file
(`memev license activate <key>`), which Memev then checks on your computer, offline, against a public
key built into it ([PRICING.md](PRICING.md#licences-draft)). Vault data never goes to the licence
server: no notes, no file names, no vault id, and no machine name. The one other thing Memev can send is the
anonymous milestone report, which is off unless you turn it on and holds only milestone names, days and
a random id ([METRICS.md](METRICS.md)).

## The research behind the engine, and the planned extension to several sites

The engine's research basis is described in the paper *Conflict-Free Replicated Data Types for
Neural Network Model Merging: A Two-Layer Architecture* (arXiv:2605.19373), which addresses
neural-network model merging. It is a specific implementation and architecture, not a claim on the
general CRDT idea. The licence facts above do not change with it: crdt-merge stays in its own
repository under its original licence, currently BSL 1.1, never vendored into Memev and called as
an external dependency, and only licence information passes between an install and our side.

What Memev calls today is narrower than that research: the boundary in
[EXTENSION-POINTS.md](EXTENSION-POINTS.md) hands the engine two versions of one note and their
common base. Converging structured project, programme or organisational state, and converging
authorised state between independently operated sites, is planned and not built. It needs separate
schemas, authority rules and conformance tests before any page describes it as available
([FEDERATION.md](FEDERATION.md), [FEDERATED-COMPUTATION.md](FEDERATED-COMPUTATION.md)).

## What is not said here

This page states no merge strategy names, benchmark figures or release dates for the engine, because
none are published for Memev. A page for any of them is written when the feature ships.
