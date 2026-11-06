# Design

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

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
write and incrementally on appends, kept on disk as a segment with a small overlay log under
`.memev/index.seg/` and read by offset, so nothing is loaded at start. Words are split by Unicode
letter and digit, so every script is indexed: accents on Latin and Greek letters are folded, and
Chinese, Japanese and Korean text is indexed as single characters plus overlapping pairs. ASCII text
splits exactly as it did before. Sections are filtered before ranking: what the token may read, the
project (recall with a project searches only that project and memories with no project;
`all_projects` turns this back into a boost), and the review state. Results are then weighted by
feedback (`memev_feedback`). On large vaults very common terms are dropped from the query. Recall
never reads the log. `memev why` shows each matched word's share of a score, and the parts multiply
back to it.

The notes are the record and the index can always be built from them, so the index only has to know
when it is wrong. A start checks the sizes and counts its files should have, and hashes none of them
but the small head that holds those. Everything recall reads carries its own check: each line of the
dictionary, each word's postings and counts, each snippet line, and the files read whole are held to
their sums as they are read. The whole-file sums are checked behind the start, by `memev doctor` and
before a fold, so damage is not carried into a new generation. A generation found damaged stops
serving at once and is rebuilt from the notes on a worker; recall says it is rebuilding until then,
and `memev status` and `memev doctor` say what was found. The check is against damage: someone able
to write `.memev` can write a sound looking index, as they can edit the log.

**Memory quality.** `memev_remember` checks text before saving it, on this machine with fixed rules:
acknowledgements, system noise, fragments under three words and duplicates of anything already in
`memory/` are refused with a reason (`force` saves anyway, flagged). Notes that read as short-lived
("for now", "today") get a `Review-By:` date and leave recall after it unless kept. Hedged notes and
near-duplicates are flagged. `memev review` keeps or drops flagged memories; the decisions are log
records, and the notes themselves are not edited. `memev audit` reports junk without changing
anything.

**Graph.** Entities extracted from sections, co-occurrence, explicit edges (`memev_link`), and
claims whose status (conjecture, theory, fact, contested, refuted) is recomputed from the weight of
supporting and opposing evidence. A finding is a claim that carries its sources and scope, and evidence alone
stops it at theory ([ORGANISATIONAL-INTELLIGENCE.md](ORGANISATIONAL-INTELLIGENCE.md), planned). Usage records say which
memory each session used.

**Scale.** `scripts/growth-bench.mjs` simulates heavy use: 170 million tokens of sessions (99
sessions, 8,096 turns, 25,862 logged operations) in 29 seconds, with the heap peaking at 160 MB
under a 256 MB limit, the log verified, every note rebuilt byte-identical from the log, and recall at
1.1 ms median, 3.4 ms p95 (measured after the Unicode index change).
