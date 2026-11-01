### Added

- The identity and scopes model, version 1 (`docs/IDENTITY-AND-SCOPES.md`, `docs/schemas/identity-v1.json`, `src/engine/identity.mjs`): subjects (person, agent, device, node, operator, service) with an owner, keys, expiry and revocation; eight scope types from personal to organisation; memberships; and a validator.
- Every authenticated HTTP and MCP request, and every store read and write, now resolves to a subject and a scope, and is refused with a reason when it resolves to neither. A token issued the way tokens are today resolves to the owner subject and the personal scope and keeps working.
- A token can carry an identity scope, a field of its own beside the read, write and admin permissions, with the subject it speaks for. A credential issued for a personal scope cannot read or write an organisational scope, and the reverse.
- The agent role bindings resolve to agent subjects bound to person subjects, with no second identity store.
- The threat model has a row for a credential of one scope used against another.
