# Changelog

## Unreleased

- The rules every session follows are now a lean text of under 200 tokens (from 562), sent once per session: by the session-start hook in apps that have one, otherwise in the MCP instructions. The CLAUDE.md, AGENTS.md and GEMINI.md block points at them instead of repeating them, and the no-lead notice stops once the setup session has asked. The fixed cost of a session in an app with hooks falls from about 1,800 to about 820 tokens.
- When GitHub is signed in, `memev init` looks for a private backup whose README is a Memev vault and offers to join that vault before it creates a new one. With no GitHub CLI, or signed out, init makes no GitHub call.
- `memev init` ends with "Finish: restart these apps" and one line for each app it connected, saying how to make that app load Memev (a new session or chat, a restart, or a window reload). Apps load MCP servers and hooks when a session starts, so the session that ran init does not have Memev yet.
- A relay gives a vault one address that stays the same after restarts: the protocol (docs/RELAY.md), a client (`memev cloud relay on|off|status|address`, off by default) and a relay for development and tests. The relay only forwards, so it cannot read tokens.
- When the tunnel address changes, the vault writes a signed address record into its git backup. A joined computer that cannot reach the old address reads that record, checks the host's signature, and switches. A bad signature is ignored.
- `memev report on|off|show|send`: an anonymous milestone report that is off by default, asked once at init, and sends only milestone names, days and a random id to an address you set.
- Activation milestones are worked out on your computer from the vault's own files and kept in onboarding.json; `memev onboarding --milestones` lists them. Nothing is sent.
- docs/METRICS.md says how licence activations and package downloads are counted, with the queries.
- `memev license activate <key>` fetches the signed licence once from a configurable endpoint and verifies it on this computer from then on.
