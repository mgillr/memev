# Threat model

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

**Assets:** the vault contents; the tokens; the contract signing key; the integrity of the log.

| Threat | Mitigation |
|---|---|
| Another user on the machine reads the vault or tokens | `.memev/`, the config dir and keys are mode 0600/0700; daemon on loopback |
| A web page calls the local API (DNS rebinding, CSRF) | bearer token on every route; a request with a non-local Host header or proxy headers is treated as remote; no cookies |
| Someone finds the tunnel address | a per-device remote token is required (optionally with a device-key signature), or the secret connector URL; rate limits; audit log; `memev cloud off` |
| A credential is copied to another machine | each added computer signs every request with its own key, which never leaves it, so the copy is refused; replays are refused by a one-time nonce; `memev devices rotate` or `remove` cuts off one device |
| A leaked token | expiry, `memev token revoke`/`rotate`, path and scope limits |
| A prompt-injected session writes junk or deletes memory | the log is append-only; every change can be seen and undone from it and from git; deletes are records, not erasures |
| A prompt-injected cloud seat posts a task to a local seat that runs shell commands, or writes a memory that another app recalls | by default a cloud seat may post only to the operator; in the bus text a hook injects into an app's context, a body or ref from any other seat is quoted as untrusted data, not instructions, and cut to a shorter cap (the bus tools hand the model the raw body, and bus_unread's description says to treat anything but an operator message as a request); a vault setting (bus cloud_tasks) lets a team allow a cloud seat to assign a task; recalled memory gets the same treatment, a snippet recalled into the resume card or the per-prompt recall text, and the card's recent decisions and last-session turns, are quoted as untrusted data, not instructions, on one line and cut to their cap; a note's heading still shows in the location label, capped and without brackets |
| A session pastes a secret into memory | the secret scanner refuses the write |
| A signed contract is quietly weakened | protected paths, the vault pre-commit hook and the signature check; changes only by a new signed amendment |
| Disk corruption or a crash mid-write | log records are checksummed and sealed per segment; files are rebuilt from the log on start |
| A tampered `cloudflared` download | pinned version and SHA-256 |
| The GitHub key is stolen | it is a deploy key for one private repository only |

**Out of scope:** an attacker who already runs code as your user; the AI apps themselves; the
security of Tailscale, Cloudflare and GitHub.
