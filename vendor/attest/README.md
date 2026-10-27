# attest (vendored)

Task contracts: a JSON contract of tasks with acceptance criteria, a canonical hash, a DSSE
signature, and a decomposer that turns a short scope file into a proposed contract.

Vendored from an Apache-2.0 project at revision c747a27 and renamed, as that project's NOTICE asks
of derived products. `LICENSE` and `NOTICE` are that project's, unchanged. Every modified file says so
at the top. Memev does not download, call or depend on the original at runtime.

Files: `contract.mjs` (model, validation, lint), `decompose.mjs` (scope → proposal), `util.mjs`,
`signature.mjs` (canonical form and DSSE PAE kept; Ed25519 via node:crypto).
