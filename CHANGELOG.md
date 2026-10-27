# Changelog

## Unreleased

- `memev upgrade` prints the checkout URL from this vault's config. The flow, the webhook that emails a licence key, and the refund path are in docs/CHECKOUT.md. Provider, prices, sender, and operator are not set.
- A relay gives a vault one address that stays the same after restarts: the protocol (docs/RELAY.md), a client (`memev cloud relay on|off|status|address`, off by default) and a relay for development and tests. The relay only forwards, so it cannot read tokens.
- When the tunnel address changes, the vault writes a signed address record into its git backup. A joined computer that cannot reach the old address reads that record, checks the host's signature, and switches. A bad signature is ignored.
- `memev report on|off|show|send`: an anonymous milestone report that is off by default, asked once at init, and sends only milestone names, days and a random id to an address you set.
- Activation milestones are worked out on your computer from the vault's own files and kept in onboarding.json; `memev onboarding --milestones` lists them. Nothing is sent.

- docs/METRICS.md says how licence activations and package downloads are counted, with the queries.
- `memev license activate <key>` fetches the signed licence once from a configurable endpoint and verifies it on this computer from then on.
