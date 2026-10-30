# Troubleshooting

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

Start with:

```sh
memev doctor          # every check, with the fix for each failure
memev doctor --fix    # apply the safe fixes; asks before anything destructive
memev doctor --bundle # a support bundle without secrets
```

The same checks are available to an AI session as the `memev_doctor` MCP tool.

| Symptom | Fix |
|---|---|
| `memev init` stops and says git, Node.js, the port or a folder is the problem | nothing was written. `memev preflight` runs the same four checks and prints the fix for your system (macOS `xcode-select --install`, Windows `winget install Git.Git`, Debian or Ubuntu `sudo apt install git`); fix it, then run `memev init` again |
| "daemon not running" | `memev start`; if it stops again, read `~/memev/.memev/daemon.log` |
| An app does not see Memev | `memev clients`; `memev connect <app>`; restart the app |
| Codex hooks do nothing | open `/hooks` in Codex and trust the Memev hooks |
| Cursor does not recall per prompt | expected: Cursor hooks only inject at session start; the MCP instructions cover the rest |
| Cloud app gets 401 | the token was not issued for remote use or was revoked: `memev cloud url` prints a fresh connector URL |
| Cloud app cannot connect | `memev cloud status`; a quick tunnel address changes on restart, so update the app or use Tailscale or a named Cloudflare tunnel |
| Port 7787 in use | nothing to do: `memev init` takes the next free port, saves it and says which; to choose one yourself, `memev init --port 7790` |
| A note was edited by hand | nothing to do: Memev imports the change into its log |
| The vault looks wrong after a crash | `memev doctor`: the log is checked against the files and anything missing is rebuilt from the log |
| GitHub pushes fail | `memev doctor` shows the git error; check the deploy key still exists in the repository |
| The vault is taking up too much space | `memev compact --dry-run` measures the op-log, journal, index and git objects from disk; `memev compact` archives the sealed op-log segments and moves old journal sessions out of the index (nothing is deleted, and the old sessions stay readable) |
| The relay is down and the vault is only reachable through the git backup (doctor check: relay) | nothing to do for the backup: the vault keeps working through the git backup; to restore the relay, check the relay address in the setting, run `memev start`, and `memev doctor` names the relay state |
| A note was edited on two computers at once and kept as two whole files (doctor check: merge) | nothing to do: both versions are kept byte for byte; `memev doctor` lists the pairs, open the two files, decide what to keep, and delete the copy you do not want |
| The licence is past its grace period (doctor check: licence-expired) | this computer keeps full read and write access and nothing is deleted; added computers can read but not write; to restore writing on the others, install a current licence with `memev license install <file>` |
| I changed the licence tier and want to know what changes (doctor check: licence-change) | nothing to re-enrol: installing a licence restores writing and removing it returns to Personal; the vault, its computers and its notes are unchanged by either |

To undo everything: `memev uninstall` (your vault stays).
