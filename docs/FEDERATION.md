# Federation

[Back to the docs index](README.md)

State may cross a boundary only as a contribution that the receiving node can verify and judge. This page describes the contribution and the node's own admission of it. It is the first part of the federation design, and later parts extend it.

## Status

Planned. The contribution block, its validator and the admission functions exist as library code with tests, and no running code path calls them: no network route accepts a contribution, nothing sends one, and the vault does not admit anything on its own. Transport between nodes is a later contract. Federation between sites in general is an architectural target, not a feature of any current release, and no tier or price lists it.

## Contribution and admission

A contribution is an [operation envelope](OPERATION-ENVELOPE.md) that carries one more block in the envelope's extension block, under the key `contribution`. The envelope stays the one record shape: its schema version, its causal context (`deps` and `hlc`), its operation id and its content hash are the contribution's own. The block is the signature and admission block, and `docs/schemas/contribution-v1.json` is its schema. The validator is `validateContribution` in `src/engine/federation/contribution.mjs`.

| Field of the block | What it holds |
|---|---|
| `schema` | `memev-contribution/1`. |
| `subject` | The subject that wrote it (a subject of the [identity model](IDENTITY-AND-SCOPES.md)). It is the origin identity of the envelope. |
| `scope` | `{ type, id }`: the scope it is written for. |
| `classification` | A string. Its values are constrained later by a classification schema; until then the node's policy lists the labels it accepts. |
| `sequence` | The per-sender sequence, a whole number of 1 or more. |
| `payload_hash` | The SHA-256 of the canonical payload of the envelope. |
| `provenance` | `{ source, derived_from }`: where it came from, and the operation ids it was derived from. |
| `signature` | `{ principal, namespace, sshsig }`: see below. |

### The signature

The signature is made with the role key of a [role binding](AGENT-IDENTITY.md), through the same ssh-keygen path, and it is checked offline with the public key the node already holds for that subject. It is made in the namespace `memev-contribution`, which is not the namespace of a role binding (`memev`). A signature made for a binding is therefore never a contribution signature, and the reverse: the validator refuses the binding namespace, and the check fails if a signature made in it is presented under the other. The signed text is a header line and the canonical text of the envelope without the signature, so it covers every other field, the payload hash included. A signature proves that a key signed. It does not say that the subject may write there.

The signing and the check live in `src/engine/agentid-bind.mjs` (`signNamespaced` and `verifyNamespaced`), so nothing under `src/engine/federation` imports a module that starts a process or opens a connection. A test scans those files for `child_process`, `node:net`, `node:http`, `node:https` and `node:dgram`.

### The two-step admission

A node admits a contribution into its own operation log in two steps before it appends anything. This two-step admission is the node's own, and it runs after an external admission service when one is configured (planned). The steps, in order:

1. **Signature.** The subject is one the node knows, it has a live key of that name, and the signature verifies with it. A revoked or expired key does not count.
2. **Authority and policy.** The scope is the scope the node holds (a personal scope and an organisational scope never mix), the subject is not revoked or expired and has a live membership in that scope in the node's own identity document, and the node's policy accepts the classification for that scope. The policy is deny by default: a scope and classification it does not list are refused.

Then the sequence is held against the high-water mark of the sender, which is the node and the subject. A sequence that is not above it is a replay and is refused. The mark is kept in the operation log: it is rebuilt from the admitted records when the node opens, so a restart does not forget it.

A contribution that passes is appended to the vault's operation log as `federation.admitted`, with the envelope as it came. A contribution that fails at either step, a malformed one, a refusal by the external service and a replay are each appended as `federation.rejected`, through the same operation log API and in no other store. The rejected event names the operation, the sender, the scope, the sequence, the step, the code and the reason, and holds nothing of the payload: not the payload, not the extension block and not the payload hash.

### What is planned

- Transport: how a contribution gets from one node to another. Nothing here opens a connection.
- The external admission service that runs before the node's own two steps. The hook exists; the service does not.
- The values of the classification field, which a classification schema constrains.
- Membership and policy exchange between nodes, and revoking a relationship.
- Splitting the operation log by scope.
