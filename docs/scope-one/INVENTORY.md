# Scope One contract and work-item inventory

Dated 2026-10-30, at the baseline commit recorded in BASELINE.md; the open pull request section is refreshed to 31 October 2026. One row per contract and work item the author can see: the signed set, open branches, delivered (merged) contracts, open pull requests, and owner-held work. Contract ids and lane words stand for owners; no person, seat, server or client product is named on this page.

[Back to the documentation index](../README.md)

## How to read
- id: the contract or work-item id.
- source: where the author saw it (signed set, git branch, changelog, market analysis, author statement).
- requirement ids covered: the SO-REQ ids the item implements, or none when not mapped.
- status: queued, ready, in progress, blocked, implemented-awaiting-verification, verified, superseded, cancelled, or unknown.
- owner: the owning lane word or contract id, or unowned.
- last known activity: the most recent observed state, or unknown.
- overlaps and conflicts: other items the same work overlaps, or none.
- disposition: KEEP, INTEGRATE, EXTEND, REPAIR, REPLACE, RESEQUENCE, MERGE, SUPERSEDE, CANCEL_WITH_APPROVAL, or NEW.

## Signed sets
| id | source | requirement ids covered | status | owner | last known activity | overlaps and conflicts | disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| k-memory-quality-multiling-4468b8 | signed set | none | verified | unowned | signed, on main | none | KEEP |

## Open branches
| id | source | requirement ids covered | status | owner | last known activity | overlaps and conflicts | disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dev-integration-specs | git branch | none | in progress | unowned | 1 commits ahead of main; branch not modified | PI-04 and PI-05 are superseded by owner decision 31 Oct 2026 (ADR 6 in DECISIONS.md): crdt-merge is reached only across the call-out boundary and is never vendored; the other specs on the branch are unaffected | REPAIR |
| MEM-001 | git branch | none | verified | unowned | 2 commits ahead of main | none | KEEP |
| MEM-002 (2) | git branch | none | verified | unowned | 17 commits ahead of main | twin branch of MEM-002 | KEEP |
| MEM-002 (1) | git branch | none | verified | unowned | 9 commits ahead of main | twin branch of MEM-002 | KEEP |
| MEM-003 | git branch | none | verified | unowned | 11 commits ahead of main | none | KEEP |
| MEM-004 | git branch | none | in progress | unowned | 1 commits ahead of main | none | MERGE |
| MEM-008 | git branch | none | verified | unowned | 9 commits ahead of main | none | KEEP |
| MEM-014 | git branch | none | in progress | unowned | 3 commits ahead of main | none | MERGE |
| MEM-016 | git branch | none | verified | unowned | 6 commits ahead of main | none | KEEP |
| MEM-020 | git branch | none | in progress | unowned | 1 commits ahead of main | none | MERGE |
| MEM-021 | git branch | none | verified | unowned | 2 commits ahead of main | none | KEEP |
| MEM-022 | git branch | none | in progress | unowned | 2 commits ahead of main | none | MERGE |
| MEM-023 | git branch | none | verified | unowned | 3 commits ahead of main | none | KEEP |
| MEM-025 | git branch | none | verified | unowned | 10 commits ahead of main | none | KEEP |
| MEM-043 | git branch | none | in progress | unowned | 6 commits ahead of main | none | MERGE |
| MEM-044 (1) | git branch | none | verified | unowned | 21 commits ahead of main | twin branch of MEM-044 | KEEP |
| MEM-044 (2) | git branch | none | verified | unowned | 20 commits ahead of main | twin branch of MEM-044 | KEEP |
| MEM-047 (2) | git branch | none | verified | unowned | 10 commits ahead of main | twin branch of MEM-047 | KEEP |
| MEM-047 (1) | git branch | none | verified | unowned | 8 commits ahead of main | twin branch of MEM-047 | KEEP |
| MEM-051 | git branch | none | verified | unowned | 16 commits ahead of main | none | KEEP |
| MEM-055 (2) | git branch | none | verified | unowned | 20 commits ahead of main | twin branch of MEM-055 | KEEP |
| MEM-055 (1) | git branch | none | verified | unowned | 18 commits ahead of main | twin branch of MEM-055 | KEEP |
| MEM-057 | git branch | none | in progress | unowned | 7 commits ahead of main | none | MERGE |
| MEM-058 | git branch | none | verified | unowned | 18 commits ahead of main | none | KEEP |
| MEM-065 | git branch | none | verified | unowned | 1 commits ahead of main | none | KEEP |
| MEM-067 | git branch | none | cancelled | unowned | #132 closed 31 Oct 2026, branch kept; owner decision 31 Oct 2026: there is no Personal trial, the free core is the trial | #154, #163, #177 carry the Business trial | CANCEL_WITH_APPROVAL |
| MEM-069 | git branch | none | in progress | unowned | 1 commits ahead of main | none | MERGE |
| MEM-077 (2) | git branch | none | verified | unowned | 7 commits ahead of main | twin branch of MEM-077 | KEEP |
| MEM-077 (1) | git branch | none | verified | unowned | 2 commits ahead of main | twin branch of MEM-077 | KEEP |
| MEM-082 (1) | git branch | none | verified | unowned | 16 commits ahead of main | twin branch of MEM-082 | KEEP |
| MEM-082 (2) | git branch | none | verified | unowned | 9 commits ahead of main | twin branch of MEM-082 | KEEP |
| MEM-088 | git branch | none | verified | unowned | 18 commits ahead of main | none | KEEP |
| MEM-093 | git branch | none | in progress | unowned | 2 commits ahead of main | none | MERGE |
| MEM-098 | git branch | none | verified | unowned | 12 commits ahead of main | none | KEEP |
| MEM-101 | git branch | none | in progress | unowned | 1 commits ahead of main | none | MERGE |
| MEM-104 | git branch | none | verified | unowned | 9 commits ahead of main | none | KEEP |
| MEM-129 | git branch | none | in progress | unowned | 16 commits ahead of main | none | MERGE |
| MEM-130 | git branch | none | in progress | unowned | 3 commits ahead of main | none | MERGE |
| MEM-131 | git branch | none | verified | unowned | 5 commits ahead of main | none | KEEP |
| MEM-133 | git branch | none | verified | unowned | 7 commits ahead of main | none | KEEP |
| MEM-134 | git branch | none | in progress | unowned | 5 commits ahead of main | none | MERGE |
| MEM-135 | git branch | none | verified | unowned | 9 commits ahead of main | none | KEEP |
| MEM-137 | git branch | none | verified | unowned | 11 commits ahead of main | none | KEEP |
| MEM-138 | git branch | none | verified | unowned | 8 commits ahead of main | none | KEEP |
| MEM-139 | git branch | none | verified | unowned | 8 commits ahead of main | none | KEEP |
| MEM-140 | git branch | none | verified | unowned | 7 commits ahead of main | none | KEEP |
| MEM-141 | git branch | none | verified | unowned | 11 commits ahead of main | none | KEEP |
| MEM-142 | git branch | none | verified | unowned | 18 commits ahead of main | none | KEEP |
| MEM-145 (1) | git branch | none | in progress | unowned | 5 commits ahead of main | twin branch of MEM-145 | MERGE |
| MEM-145 (2) | git branch | none | in progress | unowned | 5 commits ahead of main | twin branch of MEM-145 | SUPERSEDE |
| MEM-145 (3) | git branch | none | in progress | unowned | 4 commits ahead of main | twin branch of MEM-145 | SUPERSEDE |
| REV-001 | git branch | none | verified | unowned | 9 commits ahead of main | none | KEEP |
| REV-002 | git branch | none | verified | unowned | 7 commits ahead of main | none | KEEP |
| REV-003 | git branch | none | verified | unowned | 3 commits ahead of main | none | KEEP |
| REV-004 | git branch | none | verified | unowned | 3 commits ahead of main | none | KEEP |
| REV-005 | git branch | none | verified | unowned | 5 commits ahead of main | none | KEEP |
| REV-006 | git branch | none | verified | unowned | 10 commits ahead of main | none | KEEP |
| REV-010 | git branch | none | verified | unowned | 5 commits ahead of main | none | KEEP |
| REV-011 | git branch | none | verified | unowned | 5 commits ahead of main | none | KEEP |
| REV-012 (2) | git branch | none | in progress | unowned | 4 commits ahead of main | twin branch of REV-012 | SUPERSEDE |
| REV-012 (1) | git branch | none | in progress | unowned | 2 commits ahead of main | twin branch of REV-012 | MERGE |
| REV-013 | git branch | none | verified | unowned | 2 commits ahead of main | none | KEEP |
| REV-020 | git branch | none | verified | unowned | 7 commits ahead of main | none | KEEP |
| REV-021 | git branch | none | verified | unowned | 4 commits ahead of main | none | KEEP |
| REV-022 (1) | git branch | none | verified | unowned | 3 commits ahead of main | twin branch of REV-022 | KEEP |
| REV-022 (2) | git branch | none | verified | unowned | 2 commits ahead of main | twin branch of REV-022 | KEEP |
| REV-023 | git branch | none | verified | unowned | 5 commits ahead of main | none | KEEP |
| REV-024 | git branch | none | verified | unowned | 5 commits ahead of main | none | KEEP |
| REV-032 | git branch | none | verified | unowned | 3 commits ahead of main | none | KEEP |
| REV-036 | git branch | none | verified | unowned | 8 commits ahead of main | none | KEEP |
| SO-04-A | git branch | none | in progress | unowned | 4 commits ahead of main | none | MERGE |
| WO-01-A | git branch | none | in progress | unowned | 2 commits ahead of main | none | MERGE |
| WO-03-A (2) | git branch | none | in progress | unowned | 5 commits ahead of main | twin branch of WO-03-A | SUPERSEDE |
| WO-03-A (1) | git branch | none | in progress | unowned | 3 commits ahead of main | twin branch of WO-03-A | MERGE |
| WO-05-A (1) | git branch | none | in progress | unowned | 6 commits ahead of main | twin branch of WO-05-A | MERGE |
| WO-05-A (2) | git branch | none | in progress | unowned | 4 commits ahead of main | twin branch of WO-05-A | SUPERSEDE |
| WO-05-E (1) | git branch | none | in progress | unowned | 3 commits ahead of main | twin branch of WO-05-E | MERGE |
| WO-05-E (2) | git branch | none | in progress | unowned | 2 commits ahead of main | twin branch of WO-05-E | SUPERSEDE |
| WO-10-A | git branch | none | in progress | unowned | 3 commits ahead of main | none | MERGE |
| SO-T-A | git branch | SO-REQ-072 | in progress | unowned | this takeover record | none | NEW |

## Delivered (merged, branch removed)
| id | source | requirement ids covered | status | owner | last known activity | overlaps and conflicts | disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MEM-027 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-031 | test suite (on main) | none | verified | unowned | on main | none | KEEP |
| MEM-046 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-053 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-056 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-061 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-068 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-086 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-092 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-095 | changelog (merged) | none | verified | unowned | on main | none | KEEP |
| MEM-100 | git branch (merged, stale) | none | verified | unowned | on main; branch 26 commits behind | none | KEEP |

## Open pull requests
| id | source | requirement ids covered | status | owner | last known activity | overlaps and conflicts | disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #324 | gh pr list, 31 Oct 2026 | none | in progress | SO-1.02 | open, not draft; WBS.md, test/wbs.test.mjs and SO-1.01 to SO-1.11 | none | MERGE |
| #224 | gh pr list, 31 Oct 2026 | none | in progress | unowned | open, draft; federation and deployment documentation, created 30 Oct | federation is planned, not available; the tier decision names no Federated tier | REPAIR |
| #222 | gh pr list, 31 Oct 2026 | none | in progress | unowned | open, draft; Scope One architecture and delivery addendum, created 30 Oct | advisory: only recommendations the owner accepts become contracts | KEEP |
| #201 | gh pr list, 31 Oct 2026 | none | in progress | WO-05-B | open, draft; paid-engine client behind a flag, created 30 Oct | one lifecycle with #154, #163 and #177; the engine stays external behind the WO-05-A call-out boundary | INTEGRATE |
| #177 | gh pr list, 31 Oct 2026 | none | in progress | MEM-134 | open, draft; separation and abuse guards for the trial, created 29 Oct | #154, #163 and #201 | INTEGRATE |
| #163 | gh pr list, 31 Oct 2026 | none | in progress | MEM-130 | open, draft; merge-engine entitlement and trial seat policy, created 29 Oct | #154, #177 and #201 | INTEGRATE |
| #154 | gh pr list, 31 Oct 2026 | none | in progress | MEM-129 | open, draft; trial licence format and verification, created 29 Oct | #163, #177 and #201 | INTEGRATE |

## Owner-held work
| id | source | requirement ids covered | status | owner | last known activity | overlaps and conflicts | disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| owner-held (unlisted) | author statement | none | unknown | unowned | not in any branch or pull request of this set | none | NEW |

## Sources not read
- The open pull requests above are the live `gh pr list` state of memev on 31 October 2026. The earlier line that named 27 open draft pull requests, taken from the market analysis (section 7), is replaced by it: seven pull requests are open, one of them not a draft. Pull requests #319 to #323 were merged on 31 October and #132 was closed; MEM-067 is cancelled (see its row above).
