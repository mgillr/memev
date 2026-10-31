# Readiness review

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A readiness review of the earlier private prototype was done before this repository was created.
It found the prototype not ready to share (identity and business details throughout its history,
compaction continuity gaps, unbounded log growth, manual client setup) and proposed a clean build
in a new repository, in this order:

1. isolation and a clean engine (append-only, bounded memory, lossless)
2. leak-scan CI
3. working CI on Linux and macOS
4. append-only write path that never holds the whole log in memory
5. compaction continuity: state at session start, a checkpoint before compaction, a progress tool, recall on every prompt
6. zero-touch registration in every detected AI app, with backup, merge and uninstall
7. remote access on by default through a stable tunnel, one command to switch off
8. `memev doctor` (CLI and MCP tool) and an onboarding checklist
9. guided GitHub backup to the user's own private repository
10. vendored task contracts with self-signing and immutability

The review document itself is kept outside this repository because it describes private systems.

Plan-SHA256: 8a5a26e6b6b234da35f2543499dcd1f353cb374f6186cbd803d73abf18501f36
Approved-By: Ryan (2026-10-27)
