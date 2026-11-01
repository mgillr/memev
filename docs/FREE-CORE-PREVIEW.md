# Free Core Preview

**Status: closed preview. Not a general release.**

[Documentation index](README.md) · [Known issues and preview limits](KNOWN-ISSUES.md)

This guide is for invited testers evaluating the free, single-person, single-computer Memev core. The purpose of this cohort is to validate installation, day-to-day reliability, AI-tool integration, coordination, local contracts and recovery on real supported setups.

Memev is operating infrastructure for human and AI work. It provides a local foundation for project context, tool coordination, governed work and evidence. The vault is one part of that foundation; this preview is not a claim that every planned team, multi-computer or federated capability is available.

## What is included in this preview

The free core is intended for one person using one computer at a time:

- A local vault, durable records, recall, graph, claims and provenance.
- Supported AI-app integrations through MCP and hooks.
- The local communications bus for connected AI-app seats.
- Work contracts and local checks.
- Local status, diagnostics and recovery tools, including `memev doctor`.
- Optional backup to a private GitHub repository that you control.

The free core does not require a Memev account, subscription or licence. It does not include simultaneous multi-computer editing, multi-user administration, a hosted company vault, paid convergence services or operational federation. Those capabilities must not be assumed to work because related interfaces, specifications or foundations exist in the repository.

## Before you install

1. **Use a dedicated test computer, OS account or disposable VM where possible.** Do not replace an existing Memev installation or point this preview at an existing vault.
2. Use Node.js 22 or newer and Git. Docker is not required for the basic local installation. The first cohort should prioritise macOS and Linux; Windows is still labelled preview in the installation documentation and should be treated as exploratory testing, not as a supported release path.
3. Do not use customer, employer, patient, regulated, confidential or otherwise sensitive data in this preview. Use synthetic or non-sensitive test projects.
4. Do not connect a work GitHub account or repository. If you test backup, create a separate private throwaway repository.
5. Keep the secure remote link off unless a test specifically requires it. Do not expose a local daemon or share connector URLs and tokens.
6. Treat this as pre-release software. Keep independent copies of anything you cannot afford to lose.

Memev states that it has no telemetry by default. The network activity described in [Security](../SECURITY.md) and the relevant feature documentation still applies; read it before enabling optional remote features.

## Install

You must have been granted access to the private GitHub repository by the Memev maintainer.

```sh
# Replace OWNER and REPOSITORY with the values from the GitHub Code menu.
git clone https://github.com/OWNER/REPOSITORY.git
cd memev
node --version
git --version
git rev-parse HEAD
npm install -g .
memev init --local-only --no-service
```

Use a new, empty vault location if the installer offers a choice. Do not point it at another vault. This starts the daemon for the test session but does not register a login service. The standard init flow may configure detected AI clients; use a dedicated test OS account, or add `--no-connect` if you want to connect one client manually after inspecting the setup. See [AI app integrations](CLIENTS.md).

Then run:

```sh
memev status
memev doctor
memev clients
```

Record the output of `git rev-parse HEAD` as the build identifier for every report. Save diagnostic output for your test notes, but remove usernames, local paths, tokens, connector URLs and other private details before sharing it.

## First test: local operation

- Confirm that the daemon is running and that `memev doctor` reports its findings.
- Open one supported AI application and confirm its Memev integration is present.
- Ask it to save a harmless test decision or project note.
- Start a separate session or use a second connected AI application and ask it to retrieve that note.
- Check the result in the local vault. Confirm that the content is understandable and that no unrelated content is returned.
- Run `memev doctor` again and record any warnings.

Do not treat a successful installation as proof that every integration works. Record the exact app, version, operating system and Node version for each integration tested.

## Second test: coordination and governed work

Only test these capabilities if they are available in the build you received:

- Check that connected app seats can be identified and that bus messages are attributed to the correct seat.
- Send a harmless test message between two connected seats and confirm that it is visible to the intended recipient.
- Create or inspect a work contract with a clear deliverable and acceptance criteria.
- Confirm that a reported completion is not treated as verified evidence by itself.
- Where the project/task interface is exposed in your build, check that verification is tied to the agreed scope and artifact evidence.

Do not use the preview to authorise real-world actions, execute production changes or approve consequential work.

## Backup and recovery

The free core supports an optional backup to a private GitHub repository that you own. Backup is not enabled by `init --local-only`.

If you choose to test backup:

1. Create a new private repository used only for this preview.
2. Follow [GitHub backup](GITHUB.md) and run `memev github setup`.
3. Confirm that the remote is private and belongs to you.
4. Verify that the expected files are present without making the repository public.
5. Test recovery only into a separate empty directory or disposable environment.

Git backup is a single-writer backup path. Do not use it to edit the same vault concurrently from multiple computers.

Read [Known issues and preview limits](KNOWN-ISSUES.md) before testing.

## What is not in scope for this cohort

- Multiple people sharing one company vault or administrative roles.
- Concurrent writes from multiple computers to one vault.
- Paid multi-computer licensing, hosted sync or paid convergence.
- Production federation between independently governed nodes.
- Business or Corporate trials, billing, SSO or organisation-wide policy.
- A guarantee of production support, uptime or response times.

A specification, API surface, experimental implementation or open pull request is not evidence that a capability is ready for testers.

## Reporting a problem

Use the repository's **Free Core bug report** or **Free Core feedback** issue form. Include:

- Test area and the exact steps you followed.
- Expected result and actual result.
- Memev commit or build identifier, operating system, Node version and AI-app name/version.
- Relevant redacted command output or logs.
- Whether the problem is repeatable and whether restarting or `memev doctor` changes it.

Never include vault contents, prompts, customer data, tokens, private keys, connector URLs, personal access tokens or unredacted diagnostic bundles in a GitHub issue. If you suspect a security vulnerability, follow [SECURITY.md](../SECURITY.md) and report it privately; do not create a public issue.

## What we need from testers

Please report both failures and successful outcomes. In particular, we need to learn:

- Whether a first-time installation is understandable without maintainer assistance.
- Which supported AI-app integrations work reliably in practice.
- Whether notes, project context and coordination remain predictable across sessions.
- Whether diagnostics explain problems clearly enough to recover.
- Which behaviours are confusing, missing or unsafe.
- Whether the product's value is clear as infrastructure for coordinating and governing human and AI work, rather than as a standalone memory utility.

The maintainer will triage feedback and publish updated builds to the cohort when fixes have passed the relevant checks. Please do not assume an issue is fixed until a new build is identified and you have retested it.
