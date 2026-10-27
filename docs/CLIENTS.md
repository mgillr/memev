# AI apps

`memev connect` (run by `memev init`) registers Memev in each app it detects. Before it changes a
file it saves a copy in `~/.config/memev/backups/`. `memev disconnect <app>` removes exactly what
was added: if the file has not changed since, the backup is restored; if you edited it since, only
the Memev entries are taken out and the rest of your changes stay. `memev clients` lists the state.

New apps installed later are picked up automatically: the daemon checks every few minutes and
connects them, unless you disconnected that app yourself.

| App | What Memev adds | Mode |
|---|---|---|
| Claude Code | MCP server in `~/.claude.json`; hooks (SessionStart, UserPromptSubmit, PreCompact, Stop) in `~/.claude/settings.json`; a block in `~/.claude/CLAUDE.md` | hooks |
| Codex CLI | `[mcp_servers.memev]` in `~/.codex/config.toml`; hooks in `~/.codex/hooks.json`; a block in `~/.codex/AGENTS.md` | hooks (trust once) |
| Gemini CLI | MCP server and hooks (SessionStart, BeforeAgent, PreCompress, AfterAgent) in `~/.gemini/settings.json`; a block in `~/.gemini/GEMINI.md` | hooks |
| Cursor | `~/.cursor/mcp.json`; `~/.cursor/hooks.json` | hooks at session start, instructions otherwise |
| Claude Desktop | `claude_desktop_config.json` | instructions |
| Windsurf | `~/.codeium/windsurf/mcp_config.json`; a block in `memories/global_rules.md` | instructions |
| VS Code | `Code/User/mcp.json` | instructions |
| Zed | `context_servers` in `zed/settings.json` | instructions |

**Hooks** mode: the resume card is injected at session start, relevant memories are added to each
prompt, a checkpoint is written before compaction, and the turn is journaled when it ends. The app
does not need to call anything.

**Instructions** mode: the app gets the MCP server and Memev's protocol in the MCP `initialize`
instructions (call `memev_session_start` first, `memev_recall` before answering from memory,
`memev_checkpoint` before long work ends). Apps that follow server instructions behave much like
hooks mode; others need you to ask once per session.

Manual steps:

- **Codex** asks you to trust new hooks once: open `/hooks` in Codex and trust the Memev entries.
- **Cursor** hooks cannot add context to a prompt, only at session start, so per-prompt recall comes
  from the MCP instructions.

Cloud apps (claude.ai, ChatGPT, others that take a remote MCP URL) connect through the tunnel; see
[CLOUD.md](CLOUD.md).

Every app talks to the same daemon. Stdio apps run `memev mcp --client <app>`, a small proxy to the
daemon, so one process writes the vault.
