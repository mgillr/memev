# Cloud access

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

Cloud AI apps cannot reach `127.0.0.1`, so Memev opens a tunnel when remote access is on. Remote
access is off by default, on a personal install as on an organisation one. `memev init` on a
terminal offers it once; `memev cloud on` turns it on and `memev cloud off` turns it off. An
organisation install (`memev init --org`) needs `memev cloud on --yes`, because whatever recall
returns through the tunnel goes to the cloud AI app that asked for it.

The tunnel is chosen in this order (`memev cloud use auto|tailscale|cloudflare|quick` to pin one):

1. **Tailscale** if `tailscale` is installed and logged in: a stable `https://<machine>.<tailnet>.ts.net`
   address. The default is `tailscale serve`, reachable only from your tailnet, and choosing the
   provider (`memev cloud use tailscale`) keeps it that way. A Funnel opens the machine to the
   public internet, so Memev never opens one on its own: `memev cloud funnel on --yes` is the
   explicit consent that switches it on, and `memev cloud funnel off` withdraws it. Memev uses https
   port 443 on the machine. If something else already serves or funnels that port, Memev leaves it
   exactly as it is, with or without consent: it does not start its own tunnel there, never turns
   that one off, and `memev cloud status` says the port is in use.
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
`/oauth/authorize`. A remote app is sent a link to open on the vault's machine, where the consent
page is served and the owner approves or denies it; the form carries a one-time value and only works
from that page. The app exchanges the code at `/oauth/token` for a bearer token it sends as
`Authorization: Bearer <token>`, refreshes it with the refresh token, and gives it back at
`/oauth/revoke`. Each registered client shows up in `memev devices` as a cloud connector. The
connector URL above stays available for apps that take only a URL.

The issuer in that metadata never comes from the request's Host header. It is `remote.issuer` in the
vault config when that is set, an `https` address, for every caller. Otherwise a caller on the vault's
machine gets `http://127.0.0.1:<port>`, and a remote caller gets the relay's address when the relay is
on, or else the tunnel's. With none of those a remote caller gets a 503 that says so. If the relay and a
tunnel are both on and apps reach the vault through the tunnel, set `remote.issuer` to the tunnel's address.

## What each plan allows

The cloud apps gate MCP by plan, so the same connector URL does different things on different plans.
Checked 2026-10-28 against the pages named in the sources below; the limits change, so re-check before relying on one:

| App | Plan | What the connector can do |
| --- | --- | --- |
| ChatGPT | Plus, Pro (developer mode) | Developer mode adds custom MCP servers. The developer mode guide lists write actions on Plus and Pro; the help article describes Pro developer mode as read and fetch. Full MCP needs a Business, Enterprise or Edu seat. |
| ChatGPT | Business, Enterprise, Edu | Full MCP: read and write tools. |
| claude.ai | Free | One custom connector. |
| claude.ai | Pro, Max | Custom connectors. |

Sources: https://platform.openai.com/docs/guides/developer-mode (write actions on Plus and Pro) and https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta (full write MCP on Business, Enterprise, Edu; Pro developer mode is read and fetch).

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
default, per caller, and at most 10,000 callers are held) and are logged to `.memev/access.jsonl`.
A request with a valid token is counted by that token alone. Any other request is counted by its address:
no token, a token that does not verify, and the OAuth and invite routes whatever they carry. The address
is the socket's, whatever headers the caller sends. The exception is a running Cloudflare tunnel, which
overwrites `cf-connecting-ip`, so there that header is the address. Everyone through a relay or Tailscale,
or a reverse proxy of your own, arrives from one address. So a stranger on that route can use up that one
address limit, and then others with no token, and OAuth sign-in, token refresh and invites on that route,
wait for it to refill. A computer or app with a valid token is not affected and keeps its own limit.
A computer's signed request can be used once, also across a restart: what was used is kept in
`.memev/nonces.json`. If that file is found damaged it is set aside as `nonces.json.damaged-<time>`, the
vault keeps running, a request signed before that moment is refused and a fresh one is served. What that
leaves open: after a damaged store, a request from a device whose clock ran ahead can be replayed within the
skew of five minutes. Removing this would refuse every signed request for up to 5 minutes and needs a
change to a signed contract. Admin routes are local only. Contract signing is
available remotely; a contract signed from a remote origin records that origin, and its command
criteria do not run on this machine until a local operator approves it with
`memev contract approve <id>`. `memev cloud rotate-key` changes the legacy shared key, for apps
that still send it.

## Which computers can join

Joining another computer through the secure link, as on this page, is the paid tier, Personal with
more computers: the vault refuses to enroll a computer past the number in its licence, and with no
licence that number is one. Personal on one computer is free and uses one computer at a time. To
switch computers, back the vault up to your own GitHub repository and let `memev init` on the new
computer join that backup ([GITHUB.md](GITHUB.md)). Git sync is single-writer backup: a second
computer that also pushes gets a warning from `memev doctor` that concurrent edits can conflict.

A personal vault never joins a Business or Corporate vault, and a company vault never joins a
personal one. They have separate identities and keys, with no grants, mounts or mixing.
