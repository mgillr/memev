# Merge semantics

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[CONVERGENCE.md](CONVERGENCE.md), [EXTENSION-POINTS.md](EXTENSION-POINTS.md), [PROJECTS.md](PROJECTS.md),
[PAID-CONVERGENCE.md](PAID-CONVERGENCE.md).

This page says, for each entity type Memev keeps in a project, what should happen when two computers write it at the same
time, and why. It is a table and its rationale. Merge semantics are chosen per entity type, never one rule for everything.

## What this page is and is not

- The vault is the only authority, and Memev is local first. Free users keep one computer at a time and lose nothing: when
  two versions compete, the free path keeps both ([CONVERGENCE.md](CONVERGENCE.md)). The table says what a merge, when one is
  allowed to run, should do. It does not make a merge run.
- The nine entity types, the owner of each and the four class names are those of SO-F-02 (#354, final head 438887a).
  SO-F-02 declares the owner and the class on each entity type and holds them in the project store.
  This page declares nothing and enforces nothing. It cites SO-F-02, it owns the rationale, and its names must stay equal to
  those of SO-F-02.
- SO-F-06 owns the enforcement: it applies a class, checks what goes to the engine and what comes back, at the one boundary
  `src/engine/merge.mjs`, and keeps both versions when the engine is not there. This page does not restate it.
- The engine, crdt-merge, lives in its own repository under its own licence and is never vendored. Memev reaches it only across
  the external call-out boundary ([EXTENSION-POINTS.md](EXTENSION-POINTS.md)).

## The table

The four classes mean:

- `last-writer`: the newest write stands. Newest means newest in log order, the order of the append-only log of the project,
  and not a clock reading. A tie that the log cannot order is broken by the merge provider, not by the core.
- `set-union`: the elements of every write stand.
- `append-only`: nothing is replaced, every write is kept.
- `human-resolution`: competing writes are surfaced and a person settles them. They are never silently merged.

No type uses `set-union` yet. The class is there for the types that come later.

The case where the engine meets two writes to a LWWRegister with an equal timestamp is an open follow-up on the engine side.
Until it is settled, nothing here relies on how that tie falls, and this page defines no tie-break.

The owner is a subject type of the identity model: `person`, `agent`, `device`, `node`, `operator` or `service`. The owner is a
declaration of which kind of subject the type belongs to. It is not the memory authority of ADR 7, which is still proposed,
and it is not the permission matrix of ADR 5, which is still open. Neither is decided here.

| Entity type | Owner | Merge class | Status | Rationale |
| --- | --- | --- | --- | --- |
| `project` | `person` | `last-writer` | declared | A project has one current name and description, and the newest in log order is the one people expect. `scope_version` is the exception: it is monotonic, so the highest value stands and the newest write never does. Enforcing that is SO-F-06's. |
| `task` | `person` | `human-resolution` | declared | Two different moves of one task made at once are surfaced, because taking the newest could revive a finished or cancelled task or skip a required step. The version check of the state machine in [PROJECTS.md](PROJECTS.md) is what catches two updates of one task today. |
| `lease` | `service` | `human-resolution` | PROVISIONAL: class and owner | The class waits on ADR 3. The safe default is one active writer with contending writes queued, not merged, and none of the four classes is a queue. A lease is not `last-writer`, because the newest write would pre-empt the holder. The coordinator already refuses a second claim on a live lease. `human-resolution` is the nearest class, since a competing lease write is never settled by the newest one. The owner waits on a model that can issue a `service` subject. |
| `attempt` | `agent` | `append-only` | declared | An attempt is a record of work that happened. Records are kept and never replaced, so an attempt is neither lost nor folded into another because two computers saw it. |
| `evidence` | `service` | `append-only` | PROVISIONAL: owner | Evidence is kept as written, and a later record never overwrites an earlier one. The owner is declared as `service`, and no `service` subject can be issued yet, so the declaration stays until the model issues one. |
| `conflict` | `person` | `human-resolution` | declared | A conflict is the record that competing writes were surfaced. Two records of one conflict are not merged into one, and a person settles it. |
| `session` | `device` | `last-writer` | declared | A session is the current state of one device. It has one current value, and the newest in log order is the one that stands. |
| `approval` | `person` | `human-resolution` | declared | Approvals are never silently merged. Each approval is its own record. Incompatible decisions on one task, for example an approve and a reject, are surfaced, neither is applied, and a person settles it. A later approval does not overwrite an earlier one. |
| `event` | `service` | `append-only` | PROVISIONAL: owner | The event log only grows. Every event is kept and none is replaced. The owner is declared as `service`, and no `service` subject can be issued yet. |

### The scope version moves only forward

`scope_version` is monotonic. A write that carries a lower value than the one already recorded must not stand as the newest
write: the highest value stands, and the newest write never does when it would roll the scope back. The scope version rises only
through an amendment, so it is outside the `last-writer` rule that `project` follows. It is the same field on every entity
type. SO-F-06 enforces it, and this page only states it.

### The lease is provisional

The class of a lease is PROVISIONAL because it depends on ADR 3, which is open (see
[DECISIONS.md](scope-one/DECISIONS.md)). Until it is decided, the safe default stands: one active writer, contention queued,
nothing merged. If ADR 3 decides on something else, the class of `lease` follows it, in SO-F-02 first and then in this row.

### The owner is only a declaration

Nothing checks the owner on a write, and nothing here says who may settle a competing write. A person settling one is the
meaning of `human-resolution`, and which person may do so is ADR 5's question.

## The object classes of MV-ARCH-05

The requirement is that merge semantics are chosen per object class, never one rule for everything. The table above is per
entity type, because SO-F-02 declares the class on entity types. This section says where each object class of the requirement
sits. It declares no class: where SO-F-02 has no entity type for an object class, nothing here assigns one.

| Object class | Where it sits |
| --- | --- |
| observations | No entity type of SO-F-02 yet. The state map below shows the lines of a note as a set, which is a shape for a provider shim to use, not a class declared here. |
| metadata | The fields of `project` and `session`, which are `last-writer`. `scope_version` is the exception, as above. |
| membership | No entity type of SO-F-02 yet. |
| counters | No entity type of SO-F-02 yet. |
| task ownership | `lease`, `human-resolution` and PROVISIONAL, pending ADR 3. |
| task state | `task`, `human-resolution`. |
| contracts | Not an entity type of the project store. Contracts are never silently merged: a signed contract is not changed, and an amendment is a new version. |
| approvals | `approval`, `human-resolution`. Approvals are never silently merged. |
| external actions | No entity type of its own in SO-F-02 yet. |

When SO-F-02 adds an entity type for an object class that has none, its owner and class are declared there first, and this
page then gives its row and rationale.

## What the engine can and cannot do with a note

The engine has no three-way text merge. The call-out boundary sends it one JSON line, `{a, b, base}`, of text, and expects
`{text}` back, or `{refuse: true}` to keep both versions. So a provider shim maps a note to structured state, for example the
lines of a note to a set, hands that to the engine, and maps the merged state back to text. The shim lives outside the Memev
core: in memev-ops, or on the crdt-merge side. The core holds only the representation (`src/engine/state-map.mjs`): a note as a
set of lines with their order, and the state of an agent as one field per key, each mapped back without loss. The core has no
text merge of its own, and the round trip through the real engine is tested once, with a shim supplied from outside the
repository (`test/engine-roundtrip.test.mjs`, skipped and reported as not run when none is set).

## Where each part is owned

| Part | Owner |
| --- | --- |
| The rationale for each row of the table | this page |
| The owner and the class on each entity type | SO-F-02 |
| Enforcement of a class, the check of engine input and output, and the keep-both fallback | SO-F-06 |
| The call-out boundary itself | WO-05-A |
| The paid-engine client | WO-05-B |
| Lease semantics | ADR 3 |
