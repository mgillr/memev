# Security

Report vulnerabilities through GitHub's private vulnerability reporting on this repository. Please do
not open a public issue.

## Defaults

- The daemon listens on `127.0.0.1` only. Every MCP and API request needs a bearer token; tokens are
  scoped (read, write, admin), can be limited to paths, expire, and are stored hashed.
- Remote requests (through the tunnel) need a token issued to that device for remote use, or a
  connector URL. Each computer and app has its own credential (`memev devices`), which can be
  rotated or removed alone. An added computer must also sign every request with its own Ed25519
  key, made on that computer and never sent anywhere; the signature covers the method, path, time,
  a one-time nonce and the body, so a copied config or a replayed request is refused. Remote
  requests are rate limited and logged. Admin and contract-signing routes are local only.
- Writes are scanned for secrets (keys, tokens, private keys) and refused unless explicitly allowed.
  Comms bus messages are scanned the same way and always refused.
- The comms bus is files in the vault (`bus/`). It travels only with the vault: to your own git
  backup and through the secure link. A seat can only post as itself; removed computers are off it.
- Files under `.memev/` and in the config directory are created readable by your user only.
- GitHub backup uses a deploy key limited to one private repository, and a pre-push check.
- No telemetry. Memev makes no network requests except the tunnel you enable, the `cloudflared`
  download (pinned version, SHA-256 checked), and git pushes to the remote you set up.
- No runtime dependencies.
- Licences are verified offline against the vendor public key in `src/engine/license.mjs`; nothing
  is sent anywhere to check one. The vault refuses to add computers past the licensed number. With
  no licence that number is one, the vault's own computer, which is never limited
  ([CHARTER.md](CHARTER.md)). The code is open, so the check can be patched out; it is there to keep
  licensing honest, not as a security boundary. A faked cloud-app user agent or an SSH port forward
  also gets around the computer count.

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).
