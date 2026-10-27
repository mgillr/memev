# Changelog

## Unreleased

- Activation milestones are worked out on your computer from the vault's own files and kept in onboarding.json; `memev onboarding --milestones` lists them. Nothing is sent.
- docs/METRICS.md says how licence activations and package downloads are counted, with the queries.
- `memev license activate <key>` fetches the signed licence once from a configurable endpoint and verifies it on this computer from then on.
