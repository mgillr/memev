# Claude Code

Id: `claude-code`

`memev init` connects this app when it finds `~/.claude` or `~/.claude.json`. To connect it yourself:

```sh
memev connect claude-code
```

Memev adds:

- an MCP server named `memev` in `~/.claude.json`, running `memev mcp --client claude-code`
- hooks in `~/.claude/settings.json`: SessionStart, UserPromptSubmit, PreCompact, and Stop
- a short block in `~/.claude/CLAUDE.md`

Mode: hooks. A new session gets the resume card, matching notes on each prompt, a checkpoint before compaction, and a journal when the turn ends. The app does not have to call a tool for that.

After connecting, start a new Claude Code session. The session that ran the command does not have the hooks yet.

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect claude-code
```
