# Contracts

A contract is a signed statement of what a piece of work must deliver: tasks, acceptance criteria
with checks a machine can run, and stop rules. Memev includes a modified copy of Proofline
(`vendor/attest`, Apache-2.0) for drafting, decomposing and verifying them.

## Opt-in

Contracts are off by default for new installs. When they are off, build requests get no contract
nudge and the Stop hook never blocks on a contract. Existing vaults (created before the opt-in)
keep contracts on.

```sh
memev contracts on      # turn contracts on
memev contracts off     # turn contracts off
memev contracts status  # show whether contracts are on or off
```

## "I have a project, build me X"

Nothing for the user to do. When a prompt asks for something to be built, the session is told (by
the prompt hook in hooks-mode apps, by the MCP instructions everywhere) to:

1. **Infer the requirements** from the conversation and call `memev_contract_from_request` with
   them. Each requirement carries a check that runs on this machine: a file that must exist, a
   command that must exit 0, a pattern a file must contain, a test file. A requirement without a
   check gets the project's own test command (`npm test`, `pytest`, `cargo test`, `go test`,
   `make test`) when there is one; otherwise the draft is refused with `needs_checks` and the list of
   requirements to give checks to. Stop rules are added to every task.
2. **Sign it** with `memev_contract_sign`. Signing writes the contract, its DSSE/Ed25519 signature
   and the public key into the vault, records a decision memory ("Signed contract <id> for project <name>"),
   and links the contract in the graph to the project, the conversation that asked for it, and the
   decisions it rests on.
3. **Remember it.** Every session start, including after a compaction, shows the active contract,
   how many tasks pass and which remain.
4. **Verify as it builds.** `memev_contract_verify` re-runs every check, reports PASS/FAIL per task
   and what is left, and appends a receipt to `contracts/receipts/<id>.md`. The work is done only
   when verify says PASS; the session's Stop hook reminds it while its contract is open.
   `memev_contract_status` shows the latest results without re-running anything.

## Local only: no CI

Verification runs on your machine and nowhere else. No task needs a CI run to pass, and Memev never
adds workflow files to your repositories (a GitHub repository is used only to back up the vault).

```sh
memev verify [id]            # verify one contract, or every open one
memev gate [--workdir DIR]   # exit 1 while an open contract for DIR does not verify
memev contract hook [DIR]    # optional: a local git pre-push hook in DIR that runs memev gate
```

## Immutability and versions

Once signed a contract cannot change:

1. the vault refuses writes to `contracts/signed/` and `contracts/keys/` through every route,
2. a git pre-commit hook in the vault refuses commits that change them,
3. the signature fails if a file is edited by hand.

A change of requirements is `memev_contract_amend`: a new draft with `version` N+1 and `supersedes`
pointing at the old one. Once it is signed the old contract shows as superseded; it is never edited
or deleted.

## Other commands

```sh
memev contract list | status [id]
memev contract from-request "build me a CLI that ..." [--project P] [--workdir DIR]
memev contract new spec.json | sign <id> | amend <id> | decompose scope.json
```

The signing key is created on first use in `~/.config/memev/keys/` (readable only by you) and never
leaves the machine.
