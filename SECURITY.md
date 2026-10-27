# Security

Report vulnerabilities through GitHub's private vulnerability reporting on this repository. Please do
not open a public issue.

## Defaults

- The daemon listens on `127.0.0.1` only. Every MCP and API request needs a bearer token; tokens are
  scoped (read, write, admin), can be limited to paths, expire, and are stored hashed.
- Remote requests (through the tunnel) need a token issued for remote use plus the tunnel key, or a
  connector URL. They are rate limited and logged. Admin and contract-signing routes are local only.
- Writes are scanned for secrets (keys, tokens, private keys) and refused unless explicitly allowed.
- Files under `.memev/` and in the config directory are created readable by your user only.
- GitHub backup uses a deploy key limited to one private repository, and a pre-push check.
- No telemetry. Memev makes no network requests except the tunnel you enable, the `cloudflared`
  download (pinned version, SHA-256 checked), and git pushes to the remote you set up.
- No runtime dependencies.

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).
