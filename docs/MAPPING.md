# Hands-off runtime: what Memev does without being asked

| Mechanism | In Memev | Status |
|---|---|---|
| Standing instructions for every session | the protocol in MCP `initialize` instructions, plus a block in each app's instructions file | done |
| Starts with the machine | `memev service install` (systemd or launchd), run by `memev init` | done |
| State injected at session start and after compaction | resume card via SessionStart hooks and `memev_session_start` | done |
| Memory recalled for each prompt without asking | UserPromptSubmit / BeforeAgent hooks call recall | done (Cursor: session start only) |
| Progress saved before compaction and after each turn | PreCompact and Stop hooks write checkpoints and the journal | done |
| New apps connected automatically | the daemon re-detects apps and connects them (unless you disconnected one) | done |
| Knowledge graph: organise and interconnect | entities, co-occurrence, explicit typed edges; `memev_graph`, `memev_link` | done |
| Fact / theory / conjecture with promotion and demotion | claims with evidence; status recomputed per piece of evidence; history kept | done |
| Explain connections | `memev_explain`: the path between two entities and the notes behind it | done |
| Provenance | `memev_provenance`: every operation, commit and recall of a memory or claim | done |
| Competing answers ranked | `memev_tournament_match` / `_standings` (Elo; advance at 1050, decompose under 950) | done |
| Recall learns from use | feedback adjusts ranking and the per-prompt bar (`.memev/tuning.json`) | partial: tuning, not yet a learned model |
| Build requests become signed contracts | prompt hook + `memev_contract_from_request` / `_sign` / `_status` / `_verify` | done |
| Background jobs | git sync, app re-detection and tuning run inside the daemon | done |
| Automated reasoning over the graph (contradiction search, new hypotheses) | | planned |
| Multi-perspective review of a decision | | planned |
| Curated reading library and discovery loop | | planned |

Continuity is covered by `test/continuity.test.mjs` (compaction, resume, cross-app) and
`test/proofline-flow.test.mjs` (request to verified contract across a compaction).
