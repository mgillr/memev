# Your Memev vault

This folder is your memory. It is plain Markdown in a git repository, and you own it.
Every AI session you connect to Memev reads from it and writes to it.

- `memory/north-star.md`: who you are and what you are working towards. Edit it; every session reads it first.
- `memory/<kind>/YYYY-MM.md`: decisions, gotchas, facts, patterns, wins, people and preferences, one file per month.
- `work/active/<project>.md`: progress checkpoints. The latest one is shown at every session start, so work survives compaction.
- `work/sessions/`: a running record of each session.
- `contracts/`: signed task contracts. Signed files are immutable.

`.memev/` holds the local state (operation log, index, tokens). It is never committed.
Run `memev doctor` if anything looks wrong.
