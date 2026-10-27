# Changelog

## Unreleased

- A relay gives a vault one address that stays the same after restarts: the protocol (docs/RELAY.md), a client (`memev cloud relay on|off|status|address`, off by default) and a relay for development and tests. The relay only forwards, so it cannot read tokens.
- Activation milestones are worked out on your computer from the vault's own files and kept in onboarding.json; `memev onboarding --milestones` lists them. Nothing is sent.
- docs/METRICS.md says how licence activations and package downloads are counted, with the queries.
- `memev license activate <key>` fetches the signed licence once from a configurable endpoint and verifies it on this computer from then on.
