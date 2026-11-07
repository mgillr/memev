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

## Grok

Grok on the web (grok.com) and in the Grok apps for iOS and Android takes a custom connector URL.
xAI says connectors are available to all Grok users. On the web: open `grok.com/connectors`, choose
**New Connector**, then **Custom**, and paste the connector URL from `memev cloud url`. On iOS and
Android, connectors are under **Settings > Connectors**; xAI does not say whether a custom server can
be added there, so add it on the web first. Grok calls the server from xAI's cloud and rejects
`localhost` and private addresses (127.0.0.1, 10.x, 172.16.x, 192.168.x), so the address has to be a
public https one: a Cloudflare tunnel or a Tailscale Funnel, not a tailnet-only `tailscale serve`.
On a Grok Business or Enterprise team, an admin adds the connector first at `console.x.ai` (team >
**Grok Business > Connectors** > **+ Add Connector** > **Other**), then members connect at
`grok.com/connectors`.

Untested live: these steps come from xAI's pages, not from a run against a Memev vault.

Grok inside the X app is not supported: xAI lists connectors for Grok on the web, iOS and Android only.

Grok Build, xAI's terminal agent, is a local app: `memev connect` sets it up (see [CLIENTS.md](CLIENTS.md)).

Sources: https://docs.x.ai/grok/connectors, https://docs.x.ai/grok/connectors/custom-mcp-tunneling,
https://docs.x.ai/grok/connector-management and https://x.ai/news/grok-connectors (6 May 2026).

## Microsoft Copilot

The Copilot app (copilot.microsoft.com, the Copilot app on Windows, and Copilot on iOS and Android)
is not supported. Its connectors link a fixed list of services (OneDrive, Outlook.com, Google Drive,
Gmail, Google Calendar and Google Contacts), and Microsoft documents no way to add a custom connector
or MCP server. Source:
https://support.microsoft.com/en-us/microsoft-copilot/connecting-microsoft-copilot-to-other-services

GitHub Copilot CLI and Copilot in VS Code are local apps: `memev connect` sets them up (see [CLIENTS.md](CLIENTS.md)).

## Microsoft 365 Copilot (organisation admin)

Microsoft 365 Copilot reaches an MCP server only through an admin. There are two routes; both call
from Microsoft's cloud, so the vault needs a public https address, as for Grok. Untested live: the
steps come from Microsoft's pages, not from a run against a Memev vault.

**Microsoft 365 admin center (custom federated connector).** Needs the Global Administrator or AI
Administrator role, and a developer name, website, privacy policy and terms of use URL for the form.

1. In the [Microsoft 365 admin center](https://admin.microsoft.com/), open **Copilot** > **Connectors**, then the **Gallery** tab.
2. Under **Created by your org**, on the **Create a new connector** tile, select **Add**.
3. On the **Custom connector** page, under **Connect to MCP server**, select **Add**.
4. Enter a display name (Memev), a description of what the vault holds, and as **Base URL** the
   connector URL from `memev cloud url`. The connector takes Microsoft Entra SSO, OAuth 2.0 (a client
   registered in the Teams Developer Portal) or No Auth; the connector URL carries its own token, so
   it is the No Auth case.
5. **Save**, then roll it out from **Your Connections** with **Staged rollout** or **Deploy to all users**.
   Users need a Microsoft 365 Copilot licence, and the **Allow agents and plugins built by your
   organization** setting (**Agents** > **Settings** > **Agent and plugin access**) must be on.

The connector URL is one credential for everyone the connector is rolled out to, so every one of
them reads and writes the same vault. Use it only for a vault the whole group shares.

Source: https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/set-up-custom-federated-connectors

**Copilot Studio (an agent).** In the agent: **Tools** > **Add a tool** > **New tool** > **Model
Context Protocol**, then a server name, a description and the **Server URL**. Copilot Studio supports
the Streamable HTTP transport only, which is what Memev serves. For authentication choose **None**
with the connector URL, or **OAuth 2.0** > **Dynamic discovery** with the plain MCP URL, since Memev
publishes its OAuth metadata and takes dynamic client registration. Power Platform data policies
apply to the server. Source:
https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent

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
default) and are logged to `.memev/access.jsonl`. Admin routes are local only. Contract signing is
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
