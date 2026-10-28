# Benchmark: recall quality and tokens

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

`scripts/bench/run.mjs` measures how well Memev finds what was recorded and how many tokens it puts into an AI client's context. It guards every change that trims tokens: a change may cut tokens, but recall quality may not drop.

It is a development tool. It is not in the npm package, it makes no model calls and no network calls, and it reports nothing anywhere.

## Running it

```sh
node scripts/bench/run.mjs                      # the small level, a summary
node scripts/bench/run.mjs --level large        # 5,000 memories
node scripts/bench/run.mjs --check --group guard --level small --latency-vs 18abe10161ca34d4665bb2fc58b1dc4f84c9bacb
node scripts/bench/run.mjs --check --group caps --only get
node scripts/bench/run.mjs --json out.json      # every metric as JSON
```

| Flag | Meaning |
|---|---|
| `--level small\|large` | 1,000 or 5,000 memories, plus 60 past sessions, six project checkpoints, a north star and a contract draft. Default small. |
| `--group guard\|caps\|autorecall\|protocol\|lean\|all` | which targets `--check` applies. Default all. |
| `--only NAME` | one target name inside the group (for example `get` in `caps`). |
| `--check` | exit 1 when a check fails. Every check includes the guard. |
| `--json FILE` | write the metrics (`-` for standard output). |
| `--latency-vs SHA` | also time recall on that commit, interleaved with this code in the same process. |
| `--repo-sha SHA` | measure that commit's code instead of this checkout (its `src/` and `templates/` are taken from git). |
| `--repo DIR` | the repository for `--repo-sha` and `--latency-vs`. Default: this one. |
| `--metrics FILE` | check an earlier `--json` result instead of measuring. |
| `--record` | store the run as the baseline for its level in `bench/baseline.json`. |

A run takes a few seconds at either level.

## How it works

Everything runs in one Node process. The harness builds a vault in a temporary folder and opens it with the code under test. The vault's notes are written straight to disk in the formats Memev writes (`scripts/bench/seed.mjs`), so every code version searches the same notes. The HTTP routes the hooks and MCP clients use are served by the code's own request handler. Requests to the vault's port are handed to it in process; nothing listens on a port. The hooks run as the apps run them, with the input on stdin and the output on stdout, through the same `runHook` the `memev hook` command calls.

Runs are repeatable. The clock only moves when the harness moves it, the ids Memev draws at random come from a seeded generator, and the host name is fixed. Two runs of the same checkout give the same metrics byte for byte, apart from `latency` and the run time `at`.

Tokens are counted with o200k_base. `scripts/bench/o200k.mjs` is a byte-pair encoder over the published `o200k_base.tiktoken` ranks, stored gzipped beside it and checked against the published SHA-256 when loaded. `test/bench/o200k-fixture.json` holds texts counted with tiktoken 0.14.0. The counter matches every one exactly, and the test allows 2 percent.

## The labelled prompts

`bench/queries.json` holds:

- 20 on-topic prompts about things recorded in the vault, each naming the memory items (`path#heading`) recall must find.
- 20 off-topic coding prompts, which should inject nothing.
- 7 continuation prompts such as `continue`, which should inject nothing.

The on-topic and off-topic prompts are those of the 2026-10-27 token usage report. The items each on-topic prompt must find (`needles`) are written into the vault with the rest.

## The metrics

| Metric | Meaning |
|---|---|
| `quality.recall_at_6` | Tool path. For each on-topic prompt, `memev_recall` at its default limit; the share of the named items found in the first 6 results. |
| `quality.precision_at_6` | Tool path: the share of the first 6 results that are named items. |
| `quality.recall_at_4` | Hook path. The per-prompt hook recalls up to 4 items; the share of named items it injects, over one 20-prompt session. |
| `quality.precision_at_4` | Hook path: the share of injected items that are named items. |
| `autorecall.offtopic_injection_rate` | The share of off-topic and continuation prompts for which the hook injects anything. |
| `autorecall.prompt_mean_on`, `prompt_mean_off`, `prompt_mean_continuation` | Mean tokens the hook adds per prompt, per session. |
| `autorecall.repeated_items` | Items injected again later in the same session. |
| `autorecall.journal_draft_items` | Injected items from session journals (`work/sessions/`) or contract drafts (`contracts/drafts/`). |
| `fixed.fixed_overhead_default` | Fixed cost per session on an empty vault as Claude Code loads it: MCP instructions + the CLAUDE.md block + the SessionStart hook output + the tool names (`mcp__memev__<name>`, one per line). |
| `fixed.fixed_overhead_all_tools` | The same with every tool definition (name, description, input schema, compact JSON) instead of the names, for clients that load all tools. |
| `fixed.protocol_tokens`, `fixed.protocol_channels` | The protocol text, and in how many of the three channels (MCP instructions, SessionStart output, CLAUDE.md block) it appears. |
| `fixed.tools_list_tokens` | `tools/list` as the model sees it. |
| `resume.*` | Session start after a compaction and on resume in the on-topic session, whether it repeats the protocol, and the resume card that same session gets. |
| `max_result_tokens.get` (`get_chars`) | `memev_get` on the largest note. |
| `max_result_tokens.recall_limit_1000` (`recall_limit_10`) | `memev_recall` for `database migration` over all projects at limit 1000 (and 10). |
| `max_result_tokens.recall_6hit` | The same query at limit 6, and `recall_6hit_items` the number of hits it returned. |
| `max_result_tokens.bus_unread_200` | `bus_unread` after another app posts 200 messages of about 300 characters. |
| `max_result_tokens.list_entries` | Entries `memev_list` returns for the vault root. |
| `latency.recall_p95_ms` | Recall p95 on the tool path over every labelled prompt, repeated (5 times small, 3 large). With `--latency-vs`, `latency.vs` holds the other commit's figure from the same run. |

Tool results are counted on their text content, which is what the model reads; the hook on the `additionalContext` it prints. Recall items are read from the JSON (`path` and `heading`) or from `- [path#heading]` lines. A new output format has to keep one of the two, or the quality metrics cannot see the hits.

## Targets and the guard

`bench/targets.json` holds the targets; each names the contract that must meet it. The quoted baseline figures are the report's, measured at 18abe10.

| Group / name | Target | Contract |
|---|---|---|
| caps / get | `memev_get` at most 8,000 characters and 2,500 tokens (report: 98,649 tokens) | MEM-107 |
| caps / recall | recall at limit 1000 no larger than at limit 10, and at most 1,300 tokens (report: 138,407) | MEM-108 |
| caps / bus | 200 unread messages at most 1,300 tokens (report: 30,285) | MEM-109 |
| caps / list | at most 50 entries per page | MEM-110 |
| autorecall / gate | off-topic injection rate at most 0.45; mean per prompt at most 289 on-topic and 83 off-topic | MEM-111 |
| autorecall / dedupe | repeated items 0; journal or draft items 0 | MEM-112 |
| protocol / once | protocol at most 200 tokens (report: 562), in exactly one channel; fixed overhead at most 1,000 (report: 1,804) | MEM-113 |
| protocol / resume | after a compaction, no protocol text and no more than the resume card | MEM-114 |
| lean / tools | default `tools/list` at most 600 tokens (report: 4,150); fixed overhead with every tool at most 1,100 (report: 5,484) | MEM-115 |
| lean / recall-output | a 6-hit recall at most 450 tokens (report: 761), still 6 hits | MEM-116 |

The guard is part of every `--check`. On-topic recall@6, precision@6, recall@4 and precision@4 may not fall below the baseline, and the off-topic injection rate may not rise above it. The benchmark is deterministic, so any drop is a real change. With `--latency-vs`, recall p95 must stay within 10 percent or 5 ms of the other commit, both timed in the same run (the tolerance accepted on 2026-10-27). If a token target cannot be met without lowering recall, the change stops there: the benchmark, the baseline and the targets are not loosened.

## The per-prompt bar

The prompt hook injects a recalled item only when its score reaches the hook's bar. BM25 scores grow with the size of the vault, so the bar is a share (`HOOK_BAR` in `src/server/http.mjs`) of the largest score one rare word can add in that vault, `ln(1 + (sections - 0.5) / 1.5)`: about 7.0 at the small level and 7.9 at the large. `recall.hook_bar` in a vault's config changes the share, `recall.hook_min_score` sets a fixed score instead, and a higher `recall.min_score` still wins. `bench/targets.json` (`hook_bar`) records the share with the sweep that chose it: the highest that keeps every on-topic hit the baseline finds, at both levels.

The hook also does not recall at all for a prompt under 4 words or a continuation phrase such as `continue`, `go on` or `thanks`. It never injects the same item twice in a session (a compaction or a clear starts over). It leaves out past session journals and contract drafts unless `recall.hook_include_journals` is on. `memev_recall`, which the model calls itself, and `memev recall` on the command line have none of these limits.

## The baseline

`bench/baseline.json` is the harness run against 18abe10161ca34d4665bb2fc58b1dc4f84c9bacb at both levels (`--repo-sha 18abe10161ca34d4665bb2fc58b1dc4f84c9bacb --record`), before any token change. The recall p95 in it is for reference only, since timings depend on the machine; the guard compares latency against `--latency-vs` in the same run.

At 18abe10 the harness reproduces the report:

- Fixed overhead: 1,804 default and 5,484 with every tool.
- Protocol: 562 tokens, in two channels.
- `tools/list`: 4,150 tokens.
- At the large level: `memev_get` 93,879 tokens and recall at limit 1000 132,461 (report: 98,649 and 138,407).
- Off-topic prompts inject on 16 of 20 (report: 14 to 17).
