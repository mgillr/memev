### Changed

- The recall index is an on-disk segment with a small overlay log (`.memev/index.seg/`), and nothing is loaded at start. On a test vault of 50,000 synthetic notes that moves start from tens of seconds to seconds, and a save no longer stops the daemon. The first start after an upgrade converts the old `index.jsonl` once and then removes it, and `memev status` says the daemon is loading while it does. A downgrade finds no `index.jsonl` and rebuilds the index from the notes, and replays the whole log once because the older code does not read the new snapshot form. Its `.memev/index.seg/`, `notes.state` and `commit.seq` are ignored and can be deleted.
- Commits leave the daemon's thread, a new note no longer reads every path to check for a case clash, and a big vault's log snapshot is written a slice at a time.
- `memev status --json` has a `health` object: start time, recall p50 and p95 of the last 256 recalls, the longest save, memory, and prompts with and without memory, counted since this start. Prompts skipped for time are null and named under `not_measured`, because the hook gives up on its own side and the daemon never sees it.

### Fixed

- The prompt hook leaves past journals out before ranking. Before, a prompt asked a few times filled the top four with its own journal, and nothing was injected.
- A note added or edited while Memev was stopped reaches recall at the next start, not only at the next rebuild.
- A write just before a hard kill reaches recall at the next start: the index records its position in the log, and the start takes in what is past it.
