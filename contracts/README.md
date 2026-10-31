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
