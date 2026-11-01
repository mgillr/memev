# Contracts for work on Memev itself

Memev builds against its own signed contracts (see [docs/CONTRACTS.md](../docs/CONTRACTS.md)).
These files were copied from the vault the work was signed in:

- `signed/<id>.json`: the contract, with its tasks and the check for each requirement
- `signed/<id>.sig.json`: its DSSE/Ed25519 signature
- `keys/<keyid>.pub`: the public key that verifies the signature (the private key never leaves the
  machine it was made on and is not in this repository)
- `receipts/<id>.md`: the verification run that passed

| Contract | What it covers | Result |
|---|---|---|
| `k-memory-quality-multiling-4468b8` | multilingual recall, the memory quality check, review and audit, project scope, `why`, tunnel off for organisation installs, [docs/SOLUTIONS.md](../docs/SOLUTIONS.md) | PASS, 5/5 tasks |

The contract's `workdir` is the checkout it was verified in, and `memev verify` runs checks only
there. Every check is a plain file test, pattern or command (`npm test`,
`node scripts/leak-scan.mjs --history`), so it can be run by hand from the repository root.

## Signed at the three-round stop, 31 October 2026

These sixteen specs from `seed-readiness/specs/` and `quality-loop/specs/` were signed on the owner's go, after three
red-team rounds in which every answer has a disposition (the stopping rule in QL-1.01). Each was drafted and signed with
memev's own contract functions from main at 385d5182, in a signing vault on the owner's computer, and
`keys/9234819001ae43bd.pub` verifies each signature. Their `workdir` is null, as the specs have it, so `memev verify` on them
is not meaningful until SR-0.03 and QL-1.01 task 2 give it the checkout. The stop decisions QL-1.01 asks for follow when
its gate lands.

| Spec | Contract | Tasks | Criteria |
|---|---|---|---|
| [SR-0.03](seed-readiness/specs/SR-0.03-verify-runs-every-verifier-type.json) | [`k-sr-0-03-verify-runs-ever-633b99`](signed/k-sr-0-03-verify-runs-ever-633b99.json) | 5 | 51 |
| [SR-1.01](seed-readiness/specs/SR-1.01-one-writer-enforced-an-exclusive.json) | [`k-sr-1-01-one-writer-enfor-ceaa12`](signed/k-sr-1-01-one-writer-enfor-ceaa12.json) | 3 | 62 |
| [SR-1.03](seed-readiness/specs/SR-1.03-replay-protection-that-survives-a.json) | [`k-sr-1-03-replay-protectio-6aeb51`](signed/k-sr-1-03-replay-protectio-6aeb51.json) | 1 | 35 |
| [SR-1.05](seed-readiness/specs/SR-1.05-a-bounded-rate-limiter.json) | [`k-sr-1-05-a-bounded-rate-l-594b7f`](signed/k-sr-1-05-a-bounded-rate-l-594b7f.json) | 1 | 40 |
| [SR-1.06](seed-readiness/specs/SR-1.06-one-licence-schema-validated-everywhere.json) | [`k-sr-1-06-one-licence-sche-e3e5e0`](signed/k-sr-1-06-one-licence-sche-e3e5e0.json) | 1 | 43 |
| [SR-1.21](seed-readiness/specs/SR-1.21-a-missing-note-is-never-silent.json) | [`k-sr-1-21-a-missing-note-t-77741b`](signed/k-sr-1-21-a-missing-note-t-77741b.json) | 1 | 41 |
| [SR-1.22](seed-readiness/specs/SR-1.22-an-interrupted-write-recovers-from-the-log.json) | [`k-sr-1-22-a-whole-note-wri-9746f4`](signed/k-sr-1-22-a-whole-note-wri-9746f4.json) | 1 | 41 |
| [SR-1.24](seed-readiness/specs/SR-1.24-no-cli-write-beside-a-live-daemon.json) | [`k-sr-1-24-no-cli-command-w-a03500`](signed/k-sr-1-24-no-cli-command-w-a03500.json) | 1 | 38 |
| [SR-1.25](seed-readiness/specs/SR-1.25-a-cloud-seat-addresses-one-local-seat.json) | [`k-sr-1-25-a-cloud-seat-all-c6de54`](signed/k-sr-1-25-a-cloud-seat-all-c6de54.json) | 1 | 41 |
| [SR-1.26](seed-readiness/specs/SR-1.26-one-write-can-never-make-the-vault-unopenable.json) | [`k-sr-1-26-one-write-can-ne-e6ae4e`](signed/k-sr-1-26-one-write-can-ne-e6ae4e.json) | 2 | 51 |
| [SR-1.27](seed-readiness/specs/SR-1.27-done-comes-only-from-a-passing-verify.json) | [`k-sr-1-27-done-comes-only--ce2666`](signed/k-sr-1-27-done-comes-only--ce2666.json) | 1 | 22 |
| [SR-1.28](seed-readiness/specs/SR-1.28-the-bus-writes-its-own-routing-files.json) | [`k-sr-1-28-the-bus-writes-i-02c12e`](signed/k-sr-1-28-the-bus-writes-i-02c12e.json) | 2 | 56 |
| [QL-1.01](quality-loop/specs/QL-1.01-red-team-gate-no-signing.json) | [`k-ql-1-01-red-team-gate-no-296339`](signed/k-ql-1-01-red-team-gate-no-296339.json) | 2 | 50 |
| [QL-1.02](quality-loop/specs/QL-1.02-mutation-gate-on-changed-lines.json) | [`k-ql-1-02-mutation-gate-th-956ebe`](signed/k-ql-1-02-mutation-gate-th-956ebe.json) | 2 | 50 |
| [QL-1.03](quality-loop/specs/QL-1.03-sensitive-path-checklist-before-merge.json) | [`k-ql-1-03-security-checkli-c328ad`](signed/k-ql-1-03-security-checkli-c328ad.json) | 2 | 37 |
| [QL-1.04](quality-loop/specs/QL-1.04-claims-ledger-check-in-every-repository.json) | [`k-ql-1-04-the-claims-check-75de75`](signed/k-ql-1-04-the-claims-check-75de75.json) | 1 | 28 |

## Amended after signing

QL-1.01 task 1 was amended from building it: the scope gains docs/CONTRACTS.md and docs/MODULES.md, and c04, c15 and c27
change as `quality-loop/AMENDMENTS.md` records. The text was agreed in review, and it was signed on 31 October with memev's
own `contractAmend` from main at 3f9c8e2e, in the same signing vault, under the same key. The new version names the one it
supersedes; memev retires the earlier one once the new version, signed on this computer, passes its own verify.

| Spec | Contract | Version | Supersedes | Tasks | Criteria |
|---|---|---|---|---|---|
| [QL-1.01](quality-loop/specs/QL-1.01-red-team-gate-no-signing.json) | [`k-ql-1-01-red-team-gate-no-f0e136`](signed/k-ql-1-01-red-team-gate-no-f0e136.json) | 2 | [`k-ql-1-01-red-team-gate-no-296339`](signed/k-ql-1-01-red-team-gate-no-296339.json) | 2 | 50 |

## Re-signed with provenance, 31 October 2026

The red-team gate (QL-1.01) wants every signed contract to carry `provenance.spec_sha256`, the hash its spec's red-team
record makes signable. The sixteen contracts above were signed before that. Each is now signed again as the next version,
naming the one it supersedes, by signer-2 for Memev (key `keys/45c92c2850024872.pub`), after a record of its spec was
committed under `<area>/redteam/`. The records are an interim solo review by the author, pending independent re-review
(owner decision 31 Oct 2026, docs/CONTRACTS.md "The interim reviewer"); each says so in its text. No signed file was edited
and the earlier versions stay, listed as superseded by `node scripts/gate/redteam-gate.mjs --report`.

| Spec | Contract | Version | Supersedes | Tasks | Criteria |
|---|---|---|---|---|---|
| [QL-1.01](quality-loop/specs/QL-1.01-red-team-gate-no-signing.json) | [`k-ql-1-01-red-team-gate-no-af266a`](signed/k-ql-1-01-red-team-gate-no-af266a.json) | 3 | [`k-ql-1-01-red-team-gate-no-f0e136`](signed/k-ql-1-01-red-team-gate-no-f0e136.json) | 2 | 74 |
| [QL-1.02](quality-loop/specs/QL-1.02-mutation-gate-on-changed-lines.json) | [`k-ql-1-02-mutation-gate-th-0dba04`](signed/k-ql-1-02-mutation-gate-th-0dba04.json) | 2 | [`k-ql-1-02-mutation-gate-th-956ebe`](signed/k-ql-1-02-mutation-gate-th-956ebe.json) | 2 | 65 |
| [QL-1.03](quality-loop/specs/QL-1.03-sensitive-path-checklist-before-merge.json) | [`k-ql-1-03-security-checkli-aaf9db`](signed/k-ql-1-03-security-checkli-aaf9db.json) | 2 | [`k-ql-1-03-security-checkli-c328ad`](signed/k-ql-1-03-security-checkli-c328ad.json) | 2 | 37 |
| [QL-1.04](quality-loop/specs/QL-1.04-claims-ledger-check-in-every-repository.json) | [`k-ql-1-04-the-claims-check-40ff57`](signed/k-ql-1-04-the-claims-check-40ff57.json) | 2 | [`k-ql-1-04-the-claims-check-75de75`](signed/k-ql-1-04-the-claims-check-75de75.json) | 1 | 28 |
| [SR-0.03](seed-readiness/specs/SR-0.03-verify-runs-every-verifier-type.json) | [`k-sr-0-03-verify-runs-ever-2259f2`](signed/k-sr-0-03-verify-runs-ever-2259f2.json) | 2 | [`k-sr-0-03-verify-runs-ever-633b99`](signed/k-sr-0-03-verify-runs-ever-633b99.json) | 5 | 51 |
| [SR-1.01](seed-readiness/specs/SR-1.01-one-writer-enforced-an-exclusive.json) | [`k-sr-1-01-one-writer-enfor-f59dc6`](signed/k-sr-1-01-one-writer-enfor-f59dc6.json) | 2 | [`k-sr-1-01-one-writer-enfor-ceaa12`](signed/k-sr-1-01-one-writer-enfor-ceaa12.json) | 3 | 62 |
| [SR-1.03](seed-readiness/specs/SR-1.03-replay-protection-that-survives-a.json) | [`k-sr-1-03-replay-protectio-4b7e14`](signed/k-sr-1-03-replay-protectio-4b7e14.json) | 2 | [`k-sr-1-03-replay-protectio-6aeb51`](signed/k-sr-1-03-replay-protectio-6aeb51.json) | 1 | 35 |
| [SR-1.05](seed-readiness/specs/SR-1.05-a-bounded-rate-limiter.json) | [`k-sr-1-05-a-bounded-rate-l-5ffec7`](signed/k-sr-1-05-a-bounded-rate-l-5ffec7.json) | 2 | [`k-sr-1-05-a-bounded-rate-l-594b7f`](signed/k-sr-1-05-a-bounded-rate-l-594b7f.json) | 1 | 40 |
| [SR-1.06](seed-readiness/specs/SR-1.06-one-licence-schema-validated-everywhere.json) | [`k-sr-1-06-one-licence-sche-140f67`](signed/k-sr-1-06-one-licence-sche-140f67.json) | 2 | [`k-sr-1-06-one-licence-sche-e3e5e0`](signed/k-sr-1-06-one-licence-sche-e3e5e0.json) | 1 | 43 |
| [SR-1.21](seed-readiness/specs/SR-1.21-a-missing-note-is-never-silent.json) | [`k-sr-1-21-a-missing-note-t-6f2586`](signed/k-sr-1-21-a-missing-note-t-6f2586.json) | 2 | [`k-sr-1-21-a-missing-note-t-77741b`](signed/k-sr-1-21-a-missing-note-t-77741b.json) | 1 | 41 |
| [SR-1.22](seed-readiness/specs/SR-1.22-an-interrupted-write-recovers-from-the-log.json) | [`k-sr-1-22-a-whole-note-wri-93b7ea`](signed/k-sr-1-22-a-whole-note-wri-93b7ea.json) | 2 | [`k-sr-1-22-a-whole-note-wri-9746f4`](signed/k-sr-1-22-a-whole-note-wri-9746f4.json) | 1 | 41 |
| [SR-1.24](seed-readiness/specs/SR-1.24-no-cli-write-beside-a-live-daemon.json) | [`k-sr-1-24-no-cli-command-w-adb5d2`](signed/k-sr-1-24-no-cli-command-w-adb5d2.json) | 2 | [`k-sr-1-24-no-cli-command-w-a03500`](signed/k-sr-1-24-no-cli-command-w-a03500.json) | 1 | 38 |
| [SR-1.25](seed-readiness/specs/SR-1.25-a-cloud-seat-addresses-one-local-seat.json) | [`k-sr-1-25-a-cloud-seat-all-2b1c21`](signed/k-sr-1-25-a-cloud-seat-all-2b1c21.json) | 2 | [`k-sr-1-25-a-cloud-seat-all-c6de54`](signed/k-sr-1-25-a-cloud-seat-all-c6de54.json) | 1 | 41 |
| [SR-1.26](seed-readiness/specs/SR-1.26-one-write-can-never-make-the-vault-unopenable.json) | [`k-sr-1-26-one-write-can-ne-a0683a`](signed/k-sr-1-26-one-write-can-ne-a0683a.json) | 2 | [`k-sr-1-26-one-write-can-ne-e6ae4e`](signed/k-sr-1-26-one-write-can-ne-e6ae4e.json) | 2 | 51 |
| [SR-1.27](seed-readiness/specs/SR-1.27-done-comes-only-from-a-passing-verify.json) | [`k-sr-1-27-done-comes-only-72f8b2`](signed/k-sr-1-27-done-comes-only-72f8b2.json) | 2 | [`k-sr-1-27-done-comes-only--ce2666`](signed/k-sr-1-27-done-comes-only--ce2666.json) | 1 | 22 |
| [SR-1.28](seed-readiness/specs/SR-1.28-the-bus-writes-its-own-routing-files.json) | [`k-sr-1-28-the-bus-writes-i-c64ab5`](signed/k-sr-1-28-the-bus-writes-i-c64ab5.json) | 2 | [`k-sr-1-28-the-bus-writes-i-02c12e`](signed/k-sr-1-28-the-bus-writes-i-02c12e.json) | 2 | 56 |

## Scope One gap contracts, 31 October 2026

`scope-one/` holds eleven design-record contracts, SO-1.01 to SO-1.11, one for each gap the review of PR #222 names that no
other contract owns. Each quotes the addendum text it answers and asks for a decision record under `docs/scope-one/design/`;
none builds anything, because the addendum turns a recommendation into development only after the owner accepts the design.
The owner asked for them on 31 October 2026 (t531u). Each has an interim red-team record (an interim solo review by the
author, pending independent re-review) and is signed by signer-2 (`keys/45c92c2850024872.pub`). The work breakdown that
shows where each sits is [docs/scope-one/WBS.md](../docs/scope-one/WBS.md).

| Spec | Contract | Gap | Title | Depends on |
|---|---|---|---|---|
| [SO-1.01](scope-one/specs/SO-1.01-canonical-execution-integration.json) | [`k-so-1-01-canonical-execut-21da9f`](signed/k-so-1-01-canonical-execut-21da9f.json) | G-SO-01 | Canonical execution integration: the store, the state machine and the coordinator as one authority | none |
| [SO-1.02](scope-one/specs/SO-1.02-reconciliation-wbs.json) | [`k-so-1-02-reconciliation-o-701f2f`](signed/k-so-1-02-reconciliation-o-701f2f.json) | G-SO-02 | Reconciliation: one work breakdown that accounts for every requirement, contract, pull request and branch | none |
| [SO-1.03](scope-one/specs/SO-1.03-lead-assignment-preference.json) | [`k-so-1-03-lead-assignment-2ba274`](signed/k-so-1-03-lead-assignment-2ba274.json) | G-SO-03 | Lead assignment: a default suitability analysis and an in-language user preference | SO-1.01 |
| [SO-1.04](scope-one/specs/SO-1.04-dispatch-event-distinction.json) | [`k-so-1-04-dispatch-events-82855d`](signed/k-so-1-04-dispatch-events-82855d.json) | G-SO-04 | Dispatch events: a requested action, an accepted dispatch, an observed execution and a verified outcome stay apart | SO-1.01 |
| [SO-1.05](scope-one/specs/SO-1.05-workspace-views-and-lead-area.json) | [`k-so-1-05-workspace-the-el-5e1723`](signed/k-so-1-05-workspace-the-el-5e1723.json) | G-SO-05 | Workspace: the eleven project views and the persistent lead-agent area | SO-1.01, SO-1.07 |
| [SO-1.06](scope-one/specs/SO-1.06-connections-and-resource-readiness.json) | [`k-so-1-06-connections-and-761bb2`](signed/k-so-1-06-connections-and-761bb2.json) | G-SO-06 | Connections and access: the provider and tool connections screen and the internal resource readiness registry | SO-1.01 |
| [SO-1.07](scope-one/specs/SO-1.07-relationship-model-and-staleness.json) | [`k-so-1-07-relationship-mod-a24ac5`](signed/k-so-1-07-relationship-mod-a24ac5.json) | G-SO-07 | Relationship model: explicit relations between project items, and change propagation that marks affected work stale | SO-1.01 |
| [SO-1.08](scope-one/specs/SO-1.08-decision-queue.json) | [`k-so-1-08-decision-queue-b-7e1ddc`](signed/k-so-1-08-decision-queue-b-7e1ddc.json) | G-SO-08 | Decision queue: blockers and user decisions as one workflow with named states | SO-1.01 |
| [SO-1.09](scope-one/specs/SO-1.09-artefact-history-and-previews.json) | [`k-so-1-09-artefacts-versio-a9b74b`](signed/k-so-1-09-artefacts-versio-a9b74b.json) | G-SO-09 | Artefacts: version history, comparison and previews that show verification state | SO-1.01 |
| [SO-1.10](scope-one/specs/SO-1.10-fault-classes-added-to-failure-suite.json) | [`k-so-1-10-fault-classes-th-112630`](signed/k-so-1-10-fault-classes-th-112630.json) | G-SO-10 | Fault classes: the addendum classes that F01 to F20 do not name, added to the failure suite | SO-1.01 |
| [SO-1.11](scope-one/specs/SO-1.11-reference-project-acceptance.json) | [`k-so-1-11-reference-projec-1fdf73`](signed/k-so-1-11-reference-projec-1fdf73.json) | G-SO-11 | Reference project: the whole user journey as one integration gate | SO-1.01, SO-1.05, SO-1.06, SO-1.07, SO-1.08, SO-1.10 |

## Baseline 8.3 to 8.6 contracts, 31 October 2026

`scope-one/` also holds fourteen design-record contracts, SO-2.01 to SO-2.14, for the rows of baseline sections 8.3 to 8.6 that no other contract or programme task owns: organisational intelligence (six), specialist knowledge systems, other agent frameworks, other software delivery systems, business communication and enterprise systems (five), federated computation, commercial integration services and business team administration. The owner released those sections for contracting on 31 October 2026. Each quotes the baseline or addendum text it answers, asks for a decision record under `docs/scope-one/design/` and builds nothing. Each has an interim red-team record (an interim solo review by the author, pending independent re-review) and is signed by signer-2. Rows owned by the programme decomposition are mapped, not repeated, in section 5 and 9.1 of the [work breakdown](../docs/scope-one/WBS.md).

| Spec | Contract | Gap | Title | Depends on |
|---|---|---|---|---|
| [SO-2.01](scope-one/specs/SO-2.01-organisational-knowledge-model.json) | [`k-so-2-01-organisational-k-a74c7a`](signed/k-so-2-01-organisational-k-a74c7a.json) | G-SO-12 | Organisational knowledge model: relationships between people, teams, projects, decisions, artefacts and evidence | none |
| [SO-2.02](scope-one/specs/SO-2.02-permission-aware-knowledge-access.json) | [`k-so-2-02-permission-aware-3aad61`](signed/k-so-2-02-permission-aware-3aad61.json) | G-SO-13 | Permission-aware knowledge access: retrieval governed by identity, project membership, classification, policy and jurisdiction | SO-2.01 |
| [SO-2.03](scope-one/specs/SO-2.03-provenance-retention-invalidation.json) | [`k-so-2-03-provenance-reten-840a10`](signed/k-so-2-03-provenance-reten-840a10.json) | G-SO-14 | Provenance, retention and invalidation of organisational knowledge | SO-2.01 |
| [SO-2.04](scope-one/specs/SO-2.04-cross-project-intelligence.json) | [`k-so-2-04-cross-project-in-557a10`](signed/k-so-2-04-cross-project-in-557a10.json) | G-SO-15 | Cross-project intelligence: evidence-backed discovery across otherwise independent work | SO-2.01, SO-2.03 |
| [SO-2.05](scope-one/specs/SO-2.05-cross-functional-issue-discovery.json) | [`k-so-2-05-cross-functional-1e49dd`](signed/k-so-2-05-cross-functional-1e49dd.json) | G-SO-16 | Cross-functional issue discovery without unrestricted access to private records | SO-2.02, SO-2.04 |
| [SO-2.06](scope-one/specs/SO-2.06-organisational-intelligence-acceptance.json) | [`k-so-2-06-organisational-i-ea3946`](signed/k-so-2-06-organisational-i-ea3946.json) | G-SO-17 | Organisational intelligence acceptance: tests for false findings, leakage and lost provenance | SO-2.02, SO-2.03, SO-2.04, SO-2.05 |
| [SO-2.07](scope-one/specs/SO-2.07-specialist-knowledge-systems.json) | [`k-so-2-07-specialist-knowl-3f489e`](signed/k-so-2-07-specialist-knowl-3f489e.json) | G-SO-18 | Specialist knowledge systems: import, export, references, provenance and ownership at the boundary | SO-2.02, SO-2.03 |
| [SO-2.08](scope-one/specs/SO-2.08-agent-frameworks-and-runtimes.json) | [`k-so-2-08-agent-frameworks-11e2d8`](signed/k-so-2-08-agent-frameworks-11e2d8.json) | G-SO-19 | Agent frameworks and runtimes: a provider-neutral task adapter and capability mapping | SO-1.04 |
| [SO-2.09](scope-one/specs/SO-2.09-software-delivery-systems.json) | [`k-so-2-09-software-deliver-809909`](signed/k-so-2-09-software-deliver-809909.json) | G-SO-20 | Software delivery systems: other repository hosts and issue trackers | SO-1.06 |
| [SO-2.10](scope-one/specs/SO-2.10-business-communication-systems.json) | [`k-so-2-10-business-communi-7bcc87`](signed/k-so-2-10-business-communi-7bcc87.json) | G-SO-21 | Business communication systems: authorised event ingestion and task linkage | SO-1.06, SO-2.03 |
| [SO-2.11](scope-one/specs/SO-2.11-enterprise-systems.json) | [`k-so-2-11-enterprise-syste-6795d0`](signed/k-so-2-11-enterprise-syste-6795d0.json) | G-SO-22 | Enterprise systems: explicit data contracts, least privilege, audit and retention | SO-1.06, SO-2.02, SO-2.03 |
| [SO-2.12](scope-one/specs/SO-2.12-federated-computation.json) | [`k-so-2-12-federated-comput-0d4271`](signed/k-so-2-12-federated-comput-0d4271.json) | G-SO-23 | Federated computation behind the provider boundary | none |
| [SO-2.13](scope-one/specs/SO-2.13-commercial-integration-services.json) | [`k-so-2-13-commercial-integ-d4d6ec`](signed/k-so-2-13-commercial-integ-d4d6ec.json) | G-SO-24 | Commercial integration services that keep the open-core boundary neutral | none |
| [SO-2.14](scope-one/specs/SO-2.14-business-team-administration.json) | [`k-so-2-14-business-deploym-5aa59d`](signed/k-so-2-14-business-deploym-5aa59d.json) | G-SO-25 | Business deployment: multi-person project permissions and team administration | none |

## Scope One build layer, 1 November 2026

`scope-one/` also holds the build layer: 25 contracts adapted from the unsigned fold of 30 October 2026 (SO-A-01 to SO-A-12, SO-R-E, SO-F-01 to SO-F-10, SO-F-12 and SO-F-13). They build what the design records SO-1.x and SO-2.x decide, and each cites the record it builds and the signed vault contracts it rests on, by id only. I validated each against main and the programme specs of PR #325, and changed the text where main or an owner decision of 31 October 2026 disagreed with it; every spec lists its changes in its request as adapted from the unsigned fold. SO-F-11 is dropped, with the reason in section 9.3 of [docs/scope-one/WBS.md](../docs/scope-one/WBS.md). Each has an interim red-team record (an interim solo review by the author, pending independent re-review) and is signed by signer-2 (`keys/45c92c2850024872.pub`). The spec file is named by the id alone, because the gate reads the id from the file name and an id with a letter segment has no number to stop at.

| Spec | Contract | Builds | Title | Depends on |
|---|---|---|---|---|
| [SO-A-01](scope-one/specs/SO-A-01.json) | [`k-so-a-01-lead-agent-assig-fe4345`](signed/k-so-a-01-lead-agent-assig-fe4345.json) | SO-1.03 | Lead agent: assignment preferences and overrides in ordinary language | SO-1.01 |
| [SO-A-02](scope-one/specs/SO-A-02.json) | [`k-so-a-02-default-agent-su-518f1f`](signed/k-so-a-02-default-agent-su-518f1f.json) | SO-1.03 | Default agent suitability analysis: capability requirements per task | SO-1.01 |
| [SO-A-03](scope-one/specs/SO-A-03.json) | [`k-so-a-03-requested-accept-0955eb`](signed/k-so-a-03-requested-accept-0955eb.json) | SO-1.04 | Requested | SO-1.01 |
| [SO-A-04](scope-one/specs/SO-A-04.json) | [`k-so-a-04-relationship-mod-f75831`](signed/k-so-a-04-relationship-mod-f75831.json) | SO-1.07 | Relationship model and change propagation: milestones | SO-1.01 |
| [SO-A-05](scope-one/specs/SO-A-05.json) | [`k-so-a-05-decision-and-blo-5b0148`](signed/k-so-a-05-decision-and-blo-5b0148.json) | SO-1.08 | Decision and blocker queue as a workflow: seven states | SO-A-04, SO-1.01 |
| [SO-A-06](scope-one/specs/SO-A-06.json) | [`k-so-a-06-artifact-registr-c34e6d`](signed/k-so-a-06-artifact-registr-c34e6d.json) | SO-1.09 | Artifact registry: every material artifact linked to its requirement | SO-A-04, SO-1.01 |
| [SO-A-07](scope-one/specs/SO-A-07.json) | [`k-so-a-07-connections-and--af599b`](signed/k-so-a-07-connections-and--af599b.json) | SO-1.06 | Connections and access: one table over the folder grants | SO-1.01 |
| [SO-A-08](scope-one/specs/SO-A-08.json) | [`k-so-a-08-workspace-first--2598e4`](signed/k-so-a-08-workspace-first--2598e4.json) | SO-1.05 | Workspace | SO-A-01, SO-A-03, SO-A-04, SO-A-05, SO-A-06, SO-1.01 |
| [SO-A-09](scope-one/specs/SO-A-09.json) | [`k-so-a-09-workspace-second-b05b28`](signed/k-so-a-09-workspace-second-b05b28.json) | SO-1.05 | Workspace | SO-A-04, SO-A-08 |
| [SO-A-12](scope-one/specs/SO-A-12.json) | [`k-so-a-12-workspace-third--bd2b44`](signed/k-so-a-12-workspace-third--bd2b44.json) | SO-1.05, SO-1.09 | Workspace | SO-A-06, SO-A-09 |
| [SO-A-10](scope-one/specs/SO-A-10.json) | [`k-so-a-10-fault-injection--399469`](signed/k-so-a-10-fault-injection--399469.json) | SO-1.10, SO-1.11 | Fault injection and the reference journey: the failure matrix extended to F31 | SO-A-01, SO-A-02, SO-A-03, SO-A-06, SO-A-07, SO-A-08 |
| [SO-A-11](scope-one/specs/SO-A-11.json) | [`k-so-a-11-baseline-reconci-5902ed`](signed/k-so-a-11-baseline-reconci-5902ed.json) | SO-1.02 | Baseline reconciliation: a register check over the takeover record with implemented | none |
| [SO-R-E](scope-one/specs/SO-R-E.json) | [`k-so-r-e-publish-the-versi-5db602`](signed/k-so-r-e-publish-the-versi-5db602.json) | none | Publish the versioned container image by a maintainer-run script after the Docker smoke passes: the registry account read from the environment or the origin remote | none |
| [SO-F-01](scope-one/specs/SO-F-01.json) | [`k-so-f-01-identity-and-sco-a635b7`](signed/k-so-f-01-identity-and-sco-a635b7.json) | SO-2.02, SO-2.14 | Identity and scopes model | none |
| [SO-F-02](scope-one/specs/SO-F-02.json) | [`k-so-f-02-canonical-projec-38d008`](signed/k-so-f-02-canonical-projec-38d008.json) | SO-1.07, SO-2.01 | Canonical project schema | SO-F-01, SO-1.01 |
| [SO-F-03](scope-one/specs/SO-F-03.json) | [`k-so-f-03-contribution-sig-f6fdc0`](signed/k-so-f-03-contribution-sig-f6fdc0.json) | SO-2.02, SO-2.03 | Contribution signature and two-step admission: a signed | SO-F-01, SO-F-02 |
| [SO-F-04](scope-one/specs/SO-F-04.json) | [`k-so-f-04-federation-membe-b99147`](signed/k-so-f-04-federation-membe-b99147.json) | SO-2.02, SO-2.14 | Federation membership and policy exchange specification: the relationship record | SO-F-01, SO-F-03 |
| [SO-F-05](scope-one/specs/SO-F-05.json) | [`k-so-f-05-classification-m-1a82cb`](signed/k-so-f-05-classification-m-1a82cb.json) | SO-2.02, SO-2.03 | Classification model: six replication classes on notes and entities | SO-F-02, SO-F-04 |
| [SO-F-12](scope-one/specs/SO-F-12.json) | [`k-so-f-12-replication-unit-3feee3`](signed/k-so-f-12-replication-unit-3feee3.json) | SO-2.03 | Replication unit: per-scope operation-log streams carrying classification and causal context | SO-F-05, SO-F-03 |
| [SO-F-06](scope-one/specs/SO-F-06.json) | [`k-so-f-06-structured-state-f66a52`](signed/k-so-f-06-structured-state-f66a52.json) | SO-2.01 | Structured-state convergence contract for the engine: input and output schemas per merge class validated in the single boundary | SO-F-02, SO-1.01 |
| [SO-F-07](scope-one/specs/SO-F-07.json) | [`k-so-f-07-federated-query--4be6eb`](signed/k-so-f-07-federated-query--4be6eb.json) | SO-2.02, SO-2.12 | Federated query and continuity specification: an authorised view with provenance and freshness | SO-F-04, SO-F-12 |
| [SO-F-08](scope-one/specs/SO-F-08.json) | [`k-so-f-08-admission-adapte-61bb48`](signed/k-so-f-08-admission-adapte-61bb48.json) | SO-2.13 | Admission adapter boundary: the admission service behind an adapter beside the merge boundary | SO-F-03 |
| [SO-F-09](scope-one/specs/SO-F-09.json) | [`k-so-f-09-finding-model-fo-768791`](signed/k-so-f-09-finding-model-fo-768791.json) | SO-2.04, SO-2.01 | Finding model for organisational intelligence: a finding is a graph claim capped at theory by evidence | SO-F-01, SO-F-02 |
| [SO-F-13](scope-one/specs/SO-F-13.json) | [`k-so-f-13-cross-functional-c6f060`](signed/k-so-f-13-cross-functional-c6f060.json) | SO-2.05, SO-2.06 | Cross-functional conflict detection on a bounded programme: the seeded two-plan conflict detected | SO-F-09, SO-A-05 |
| [SO-F-10](scope-one/specs/SO-F-10.json) | [`k-so-f-10-federated-comput-be4e45`](signed/k-so-f-10-federated-comput-be4e45.json) | SO-2.12 | Federated computation specification as an interface reservation: the work specification and receipt schemas | SO-F-03, SO-F-04 |

## Build layer re-signed after a README re-review, 1 November 2026

Thirteen of the build layer specs above have `docs/README.md` in their scope. Index rows for the SO-2.02 to SO-2.06 decision
records landed there after the specs' round 1 was read, so the red-team gate reported `head_stale_src` for them. Each now has
a round 2 in its record (an interim solo review by the author, pending independent re-review, on the unchanged spec hash)
and is signed again by signer-2 (`keys/45c92c2850024872.pub`) as the next version, naming the one it supersedes, after that
round was committed. No signed file was edited and the earlier versions stay, listed as superseded by
`node scripts/gate/redteam-gate.mjs --report`.

| Spec | Contract | Version | Supersedes |
|---|---|---|---|
| [SO-A-01](scope-one/specs/SO-A-01.json) | [`k-so-a-01-lead-agent-assig-861b14`](signed/k-so-a-01-lead-agent-assig-861b14.json) | 2 | [`k-so-a-01-lead-agent-assig-fe4345`](signed/k-so-a-01-lead-agent-assig-fe4345.json) |
| [SO-A-07](scope-one/specs/SO-A-07.json) | [`k-so-a-07-connections-and--0fd80a`](signed/k-so-a-07-connections-and--0fd80a.json) | 2 | [`k-so-a-07-connections-and--af599b`](signed/k-so-a-07-connections-and--af599b.json) |
| [SO-A-10](scope-one/specs/SO-A-10.json) | [`k-so-a-10-fault-injection--0b84bc`](signed/k-so-a-10-fault-injection--0b84bc.json) | 2 | [`k-so-a-10-fault-injection--399469`](signed/k-so-a-10-fault-injection--399469.json) |
| [SO-F-01](scope-one/specs/SO-F-01.json) | [`k-so-f-01-identity-and-sco-2276e1`](signed/k-so-f-01-identity-and-sco-2276e1.json) | 2 | [`k-so-f-01-identity-and-sco-a635b7`](signed/k-so-f-01-identity-and-sco-a635b7.json) |
| [SO-F-03](scope-one/specs/SO-F-03.json) | [`k-so-f-03-contribution-sig-2ba083`](signed/k-so-f-03-contribution-sig-2ba083.json) | 2 | [`k-so-f-03-contribution-sig-f6fdc0`](signed/k-so-f-03-contribution-sig-f6fdc0.json) |
| [SO-F-04](scope-one/specs/SO-F-04.json) | [`k-so-f-04-federation-membe-8cc66d`](signed/k-so-f-04-federation-membe-8cc66d.json) | 2 | [`k-so-f-04-federation-membe-b99147`](signed/k-so-f-04-federation-membe-b99147.json) |
| [SO-F-05](scope-one/specs/SO-F-05.json) | [`k-so-f-05-classification-m-b3c790`](signed/k-so-f-05-classification-m-b3c790.json) | 2 | [`k-so-f-05-classification-m-1a82cb`](signed/k-so-f-05-classification-m-1a82cb.json) |
| [SO-F-07](scope-one/specs/SO-F-07.json) | [`k-so-f-07-federated-query--085a5f`](signed/k-so-f-07-federated-query--085a5f.json) | 2 | [`k-so-f-07-federated-query--4be6eb`](signed/k-so-f-07-federated-query--4be6eb.json) |
| [SO-F-08](scope-one/specs/SO-F-08.json) | [`k-so-f-08-admission-adapte-1f2357`](signed/k-so-f-08-admission-adapte-1f2357.json) | 2 | [`k-so-f-08-admission-adapte-61bb48`](signed/k-so-f-08-admission-adapte-61bb48.json) |
| [SO-F-09](scope-one/specs/SO-F-09.json) | [`k-so-f-09-finding-model-fo-cbe213`](signed/k-so-f-09-finding-model-fo-cbe213.json) | 2 | [`k-so-f-09-finding-model-fo-768791`](signed/k-so-f-09-finding-model-fo-768791.json) |
| [SO-F-10](scope-one/specs/SO-F-10.json) | [`k-so-f-10-federated-comput-46e7e6`](signed/k-so-f-10-federated-comput-46e7e6.json) | 2 | [`k-so-f-10-federated-comput-be4e45`](signed/k-so-f-10-federated-comput-be4e45.json) |
| [SO-F-12](scope-one/specs/SO-F-12.json) | [`k-so-f-12-replication-unit-156f69`](signed/k-so-f-12-replication-unit-156f69.json) | 2 | [`k-so-f-12-replication-unit-3feee3`](signed/k-so-f-12-replication-unit-3feee3.json) |
| [SO-F-13](scope-one/specs/SO-F-13.json) | [`k-so-f-13-cross-functional-8c65b0`](signed/k-so-f-13-cross-functional-8c65b0.json) | 2 | [`k-so-f-13-cross-functional-c6f060`](signed/k-so-f-13-cross-functional-c6f060.json) |
