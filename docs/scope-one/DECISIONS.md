# Scope One decisions

This page holds the architecture decision records the handoff leaves open, and a separate
list of questions that only the product owner can answer. An ADR here is a record of a
decision that is not yet made: it names the topic, the current status, the rationale for
leaving it open, the owner who will close it, and the safe default the code follows until
then. Nothing on this page changes behaviour; it only records what is undecided and what
we do in the meantime.

[Back to the documentation index](../README.md)

## ADRs

Each ADR uses a fixed topic list from the handoff. Status is one of `open`, `proposed`,
`decided`. While a status is `open` or `proposed`, the safe default is the behaviour the
current code already uses, so no contract is blocked on a guess.

### ADR 1: store schema version and migration

- Status: open
- Decision owner: engineering owner of the project-state contract
- Rationale: the project and task state machine introduces a new store shape. Whether it
  is a new schema version, a migration of the existing store, or a separate store is not
  settled. The handoff forbids a second store, so the choice is between a versioned
  migration and an in-place extension.
- Safe default: extend the existing store in place and record a schema version field; do
  not create a second store. Migrations are additive and reversible.

### ADR 2: id and event ordering

- Status: open
- Decision owner: engineering owner of the project-state contract
- Rationale: ids for projects, tasks and state events, and the order those events are
  applied, are not fixed. The op-log already provides an append-only order; the open
  question is whether state-machine events reuse that order or carry their own sequence.
- Safe default: reuse the existing op-log order for state events; ids are opaque strings
  assigned at write time. No reordering, no gaps.

### ADR 3: lease semantics

- Status: open
- Decision owner: engineering owner of the project-state contract
- Rationale: when two lanes or two devices work the same project, a lease decides who may
  write. The handoff does not fix lease duration, renewal, or what happens on expiry.
- Safe default: a single active writer per project; a lease is implicit while a write is
  in flight and there is no background renewal. Contending writes are queued, not merged.

### ADR 4: policy defaults

- Status: open
- Decision owner: product owner
- Rationale: the default recall, retention and compaction policies are not set. These
  affect what a user sees and how long data is kept, so they are a product decision, not
  an engineering one.
- Safe default: keep the policies the current code already applies. New projects inherit
  the existing defaults; nothing is tightened or loosened until the product owner decides.

### ADR 5: permission matrix

- Status: open
- Decision owner: product owner
- Rationale: which role may do which action (create a project, edit a task, run an engine
  call, export) is not fixed as a matrix. The entitlements module already gates some
  actions; the open question is the full role-by-action table.
- Safe default: keep the entitlements module current gates. No new role or action is
  granted until the matrix is decided; anything ungated stays denied.

## Owner decisions of 31 October 2026

These are decided, in the owner's words of that day. Cite them as "owner decision 31 Oct 2026".

- Topology: local-first. The cloud is only a relay and a backup.
- Providers are neutral: every supported provider stands on equal footing, and no work or tier depends on one.
- Tiers: the Free core, which includes cloud AI and is the trial; Personal at $12/month or $120/year for up to 3
  computers; contact us for the higher tiers. There is no separate Personal trial (docs/BUSINESS-TRIAL.md).
- Review: while the reviewer is out, the author acts as interim reviewer with one interim key
  (docs/CONTRACTS.md, "The interim reviewer"). What it signs says so and waits for an independent re-review.

These close the owner decisions the [addendum](ADDENDUM-ARCHITECTURE-AND-DELIVERY-REVIEW.md) review asked for first
(topology, provider neutrality, tier set). They do not accept the addendum's other recommendations; those still need
explicit acceptance one by one.

## Product-owner decision list

These questions block specific contracts. Each lists the contracts it blocks (ids from the
[inventory](INVENTORY.md)) and a safe default so work can continue without an answer. The
product owner closes each by choosing an option; until then the safe default holds.

| Question | Contracts blocked | Safe default |
| --- | --- | --- |
| Which configured AI clients are in scope for the first release, and in what order? | MEM-101, MEM-051 | ship the clients already documented; add new ones behind the same hand-off without a new contract |
| What are the tier names and the trial length? | MEM-137, MEM-129, MEM-141 | keep the current tier names and trial length |
| Which deployment modes ship in the first release? | MEM-138, MEM-139 | local-first; cloud-hosted behind the same interface |
| What is the secure remote model for customer-initiated access? | MEM-142 | customer-initiated only, no standing remote session |
| What is the paid conversion path and its place in the flow? | MEM-133 | keep the current conversion step |

## How these close

- An ADR moves to `decided` when its owner records a choice here and the matching contract
  lands the behaviour. The [traceability](TRACEABILITY.md) page then points the affected
  requirement at the deciding contract.
- A product-owner question is removed from this list when the answer is recorded and the
  blocked contracts proceed. The safe default is what the code does until that moment, so
  removing a row never changes behaviour on its own.
