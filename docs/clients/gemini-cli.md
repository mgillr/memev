# Gemini CLI

Id: `gemini-cli`

`memev init` connects this app when it finds `~/.gemini`. To connect it yourself:

```sh
memev connect gemini-cli
```

Memev adds, in `~/.gemini/settings.json`:

- an MCP server named `memev`, running `memev mcp --client gemini-cli`
- hooks: SessionStart, BeforeAgent, PreCompress, and AfterAgent

It also adds a short block in `~/.gemini/GEMINI.md`.

Mode: hooks. A new session gets the resume card, matching notes on each prompt, a checkpoint before compaction, and a journal when the turn ends. The app does not have to call a tool for that.

After connecting, start a new Gemini CLI session. The session that ran the command does not have the hooks yet.

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect gemini-cli
```
