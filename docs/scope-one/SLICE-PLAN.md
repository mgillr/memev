# Scope One slice plan

This page orders the Scope One work into vertical slices a small team can execute one at a
time. Each slice lands one or more contracts, names the test command that proves it, and
states the definition of done. The order follows the [dependency graph](DEPENDENCIES.md):
a slice never lands a contract whose prerequisite is in a later slice. The
[inventory](INVENTORY.md) lists the current state of every contract named here.

[Back to the documentation index](../README.md)

## How to read a slice

- **Lands** names the contract ids the slice delivers. A contract that is not yet created
  is named by its handoff section and marked "to be contracted."
- **Test** is the single command that must pass for the slice to count as done.
- **Done** is the definition of done: the observable behaviour a reviewer checks.
- Slices run top to bottom. A slice may start only when every slice above it is done.

## Slices

### Slice 1: Takeover record

- Lands: SO-T-A
- Test: `node --test test/scope-one-record.test.mjs`
- Done: the seven scope-one pages exist and pass their checks; the requirement register,
  traceability, inventory, baseline, dependencies, decisions and slice plan are complete;
  the leak scan is clean; `ocx scope` reports no file outside the contract scope; no source
  file changed.

### Slice 2: Project and task state foundation

- Lands: SO-04-A
- Test: `node --test test/project-state.test.mjs`
- Done: the project and task state machine passes its tests; the store is extended in place
  with a schema version field (ADR 1 default); there is no second store; ids and state
  events reuse the op-log order (ADR 2 default).

### Slice 3: Engine call boundary and gate

- Lands: WO-05-A, MEM-131, MEM-130
- Test: `node --test test/engine-boundary.test.mjs`
- Done: every call to the convergence engine crosses the external boundary; the engine call
  gate and the merge engine entitlement both respect that boundary; no convergence logic is
  added to the core and the engine is not vendored.

### Slice 4: First-run onboarding

- Lands: MEM-101, MEM-001, MEM-020, MEM-021, MEM-022, MEM-003, MEM-004, MEM-014, MEM-016,
  MEM-023, MEM-025, MEM-043
- Test: `node --test test/onboarding.test.mjs`
- Done: a new user can set up their office; preflight runs before init; init asks for the
  first computer; the doctor warns on two vaults; the one-line installers install; the
  readme first screen is correct; the config-not-editable checklist holds.

### Slice 5: Licence, tiers and conversion

- Lands: MEM-129, MEM-137, MEM-141, MEM-133, MEM-067, MEM-077, MEM-057, MEM-134, MEM-065,
  MEM-069
- Test: `node --test test/licence.test.mjs`
- Done: the trial licence format verifies; the tier names are consistent across code and
  docs; the paid conversion path is in place; a lead is asked once; team buyers map onto
  the tiers; the separation abuse guards hold.

### Slice 6: Deployment and secure remote

- Lands: MEM-138, MEM-139, MEM-142, MEM-055, MEM-088, MEM-145
- Test: `node --test test/deployment.test.mjs`
- Done: the deployment modes are documented and match the code; the secure remote is
  customer-initiated with no standing session; the funnel landing works; the licence
  direction is decided and announced; the human binding roles are in place.

### Slice 7: Dashboard

- Lands: the dashboard contract (handoff "Dashboard acceptance criteria", to be contracted)
- Test: `node --test test/dashboard.test.mjs`
- Done: a first-time non-technical user can identify project status, next milestone,
  outstanding user decisions, blockers and the latest deliverable without engineer
  onboarding; closing the dashboard does not stop autonomous execution; reopening it
  reconstructs the current state from durable project data.

### Slice 8: Lead selection and single-authority coordination

- Lands: the lead contract (handoff "Lead agent selection and single-authority
  coordination", to be contracted)
- Test: `node --test test/lead.test.mjs`
- Done: exactly one active lead per project; a deterministic default is chosen when no
  preference is supplied; the handover is explicit and recorded; stale-lead writes are
  rejected; the lead is separate from the bus operator seat.

### Slice 9: Release readiness

- Lands: the release contract (handoff "Release and installation readiness", to be
  contracted)
- Test: `node --test test/release.test.mjs`
- Done: the installation runbook works copy-paste as written; the lead instruction is
  provider-neutral and version-aware; CI and release gates block publication on failure;
  no advertised installation path is broken or unverified.

### Slice 10: Failure paths

- Lands: the failure-test contract (extends the existing fail-paths work, to be contracted)
- Test: `node --test test/fail-paths.test.mjs`
- Done: all twenty failure tests are present and passing; the sixteen that are missing on
  main are added; each test asserts the failure behaviour its id names.

## Deferred or blocked

Work that cannot land in the order above is listed here with the reason, the user impact,
the owner who unblocks it, and the resolution path. A row leaves this table when its
resolution path is taken.

| Item | Reason | User impact | Owner | Resolution path |
| --- | --- | --- | --- | --- |
| Dashboard | no contract created yet | no unified status view for a new user | product owner | create the dashboard contract after Slice 2 lands |
| Lead coordination | no contract created yet | no single-authority coordination | product owner | create the lead contract |
| Release readiness | no contract created yet | no verified installation path | release owner | create the release contract |
| Sixteen missing failure tests | not yet implemented | failure paths are untested | engineering owner | add them to the fail-paths test in Slice 10 |
| Twenty-seven open draft pull requests | not readable from this lane | unknown work may overlap the inventory | product owner | triage the pull requests and fold them into the inventory |
| Policy defaults (ADR 4) | product decision open | defaults may change after launch | product owner | close ADR 4 in the decisions page |
| Permission matrix (ADR 5) | product decision open | some actions stay ungated | product owner | close ADR 5 in the decisions page |

## What keeps the order safe

- Slice 2 (the state foundation) precedes every slice that creates or displays projects
  and tasks, matching the SO-04-A edges in the dependency graph.
- Slice 3 (the engine boundary) precedes any slice that adds an engine call, matching the
  WO-05-A edges.
- The three "to be contracted" slices (7, 8, 9) depend only on Slices 2 and 3, so they can
  be contracted as soon as the foundation and the boundary are landed.
