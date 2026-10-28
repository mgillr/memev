# Zed

Part of the [Memev documentation](../README.md). Up: [AI apps](../CLIENTS.md), the [README](../../README.md).

Id: `zed`

`memev init` connects this app when it finds the Zed config folder. On macOS and Linux that folder is `~/.config/zed`. On Windows it is `%APPDATA%\zed`. To connect it yourself:

```sh
memev connect zed
```

Memev adds a context server named `memev` to `settings.json` in that folder, running `memev mcp --client zed`.

Mode: instructions. The app is told to call `memev_session_start` first, `memev_recall` before answering from memory, and `memev_checkpoint` before long work ends. If it follows those instructions it behaves much like an app with hooks. If it does not, ask it once in the session.

After connecting, quit and reopen Zed.

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect zed
```
