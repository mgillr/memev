# Scope One traceability matrix

Dated 2026-10-30, at the baseline commit recorded in BASELINE.md. One row per requirement id in the
[requirement register](REQUIREMENTS.md). A row names the implementation paths on main, the contract
that owns the work (a contract id, where the id stands for the owner, or unowned), the requirement
dependencies, the test names or evidence, and the status. A row may cite nothing only when its
status is MISSING or UNKNOWN. No person, seat, server or client product is named on this page.

[Back to the documentation index](../README.md)

## How to read a row
- implementation paths: the files on main that implement the requirement, or none.
- contract: the owning contract id, or unowned when no single contract owns it.
- dependencies: the other requirement ids this one depends on, or none.
- test names or evidence: the test files that prove it, or the evidence for its status.
- status: one of the seven register statuses.

## Matrix

| id | implementation paths | contract | dependencies | test names or evidence | status |
| --- | --- | --- | --- | --- | --- |
| SO-REQ-001 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-002 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-003 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-004 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-005 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-006 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-007 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-008 | `src/engine/oplog.mjs` | REV-003 | none | `test/oplog-recovery.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-009 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-010 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-011 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-012 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-013 | `src/engine/oplog.mjs` | REV-003 | none | `test/oplog.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-014 | `test/fail-paths.test.mjs` | MEM-100 | none | `test/fail-paths.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-015 | none | unowned | none | documented in the handoff (Scope One acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-016 | `docs/CLIENTS.md` | unowned | none | `test/clients-unsupported.test.mjs` | EXISTS_AND_VERIFIED |
| SO-REQ-017 | none | unowned | none | none | MISSING |
| SO-REQ-018 | none | unowned | none | none | MISSING |
| SO-REQ-019 | none | unowned | none | none | MISSING |
| SO-REQ-020 | none | unowned | none | none | MISSING |
| SO-REQ-021 | none | unowned | none | none | MISSING |
| SO-REQ-022 | none | unowned | none | none | MISSING |
| SO-REQ-023 | none | unowned | none | none | MISSING |
| SO-REQ-024 | none | unowned | none | none | MISSING |
| SO-REQ-025 | none | unowned | none | none | MISSING |
| SO-REQ-026 | none | unowned | none | none | MISSING |
| SO-REQ-027 | none | unowned | none | none | MISSING |
| SO-REQ-028 | none | unowned | none | none | MISSING |
| SO-REQ-029 | none | unowned | none | none | MISSING |
| SO-REQ-030 | none | unowned | none | none | MISSING |
| SO-REQ-031 | `src/engine/oplog.mjs` | REV-003 | none | `test/oplog.test.mjs`, `test/oplog-recovery.test.mjs` | EXISTS_AND_VERIFIED |
| SO-REQ-032 | none | unowned | none | none | MISSING |
| SO-REQ-033 | none | unowned | none | none | MISSING |
| SO-REQ-034 | none | unowned | none | none | MISSING |
| SO-REQ-035 | none | unowned | none | none | MISSING |
| SO-REQ-036 | none | unowned | none | none | MISSING |
| SO-REQ-037 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-038 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-039 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-040 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-041 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-042 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-043 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-044 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-045 | none | unowned | none | documented in the handoff (Dashboard acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-046 | `src/engine/vault.mjs` | unowned | none | `test/isolation.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-047 | none | unowned | none | documented in the handoff (Onboarding acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-048 | none | unowned | none | documented in the handoff (Onboarding acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-049 | `src/engine/git.mjs` | unowned | none | `test/github-detect.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-050 | none | unowned | none | documented in the handoff (Onboarding acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-051 | none | unowned | none | documented in the handoff (Onboarding acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-052 | `src/engine/secrets.mjs` | unowned | none | `test/leak-scan.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-053 | none | unowned | none | documented in the handoff (Onboarding acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-054 | none | unowned | none | documented in the handoff (Onboarding acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-055 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-056 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-057 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-058 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-059 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-060 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-061 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-062 | none | unowned | none | documented in the handoff (Lead agent acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-063 | `src/engine/setup-channel.mjs` | unowned | none | `test/installers.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-064 | `package.json` | unowned | none | `test/installers.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-065 | none | unowned | none | documented in the handoff (Release acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-066 | `package.json` | unowned | none | the documented suite runs via the package.json test script; baseline in BASELINE.md | EXISTS_AND_VERIFIED |
| SO-REQ-067 | none | unowned | none | documented in the handoff (Release acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-068 | `package.json` | unowned | none | `test/version-single-source.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-069 | `package.json` | unowned | none | `test/proofline-flow.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-070 | `src/engine/vault.mjs` | unowned | none | `test/upgrade.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-071 | none | unowned | none | documented in the handoff (Release acceptance criteria); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-072 | `docs/scope-one/BASELINE.md` | SO-T-A | none | `test/scope-one-record.test.mjs` | EXISTS_AND_VERIFIED |
| SO-REQ-073 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-074 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-075 | `src/engine/secrets.mjs` | unowned | none | `test/leak-scan.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-076 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-077 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-078 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-079 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-080 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-081 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-082 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-083 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-084 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-085 | none | unowned | none | documented in the handoff (Builder handoff checklist); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-086 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-087 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-088 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-089 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-090 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-091 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-092 | `src/engine/quality.mjs` | unowned | none | `test/memory-quality.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-093 | `src/engine/bus.mjs` | MEM-031 | none | `test/bus.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-094 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-095 | `src/engine/entitlements.mjs` | unowned | none | `test/protect.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-096 | `src/engine/setup-channel.mjs` | unowned | none | `test/installers.test.mjs` | EXISTS_BUT_INCOMPLETE |
| SO-REQ-097 | none | unowned | none | documented in the handoff (The finished Scope One system); no implementation in the tree | DOCUMENTED_ONLY |
| SO-REQ-098 | `test/fail-paths.test.mjs` | MEM-100 | none | `test/fail-paths.test.mjs` | EXISTS_BUT_INCOMPLETE |
