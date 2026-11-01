# Identity and scopes

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related: [THREAT-MODEL.md](THREAT-MODEL.md), [AGENT-IDENTITY.md](AGENT-IDENTITY.md), [PROJECTS.md](PROJECTS.md).

This page describes version 1 of the identity and scopes model: who a request is, where it may act, and which parts of that are enforced today. Anything not enforced is labelled **planned**. The schema is `docs/schemas/identity-v1.json`; the model, its validator and the resolution are in `src/engine/identity.mjs`.

Everything here is resolved on the computer that holds the vault. Resolving a subject and a scope makes no network call, and an agent subject names a role, never a provider.

## The model

A **subject** is who acts. There are six types: `person`, `agent`, `device`, `node`, `operator` and `service`. Every subject has an owner, and the owner is a person subject; a person is its own owner. An agent subject also names a role (the role of [AGENT-IDENTITY.md](AGENT-IDENTITY.md)) and never names a provider or a model. A subject has keys (each with its own expiry and revocation) and an expiry and revocation of its own.

A **scope** is where a subject may act. There are eight types: `personal`, `team`, `department`, `project`, `programme`, `portfolio`, `site` and `organisation`. A scope has an id and a type; a scope without a type is refused.

A **membership** records that a subject belongs to a scope from a time, until it expires or is revoked.

A token's **identity scope** is a field of its own (`identity_scope`, with a `subject`) in the token record. It is not one of the read, write and admin permissions of the token. A permission says what a token may do; an identity scope says where. An admin token is still bound to one scope.

## What is enforced today

- **Resolution.** Every authenticated HTTP and MCP request resolves to a subject and a scope before anything runs, and so does every store read and write. A request that resolves to neither is refused with a code and a reason (`no_identity`, `no_subject`, `bad_scope`, `expired`, `revoked` or `scope_mismatch`). The routes that need no token (the health check, the OAuth discovery and setup routes) are unchanged.
- **Personal stays as it is.** A device token or a client token issued the way tokens are issued today has no identity scope. It resolves to the owner subject and the personal scope, and keeps working.
- **Organisational tokens.** A token issued with an identity scope other than personal must name its subject, with an owner. It resolves to that subject and that scope.
- **No mixing.** A credential issued for a personal scope cannot read or write an organisational scope, and a credential issued for an organisational scope cannot read or write a personal scope. Two organisational scopes meet only when they are the same scope (same type and same id). A vault holds one scope: the one named in `identity.scope` in its config, or the personal scope when it names none. A vault that names an invalid scope refuses every request.
- **Role bindings.** The bindings of [AGENT-IDENTITY.md](AGENT-IDENTITY.md) resolve to subjects of this model without a second identity store. A role whose binding verifies becomes an agent subject whose owner is the person subject that vouched for it. A binding that is unbound, invalid, or could not be checked (no OpenSSH) is not a subject. The agents directory stays the only record.
- **No second store.** A token's subject and identity scope live in the token record that already exists; a binding stays where it is; a vault names its scope in its own config. The module writes nothing.

## What is planned

These parts of the model are defined by the schema and the validator but are **planned**: nothing enforces them yet.

- Memberships and scope parents: no request is checked against a membership, and a team or project scope does not yet reach into the scope it sits in. Today two organisational scopes meet only when they are identical.
- Subject keys: the keys of a subject are described, not yet checked against a request signature, and a subject's own expiry and revocation are read only from the subject a token carries.
- The node, operator and service subjects: no feature issues one yet; federation, admission and delegation (see the federation pages) build on this model later.
- Issuing an organisational token from the command line, and the page where an operator manages subjects and memberships.
- A role by action matrix: it is not introduced here, and no role grants anything.
- The command line and the importers use identities that are not tokens; on a vault that names an organisational scope they are treated as personal and refused. An operator subject for the local command line is planned.
- A role binding as a credential on a request: today a binding vouches for a role offline, and does not authenticate a call.

## Where each part lives

| Part | Where |
|---|---|
| Schema | `docs/schemas/identity-v1.json` |
| Model, validator, resolution | `src/engine/identity.mjs` |
| Token fields `identity_scope` and `subject` | `src/engine/tokens.mjs` |
| Store reads and writes | `src/engine/vault.mjs` |
| HTTP and MCP boundary | `src/server/http.mjs`, `src/server/mcp.mjs` |
| The test | `test/identity.test.mjs` |
