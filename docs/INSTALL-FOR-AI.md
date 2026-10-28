# Install Memev

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

An AI app can follow this page without guessing. Run the commands yourself. Stop at the first failure and show the person that command and its output. Do not invent a download address, a token, or a host. Do not post this page anywhere.

## Commands, in order

```sh
node --version          # need v22 or newer
git --version
node bin/memev.mjs init # from the repository root
memev clients
```

## What you need first

Node 22 or newer, and git. The person already has a copy of the Memev repository. There is no package on the npm registry yet, and the one-line installer is not published yet. Do not run `npx memev`.

## What init does

From the repository root, `node bin/memev.mjs init`:

1. Creates the notes folder at `~/memev`. Pass `--root DIR` to put it somewhere else.
2. Copies Memev to `~/.config/memev/runtime` and adds the launcher `~/.config/memev/bin/memev`, so apps do not point at the folder you installed from.
3. Starts Memev in the background on `127.0.0.1:7787` and installs a login service.
4. Connects every AI app it finds. It saves a copy of each file before it changes one. The per-app pages are in `docs/clients/`.
5. Leaves the optional remote link for cloud apps off. Init asks once on a terminal, or the person runs `memev cloud on`. `--local-only` and `--org` skip the question.
6. Prints a checklist.

Show the person the whole checklist. Keep every line that asks them to do something.

## After that

- `memev clients` lists each app. An app that is not installed is not connected. Install it, then `memev connect <id>`. The id is the file name in `docs/clients/`.
- Start a new session, or quit and reopen the app, as that page says. The session that ran init does not have Memev loaded.
- The GitHub backup is a separate step: `memev github setup`. Do not create a repository unless the person asked.
- Do not repeat a connector URL, a token, or a home path in a shared chat. `memev cloud url` prints a secret.

## If a config file cannot be edited

`memev connect` edits JSON with comments in place. If it cannot edit a file, it names the file and the reason. Then `memev connect <id> --print` prints what to paste by hand. `--print` changes nothing.

## Undo

`memev disconnect <id>` takes Memev back out of that app. `memev uninstall` disconnects every app and stops the background process.
