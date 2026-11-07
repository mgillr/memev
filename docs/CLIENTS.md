# AI apps

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

`memev connect` (run by `memev init`) registers Memev in each app it detects. Before it changes a
file it saves a copy in `~/.config/memev/backups/`. `memev disconnect <app>` removes exactly what
was added: if the file has not changed since, the backup is restored; if you edited it since, only
the Memev entries are taken out and the rest of your changes stay. `memev clients` lists the state.

New apps installed later are picked up automatically: the daemon checks a few seconds after it starts
and then every 30 minutes (`clients.recheck_min`), and connects them, unless you disconnected that app
yourself. `memev init --no-connect` turns this background connect off, so no app is connected until you
run `memev connect <app>` for it; `memev connect` with no app connects every app it finds and turns the
background connect back on.

| App | What Memev adds | Mode |
|---|---|---|
| Claude Code | MCP server in `~/.claude.json`; hooks (SessionStart, UserPromptSubmit, PreCompact, Stop) in `~/.claude/settings.json`; a block in `~/.claude/CLAUDE.md`; with consent, the Memev memory tools (recall, remember, checkpoint, status, why) in `~/.claude/settings.json` `permissions.allow` | hooks |
| Codex CLI | `[mcp_servers.memev]` in `~/.codex/config.toml`; hooks in `~/.codex/hooks.json`; a block in `~/.codex/AGENTS.md` | hooks (trust once) |
| Gemini CLI | MCP server and hooks (SessionStart, BeforeAgent, PreCompress, AfterAgent) in `~/.gemini/settings.json`; a block in `~/.gemini/GEMINI.md` | hooks |
| Cursor | `~/.cursor/mcp.json`; `~/.cursor/hooks.json`; with `--project`, an always-on rule in `<project>/.cursor/rules/memev.mdc` | hooks at session start, instructions otherwise |
| Claude Desktop | `claude_desktop_config.json` | instructions |
| Windsurf | `~/.codeium/windsurf/mcp_config.json`; a block in `memories/global_rules.md` | instructions |
| VS Code | `Code/User/mcp.json` | instructions |
| Zed | `context_servers` in `zed/settings.json` | instructions |
| Aider | a conventions file in `~/.config/memev/aider-conventions.md`, listed under `read:` in `~/.aider.conf.yml` | conventions file (no MCP) |
| OpenCode | `mcp` entry in `~/.config/opencode/opencode.json`; a block in the OpenCode rules file (skipped if the Claude rules file exists and the OpenCode one is missing) | instructions |
| GitHub Copilot CLI | `mcpServers` entry in `~/.copilot/mcp-config.json` and a block in `~/.copilot/copilot-instructions.md` (in `$COPILOT_HOME` when it is set) | instructions |

More apps, each at the path and key its own MCP docs give. `~` is your home folder (`%USERPROFILE%` on
Windows). Where the docs name no Windows location, Memev connects the app on macOS and Linux only; on
Windows it is listed as found, not supported yet, and its files are not changed. These apps are in
instructions mode.

| App | What Memev adds | Windows | Docs |
|---|---|---|---|
| Qwen Code | `mcpServers` entry in `~/.qwen/settings.json` | yes | [MCP](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp) |
| Kimi Code CLI | `mcpServers` entry in `~/.kimi-code/mcp.json` (in `$KIMI_CODE_HOME` when it is set) | yes | [MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html), [data locations](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html) |
| Factory Droid | `mcpServers` entry (`type: stdio`) in `~/.factory/mcp.json` | not documented | [MCP](https://docs.factory.com/cli/configuration/mcp) |
| Augment (Auggie CLI) | `mcpServers` entry in `~/.augment/settings.json` | not documented | [integrations](https://docs.augmentcode.com/cli/integrations) |
| Tabnine CLI | `mcpServers` entry in `~/.tabnine/agent/settings.json` | not documented | [MCP config](https://docs.tabnine.com/main/getting-started/tabnine-agent/mcp-intro-and-setup/mcp-server-config) |
| iFlow CLI | `mcpServers` entry in `~/.iflow/settings.json` | yes | [settings](https://platform.iflow.cn/en/cli/configuration/settings), [MCP](https://platform.iflow.cn/en/cli/examples/mcp) |
| Warp | `mcpServers` entry in `~/.warp/.mcp.json` | not documented | [MCP](https://docs.warp.dev/knowledge-and-collaboration/mcp) |
| Mistral Vibe | a `[[mcp_servers]]` table named memev in `~/.vibe/config.toml` (in `$VIBE_HOME` when it is set), between `# memev:start` and `# memev:end`; left alone if you already have a server named memev | yes | [configuration](https://docs.mistral.ai/vibe/code/cli/configuration), [reference](https://docs.mistral.ai/vibe/code/cli/configuration-reference) |
| LM Studio | `mcpServers` entry in `~/.lmstudio/mcp.json`; LM Studio asks before each tool call | yes | [blog](https://lmstudio.ai/blog/mcp), [MCP](https://lmstudio.ai/docs/app/mcp) |
| AnythingLLM | `mcpServers` entry in `plugins/anythingllm_mcp_servers.json` in the storage folder (`~/.config/anythingllm-desktop/storage` on Linux, `~/Library/Application Support/anythingllm-desktop/storage` on macOS, `%APPDATA%\anythingllm-desktop\storage` on Windows) | yes | [MCP](https://docs.anythingllm.com/mcp-compatibility/overview), [storage](https://docs.anythingllm.com/installation-desktop/storage) |
| oterm | `mcpServers` entry in `config.json` in the data folder (`~/.local/share/oterm` or `$XDG_DATA_HOME/oterm` on Linux, `~/Library/Application Support/oterm` on macOS, `%APPDATA%\oterm` on Windows, `$OTERM_DATA_DIR` when set) | yes | [app config](https://ggozad.github.io/oterm/app_config/), [MCP](https://ggozad.github.io/oterm/mcp/) |
| Muse Code | `mcp_servers` entry (`transport: stdio`, `mode: optional`, so a run goes on if Memev cannot start) in `~/.config/muse/settings.json`; a new file gets the `schema_version: 1` Muse Code needs | not documented | [extending](https://dev.meta.ai/docs/muse-code/extending.md), [configuration](https://dev.meta.ai/docs/muse-code/configuration.md) |
| ZCode | `mcp.servers` entry in `~/.zcode/cli/config.json` | not documented | [MCP services](https://zcode.z.ai/en/docs/mcp-services) |
| MCPHub (Neovim) | `mcpServers` entry in `~/.config/mcphub/servers.json` | not documented | [servers.json](https://ravitemer.github.io/mcphub.nvim/mcp/servers_json.html) |
| CodeBuddy Code | `mcpServers` entry in the first of `~/.codebuddy/.mcp.json`, `~/.codebuddy/mcp.json`, `~/.codebuddy.json` that exists (the one CodeBuddy reads), else the first | not documented | [MCP](https://www.codebuddy.ai/docs/cli/mcp) |
| Qoder CLI | `mcpServers` entry in `~/.qoder/settings.json` | not documented | [MCP reference](https://docs.qoder.com/cli/mcp-reference) |
| OpenHands CLI | `mcpServers` entry in `~/.openhands/mcp.json` | not documented | [MCP servers](https://docs.openhands.dev/openhands/usage/cli/mcp-servers) |
| Cline | `mcpServers` entry in `~/.cline/data/settings/cline_mcp_settings.json` (`$CLINE_MCP_SETTINGS_PATH` when set), the file the Cline CLI reads; the VS Code extension keeps its own file, which its docs do not name, so check MCP Servers there | not documented | [MCP](https://docs.cline.bot/mcp/configuring-mcp-servers), [config](https://docs.cline.bot/getting-started/config) |
| Kiro (IDE and CLI) | `mcpServers` entry in `~/.kiro/settings/mcp.json`; in the IDE turn on MCP support if it is off | not documented | [MCP configuration](https://kiro.dev/docs/mcp/configuration/) |
| Junie (IDE plugin and CLI) | `mcpServers` entry in `~/.junie/mcp/mcp.json` | not documented | [MCP](https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html) |
| Amp | `amp.mcpServers` entry in `~/.config/amp/settings.json` (or `settings.jsonc` when that is the one you have) | yes, `%USERPROFILE%\.config\amp` | [settings](https://ampcode.com/docs/cli/settings), [MCP](https://ampcode.com/docs/customize/mcp) |
| Kilo Code | `mcp` entry (`type: local`, the command as one array) in `~/.config/kilo/kilo.jsonc` (or `kilo.json` when that is the one you have); Kilo asks before each tool call unless `"permission": { "memev_*": "allow" }` is set | yes, `%USERPROFILE%\.config\kilo` | [MCP](https://kilo.ai/docs/automate/mcp/using-in-kilo-code) |
| Amazon Q Developer CLI | `mcpServers` entry in `~/.aws/amazonq/mcp.json`, which the default agent reads (the CLI is now Kiro CLI; this is for installs that remain) | not documented | [agent file locations](https://github.com/aws/amazon-q-developer-cli/blob/main/docs/agent-file-locations.md) |

**Aider** has no MCP and no hooks, so the hand-off is different: `memev card --aider` writes the
resume card to a conventions file and adds it to the `read:` list in `~/.aider.conf.yml`, which Aider
reads into context at session start. It is opt-in, so `memev connect` does not touch it; `memev
disconnect aider` removes the entry and the conventions file.

**Hooks** mode: the resume card is injected at session start, relevant memories are added to each
prompt, a checkpoint is written before compaction, and the turn is journaled when it ends. The app
does not need to call anything.

**Instructions** mode: the app gets the MCP server and Memev's protocol in the MCP `initialize`
instructions (call `memev_session_start` first, `memev_recall` before answering from memory,
`memev_checkpoint` before long work ends). Apps that follow server instructions behave much like
hooks mode; others need you to ask once per session.

**Claude Code tool consent**: the hooks tell Claude to call Memev tools every turn, which would otherwise
raise an approval prompt. With consent, Memev adds the Memev memory tools (recall, remember, checkpoint,
status, why) to `permissions.allow` in `~/.claude/settings.json`, so Claude Code runs them without asking
each time; the write and contract tools still prompt. Consent is a question at `memev init` (on a terminal)
or the `--allow-tools` flag on `memev connect claude-code`; `memev disconnect claude-code` removes the
entries again. It is off unless you opt in, and it never touches your other permissions.

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

Memev detects these apps and lists them as found, not supported yet, with the way to add Memev by hand.
It never changes their files. The checklist points to this page until there is a public place to ask for
the next one. Each lookup folder is the one the app's own docs name.

| App | Where Memev looks | Why not yet | Docs |
|---|---|---|---|
| Roo | `~/.roo/` (`%USERPROFILE%\.roo` on Windows) | global MCP servers live in `mcp_settings.json` inside VS Code, at a place the docs do not name | [MCP](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo) |
| Continue | `~/.continue` | `config.yaml` holds servers as a YAML list, and Memev has no YAML editor; per-server files are documented for a workspace only | [MCP](https://github.com/continuedev/continue/blob/main/docs/customize/deep-dives/mcp.mdx), [config file](https://docs.continue.dev/customize/deep-dives/configuration) |
| JetBrains AI | `~/.config/JetBrains` on Linux, `~/Library/Application Support/JetBrains` on macOS, `%APPDATA%\JetBrains` on Windows | MCP servers are set in Settings, Tools, AI Assistant, Model Context Protocol (MCP) only | [MCP](https://www.jetbrains.com/help/ai-assistant/mcp.html) |
| Goose | `~/.config/goose` on macOS and Linux, `%APPDATA%\Block\goose` on Windows | `config.yaml` holds extensions as a YAML map, and Memev has no YAML editor | [config files](https://goose-docs.ai/docs/guides/config-files/) |
| Jan | `Jan/data` in `~/Library/Application Support` (macOS), `%APPDATA%` (Windows), `~/.local/share` (Linux) | MCP servers are added in Settings, MCP Servers only; the docs name `mcp_config.json` but not its format | [MCP](https://docs.jan.ai/desktop/integrations/mcp-servers), [data folder](https://docs.jan.ai/desktop/data-folder) |
| Cherry Studio | `CherryStudio` in `~/Library/Application Support`, `%APPDATA%`, `~/.config` | MCP servers are added in Settings, MCP only | [MCP](https://cherryai.com/docs/en/advanced-basic/extensions/mcp/), [storage](https://cherryai.com/docs/en/pre-basic/personalization-settings/storage/) |
| BoltAI (macOS) | `~/.boltai` | the docs name `~/.boltai/mcp.json` but not its format | [MCP servers](https://docs.boltai.com/docs/plugins/mcp-servers) |
| Lingma | `~/.lingma` | MCP servers are added through a JSON form in the IDE; the file is not named | [MCP](https://www.alibabacloud.com/help/en/lingma/user-guide/guide-for-using-mcp) |
| Rovo Dev CLI | `~/.rovodev` | two vendor pages name different files (`mcp.json` and `mcp_config.json`) | [MCP](https://support.atlassian.com/rovo/docs/connect-to-an-mcp-server-in-rovo-dev-cli/), [settings](https://support.atlassian.com/rovo/docs/manage-rovo-dev-cli-settings) |
| Crush | `~/.config/crush` | the config is now a `crushrc` file of command lines; the JSON form is deprecated | [README](https://github.com/charmbracelet/crush) |

On Windows, the apps above marked "not documented" in the Windows column are listed here too, as found,
not supported yet, until their docs name a Windows location.

Apps with a local MCP client that Memev does not detect, because their docs name neither a config file
nor a folder to look for:

| App | Why | Docs |
|---|---|---|
| Trae | the global `mcp.json` is edited from Settings, MCP; its location is not documented | [MCP](https://docs.trae.ai/ide/add-mcp-servers) |
| Raycast | servers are added with the Install MCP Server command; "Config file on disk: Not documented" | [MCP](https://manual.raycast.com/ai/model-context-protocol) |
| Perplexity (Mac) | local servers are added in Plugins through the PerplexityXPC helper | [local MCP](https://www.perplexity.ai/help-center/en/articles/11502712-local-and-remote-mcps-for-perplexity) |
| Msty Studio | tools are added in the Toolbox screen | [tools](https://docs.msty.ai/studio/features/toolbox/tools) |
| Witsy, 5ire | no vendor page documents a config file | - |
| Sourcegraph Cody | `cody.mcpServers` in editor settings, behind an Enterprise feature flag | [agentic context](https://sourcegraph.com/docs/cody/capabilities/agentic-context-fetching) |
| Qodo | only a project `mcp.json` is documented, no user-level one | - |
| Emacs mcp.el | configured in Elisp, no file | [mcp.el](https://github.com/lizqwerscott/mcp.el) |
| Android Studio (Gemini) | stdio servers are not supported | - |
| ChatGPT desktop | remote servers only | - |

Visual Studio reaches MCP servers through GitHub Copilot, which is set up separately.

Cloud apps (claude.ai, ChatGPT, others that take a remote MCP URL) connect through the tunnel, side by
side; see [CLOUD.md](CLOUD.md).

One page per app: [Claude Code](clients/claude-code.md), [Codex](clients/codex.md),
[Gemini CLI](clients/gemini-cli.md), [Cursor](clients/cursor.md), [Claude Desktop](clients/claude-desktop.md),
[Windsurf](clients/windsurf.md), [VS Code](clients/vscode.md), [Zed](clients/zed.md).

Every app talks to the same daemon. Stdio apps run `memev mcp --client <app>`, a small proxy to the
daemon, so one process writes the vault.
