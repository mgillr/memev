# Install Memev, step by step

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

This page is a runbook for an AI app that installs Memev at the person's request. The agent runs the
commands, shows the person each result, and stops at the first failure. It never invents a download
address, a token, or a host, and it never posts this page anywhere.

## Identify the operating system and runtime

State the operating system you are running on, and the Node version, before you touch anything. Memev
needs Node 22 or newer and git. Memev runs on macOS and Linux. Windows is a preview: it has code paths
and tests, but it has not had a full lab run yet. After the install, `memev preflight` re-checks the
Node version, git, the port, and a folder it can write to, and stops with the fix for your system.

## Choose and explain the installation path

Ask the person which path fits, and explain the one you choose before you run it:

- From a copy of the repository: `node bin/memev.mjs init --no-connect`, run in the folder the person
  downloaded.
- npm, from a copy of the repository: `npm install -g . && memev init --no-connect`, which also puts
  `memev` on the PATH.
- Docker, for an always-on server or a home lab: `docker compose up -d`; the apps are connected by hand.
- `npx memev init` is not published yet (it is not on the npm registry). Do not look for it.
- The one-line installer is coming soon. Do not look for it.

Every path sets up the same thing: it creates the notes folder, starts Memev and runs a self-test.
`--no-connect` keeps init from connecting the AI apps it finds; connect each app only after the person
approves it. The person already has a copy of the repository, or names the release to install; there
is no other source.

## Ask permission before each privileged action

Before every action that changes the person's machine, ask, and show the exact command: installing
Memev, putting it on the PATH, starting the background service, connecting an AI app (which edits that
app's config file), creating a GitHub repository, or turning on the remote link. One yes covers one
action, not the rest of the runbook. Never weaken local security controls: no disabled firewall, no
loosened file permissions, no skipped certificate checks, no elevated rights the person did not ask
for. Never paste a connector URL, a token, or a home path into a shared chat: `memev cloud url` prints
a secret.

## Install the pinned stable release

Install the release the person named: the folder they downloaded, or the tag they gave you. Do not pick
a version yourself, and do not write one down from memory. Run the install command for the chosen path,
with `--no-connect` as above, then show the person the whole checklist it prints, keeping every line
that asks them to do something. The install copies Memev to `~/.config/memev/runtime`, adds the
launcher, starts Memev on `127.0.0.1:7787`, and installs a login service. With `--no-connect`, init
does not connect the AI apps itself: connect each one only after the person approves it, as "Connect
only the clients the user approved" says, before the smoke test, which needs them.

## Verify the installed version and health

- `memev --version` prints the installed version, one line. It must be the release the person named; if
  it is not, stop and say so.
- `memev doctor --json` prints one JSON array of checks. Each check has an `id`, a `title`, a `status`
  that is `ok`, `warn` or `fail`, a `detail`, and a `fix` with a `desc` and a `destructive` flag when
  there is one. Show the person every check that is not `ok`, with its `detail`. Until an app is
  connected, the `apps` check is a warning.

## Run the minimal smoke test

The smoke test needs the approved clients connected; if none is connected yet, connect them first, as
the next section says. Ask the person to open a new session in each connected client; the session that
ran the install does not have Memev loaded. Ask them to have one client remember something and then
ask the other about it, and run `memev ready --json --timeout 120` while they do. It prints nothing
while it waits, then one JSON object when the setup is ready or the timeout runs out. Without
`--timeout` it waits 600 seconds, so always give one. The object has:

- `ok`: true when the setup is ready.
- `smoke`: true only when two clients joined and one of them recalled a memory the other wrote.
- `clients`: one entry per connected client, with `id`, `name`, `joined`, and `joinedAt`, the time of
  the first heartbeat, an ISO time or null when the client has not joined.

Exit codes: 0 when ready, 1 when it is not ready within the timeout, 2 for a usage error. When it is
not ready, tell the person what the object says and run `memev ready --json --timeout 120` again.

## Connect only the clients the user approved

`memev clients` lists each client that is installed and whether it is connected. Show the person the
list and ask about each client in turn. Run `memev connect <client>` for a client only after the person
says yes to that client: one yes connects one client. It saves a copy of each file before it changes
one. Memev also looks for AI apps in the background a few seconds after it starts, and connects each one
it finds that nobody has disconnected, so `memev clients` may already show an app as connected that the
person has not approved: tell the person, and run `memev disconnect <client>` for each one they do not
want, which also stops Memev connecting it again. The ids are the file names in `docs/clients/`, and
the full list is in the [AI apps documentation](CLIENTS.md). If a client is not installed, say so and
ask before you install it. If `memev connect` cannot edit a file, it names the file and the reason;
show the person, and do not edit the file yourself.

## Report exact results and limitations

Report only what the machine-readable checks printed: the version from `memev --version`, the checks
from `memev doctor --json`, and the object from `memev ready --json`. Name every check that is not `ok`
and every client that has not joined. State the limitations plainly: the remote link for cloud apps is
off unless the person turns it on, the GitHub backup is a separate step (`memev github setup`), and
Windows is a preview. Tell the person how to undo the install: `memev disconnect <client>` takes Memev
back out of one client, and `memev uninstall` disconnects every client and stops Memev, leaving the
notes folder as it is. Never report success that a check did not verify.

## On failure: diagnose and recover or stop safely

At the first failure, show the person the command and its output. Run `memev doctor --json` and work
through the checks that are not `ok`, one at a time. `memev doctor --fix` applies the safe fixes, and
the fixes that could lose data or cut off a client ask first. Ask permission before each fix. Never
repeat a destructive command, and never run `memev uninstall --purge` unless the person explicitly
asks. If you cannot recover, stop, say what you tried and what failed, and leave the machine as you
found it except for the steps the person approved. Never report unverified success.
