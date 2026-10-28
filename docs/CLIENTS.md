# AI apps

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

`memev connect` (run by `memev init`) registers Memev in each app it detects. Before it changes a
file it saves a copy in `~/.config/memev/backups/`. `memev disconnect <app>` removes exactly what
was added: if the file has not changed since, the backup is restored; if you edited it since, only
the Memev entries are taken out and the rest of your changes stay. `memev clients` lists the state.

New apps installed later are picked up automatically: the daemon checks every few minutes and
connects them, unless you disconnected that app yourself.

| App | What Memev adds | Mode |
|---|---|---|
| Claude Code | MCP server in `~/.claude.json`; hooks (SessionStart, UserPromptSubmit, PreCompact, Stop) in `~/.claude/settings.json`; a block in `~/.claude/CLAUDE.md`; with consent, `mcp__memev` in `~/.claude/settings.json` `permissions.allow` | hooks |
| Codex CLI | `[mcp_servers.memev]` in `~/.codex/config.toml`; hooks in `~/.codex/hooks.json`; a block in `~/.codex/AGENTS.md` | hooks (trust once) |
| Gemini CLI | MCP server and hooks (SessionStart, BeforeAgent, PreCompress, AfterAgent) in `~/.gemini/settings.json`; a block in `~/.gemini/GEMINI.md` | hooks |
| Cursor | `~/.cursor/mcp.json`; `~/.cursor/hooks.json`; with `--project`, an always-on rule in `<project>/.cursor/rules/memev.mdc` | hooks at session start, instructions otherwise |
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

**Claude Code tool consent**: the hooks tell Claude to call Memev tools every turn, which would otherwise
raise an approval prompt. With consent, Memev adds `mcp__memev` to `permissions.allow` in
`~/.claude/settings.json`, so Claude Code runs Memev's tools without asking each time. Consent is a
question at `memev init` (on a terminal) or the `--allow-tools` flag on `memev connect claude-code`;
`memev disconnect claude-code` removes the entry again. It is off unless you opt in, and it never
touches your other permissions.

Manual steps:

- **Codex** asks you to trust new hooks once: open `/hooks` in Codex and trust the Memev entries.
- **Cursor** hooks cannot add context to a prompt, only at session start, so per-prompt recall comes
  from the MCP instructions.

**Cursor's hook limits.** Cursor hooks can only add context at session start (the `sessionStart`
hook); they cannot add context to a prompt. Memev works around this in three ways:

- `memev connect cursor --project <dir>` writes an always-on rule to `<dir>/.cursor/rules/memev.mdc`
  (`alwaysApply: true`), so the memory rule is in every session of that project, not only at session
  start. `memev disconnect cursor` removes the file again.
- Per-prompt recall and post-compaction state come through the MCP instructions instead of a hook.
- The stop hook can only continue the session with a `followup_message`. Memev uses that only for
  operator tasks waiting for you (never for ordinary bus traffic), and sets `loop_limit: 3` on
  the stop entry in `~/.cursor/hooks.json` so the follow-ups cannot run away. The prompt hook only
  peeks at the bus, so a task that is already waiting when you type is still picked up by the stop
  hook; the stop hook marks the tasks it followed up on as read.

## Apps Memev does not support yet

Memev detects these apps and lists them as found, not supported yet. It never changes their files.
The checklist points to this page until there is a public place to ask for the next one.

Each lookup directory is the one the app's own docs name, cited in the last column.

| App | Where Memev looks | Docs |
|---|---|---|
| Cline | `~/.cline/` | [config](https://docs.cline.bot/getting-started/config) |
| Roo | `~/.roo/` on Linux and macOS, `%USERPROFILE%\.roo` on Windows | [custom instructions](https://docs.roocode.com/features/custom-instructions) |
| Continue | `~/.continue` | [config file](https://docs.continue.dev/customize/deep-dives/configuration) |
| Kiro | `~/.kiro` | [CLI chat configuration](https://kiro.dev/docs/cli/chat/configuration/) |
| JetBrains AI | `~/.config/JetBrains` on Linux, `~/Library/Application Support/JetBrains` on macOS, `%APPDATA%\JetBrains` on Windows | [settings and plugins](https://www.jetbrains.com/help/idea/directories-used-by-the-ide-to-store-settings-caches-plugins-and-logs.html) |
| Amp | `~/.config/amp` on macOS and Linux, `%USERPROFILE%\.config\amp` on Windows | [manual](https://ampcode.com/manual) |
| Goose | `~/.config/goose` on macOS and Linux, `%APPDATA%\Block\goose` on Windows | [config files](https://goose-docs.ai/docs/guides/config-files) |

Cloud apps (claude.ai, ChatGPT, others that take a remote MCP URL) connect through the tunnel, side by
side; see [CLOUD.md](CLOUD.md).

One page per app: [Claude Code](clients/claude-code.md), [Codex](clients/codex.md),
[Gemini CLI](clients/gemini-cli.md), [Cursor](clients/cursor.md), [Claude Desktop](clients/claude-desktop.md),
[Windsurf](clients/windsurf.md), [VS Code](clients/vscode.md), [Zed](clients/zed.md).

Every app talks to the same daemon. Stdio apps run `memev mcp --client <app>`, a small proxy to the
daemon, so one process writes the vault.
