# Scope One dependencies

This page lists the ordering edges between the contract ids that appear in the
[inventory](INVENTORY.md). Each edge is `A -> B`, read as "B builds on A, so A should be
landed before B." The graph is acyclic: following any chain of edges never returns to its
start. The [slice plan](SLICE-PLAN.md) uses this graph to order the vertical slices.

[Back to the documentation index](../README.md)

## How to read an edge

- `A -> B` means B depends on A. A is the prerequisite, B is the dependent.
- The reason states the concrete dependency: a shared module, a data shape, a call path,
  or an ordering constraint.
- Only contract ids present in the inventory are used as endpoints. Contracts that are not
  yet in the inventory (for example the dashboard, onboarding, lead and release contracts)
  are not endpoints here; they will join the graph when their work items appear.

## Edges

| From | To | Reason |
| --- | --- | --- |
| SO-04-A | MEM-101 | onboarding creates the first project and task, which needs the project and task state machine |
| WO-05-A | MEM-131 | the engine call gate controls calls that must cross the external engine boundary |
| WO-05-A | MEM-130 | the merge engine entitlement gates engine calls that must cross the external engine boundary |
| MEM-001 | MEM-020 | preflight runs before init, so the first-computer init step builds on it |
| MEM-129 | MEM-130 | the trial licence format must be verified before a merge engine entitlement is issued |
| MEM-003 | MEM-021 | the doctor two-vault warning depends on vault creation being detectable |

## Acyclic check

The sources in the table are SO-04-A, WO-05-A, MEM-001, MEM-129 and MEM-003. The targets
are MEM-101, MEM-131, MEM-130, MEM-020 and MEM-021. No id is both a source and a target,
so no cycle can form. The [test](../../test/scope-one-record.test.mjs) recomputes this and
fails if an edge points at an id missing from the inventory or if a cycle appears.

## What is not an edge

- The bus, the vault, the op-log and the existing engine modules are already on main. They
  are not contracts in the inventory, so they are not endpoints. Work that uses them does
  not create an edge here; it is recorded as a module boundary in the handoff instead.
- Two branches of the same contract (twins) are not an edge between each other. They are
  a conflict to resolve in the inventory, not an ordering dependency.
