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
