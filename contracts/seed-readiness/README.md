# Seed-readiness contracts

Every gap found in the October 2026 investment analysis of Memev is paired with exactly one contract that closes it. When all 85 contracts verify PASS, SR-0.02 (the seed gate) passes.

- `specs/`: one contract spec per file, in the attest/1 task shape that `memev contract new` takes
- `manifest.json`: gap id, repository, cross-contract dependencies and counts for each contract

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
| [SR-0.01](specs/SR-0.01-programme-set-up-evidence-repository.json) | enabler | memev-ops | Programme set-up: evidence repository, contract register and seed-gate script | none |
| [SR-0.02](specs/SR-0.02-seed-gate-every-seed-readiness.json) | G84 | memev-ops | Seed gate: every seed-readiness contract verifies PASS | ALL |
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
| [SR-2.09](specs/SR-2.09-grok-build-it-or-stop.json) | G29 | memev | Grok: build it or stop showing it | none |
| **SR-3** | | | **Convergence engine (paid core)** | |
| [SR-3.01](specs/SR-3.01-engine-decision-what-merges-a.json) | G30 | memev | Engine decision: what merges a note, where it lives, how it is licensed | none |
| [SR-3.02](specs/SR-3.02-an-engine-conformance-suite-in.json) | G31 | memev | An engine conformance suite in the core | SR-3.01 |
| [SR-3.03](specs/SR-3.03-the-text-merge-engine-built.json) | G32 | memev-merge | The text merge engine, built and passing conformance | SR-3.02 |
| [SR-3.04](specs/SR-3.04-several-computers-editing-one-vault.json) | G33 | memev | Several computers editing one vault at once, nothing to resolve | SR-3.03, SR-1.01 |
| [SR-3.05](specs/SR-3.05-one-licence-for-the-engine.json) | G34 | memev | One licence for the engine, stated once | none |
| [SR-3.06](specs/SR-3.06-know-what-the-patents-cover.json) | G35 | memev-ops | Know what the patents cover | none |
| **SR-4** | | | **Hosted services** | |
| [SR-4.01](specs/SR-4.01-one-architecture-for-personal-and.json) | G36 | memev-cloud | One architecture for personal and company data | none |
| [SR-4.02](specs/SR-4.02-a-licence-server-that-issues.json) | G37 | memev-cloud | A licence server that issues and activates licences | SR-4.01, SR-9.03 |
| [SR-4.03](specs/SR-4.03-end-to-end-encrypted-sync.json) | G38 | memev-cloud | End-to-end encrypted sync between one person's computers | SR-4.01, SR-3.04 |
| [SR-4.04](specs/SR-4.04-a-hosted-relay-with-a.json) | G39 | memev-cloud | A hosted relay with a stable address | SR-4.01, SR-4.02 |
| [SR-4.05](specs/SR-4.05-hosted-encrypted-backup.json) | G40 | memev-cloud | Hosted encrypted backup | SR-4.03 |
| [SR-4.06](specs/SR-4.06-run-the-hosted-services-like.json) | G41 | memev-cloud | Run the hosted services like a business | SR-4.02, SR-4.03, SR-4.04 |
| **SR-5** | | | **Monetisation** | |
| [SR-5.01](specs/SR-5.01-people-can-pay-live-checkout.json) | G42 | memev-cloud | People can pay: live checkout, webhook, licence by email | SR-4.02, SR-9.01, SR-9.02 |
| [SR-5.02](specs/SR-5.02-the-business-trial-can-actually.json) | G43 | memev | The Business trial can actually start | SR-4.02, SR-7.02 |
| [SR-5.03](specs/SR-5.03-referral-credit.json) | G44 | memev-cloud | Referral credit | SR-5.01 |
| [SR-5.04](specs/SR-5.04-paid-tiers-sell-only-what.json) | G45 | memev | Paid tiers sell only what is built, on every surface | none |
| [SR-5.05](specs/SR-5.05-a-rate-card-for-business.json) | G46 | memev-ops | A rate card for Business and Corporate | SR-7.13 |
| [SR-5.06](specs/SR-5.06-support-the-company-can-actually.json) | G47 | memev-ops | Support the company can actually deliver | none |
| **SR-6** | | | **Distribution and go-to-market** | |
| [SR-6.01](specs/SR-6.01-the-repository-goes-public.json) | G48 | memev | The repository goes public | SR-1.20, SR-9.01 |
| [SR-6.02](specs/SR-6.02-npx-memev-init-works.json) | G49 | memev | npx memev init works | SR-6.01 |
| [SR-6.03](specs/SR-6.03-installers-and-a-container-anyone.json) | G50 | memev | Installers and a container anyone can fetch | SR-6.01 |
| [SR-6.04](specs/SR-6.04-listed-where-people-look-for.json) | G51 | memev | Listed where people look for MCP servers | SR-6.02 |
| [SR-6.05](specs/SR-6.05-a-site-that-leads-to.json) | G52 | memev-site | A site that leads to the product | SR-6.02 |
| [SR-6.06](specs/SR-6.06-the-site-says-only-what.json) | G53 | memev-site | The site says only what is true | SR-5.04 |
| [SR-6.07](specs/SR-6.07-one-positioning-chosen-and-used.json) | G54 | memev-ops | One positioning, chosen and used everywhere | none |
| [SR-6.08](specs/SR-6.08-proof-that-people-use-it.json) | G55 | memev-ops | Proof that people use it | SR-6.02, SR-6.04, SR-6.05 |
| [SR-6.09](specs/SR-6.09-a-name-the-company-can.json) | G56 | memev-ops | A name the company can own | none |
| **SR-7** | | | **Business tier** | |
| [SR-7.01](specs/SR-7.01-a-company-vault-european-works.json) | G57 | memev-org | A company vault European works councils will accept | none |
| [SR-7.02](specs/SR-7.02-a-company-server-with-accounts.json) | G58 | memev-org | A company server with accounts | SR-7.01, SR-4.01 |
| [SR-7.03](specs/SR-7.03-members-keys-and-invites.json) | G59 | memev-org | Members, keys and invites | SR-7.02 |
| [SR-7.04](specs/SR-7.04-promote-up-company-knowledge-down.json) | G60 | memev-org | Promote up, company knowledge down | SR-7.03, SR-3.03 |
| [SR-7.05](specs/SR-7.05-an-admin-console.json) | G61 | memev-org | An admin console | SR-7.04 |
| [SR-7.06](specs/SR-7.06-offboarding-inside-the-time-the.json) | G62 | memev-org | Offboarding inside the time the site promises | SR-7.03 |
| [SR-7.07](specs/SR-7.07-sign-in-with-google-workspace.json) | G63 | memev-org | Sign in with Google Workspace and Microsoft Entra ID | SR-7.02 |
| [SR-7.08](specs/SR-7.08-roles-and-path-grants-from.json) | G64 | memev-org | Roles and path grants from the org chart | SR-7.04 |
| [SR-7.09](specs/SR-7.09-control-what-reaches-the-ai.json) | G65 | memev-org | Control what reaches the AI provider | SR-7.08 |
| [SR-7.10](specs/SR-7.10-one-ai-provider-per-organisation.json) | G66 | memev-org | One AI provider per organisation | SR-7.09 |
| [SR-7.11](specs/SR-7.11-a-business-trial-that-starts.json) | G67 | memev-org | A Business trial that starts in minutes | SR-7.02, SR-5.02, SR-4.06 |
| [SR-7.12](specs/SR-7.12-the-agent-coordination-control-plane.json) | G68 | memev-org | The agent coordination control plane | SR-7.04, SR-7.08 |
| [SR-7.13](specs/SR-7.13-two-design-partners-in-regulated.json) | G69 | memev-ops | Two design partners in regulated SMEs | SR-7.01 |
| **SR-8** | | | **Corporate tier** | |
| [SR-8.01](specs/SR-8.01-high-availability.json) | G70 | memev-org | High availability | SR-7.05 |
| [SR-8.02](specs/SR-8.02-an-air-gapped-package.json) | G71 | memev-org | An air-gapped package | SR-7.10 |
| [SR-8.03](specs/SR-8.03-scim-provisioning.json) | G72 | memev-org | SCIM provisioning | SR-7.07 |
| [SR-8.04](specs/SR-8.04-audit-export-retention-and-legal.json) | G73 | memev-org | Audit export, retention and legal hold | SR-7.09 |
| [SR-8.05](specs/SR-8.05-source-escrow-and-a-succession.json) | G74 | memev-ops | Source escrow and a succession plan | SR-9.01 |
| [SR-8.06](specs/SR-8.06-a-services-catalogue-matched-to.json) | G75 | memev-ops | A services catalogue matched to capacity | SR-9.05 |
| **SR-9** | | | **Company, legal and team** | |
| [SR-9.01](specs/SR-9.01-a-legal-entity-with-a.json) | G76 | memev-ops | A legal entity with a published imprint | none |
| [SR-9.02](specs/SR-9.02-terms-privacy-policy-and-dpa.json) | G77 | memev-ops | Terms, privacy policy and DPA | SR-9.01 |
| [SR-9.03](specs/SR-9.03-the-vendor-signing-key-is.json) | G78 | memev-ops | The vendor signing key is safe and recoverable | none |
| [SR-9.04](specs/SR-9.04-a-founder-committed-full-time.json) | G79 | memev-ops | A founder committed full time, and a focused portfolio | none |
| [SR-9.05](specs/SR-9.05-a-second-engineer-and-two.json) | G80 | memev | A second engineer and two-person review | SR-9.01, SR-1.09 |
| [SR-9.06](specs/SR-9.06-commercial-experience-on-the-team.json) | G81 | memev-ops | Commercial experience on the team | SR-9.01 |
| [SR-9.07](specs/SR-9.07-the-company-owns-its-ip.json) | G82 | memev-ops | The company owns its IP | SR-9.01, SR-3.05 |
| [SR-9.08](specs/SR-9.08-a-data-room-an-investor.json) | G83 | memev-ops | A data room an investor can work from | SR-9.07, SR-6.08, SR-5.05 |
