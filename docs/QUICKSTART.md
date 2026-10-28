# Quickstart

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

You need Node 22 or newer and git.

In a copy of the Memev repository:

```sh
node bin/memev.mjs init   # or: npm install -g . && memev init
```

`npx memev init` will work once Memev is on the npm registry (coming soon). Or ask an AI app that
can run commands to do it: "Download the Memev repository, run `node bin/memev.mjs init` inside it,
and show me the checklist it prints."

`init`:

1. creates the vault in `~/memev` (choose another place with `--root DIR`),
2. copies Memev to a stable place (`~/.config/memev/runtime`) and adds a launcher at
   `~/.config/memev/bin/memev`, so your apps never point into the folder you installed from,
3. starts the Memev daemon on `127.0.0.1:7787` and installs a login service (systemd, launchd, or a
   Task Scheduler entry on Windows),
4. connects every AI app it finds (see [CLIENTS.md](CLIENTS.md)), backing up each file it changes,
5. leaves the private tunnel for cloud apps off (see [CLOUD.md](CLOUD.md)); init asks once on a terminal,
   or `memev cloud on` turns it on; `--local-only` and `--org` (an install for an organisation) skip the question,
6. prints a checklist: what is connected, what needs one click from you, and how to back up to GitHub.

Run `memev ready`, then open a new session or chat in each connected app. It prints "<app> joined at
HH:MM" as each one starts, and "Ready: <app> and <app> share one memory" once one app recalls a
memory another one saved: ask one to remember something and another about it. `--timeout SECONDS`
(default 600) sets how long it waits; it exits non-zero and names the apps that did not join.

Open a new session in any connected app. It starts with a short resume card: what you were doing,
what is next, recent decisions. Work as usual. Memev saves a checkpoint before compaction and at the
end of each turn; each prompt gets the few memories that match it.

## Everyday commands

```sh
memev status                       # is it running, how big is the vault
memev recall "how do we deploy"    # search memory
memev remember "We use Postgres 16 for the API" --kind decision --project api --why "logical replication"
memev why "how do we deploy"       # why recall returned what it did
memev review                       # memories waiting for a keep or drop decision
memev audit                        # junk, duplicates and stale memories (changes nothing)
memev card --project api           # the resume card an app would see
memev claims --status fact         # what the graph holds as established
memev doctor                       # check everything; --fix repairs what it can
memev clients                      # which apps are connected
memev bus hello <seat>             # guided test: post a hello and wait for the app to read it
memev cloud status                 # remote access
memev github setup                 # back the vault up to a private GitHub repo
```

## The vault

```
~/memev/
  memory/        the north star, and decisions, facts and other kinds, one file per month
                 (memory/decisions/2026-10.md)
  work/active/   one file per project: current task, done, doing, next
  work/sessions/ one file per session: what was asked and answered
  bus/           the comms bus: seats, messages, heartbeats (see BUS.md)
  contracts/     signed contracts
  .memev/        the log, index, graph, tokens and config (not in git)
```

Everything is Markdown. Edit it in any editor: Memev notices and records the change in its log.

## Windows (preview)

Windows has its own code paths and tests but has not had a full lab run yet. Install Node 22 from
nodejs.org and Git for Windows, then run the same command in PowerShell or Windows Terminal. What
differs:

- Settings and the `memev.cmd` launcher live in `%APPDATA%\memev`; the vault is `%USERPROFILE%\memev`.
- On a terminal, init offers to add the launcher folder to your user PATH. Open a new terminal
  afterwards. `memev path remove` takes it off again; `memev uninstall` does not.
- Apps are registered to run `node.exe` with Memev's runtime script as its first argument, not the
  `memev.cmd` launcher: a Node app cannot start a `.cmd` file without a shell.
- The privacy check reads each private file's access list (`icacls`): you, SYSTEM and
  Administrators may have access, no one else.
- Memev starts at login through a per-user Task Scheduler entry (`memev service install`, which init
  runs). If that cannot be created, init says so; run `memev start` after you sign in.

If something breaks, `memev doctor` shows what and how to fix it; include its output when you
report a problem.

## Removing Memev

```sh
memev uninstall           # disconnect every app (restoring their files) and stop
memev uninstall --purge   # also remove the runtime copy and launcher
```

The vault is never deleted for you.
