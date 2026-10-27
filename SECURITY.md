# Security

Report vulnerabilities through GitHub's private vulnerability reporting on this repository. Please do
not open a public issue.

## Defaults

- The daemon listens on `127.0.0.1` only. Every MCP and API request needs a bearer token; tokens are
  scoped (read, write, admin), can be limited to paths, expire, and are stored hashed.
- Remote requests (through the tunnel) need a token issued to that device for remote use, or a
  connector URL. Each computer and app has its own credential (`memev devices`), which can be
  rotated or revoked alone; a computer can also sign its requests with its own Ed25519 key. They are rate limited and logged. Admin and contract-signing routes are local only.
- Writes are scanned for secrets (keys, tokens, private keys) and refused unless explicitly allowed.
- Files under `.memev/` and in the config directory are created readable by your user only.
- GitHub backup uses a deploy key limited to one private repository, and a pre-push check.
- No telemetry. Memev makes no network requests except the tunnel you enable, the `cloudflared`
  download (pinned version, SHA-256 checked), and git pushes to the remote you set up.
- No runtime dependencies.
- Licences are verified offline; nothing is sent anywhere to check one. Device and seat counts stay
  on your machine and never limit anything ([CHARTER.md](CHARTER.md)).

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).
