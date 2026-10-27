# Troubleshooting

Start with:

```sh
memev doctor          # every check, with the fix for each failure
memev doctor --fix    # apply the safe fixes; asks before anything destructive
memev doctor --bundle # a support bundle without secrets
```

The same checks are available to an AI session as the `memev_doctor` MCP tool.

| Symptom | Fix |
|---|---|
| "daemon not running" | `memev start`; if it stops again, read `~/memev/.memev/daemon.log` |
| An app does not see Memev | `memev clients`; `memev connect <app>`; restart the app |
| Codex hooks do nothing | open `/hooks` in Codex and trust the Memev hooks |
| Cursor does not recall per prompt | expected: Cursor hooks only inject at session start; the MCP instructions cover the rest |
| Cloud app gets 401 | the token was not issued for remote use or was revoked: `memev cloud url` prints a fresh connector URL |
| Cloud app cannot connect | `memev cloud status`; a quick tunnel address changes on restart, so update the app or use Tailscale or a named Cloudflare tunnel |
| Port 7787 in use | `memev init --port 7790` |
| A note was edited by hand | nothing to do: Memev imports the change into its log |
| The vault looks wrong after a crash | `memev doctor`: the log is checked against the files and anything missing is rebuilt from the log |
| GitHub pushes fail | `memev doctor` shows the git error; check the deploy key still exists in the repository |

To undo everything: `memev uninstall` (your vault stays).
