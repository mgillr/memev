# Cloud access

Cloud AI apps cannot reach `127.0.0.1`, so Memev opens a tunnel when remote access is on. On a
personal install it is on by default; `memev init --local-only` or `memev cloud off` turns it off,
`memev cloud on` back on. An organisation install (`memev init --org`) starts with it off, and
`memev cloud on --yes` is needed to switch it on, because whatever recall returns through the tunnel
goes to the cloud AI app that asked for it.

The tunnel is chosen in this order (`memev cloud use auto|tailscale|cloudflare|quick` to pin one):

1. **Tailscale Funnel** if `tailscale` is installed and logged in: a stable `https://<machine>.<tailnet>.ts.net` address.
2. **A named Cloudflare tunnel** if you set one up: `memev cloud use cloudflare --name <tunnel> --hostname <host>`.
3. **A Cloudflare quick tunnel**: no account, works anywhere, but the address changes when it restarts.
   Memev downloads a pinned `cloudflared` release and checks its SHA-256 before running it.

`memev cloud status` shows the state. `memev cloud url` prints:

- a **connector URL** (`https://<address>/c/<token>/mcp`) for apps that take only a URL. It contains a
  secret: treat it like a password; `memev token revoke <id>` kills it.
- the plain MCP URL plus the header apps with header support should send:
  `Authorization: Bearer <token>`.

Every app and computer has its own credential; there is no shared key. `memev devices` lists them:

```sh
memev devices                                    # computers, connectors and local apps, with last use
memev devices enroll --kind cloud-connector --label chatgpt   # a token for a cloud AI app
memev devices rotate <id>   |   memev devices remove <id>     # replace or cut off one credential
```

Another computer joins with its own key, made on that computer:

```sh
memev devices keygen                                          # on the laptop: prints its public key
memev devices enroll --kind remote-computer --label laptop --pubkey <key>   # on the vault
memev join https://<address> --token <token>                  # on the laptop
```

`memev join` checks the vault answers, saves the address, and connects the AI apps on the laptop.
From then on every request from the laptop is signed with its key, and the token alone does not
work on another machine. The vault refuses to enroll more computers than its licence covers; with
no licence that is one, the vault's own computer. `memev devices remove <id>` frees a seat. A
connector URL pasted into a coding app on a computer is refused with a pointer to these steps.
Apps set up before per-device credentials still send `X-Memev-Key`; it keeps working, but is no
longer needed.

Remote requests always need a token issued for remote use, are rate limited (120 a minute by
default) and are logged to `.memev/access.jsonl`. Contract signing and admin routes are local only.
`memev cloud rotate-key` changes the legacy shared key, for apps that still send it.
