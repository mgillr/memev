# Threat model

**Assets:** the vault contents; the tokens; the contract signing key; the integrity of the log.

| Threat | Mitigation |
|---|---|
| Another user on the machine reads the vault or tokens | `.memev/`, the config dir and keys are mode 0600/0700; daemon on loopback |
| A web page calls the local API (DNS rebinding, CSRF) | bearer token on every route; a request with a non-local Host header or proxy headers is treated as remote; no cookies |
| Someone finds the tunnel address | remote token and tunnel key both required, or the secret connector URL; rate limits; audit log; `memev cloud off` |
| A leaked token | expiry, `memev token revoke`/`rotate`, path and scope limits |
| A prompt-injected session writes junk or deletes memory | the log is append-only; every change can be seen and undone from it and from git; deletes are records, not erasures |
| A session pastes a secret into memory | the secret scanner refuses the write |
| A signed contract is quietly weakened | protected paths, the vault pre-commit hook and the signature check; changes only by a new signed amendment |
| Disk corruption or a crash mid-write | log records are checksummed and sealed per segment; files are rebuilt from the log on start |
| A tampered `cloudflared` download | pinned version and SHA-256 |
| The GitHub key is stolen | it is a deploy key for one private repository only |

**Out of scope:** an attacker who already runs code as your user; the AI apps themselves; the
security of Tailscale, Cloudflare and GitHub.
