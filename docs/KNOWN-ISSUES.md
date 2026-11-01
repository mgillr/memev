# Known issues and preview limits

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

**Status: invited Free Core preview.** This page records the limits testers must account for. It is not a promise that planned features are available.

## Free Core boundaries

- The preview is for one person and one computer at a time. Do not mount one vault for concurrent writers on multiple computers or run multiple daemon instances against the same vault.
- Multi-computer concurrent editing, hosted company vaults, team administration, SSO, Business and Corporate services are not included in this preview.
- Federation is not an operational product capability. Signed contributions, local admission, relationship records and policy gates are foundations only; there is no complete inter-node transport or deployment.
- The paid convergence engine is a separate, licensed component. It is not included in Free Core and must not be assumed available because the client boundary exists in the repository.
- ProjectStore, Coordinator and contract-verification capabilities exist in the local engine. The availability and maturity of user-facing project-management workflows depend on the exact build; do not assume every planned screen, integration or workflow is shipped.

## Platform and installation limits

- Node.js 22 or newer is required.
- The first cohort should prioritise macOS and Linux. Windows remains exploratory preview testing; report the exact Windows version and environment.
- Installation can configure detected AI clients. Use a dedicated test OS account or VM. Add `--no-connect` to `memev init` if you want to inspect the installation before allowing it to modify AI-client configuration; you can connect one app later with `memev connect <app>`.
- The standard init flow can install a login service. Use `--no-service` for a temporary test setup that does not register automatic login startup.

## Data and remote-feature limits

- Treat this as pre-release software. Use synthetic or non-sensitive test data and keep independent copies of anything you cannot afford to lose.
- Do not use employer, customer, patient, regulated, confidential or production data.
- GitHub backup is optional and must be configured deliberately against a private repository you control. It is not multi-writer synchronisation; do not use it for concurrent edits from multiple computers.
- Remote/cloud connectivity is opt-in. Keep it disabled unless a test explicitly covers it, and never share connector URLs, credentials or diagnostic bundles containing private information.
- The repository is private and the preview is invite-only. There is no public package-registry installation path for this cohort.

## Reporting

Report reproducible defects through the **Free Core bug report** issue form and general outcomes through **Free Core feedback**. Include the exact commit SHA, OS, Node version and AI-app version. Redact local paths, usernames, vault contents, prompts, credentials and connector URLs.

Suspected security vulnerabilities must be reported privately using [SECURITY.md](../SECURITY.md), not through a public issue.
