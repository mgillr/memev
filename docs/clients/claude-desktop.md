# Claude Desktop

Part of the [Memev documentation](../README.md). Up: [AI apps](../CLIENTS.md), the [README](../../README.md).

Id: `claude-desktop`

`memev init` connects this app when it finds the Claude Desktop config folder. To connect it yourself:

```sh
memev connect claude-desktop
```

Memev adds an MCP server named `memev` to `claude_desktop_config.json`, running `memev mcp --client claude-desktop`.

Mode: instructions. The app is told to call `memev_session_start` first, `memev_recall` before answering from memory, and `memev_checkpoint` before long work ends. If it follows those instructions it behaves much like an app with hooks. If it does not, ask it once in the session.

After connecting, quit and reopen Claude Desktop.

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect claude-desktop
```
