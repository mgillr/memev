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

2. **AI history on the machine.** Claude Code and Cursor project memory files,
   CLAUDE.md and similar project rule files, found in their documented
   locations. Read-only: the originals are never edited or removed. Enable with
   `--ai-history`.

3. **Chat export zips.** ChatGPT and Claude export zips (conversations.json and
   similar), read with a small built-in zip reader. Pass one or more files with
   `--export FILE.zip`.

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
their contents.

## Tagging and undo

Every imported note carries a source tag (kind of source plus path or export name)
and one import id. `memev import list` shows each import with its item count.
`memev import undo <id>` removes exactly that import's notes and leaves everything
else. A second undo is a no-op.

```
memev import list
memev import undo imp-1a2b3c4d
```

## At init

On a terminal, init offers the import step once, after the lead question. It is
off unless you say yes, and it never blocks init. Non-terminal init skips it.

## No model calls

Import uses no model and no network. Summarising and clustering use plain text
rules inside Memev, so it costs your AI plan nothing.
