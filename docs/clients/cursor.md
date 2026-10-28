# Cursor

Id: `cursor`

`memev init` connects this app when it finds `~/.cursor`. To connect it yourself:

```sh
memev connect cursor
```

Memev adds:

- `~/.cursor/mcp.json`, with an MCP server named `memev` running `memev mcp --client cursor`
- `~/.cursor/hooks.json`

Mode: hooks at session start, instructions otherwise. Cursor injects the resume card at session start. Per-prompt recall and the note saved before compaction come through the MCP instructions, because Cursor hooks cannot add context to a prompt.

One step is yours. The checklist prints it: Check that Settings → MCP shows memev connected, and allow its tools.

After connecting, open a new Cursor chat. The chat that ran the command does not have Memev loaded yet.

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect cursor
```
