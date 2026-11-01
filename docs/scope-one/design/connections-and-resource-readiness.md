# SO-1.06 Connections and resource readiness: design record

Part of the [Memev documentation](../../README.md). Up: the [README](../../../README.md). Related: [work breakdown](../WBS.md), [decisions](../DECISIONS.md), [requirements](../REQUIREMENTS.md), [clients](../../CLIENTS.md).

This is the decision record that contract SO-1.06 asks for (task T1, phase design). It builds nothing and changes no code. It cites the contracts that already specify most of this scope by id and does not restate them. Every claim cites a file and line, a contract id and criterion, or a document section. Where the sources are silent the text says "open, needs owner decision" and the item is listed under [Open items](#open-items).

## Sources and cited contracts

- Spec: `contracts/scope-one/specs/SO-1.06-connections-and-resource-readiness.json`. The requirements are at lines 13 to 19. Its dependencies are named at line 5.
- Code on main at `908654d`: `src/cli/clients.mjs`, `src/engine/devices.mjs`, `src/cli/github.mjs`, `src/engine/coordinator.mjs`. Docs: `docs/CLIENTS.md`, and in `docs/scope-one/`: `WBS.md`, `DECISIONS.md`.
- Tiers: Free, Personal at $12/month or $120/year for up to 3 computers, and contact us for the higher tiers; there is no Personal trial (`docs/scope-one/DECISIONS.md:74`).
- Settled decisions followed (owner decisions of 31 October 2026, `docs/scope-one/DECISIONS.md:68-76`): local-first, the cloud only a relay and a backup (line 72); providers are neutral (line 73).
- Current state: no connections table, workspace grant, client capability record or readiness registry exists on main. The client registry is `clientDefs` (`src/cli/clients.mjs:210`) and carries no capability fields; the device registry counts computers against the licence (`src/engine/devices.mjs:1-8`); and `src/engine/` has no grants or readiness module.

Contracts cited by id. None is in this repository; each is held in the owner's vault, in the bundle and file named below (provider-neutral text, no other detail).

| Id | Status | Vault bundle and file | Cited for |
| --- | --- | --- | --- |
| SO-A-07 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | the connections table, grant levels and the internal readiness registry |
| SO-O-A | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | workspace grants, the one path check, access requests (AC01, AC02, AC05, AC06) |
| SO-O-B | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | the GitHub connection, credential storage, expiry (AC01, AC03, AC06) |
| SO-O-C | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | safe publishing (not needed for this scope beyond the grant model) |
| SO-05-B | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | client capability records and a truthful connection screen (AC01 to AC05) |
| SO-C-C | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | Settings and Connections with repair (AC04) |
| SO-08-B | signed | `memev-pi17-2026-10-29`, `set-work/proofline.json` | recovery when a session stops (AC01) |
| SO-A-05 | fold contract, unsigned, proposed | `memev-fold-addendum-2026-10-30`, `set-fold/proofline.json` | user blockers (see the SO-1.08 record) |

Because the fold contracts are unsigned, what they decide is a proposal until the owner signs them. This record cites them as the intended owner and does not treat them as settled.

Connections screen: one table over folders, repositories, providers, tools and remote computers, each with identity, granted scope, permission level and last verified time, with connect, test, inspect and revoke delegated to the existing commands (SO-A-07 AC01). No routing score, lease or assignment appears on it (SO-A-07 AC03). The screen is fixed by the spec at lines 13 to 15.

Readiness registry: per resource, whether it is authenticated, reachable, authorised for the operation, capable and currently usable, kept as events in the project store and the daemon's live state and never as a store of its own; unknown stays unknown (SO-A-07 AC03). The registry is fixed by the spec at lines 16 and 19.

## Requirement 1: connect supported providers, tools and remote computers where the tier and configuration permit

- Covered by: SO-A-07 AC01 (the one table; remote computers included); SO-05-B AC01 and AC02 (client capability records, connected only when the seat answered); SO-O-B AC01 (the GitHub connection).
- Repo fact: remote computers are counted against the licence in the device registry (`src/engine/devices.mjs:1-8`); Personal allows up to 3 computers (`docs/scope-one/DECISIONS.md:74`).
- Gap: open, needs owner decision: how the tier limit on remote computers shows on the table; SO-A-07 does not mention it.

## Requirement 2: connect, reconnect, test, inspect and disconnect; no secrets in the UI, logs or artefacts; secure operating-system facilities; auditable permission changes

- Covered by: SO-A-07 AC01 and AC02 (the actions delegate to existing commands; grants revocable); SO-O-A AC01 and AC06 (revocation; grants, writes and errors recorded without tokens); SO-O-B AC01 (the credential goes through the existing credential storage) and AC06 (one message and a recovery action); SO-C-C AC04 (revoke and a guided repair flow).
- Repo fact: a search of `src/` finds no use of an operating-system keychain.
- Gap: open, needs owner decision: whether secure operating-system credential storage is required, since SO-O-B cites the existing storage and the code has none.

## Requirement 3: the settings area does not expose eligibility, routing scores, assignments, leases or execution states

- Covered by: SO-A-07 AC03 (the test greps the rendered page for routing score, lease and assignment); SO-C-A AC02 (the plain-view rule).
- Gap: none.

## Requirement 4: internally determine whether a resource is authenticated, reachable, authorised, capable and usable, feeding the state machine and scheduler

- Covered by: SO-A-07 AC03 (the registry; the coordinator reads it for eligibility); SO-05-B AC05 (health from the seat heartbeat).
- Gap: open, needs owner decision: the cadence, since the spec says "continuously" and SO-A-07 sets no trigger or interval.

## Requirement 5: when a resource becomes unavailable, update the registry, prevent invalid dispatch, retry or route elsewhere where policy permits, and keep continuity

- Covered by: SO-A-07 AC04 (registry updated, invalid dispatch prevented, rerouted within policy); SO-08-B AC01 (recovery plan); SO-A-01 AC02 (an unavailable preferred resource gives an alternative proposal).
- Repo fact: retry and recovery code exists as engine functions with no caller outside the engine (`src/engine/coordinator.mjs:258-286`, `:384-399`; `contracts/scope-one/manifest.json:11`).
- Gap: open, needs owner decision: the retry limits (policy defaults, ADR 4, `docs/scope-one/DECISIONS.md:48-56`).

## Requirement 6: surface a user blocker only when it cannot be resolved within the grants and policy, in plain language

- Covered by: SO-A-07 AC04 (a blocker only when a reconnect or a new grant is needed); SO-O-A AC05 (an access request appears in the decisions queue; the lead cannot grant it); SO-O-B AC06 (one message naming the limitation and the recovery); SO-A-05 AC03.
- Gap: none beyond the decisions queue gaps in the SO-1.08 record.

## Requirement 7: never claim an integration or permission is available unless verified; unknown stays unknown

- Covered by: SO-A-07 AC03 (unknown is never rendered ready); SO-05-B AC02 (connected only when registration files are in place and the seat answered); SO-A-04 AC03 (an unconfirmed value renders as not confirmed).
- Gap: none.

## Open items

Each needs an owner decision before a build contract is written. Everything else is decided by the contracts cited above, if the owner signs the fold contracts.

1. How the tier limit on remote computers shows on the connections table (requirement 1).
2. Whether secure operating-system credential storage is required (requirement 2).
3. The cadence of the readiness checks (requirement 4).
4. The retry limits that decide when rerouting gives way to a user blocker (requirement 5; ADR 4).
5. The owner decides whether SO-1.06 is built against the unsigned SO-A-07, which depends on signed SO-O-A, SO-O-B, SO-05-B, SO-09-A and SO-C-C (all requirements).
