# History import

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

Memev can import what you have already worked on, so your memory starts with your
existing context instead of an empty vault.

Import makes no model calls and no network calls. Everything is local: plain text
rules inside Memev read your files and write notes into the vault. It costs your AI
plan nothing.

## Sources

1. **Project folders.** README, docs markdown, notes files, and a summary of recent
   git history (commit subjects only, no diffs). Pass one or more folders with
   `--path DIR`. Build folders (node_modules, vendor, dist, .git objects) are
   skipped to keep a first import small.

2. **AI memory and rule files on the machine.** Claude Code and Cursor project
   memory files, CLAUDE.md and similar project rule files, found in their
   documented locations. Enable with `--ai-history`.

3. **Chat exports.** A ChatGPT or Claude export: the zip the service emails you, the
   folder it unpacks to, or its `conversations.json`. Pass it with
   `--export FILE.zip`; exports in `~/Downloads` are also found. Each conversation
   becomes its own note.

4. **Each AI app's stored sessions.** Each session becomes its own note.

| Source id | App | Where Memev looks | Read from |
|---|---|---|---|
| `claude-code` | Claude Code | `~/.claude/projects/<project>/<session>.jsonl` (`CLAUDE_CONFIG_DIR` moves `~/.claude`) | [sessions](https://code.claude.com/docs/en/sessions), [.claude directory](https://code.claude.com/docs/en/claude-directory), [Agent SDK session reader](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/sessions.py) |
| `codex` | Codex CLI | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` and `archived_sessions/` (`CODEX_HOME` is `~/.codex` by default) | [environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables), [rollout recorder](https://github.com/openai/codex/tree/main/codex-rs/rollout/src) |
| `gemini-cli` | Gemini CLI | `~/.gemini/tmp/<project>/chats/session-*.jsonl` or `.json` (`GEMINI_CLI_HOME` moves the home) | [session management](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md?plain=1), [chat recording types](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts) |
| `qwen-code` | Qwen Code | `~/.qwen/projects/<project>/chats/<session>.jsonl` (`QWEN_RUNTIME_DIR` or `QWEN_HOME` moves `~/.qwen`) | [storage](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/config/storage.ts), [chat recording](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/services/chatRecordingService.ts) |
| `jan` | Jan | `<Jan data folder>/threads/<thread>/messages.jsonl` and `thread.json`, in the default data folder | [data folder](https://docs.jan.ai/desktop/data-folder) |
| `continue` | Continue | `~/.continue/sessions/<session>.json` (`CONTINUE_GLOBAL_DIR` moves `~/.continue`) | [paths](https://github.com/continuedev/continue/blob/main/core/util/paths.ts), [session types](https://github.com/continuedev/continue/blob/main/core/index.d.ts) |
| `cline` | Cline | `~/.cline/data/tasks/<task>/api_conversation_history.json` | [prompt storage](https://docs.cline.bot/enterprise-solutions/monitoring/prompt-storage) |

Exports are read by their format, field by field. Neither service publishes a
schema, so the fields follow the help pages and the open parsers that read real
exports:

- ChatGPT ([help page](https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data);
  [format notes](https://github.com/mohamed-chs/convoviz/blob/main/docs/dev/export-format.md?plain=1)):
  `conversations.json` (or its shards `conversations-000.json` and on) is a list of
  conversations, and each one keeps its messages in a `mapping` tree. Memev follows
  the branch you saw, from `current_node` back to the start, so a regenerated answer
  you moved away from is left out. When `current_node` is missing, the newest
  branch is used.
- Claude ([help page](https://support.claude.com/en/articles/9450526-export-your-claude-data);
  [format notes](https://github.com/Superkikim/nexus-ai-chat-importer/blob/master/docs/architecture/providers/claude-export-format.md?plain=1)):
  `conversations.json` is a list of conversations with their `chat_messages` in
  order, and `projects.json` names the projects.

The apps say their session files are internal and change between versions, so
every field is optional: a line Memev does not know is passed over, never guessed
at. Other apps keep history in a database, or in files whose place or format their
makers do not document. Those apps are not read: OpenCode, Goose, Crush, Cursor,
Windsurf, Zed, Amazon Q, Amp, Kiro, Roo Code, Kilo Code, Cherry Studio and Warp.
Copilot CLI, Kimi, Rovo Dev, OpenHands, Mistral Vibe, LM Studio and Factory
document where their files are but not what is in them, so they are not read yet.

### What a conversation note keeps

One note per conversation or session, at
`memory/imports/history/<app>/<project>/<date>-<title>-<id>.md`, with its title,
date, project and the turns in order. It keeps what you and the assistant wrote.
A tool call or a tool's output becomes one short line, such as
`[tool call: Bash]`; the output itself is left out. Hidden reasoning, text the app
added to your turn (instructions, environment details, reminders) and subagent
turns are left out too.

A conversation is skipped by itself when its note would pass 2 MB, or when an
export entry passes 64 MB. The rest of the source is still imported, and the
preview and the summary give the count.

### Large exports

An export is read as a stream: Memev reads the zip's directory, inflates only the
conversations file, and holds one conversation at a time. A multi-hundred-MB export
needs little memory. The rest of the zip (images, audio) is never opened.

## Finding sources: memev import scan

```
memev import scan            # a numbered list
memev import scan --json     # the same, for the app's setup
memev import scan --quick    # an export in Downloads listed by size, not counted
```

The scan imports nothing and needs no vault. Each source has an `id`, `app`,
`kind` (`files`, `sessions` or `export`), `path`, `count` (sessions,
conversations or files; `null` when not counted), `bytes`, a `first` and `last`
date and `marked`. Sessions are counted from the file list, and their dates are
the files' own times. An export is read once to count its conversations. Claude
Code and the other apps that group sessions by project also list `projects`, each
with its own id, such as `claude-code/-home-me-myproject`.

Import the ones you choose:

```
memev import --source claude-code --source codex --preview
memev import --source claude-code/-home-me-myproject --yes
memev import --source export:/Users/me/Downloads/chatgpt-export.zip --yes
```

`--source` may be given more than once, or as a comma list. An `export:` id is
read whole, because a path may hold a comma.

### Importing twice

Every conversation has a key: the app plus the conversation's own id (the ChatGPT
or Claude conversation id, or the session id). The key's hash is part of the note's
name, so an import that finds the note already there skips that conversation. A
later export of the same account, with a conversation renamed, does not make a
second note. A session that went on after it was imported is not brought up to
date. To import it again in full, undo the import that brought it in, then
import again.

## Preview

Nothing is written until you have seen a preview of what was found. The preview
lists each item with its title, size, and source, plus counts and sizes per
source. On a terminal one question imports everything the preview lists or nothing;
to pick items, run it again with `--keep` and the numbers the preview shows, or
use `--yes` to take them all without the question.

```
memev import --path ~/myproject --preview
```

## Secrets are never imported

Files that look like secrets (.env, private keys, credential stores) and any text
the secrets guard flags are skipped and listed as skipped by name only, without
their contents. A conversation that looks like it holds a secret is skipped as a
whole, and the preview and the summary count it.

## Read-only, and local

Every source is only read. Memev never edits, moves or removes the files of an
app or an export. Nothing leaves the computer: the import makes no network call,
and the notes go only into your vault.

## Tagging and undo

Every imported note carries a source tag (kind of source plus path or export name)
and one import id. Each import has a record at `memory/imports/<id>.md`, which
names every conversation note it wrote. `memev import list` shows each import with
its item count. `memev import undo <id>` removes exactly that import's notes and
leaves everything else. A second undo is a no-op.

```
memev import list
memev import undo imp-1a2b3c4d
```

## At init

On a terminal, init offers the import once, after the lead question. It lists
every source the scan found: this folder, the AI memory files, each app's sessions
and any export in `~/Downloads`. It shows each source's count, size and dates, and
asks one question. A source with 100 items or fewer is marked `[x]`. A bigger one,
or an export not yet counted, is shown but not marked. The answers:

- Enter imports nothing.
- `y` imports the marked sources.
- `all` imports every source.
- Numbers such as `1,3` import those sources.

The offer never blocks init, and it is asked once only. Non-terminal init skips it,
and so do init's `--yes` and `--keep`. `memev import`, which you run yourself,
imports on Enter. The app's setup asks the same question with checkboxes, from
`memev import scan --json`, and imports with `memev import --source ... --yes`.

## No model calls

Import uses no model and no network. Summarising and clustering use plain text
rules inside Memev, so it costs your AI plan nothing.
