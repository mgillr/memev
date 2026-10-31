# Scope One baseline

This page records the state of the repository at the moment the takeover record was
started. It is the reference point every other scope-one page measures against.

[Back to the documentation index](../README.md)

## Reference point

| Field | Value |
| --- | --- |
| Branch | `so-t-a-takeover-record-repository-requirement` |
| Main commit | `2909702df758d438626c35d937022572227b4efa` |
| Working tree | clean, 0 changed files |
| Recorded at | 2026-10-30T01:42:51Z |

The branch was fast-forwarded to `origin/main` before any scope-one work began, so the
main commit above is the exact tree the test run below was taken from.

## Test baseline

The full suite was run once from a clean tree at the commit above. The command and the
result are recorded here so a later run can be compared against them.

| Field | Value |
| --- | --- |
| Command | `node --test --test-concurrency=4 test/*.test.mjs` |
| Exit code | 0 |
| Pass | 604 |
| Fail | 0 |
| Skipped | 0 |
| Cancelled | 0 |
| Todo | 0 |
| Duration | 90473.37442 ms |
| Wall time | 91000 ms |

## What the baseline means

- The suite is green at this commit: 604 tests pass and none fail, skip, cancel or todo.
- The duration and wall time above are the reference for the "no slower than baseline"
  check in the Scope One acceptance criteria. A later full run must not be slower than
  90473.37442 ms of test duration to count as holding the baseline.
- No source file is changed by the takeover record itself. The baseline is therefore
  unchanged by this contract: the same 604 tests pass after the record is added.

## How to reproduce

From a clean checkout at the main commit above, run the command in the table. The
`docs-links` test and the new `scope-one-record` test are part of the suite, so the pass
count rises by the number of assertions they add while the fail count stays at 0.
