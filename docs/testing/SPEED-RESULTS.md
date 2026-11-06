# Speed results for SR-1.35

Part of the [Memev documentation](../README.md). Up: the [README](../../README.md).

These are measured figures on generated notes, on one computer. They are not a promise about your vault. Reproduce the ceilings with `node scripts/bench/speed/targets.mjs`, and see that they catch the old code with `node scripts/bench/speed/targets.mjs --against <commit>`.

## How this was measured

- **Computer:** one iMac, Intel i5-6500, 4 cores, 24 GB, macOS, Node 23.7.0. Load stayed about 1.5 to 2.6 from other idle programs, and no other test or bench was running.
- **Commits:** the table below was taken at 5355c9a4b896cef443c9d715a6ada5f22cf5b584 against main at 8a01f7f6f0a57ee2a8de9dba5dfd7b75eea80a74. The commits after it change the commit catch-up after a hard kill and add the ceilings, so only the git figure can feel them, and the ceilings below re-measure it.
- **Notes:** 50,082 generated notes unless stated, with a spread of sizes and a word curve from `scripts/bench`.
- **Spread:** a range is the lowest and highest of the runs, and a single figure is a median.

| Axis | What | Before | After |
|---|---|---|---|
| A1 Start | Spawn to `/healthz` | 44.8 s (44.1 to 46.9) | 1.08 s (1.00 to 1.43) |
| | Memory after start | 1.5 GB | 210 MB |
| A7 First run | Converting an old index, once per vault | not applicable | 48.4 s, 675 MB |
| | First import of a folder of notes | 374 s, one run, 1.8 GB | 73.6 s (72.5 to 73.6), about 650 MB |
| A8 Stop | SIGTERM to exit | 339 ms (320 to 345) | 94 ms (50 to 398) |
| | The same, just after a write | 8.0 s (7.6 to 8.0) | 141 ms (129 to 659) |
| A2 Save | `/healthz` waits over 800 ms while writing, per cycle | 8 | 0, worst wait 3.2 ms |
| | Longest stall of the serving thread during a fold | not measured | 48 to 144 ms, fold 8.6 to 11.8 s on a worker |
| A3 Recall | Real route, p50 | 80 to 102 ms | 10 to 13 ms |
| | Real route, p95 | 135 to 157 ms | 16 to 33 ms |
| | First recall after a save | 7.2 to 9.5 s | 18 to 26 ms |
| A4 Write | New note, route, p50, 10,000 notes | 21 ms | 10.8 ms |
| | Journal, new file, p50, 10,000 notes | 20.9 ms | 11.1 ms |
| | Append, route, p50, 10,000 notes | 9.7 ms | 9.3 ms: no gain beyond the spread |
| | Worst `/healthz` during writes, 10,000 notes | 437 ms | 26 ms |
| A5 Git | How long a commit stops the thread, p50 | 215 ms | 0.5 ms |
| | The commit itself, now off the thread, 10,000 notes | 150 ms | 164 ms: slower |
| A6 Bus | Roster, 50 seats, 100,000 messages | 2,904 ms | 3.5 ms |
| | Tasks | 9,448 ms | 10 ms |
| | Send | 374 ms | 10.5 ms |
| | Unread, caught up | 85 ms | 9.2 ms |
| | First read | 360 ms | 327 ms: no gain beyond the spread |
| Sweep | The check behind the start, 299 MB | not applicable | about 3.5 s, once 12.4 s; worst thread stall 24 ms |

## Same answers

- **Recall against the old index, 10,000 notes, in every state:** 0 differences. Its broken controls were all caught: order 480, boost 37, review 164, drop 61.
- **Recall on a just-opened vault against main's graph:** 0 of 349 queries differ. Its broken control differs on 114.

## The ceilings

`targets.mjs` holds a ceiling on every axis. The ceilings sit well above these figures, so a slower computer should still pass, though no slower computer has been run yet. One run of each, at 50,000 notes, by the same benches, on this computer:

| Ceiling | Limit | This code | Main's code |
|---|---|---|---|
| Start | 10,000 ms | 1,030 | 68,430 |
| First import | 200,000 ms | 89,941 | 405,114 |
| Stop after a write | 2,000 ms | 137 | 7,561 |
| Recall p95 | 100 ms | 32.6 | 158 |
| First recall after a save | 1,000 ms | 41 | 7,577 |
| `/healthz` timeouts while writing | 0 | 0 | 16 |
| Commit stops the thread, p50 | 25 ms | 0.5 | 204 |
| Roster | 50 ms | 3.7 | 3,057 |
| Tasks | 200 ms | 12 | 10,221 |
| Send | 200 ms | 7.5 | 378 |
| Stop, nothing written (guard) | 2,000 ms | 49 | 352 |
| New note, p50 (guard) | 200 ms | 11.9 | 107 |

The last two are guards against getting worse: main passes them too, and they claim no gain. Recall p95 and send are also guards in the `--against` check, since main measured under twice their ceilings, so a faster computer could pass the old code. This run's notes differ a little from the table above, so compare the columns of one table and not across the two.

## Costs and limits

- Every vault converts its index once after this update.
- Going back to code older than rotation, after a bus file has rolled over, can reuse counters and leave a new message undelivered. See `docs/BUS.md`.
- Two processes writing at once fail the log's verify, as they do before this work. SR-1.01's writer lock closes that.

## Not measured

Power loss, a real vault at this size, Windows, Linux, a full disk, a clock set back, and two computers through git. No figure here says anything about those.
