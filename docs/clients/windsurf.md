# Windsurf

Part of the [Memev documentation](../README.md). Up: [AI apps](../CLIENTS.md), the [README](../../README.md).

Id: `windsurf`

`memev init` connects this app when it finds `~/.codeium/windsurf`. To connect it yourself:

```sh
memev connect windsurf
```

Memev adds:

- an MCP server named `memev` in `~/.codeium/windsurf/mcp_config.json`, running `memev mcp --client windsurf`
- a short block in `~/.codeium/windsurf/memories/global_rules.md`

Mode: instructions. The app is told to call `memev_session_start` first, `memev_recall` before answering from memory, and `memev_checkpoint` before long work ends. If it follows those instructions it behaves much like an app with hooks. If it does not, ask it once in the session.

After connecting, quit and reopen Windsurf.

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect windsurf
```
