# Cloud access

Cloud AI apps cannot reach `127.0.0.1`, so Memev opens a tunnel when remote access is on. It is on
by default; `memev init --local-only` or `memev cloud off` turns it off, `memev cloud on` back on.

The tunnel is chosen in this order (`memev cloud use auto|tailscale|cloudflare|quick` to pin one):

1. **Tailscale Funnel** if `tailscale` is installed and logged in: a stable `https://<machine>.<tailnet>.ts.net` address.
2. **A named Cloudflare tunnel** if you set one up: `memev cloud use cloudflare --name <tunnel> --hostname <host>`.
3. **A Cloudflare quick tunnel**: no account, works anywhere, but the address changes when it restarts.
   Memev downloads a pinned `cloudflared` release and checks its SHA-256 before running it.

`memev cloud status` shows the state. `memev cloud url` prints:

- a **connector URL** (`https://…/c/<token>/mcp`) for apps that take only a URL. It contains a
  secret: treat it like a password; `memev token revoke <id>` kills it.
- the plain MCP URL plus the header apps with header support should send:
  `Authorization: Bearer <token>`.

Every app and computer has its own credential; there is no shared key. `memev devices` lists them:

```sh
memev devices                                    # computers, connectors and local apps, with last use
memev devices enroll --kind remote-computer --label laptop    # a token for another computer
memev devices enroll --kind cloud-connector --label chatgpt   # a token for a cloud AI app
memev devices rotate <id>   |   memev devices revoke <id>     # replace or cut off one credential
```

A remote computer can also prove who it is with its own key: run `memev devices keygen` on it and
enroll it with `--pubkey`. A copied configuration is then useless without that key. Apps set up
before per-device credentials still send `X-Memev-Key`; it keeps working, but is no longer needed.

Remote requests always need a token issued for remote use, are rate limited (120 a minute by
default) and are logged to `.memev/access.jsonl`. Contract signing and admin routes are local only.
`memev cloud rotate-key` changes the legacy shared key, for apps that still send it.
