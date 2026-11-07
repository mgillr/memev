### Added

- Setup offers your chat history, once: init lists every source it found on the computer, with its count, size and dates, and asks one question. These are each AI app's stored sessions (Claude Code, Codex CLI, Gemini CLI, Qwen Code, Jan, Continue, Cline) and any ChatGPT or Claude export in Downloads. Only sources with 100 items or fewer are marked, and Enter imports nothing.
- `memev import scan --json` lists each source without importing (id, app, path, count, size, date range, whether it is marked), so the app's setup can show checkboxes. `memev import --source ID --source ID --yes` imports the chosen sources, and a single project can be chosen as `claude-code/<project folder>`.

### Changed

- Chat exports are read by their real format: ChatGPT's mapping tree, following the branch you saw, and Claude's message list. Shards (`conversations-000.json` and on) and unpacked folders are read too. Each conversation becomes its own note, with its title, date and turns in order. An export is streamed, so a multi-hundred-MB export needs little memory. Before, a `conversations.json` over 512 KB was skipped whole, and a small one became a single note.
- Each conversation or session is one note under `memory/imports/history/<app>/<project>/`. It keeps what you and the assistant wrote, and each tool call or tool output is one short line. Importing again never makes a second note of the same conversation. A conversation that looks like it holds a secret, or is over 2 MB, is skipped by itself and counted. `memev import undo` removes every note of that import.
