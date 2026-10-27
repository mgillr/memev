# Design

**One writer.** The daemon is the only process that writes the vault. App integrations (`memev mcp`,
hooks, the CLI) talk to it over HTTP on `127.0.0.1`.

**Log first.** Every change is appended to `.memev/oplog/` before the Markdown file changes: puts,
splices (small diffs), appends, deletes, and the graph, claim, usage, feedback, tournament and
contract operations. Records are checksummed and segments are sealed with a SHA-256. On start and
before each write the files are reconciled with the log: a missing file is rebuilt, a half-finished
append is completed, and a file edited by hand is imported as an external change. Nothing in the
log is ever rewritten.

**Files are the interface.** Memory is Markdown: month files for decisions and facts, one file per
project for checkpoints, one per session for the journal. git commits every change.

**Recall.** A BM25 index over note sections (about six bytes per section-term pair), updated per
write and incrementally on appends, persisted to `.memev/index.jsonl`. Results are boosted by the
project and by feedback (`memev_feedback`). On large vaults very common terms are dropped from the
query. Recall never reads the log.

**Graph.** Entities extracted from sections, co-occurrence, explicit edges (`memev_link`), and
claims whose status (conjecture, theory, fact, contested, refuted) is recomputed from the weight of
supporting and opposing evidence. Usage records say which memory each session used.

**Scale.** `scripts/growth-bench.mjs` simulates heavy use: 170 million tokens of sessions (99
sessions, 8,096 turns, 25,862 logged operations) in 27 seconds, with the heap under 256 MB (it also
passes with a 160 MB limit; the steady state after opening is about 52 MB), the log verified, every
note rebuilt byte-identical from the log, and recall at 1.0 ms median, 2.8 ms p95.
