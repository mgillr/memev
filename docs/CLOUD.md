# Cloud access

Cloud AI apps cannot reach `127.0.0.1`, so Memev opens a tunnel when remote access is on. Remote
access is off by default, on a personal install as on an organisation one. `memev init` on a
terminal offers it once; `memev cloud on` turns it on and `memev cloud off` turns it off. An
organisation install (`memev init --org`) needs `memev cloud on --yes`, because whatever recall
returns through the tunnel goes to the cloud AI app that asked for it.

The tunnel is chosen in this order (`memev cloud use auto|tailscale|cloudflare|quick` to pin one):

1. **Tailscale serve** if `tailscale` is installed and logged in: a stable `https://<machine>.<tailnet>.ts.net` address, reachable only from your tailnet (Memev never opens a Funnel).
2. **A named Cloudflare tunnel** if you set one up: `memev cloud use cloudflare --name <tunnel> --hostname <host>`.
3. **A Cloudflare quick tunnel**: no account, works anywhere, but the address changes when it restarts.
   Memev downloads a pinned `cloudflared` release and checks its SHA-256 before running it.

`memev cloud status` shows the state. `memev cloud url` prints:

- a **connector URL** (`https://<address>/c/<token>/mcp`) for apps that take only a URL. It contains a
  secret: treat it like a password; `memev token revoke <id>` kills it.
- the plain MCP URL plus the header apps with header support should send:
  `Authorization: Bearer <token>`.

Apps that speak OAuth 2.1 use the standard flow instead of a URL with a secret in it. The server
publishes its metadata at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`. The app registers itself at `/oauth/register` (dynamic
client registration) and gets a client id, then starts the authorization code grant with PKCE at
`/oauth/authorize`. That redirects to a consent page on the vault's machine, where the owner
approves or denies it. The app exchanges the code at `/oauth/token` for a bearer token it sends as
`Authorization: Bearer <token>`, refreshes it with the refresh token, and gives it back at
`/oauth/revoke`. Each registered client shows up in `memev devices` as a cloud connector. The
connector URL above stays available for apps that take only a URL.

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

`memev invite` prints a one-time code, a link and a QR code. The code carries this vault's address and a secret. The secret is stored only as a hash and it expires (15 minutes, or `--ttl` seconds). Redeeming the code enrolls one computer. A second redemption is refused, and an expired code is refused with a message that says it expired.

```sh
memev invite                 # on the vault: code, link and QR code
memev invite --ttl 600       # the same, expiring after ten minutes
```

`memev init` on a terminal asks whether this is the first computer or you are adding this one to an existing vault. Answering joining runs the join flow and creates no vault here. Without a terminal, init creates a vault and prints one line on how a second computer uses `memev init --join`. `memev init --join <code>` joins straight away and does not ask.

On the other computer, `memev join <code>` makes a device key, enrols this computer and connects the AI apps on it. A bad or used code stops before any credential is saved. The older path still works: `memev devices keygen`, then `memev join <url> --token <token>`.

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

## Which computers can join

Joining another computer through the secure link, as on this page, is the paid tier, Personal with
more computers: the vault refuses to enroll a computer past the number in its licence, and with no
licence that number is one. Personal on one computer is free and uses one computer at a time. To
switch computers, back the vault up to your own GitHub repository and let `memev init` on the new
computer join that backup ([GITHUB.md](GITHUB.md)). Git sync is single-writer backup: a second
computer that also pushes gets a warning from `memev doctor` that concurrent edits can conflict.

A personal vault never joins a Business or Corporate vault, and a company vault never joins a
personal one. They have separate identities and keys, with no grants, mounts or mixing.
