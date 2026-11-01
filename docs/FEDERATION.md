# Federation

[Back to the docs index](README.md)

State may cross a boundary only as a contribution that the receiving node can verify and judge. This page describes the contribution and the node's own admission of it. It is the first part of the federation design, and later parts extend it.

## Status

Planned. Federation is a planned capability of the tiers above Personal, available by contacting us; no tier table or price cell lists it. The contribution block (`docs/schemas/contribution-v1.json`), the relationship record (`docs/schemas/membership-v1.json`) and the policy document (`docs/schemas/policy-v1.json`) exist as schemas with validators, and the admission functions, the relationship book and the evaluation function exist as library code with tests. No running code path calls them: no network route accepts a contribution or a relationship, nothing sends one, and the vault does not admit anything on its own. Transport between nodes is a later contract. Federation between sites in general is an architectural target, not a feature of any current release.

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

## Relationship and policy

Federation starts with an explicit relationship between two parties. It is a record, `memev-membership/1`, and `src/engine/federation/membership.mjs` validates it.

| Field | What it holds |
|---|---|
| `parties` | Two parties, the proposer first. Each is a node and the scope it holds, with the time it accepted (or null while it has not). The two nodes differ. |
| `scope` | The one scope the relationship covers. A contribution for any other scope is outside it. |
| `purpose` | Why the two parties exchange state, in a short text. |
| `expires` | When it ends, after every acceptance. |
| `revocation` | `by` says who may revoke (`either_party` or `proposer`); `revoked_at` and `revoked_by` are null until a party ends it. |
| `policy_version` | The version of the policy document both parties accepted. |

A personal scope or a personal vault is never a party, and never the scope a relationship covers: personal data does not join an organisation. The validator refuses both, and the evaluation denies a personal scope whatever a record says.

One party proposes and the other accepts; a record without both acceptances is not established. Revoking makes a new value with the revocation filled in. A node holds its relationships in its own operation log as `federation.relationship` and `federation.relationship.revoked`, and rebuilds them when it opens, so a restart does not forget a revocation, and a record that was revoked cannot be added again to undo it. There is no other store.

The policy is a second record, `memev-policy/1` (`src/engine/federation/policy.mjs`). For each data class it says whether each of six actions is allowed (discover, read, replicate, compute, retain, export) and gives the recovery point and recovery time objectives of the class, which the backup and recovery work reads. The list of classes is open: the classification schema of a later contract pins the names, and a class the policy does not list has no rule.

### The evaluation

`evaluate` maps a request, (subject, scope, action, class), to allow or deny with the id of the rule that decided. It denies by default and never throws. The rules, in the order they are tried:

| Rule id | Denies when |
|---|---|
| `deny.bad_request` | the request, the policy or the list of relationships cannot be read |
| `deny.personal_scope` | the scope is a personal scope |
| `deny.no_relationship` | no valid relationship covers the scope |
| `deny.revoked` | every relationship for the scope is revoked at that time (checked before expiry) |
| `deny.expired` | every relationship for the scope has expired at that time |
| `deny.not_established` | a relationship exists but a party has not yet accepted, or acceptance is later |
| `deny.policy_version` | the live relationship did not accept this version of the policy |
| `deny.no_rule` | the policy lists no rule for the class |
| `deny.action` | the policy lists the class and does not allow the action |

An allow carries `allow:<policy id>:<class>:<action>`. The subject is checked to be a subject id of the identity model; no rule depends on which subject it is, because who may act inside a site is membership in the identity model, and a node still judges the subject itself in its own admission.

The gate (`relationshipGate`) turns the evaluation into the optional check that the node's admission runs before its two steps: a contribution is a request to replicate its class into its scope. A refusal is recorded as a rejected event, with the rule id as the code and nothing of the payload. The same hook is the place for the external admission service, so a node that wants both composes them.

### What is planned

- Transport: how a contribution gets from one node to another. Nothing here opens a connection.
- The external admission service that runs before the node's own two steps. The hook exists; the service does not.
- The values of the classification field, which a classification schema constrains.
- Carrying a relationship record, an acceptance or a revocation from one node to the other. The test carries them itself.
- The classification schema that pins the class names, and enforcement of the other actions (read, compute, retain, export) at the point each happens; the evaluation only answers.
- Splitting the operation log by scope.
