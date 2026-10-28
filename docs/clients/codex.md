# Codex CLI

Id: `codex`

`memev init` connects this app when it finds `~/.codex`. To connect it yourself:

```sh
memev connect codex
```

Memev adds:

- `[mcp_servers.memev]` in `~/.codex/config.toml`, running `memev mcp --client codex`
- hooks in `~/.codex/hooks.json`: SessionStart, UserPromptSubmit, PreCompact, and Stop
- a short block in `~/.codex/AGENTS.md`

Mode: hooks. A new session gets the resume card, matching notes on each prompt, a checkpoint before compaction, and a journal when the turn ends.

One step is yours. The checklist prints it: Codex asks you to trust new hooks once: open `/hooks` in Codex and trust the Memev hooks.

After connecting, start a new Codex CLI session. The session that ran the command does not have the hooks yet.

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect codex
```
