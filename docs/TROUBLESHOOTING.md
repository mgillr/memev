# Troubleshooting

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

Start with:

```sh
memev doctor          # every check, with the fix for each failure
memev doctor --fix    # apply the safe fixes; asks before anything destructive
memev doctor --bundle # a support bundle without secrets
```

The same checks are available to an AI session as the `memev_doctor` MCP tool.

The table below holds one row per check id, and it is checked against the machine-readable doctor output, `memev doctor --json`: every id the doctor reports has a row, and every row names an id the doctor can report. The Severity column says what the doctor reports when the symptom happens: a warning is a warning, and a failure means the vault needs the fix before it works.

Before there is a vault, two symptoms have no check id yet:

- `memev init` stops and says git, Node.js, the port or a folder is the problem. Nothing was written. `memev preflight` runs the same checks and prints the fix for your system (macOS `xcode-select --install`, Windows `winget install Git.Git`, Debian or Ubuntu `sudo apt install git`); fix it, then run `memev init` again.
- Port 7787 in use. Nothing to do: `memev init` takes the next free port, saves it and says which; to choose one yourself, `memev init --port 7790`.

| Check | Severity | Symptom | Fix |
|---|---|---|---|
| `daemon` | failure: the vault needs the fix before it works | the daemon is not running, so nothing answers on the vault port and apps cannot reach Memev | `memev start`; if it stops again, read `~/memev/.memev/daemon.log` |
| `open` | failure: the vault needs the fix before it works | the vault does not open: the operation log cannot be read, so the log-based checks are skipped | `memev doctor` names the error; the log is the source of truth and the notes are rebuilt from it |
| `mcp` | failure: the vault needs the fix before it works | the MCP endpoint does not answer, so an AI session cannot call the doctor tool | `memev restart` |
| `node` | failure: the vault needs the fix before it works | Node.js is missing or older than 22, so the daemon and the launcher cannot run | install Node 22 or newer, then `memev doctor` checks it again |
| `git` | failure: the vault needs the fix before it works | git is not on PATH, so the vault cannot be backed up | `memev preflight` prints the install command for your system; then `memev doctor` |
| `vault` | failure: the vault needs the fix before it works | no vault at the expected path | `memev init` creates it |
| `permissions` | warning, or failure: the vault needs the fix before it works | a private file (tokens, config, the log) is readable by others, or its owner is unclear | `memev doctor --fix` restricts it to you |
| `token-expiry` | warning | a credential expires within 14 days, so an app will lose access | `memev token list` shows which one expires; issue or rotate it before then |
| `oplog` | failure: the vault needs the fix before it works | the operation log does not verify: a seal or a chain link is broken | `memev doctor` names the broken segment; restore the vault from its backup if the log cannot be repaired |
| `index` | warning | the recall index covers fewer notes than the vault holds, so recall misses notes | `memev doctor --fix` rebuilds the index |
| `drift` | warning | a note changed outside Memev, so the file and the log disagree | nothing to do: the change is imported on the next write or restart; `memev doctor --fix` imports it now |
| `secrets` | warning | a note looks like it holds a credential | rotate the credential and remove it from the note; git history keeps old versions, so purge the history too if it is sensitive |
| `bus` | warning, or failure: the vault needs the fix before it works | a seat is stale (no heartbeat lately: the app is closed or offline), or the bus log has unreadable lines | `memev bus check` asks every seat and reports who answers; `memev bus roster` lists the seats |
| `bus-files` | failure: the vault needs the fix before it works | bus/ is missing from the vault, so the apps have no comms bus | `memev doctor --fix` sets bus/ up again |
| `bus-seats` | failure: the vault needs the fix before it works | a connected app has no seat on the bus | `memev doctor --fix` seats it again |
| `bus-lead` | warning | no lead AI is chosen yet, so the apps do not coordinate | `memev bus roster` lists the seats; `memev bus operator <seat>` picks the lead |
| `launcher` | warning, or failure: the vault needs the fix before it works | the launcher is missing, or it finds no Node.js 22 or newer, so apps cannot start Memev | install Node 22 or newer, then `memev doctor --fix` points the launcher at it |
| `apps` | warning | no AI app is connected yet, or a connected app is missing its Memev entry | `memev clients` lists the installed apps; `memev connect` registers Memev in one |
| `deployment` | warning | the deployment mode and provider cannot work together: an internal model is not reachable from a managed host | `memev deployment` shows the current choice; `memev deployment set --mode M --ai T` writes a working one; docs/DOCKER.md covers the self-hosted install |
| `remote` | warning | remote access is on but the tunnel is not up, so cloud apps cannot reach the vault | `memev cloud status` shows the tunnel state; `memev cloud off` switches remote access off |
| `backup` | warning | the vault has no backup off this machine, so a lost disk loses the vault | `memev github setup` backs it up to a private GitHub repository with a deploy key for this vault; for another git host, `memev backup set <git-url>`; the doctor tracks the sync |
| `writers` | warning | more than one computer writes the git backup, so the pushes collide | keep one computer as the writer and the others read-only; `memev devices` lists the computers |
| `relay` | warning | the relay is down, so the vault is only reachable through the git backup | nothing to do for the backup: the vault keeps working through the git backup; to restore the relay, check the relay address in the setting, run `memev start`, and `memev doctor` names the relay state |
| `merge` | warning | a note was edited on two computers at once and kept as two whole files | nothing to do: both versions are kept byte for byte; `memev doctor` lists the pairs, open the two files, decide what to keep, and delete the copy you do not want |
| `license` | warning | a credential is flagged, or the licence needs renewal (report only: nothing is limited) | `memev license status` shows the licence; `memev devices` shows the flagged credential |
| `license-expired` | warning | the licence is past its grace period | this computer keeps full read and write access and nothing is deleted; added computers can read but not write; to restore writing on the others, install a current licence (a file or a key), and `memev license status` shows the current one |
| `license-change` | warning | the licence is valid, but an added computer within its seat count can still only read, so installing the licence did not restore its writing | nothing needs re-enrolling: installing a licence restores writing and removing it returns to Personal, and the vault, its computers and its notes are unchanged by either; `memev license status` shows the tier and the seats, and `memev devices` lists the computers; when the seat count covers the computer that only reads, report it as a fault |
| `disk` | warning | less than 3% of the disk space or inodes is free | `memev compact --dry-run` measures what can be archived; `memev compact` archives it (on a stopped vault) |
| `update` | warning | a newer version of Memev is available | download the release tarball and run `memev update <tarball>` |
| `container-vault` | failure: the vault needs the fix before it works | the vault volume is not writable in the container | check the volume mount in the compose file and restart the container |
| `container-loopback` | ok | the host port mapping is not visible from inside the container (informational) | check it on the host: `docker compose -f compose.trial.yaml port memev 7787` |
| `container-remote` | warning | remote access is on in the container, which the trial image does not want | `memev cloud off` switches it off |
| `github-net` | failure: the vault needs the fix before it works | neither github.com:22 nor ssh.github.com:443 answers, so the git backup cannot push | fix the network, or push over HTTPS with a fine-grained token for that one repository (docs/GITHUB.md) |
| `two-vaults` | warning | two vaults run on this computer | join the other instead of keeping two: `memev init --join` with an invite code |
| `backup-vault` | warning | the backup belongs to a different vault (two vaults per user are not supported) | join that vault instead: `memev init --join` with an invite code |
| `service` | warning | the login service is not installed, so Memev does not start at login | `memev service install` installs it |

Some symptoms have no check id, because the doctor cannot see them from the vault:

- A cloud app gets 401. The token was not issued for remote use, or it was revoked: `memev cloud url` prints a fresh connector URL.
- A cloud app cannot connect. `memev cloud status` shows the tunnel; a quick tunnel address changes on restart, so update the app, or use Tailscale or a named Cloudflare tunnel.
- Cursor does not recall on every prompt. Expected: Cursor hooks inject only at session start, and the MCP instructions cover the rest.
- `memev_recall` returns fewer hits than requested. The limit is clamped to 1-10; use `offset` to page through more results.
- GitHub pushes fail. `memev doctor` shows the git error under `backup`; check that the deploy key still exists in the repository.
- A note was edited by hand. Nothing to do: Memev imports the change into its log.
- The vault looks wrong after a crash. `memev doctor` checks the log against the files, and anything missing is rebuilt from the log.

To undo everything: `memev uninstall` (your vault stays).
