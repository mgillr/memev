# Extension points

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[CONVERGENCE.md](CONVERGENCE.md), [ARCHITECTURE.md](ARCHITECTURE.md), [MODULES.md](MODULES.md).

Memev is one program with no runtime dependencies: only Node built-ins and the code under
`vendor/`. The one place the core hands work to an outside program is the merge engine, and it
does so through a single boundary: `src/engine/merge.mjs`. This page describes that boundary.

## The merge engine boundary

The core holds no convergence logic. When a sync finds a note that two computers changed
differently, the core does not decide how to join the versions. It hands the two versions and
their common base to the external merge engine, and the engine returns the merged text. The
engine is a separate component under its own licence, not in this repository: nothing here
imports it, and it is not a package dependency.

The boundary has three parts, all in `src/engine/merge.mjs`:

- `engineAllowed(license)`: the licence gate. The engine is called only when the licence allows
  it (the merge service, while the licence is valid or in grace). With no licence, an expired
  trial, or a licence without the merge service, the engine is not called.
- `registerMergeProvider(provider)`: the registration point. The engine registers itself into the
  boundary; the core never imports the engine. The install hands the boundary a provider, and the
  boundary calls it.
- `resolveMerge({ a, b, base, ... })`: the call. It asks the licence gate, then the provider, and
  returns either the merged text or the keep-both result with a line that names the reason.

### How the engine is reached

The engine cannot be a package dependency, so the boundary speaks to a command or an address.
`commandProvider(command)` builds a provider that runs the engine as an external process: the
boundary sends the two versions and the base to the command's standard input as one JSON line,
and reads one JSON line back. `{ "text": "..." }` is the merged note; `{ "refuse": true }` keeps
both versions. The answer may be up to 64 MB (the `maxBuffer` option), so a large note still
merges. When the engine fails, the reason names it by its id (the command's file name, or the `id`
option), never by a path, because the reason is kept in the conflict record and shown on the card.
A provider may also be an in-process function with the same shape, for an install that hosts the
engine in its own process.

The provider receives only the two versions and the common base, and nothing else: no licence, no
token, no path.

### What happens when the engine is not there

The free behaviour is the default and never changes:

- No engine registered: both versions are kept. This computer's version stays at the note's path,
  the other computer's version is kept whole in a conflict copy, and `memev doctor` reports the
  conflict for a person to resolve.
- The engine refuses or fails: the same keep-both result, and a line names the reason.
- The licence does not allow the engine: the same keep-both result, and a line names the reason.

Removing a registered engine returns the install to this behaviour. No version is lost or
overwritten: both are kept byte for byte, and the conflict copy is listed until it is resolved.

## How this fits the wider architecture\n\nThis boundary is the current note-conflict integration, not the complete future Federation API.\nThe wider architecture will need separately versioned interfaces for node identity, federation\nmembership, policy evaluation, authorised state exchange, structured work contributions, remote\nexecution and workload-specific results. Those interfaces must not bypass the existing local\npermission checks or assume that a successful merge grants authority. See\n[FEDERATION.md](FEDERATION.md) and [FEDERATED-COMPUTATION.md](FEDERATED-COMPUTATION.md).\n\n## Where the boundary is called

The sync path calls the boundary when it resolves a conflicted note after a git merge
(`src/cli/sync.mjs`). That is the only place in the core that reaches the engine. The bus log
merge and the union merge driver for Markdown notes are the core's own, and they run with or
without the engine.
