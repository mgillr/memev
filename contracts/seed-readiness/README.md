# Seed-readiness contracts

Every gap found in the October 2026 investment analysis of Memev is paired with exactly one contract that closes it. This repository holds the contracts whose work lands here; the full register of all 85 across the six repositories, and the seed gate SR-0.02, live in the private programme repository (memev-ops).

- `specs/`: one contract spec per file, in the attest/1 task shape that `memev contract new` takes
- `manifest.json`: gap id, repository, cross-contract dependencies and counts for each contract

Repository names are given without the account: all six repositories live under the same GitHub account as this one. SR-2.09 names the provider it concerns by its role (the coming-soon provider), because the vendor name is on this repository's leak denylist; the gap register of the investment analysis names the vendor. The two commands that named the repository (SR-6.01 T1, SR-9.05 T2) resolve it from the checkout they run in (gh repo view with no argument; gh api with {owner}/{repo}), so they run unchanged in any fork.

## Run one

```sh
# in a checkout of the contract's repository; set "workdir" in the spec to that checkout first
memev contract new contracts/seed-readiness/specs/<file>.json
memev contract sign <id>
memev verify <id>
```

All 85 specs pass `vendor/attest` lint with no errors or warnings and were drafted and signed in a throwaway vault before this folder was written.

## Register

| Contract | Gap | Repository | Title | Depends on |
|---|---|---|---|---|
| **SR-0** | | | **Programme control** | |
| **SR-1** | | | **Core engineering hardening** | |
| [SR-1.01](specs/SR-1.01-one-writer-enforced-an-exclusive.json) | G01 | memev | One writer, enforced: an exclusive lock on the vault log | none |
| [SR-1.02](specs/SR-1.02-no-ai-drafted-command-runs.json) | G02 | memev | No AI-drafted command runs without local approval | none |
| [SR-1.03](specs/SR-1.03-replay-protection-that-survives-a.json) | G03 | memev | Replay protection that survives a restart | none |
| [SR-1.04](specs/SR-1.04-cloud-connectors-no-bearer-in.json) | G04 | memev | Cloud connectors: no bearer in the URL, proof of possession | none |
| [SR-1.05](specs/SR-1.05-a-bounded-rate-limiter.json) | G05 | memev | A bounded rate limiter | none |
| [SR-1.06](specs/SR-1.06-one-licence-schema-validated-everywhere.json) | G06 | memev | One licence schema, validated everywhere | none |
| [SR-1.07](specs/SR-1.07-pinned-tls-on-the-relay.json) | G07 | memev | Pinned TLS on the relay and a configured OAuth issuer | none |
| [SR-1.08](specs/SR-1.08-remote-setup-session-allowlist-that.json) | G08 | memev | Remote setup session: allowlist that works, tested like the rest | none |
| [SR-1.09](specs/SR-1.09-code-a-second-engineer-can.json) | G09 | memev | Code a second engineer can read | none |
| [SR-1.10](specs/SR-1.10-a-suite-that-is-green.json) | G10 | memev | A suite that is green on any machine | none |
| [SR-1.11](specs/SR-1.11-memev-stop-always-ends-inside.json) | G11 | memev | memev stop always ends inside its bound | none |
| [SR-1.12](specs/SR-1.12-ci-that-protects-main.json) | G12 | memev | CI that protects main | none |
| [SR-1.13](specs/SR-1.13-performance-numbers-anyone-can-reproduce.json) | G13 | memev | Performance numbers anyone can reproduce | none |
| [SR-1.14](specs/SR-1.14-the-multilingual-claim-runs-in.json) | G14 | memev | The multilingual claim runs in the suite | none |
| [SR-1.15](specs/SR-1.15-no-code-without-a-caller.json) | G15 | memev | No code without a caller | none |
| [SR-1.16](specs/SR-1.16-docs-and-code-say-the.json) | G16 | memev | Docs and code say the same thing | none |
| [SR-1.17](specs/SR-1.17-a-bus-that-scales-to.json) | G17 | memev | A bus that scales to a team | none |
| [SR-1.18](specs/SR-1.18-windows-out-of-preview.json) | G18 | memev | Windows out of preview | none |
| [SR-1.19](specs/SR-1.19-the-lab-plan-is-run.json) | G19 | memev | The lab plan is run, not just written | none |
| [SR-1.20](specs/SR-1.20-external-security-review-before-any.json) | G20 | memev | External security review before any public launch | SR-1.01, SR-1.02, SR-1.03, SR-1.04, SR-1.05, SR-1.07 |
| **SR-2** | | | **Recall and product depth** | |
| [SR-2.01](specs/SR-2.01-recall-that-finds-paraphrases.json) | G21 | memev | Recall that finds paraphrases | none |
| [SR-2.02](specs/SR-2.02-a-public-memory-benchmark.json) | G22 | memev | A public memory benchmark | SR-2.01 |
| [SR-2.03](specs/SR-2.03-every-client-hook-verified-against.json) | G23 | memev | Every client hook verified against the real app | none |
| [SR-2.04](specs/SR-2.04-continuity-measured-in-every-app.json) | G24 | memev | Continuity measured in every app, including those without hooks | none |
| [SR-2.05](specs/SR-2.05-catch-restatements-and-count-confirmations.json) | G25 | memev | Catch restatements and count confirmations | none |
| [SR-2.06](specs/SR-2.06-one-rules-file-for-every.json) | G26 | memev | One rules file for every app | none |
| [SR-2.07](specs/SR-2.07-project-names-in-any-script.json) | G27 | memev | Project names in any script | none |
| [SR-2.08](specs/SR-2.08-a-local-read-only-view.json) | G28 | memev | A local read-only view of the vault | none |
| [SR-2.09](specs/SR-2.09-coming-soon-provider-build-it-or-stop.json) | G29 | memev | The coming-soon provider: build it or stop showing it | none |
| **SR-3** | | | **Convergence engine (paid core)** | |
| [SR-3.01](specs/SR-3.01-engine-decision-what-merges-a.json) | G30 | memev | Engine decision: what merges a note, where it lives, how it is licensed | none |
| [SR-3.02](specs/SR-3.02-an-engine-conformance-suite-in.json) | G31 | memev | An engine conformance suite in the core | SR-3.01 |
| [SR-3.04](specs/SR-3.04-several-computers-editing-one-vault.json) | G33 | memev | Several computers editing one vault at once, nothing to resolve | SR-3.03, SR-1.01 |
| [SR-3.05](specs/SR-3.05-one-licence-for-the-engine.json) | G34 | memev | One licence for the engine, stated once | none |
| **SR-4** | | | **Hosted services** | |
| **SR-5** | | | **Monetisation** | |
| [SR-5.02](specs/SR-5.02-the-business-trial-can-actually.json) | G43 | memev | The Business trial can actually start | SR-4.02, SR-7.02 |
| [SR-5.04](specs/SR-5.04-paid-tiers-sell-only-what.json) | G45 | memev | Paid tiers sell only what is built, on every surface | none |
| **SR-6** | | | **Distribution and go-to-market** | |
| [SR-6.01](specs/SR-6.01-the-repository-goes-public.json) | G48 | memev | The repository goes public | SR-1.20, SR-9.01 |
| [SR-6.02](specs/SR-6.02-npx-memev-init-works.json) | G49 | memev | npx memev init works | SR-6.01 |
| [SR-6.03](specs/SR-6.03-installers-and-a-container-anyone.json) | G50 | memev | Installers and a container anyone can fetch | SR-6.01 |
| [SR-6.04](specs/SR-6.04-listed-where-people-look-for.json) | G51 | memev | Listed where people look for MCP servers | SR-6.02 |
| **SR-7** | | | **Business tier** | |
| **SR-8** | | | **Corporate tier** | |
| **SR-9** | | | **Company, legal and team** | |
| [SR-9.05](specs/SR-9.05-a-second-engineer-and-two.json) | G80 | memev | A second engineer and two-person review | SR-9.01, SR-1.09 |

## Contracts added after the analysis

The engine enabler and the gaps the memev twin measured, approved by the owner on 31 October 2026. Each signs only after a clean red-team round.

| Contract | Gap | Repository | Title | Depends on |
|---|---|---|---|---|
| [SR-0.03](specs/SR-0.03-verify-runs-every-verifier-type.json) | G85 | memev | Verify runs every verifier type the specs use: red-green tests, metrics and scope, behind the same local gates as commands | none |
| [SR-1.21](specs/SR-1.21-a-missing-note-is-never-silent.json) | G86 | memev | A missing note the log cannot rebuild is reported, never silent | SR-1.01, QL-1.02 |
| [SR-1.22](specs/SR-1.22-an-interrupted-write-recovers-from-the-log.json) | G87 | memev | A whole-note write interrupted after the log append recovers from the log, not from the old file | SR-1.01, QL-1.02 |
| [SR-1.23](specs/SR-1.23-verify-sees-a-removed-tail.json) | G88 | memev | verify() catches a removed tail of the active segment and a removed last record of a path | SR-1.01, QL-1.02 |
| [SR-1.24](specs/SR-1.24-no-cli-write-beside-a-live-daemon.json) | G89 | memev | No CLI command writes vault state beside a live daemon | SR-1.01, QL-1.02 |
| [SR-1.25](specs/SR-1.25-a-cloud-seat-addresses-one-local-seat.json) | G90 | memev | A cloud seat allowed to assign tasks addresses one local seat, never all | QL-1.02 |
