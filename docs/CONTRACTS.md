# Contracts

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A contract is a signed statement of what a piece of work must deliver: tasks, acceptance criteria
with checks a machine can run, and stop rules. Memev includes a modified copy of Proofline
(`vendor/attest`, Apache-2.0) for drafting, decomposing and verifying them.

## Opt-in

Contracts are off by default for new installs. When they are off, the Stop hook never blocks on a
contract. Existing vaults (created before the opt-in) keep contracts on.

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

## Remote signing and local approval

A contract can be signed from a remote origin (through the tunnel). The signed contract records
its origin. While a remote-signed contract is not yet approved, its command criteria are blocked
on this machine: `memev_contract_verify` reports them as BLOCKED, and the resume card does not
solicit a verify. A local operator approves it with:

```sh
memev contract approve <id>  # allow a remote-signed contract's commands to run here
```

After approval, the contract verifies normally. File-existence and grep criteria are always
confined to the vault root; paths that escape it are refused.

## Immutability and versions

Once signed a contract cannot change:

1. the vault refuses writes to `contracts/signed/` and `contracts/keys/` through every route,
2. a git pre-commit hook in the vault refuses commits that change them,
3. the signature fails if a file is edited by hand.

A change of requirements is `memev_contract_amend`: a new draft with `version` N+1 and `supersedes`
pointing at the old one. Once it is signed the old contract shows as superseded; it is never edited
or deleted.

## Red-team records

Before a contract spec is signed, a reviewer attacks it in rounds, and the red-team gate checks the
record of those rounds:

```sh
node scripts/gate/redteam-gate.mjs [spec.json ...]   # one line per spec; exit 0 only when every spec is SIGNABLE
node scripts/gate/redteam-gate.mjs --report          # also checks contracts/signed/; fails only on a broken record
```

With no spec named, the gate reads every spec under `contracts/seed-readiness/specs/` and
`contracts/quality-loop/specs/`. Each line says `SIGNABLE`, `SIGNABLE AT STOP (<n> open items)`,
`NOT SIGNABLE: <reasons>` or `NO RECORD`. The same check is `evaluate()` in
`src/engine/redteam-gate.mjs`.

The record of `contracts/<area>/specs/<id>-*.json` is `contracts/<area>/redteam/<id>.json` (schema
`memev-redteam/1`), with the spec each round reviewed beside it as `<id>.r<n>.spec.json`. A round's
`spec_sha256` is the sha256 of the spec as canonical JSON (sorted keys, no whitespace) with `workdir`
null. A round is of kind `spec` (the default) or `implementation`; it names the commit the reviewer
read (`base_commit`), the files it read with their sha256 (`inputs.files`) and, on the last round, the
kind in the spec's manifest row (`manifest_kind`).

**The stopping rule.** A round is clean when it holds no answer of severity high and every answer is
dispositioned: `added`, with its criterion then in the spec verbatim (task, statement and verifier),
or `rejected` with a reason. When the build or the builder changes what an added answer proposed (the build's name guard rewrites a
test command; an answer is folded in substance), the builder records `folded_as`: the criterion the answer became,
as `{task, statement, verifier}`, and that criterion must be in the spec verbatim instead. A `folded_as` never names a
criterion already verbatim in its round's own snapshot: that answer added nothing, so it is rejected with a reason
instead. Medium and low answers may remain in a clean round, each with its disposition. A spec is SIGNABLE when all of
these hold:

- its last round has verdict `clean`, holds no high answer, and reviewed the spec as it is on disk;
- every answer of every round is dispositioned, and every rejected answer has a reason;
- no round weakens what an earlier one required: no task, criterion, requirement, stop rule or
  dependency removed, no requirement reworded, no statement or verifier key changed, no metric loosened,
  no scope glob added, no workdir set, no criterion made optional, except as an amendment records it;
- every implement task has a mandatory `test_red_green` criterion whose command runs its own test
  file under the test runner, unless the manifest row says `docs` or `evidence`: one command of it is
  `node` with `--test` and, as an argument, the test file, a glob that matches it, or `{test}`. A command
  that only names the file (`test -f`, `cat`, `grep`, `true`) does not count;
- since the reviewed commit, no file in the spec's scope and no listed input under `src/` changed.
  This is judged at HEAD for a spec not yet signed, and at the commit that signed the contract for one
  that is signed, so the signed contract's own work never makes it stale.

**Amendments.** A change between two snapshots is accepted only when the later round's `amendments`
list records it with a citation, and the next round judges whether it weakens:

- a requirement reworded: `{task, field: "requirement", from, to, <citation>}`;
- a criterion's statement rewritten: `{task, field: "statement", from, to, <citation>}`;
- any other key of a criterion's verifier changed: `{task, field: "verifier.<key>", statement, from, to,
  <citation>}`, where `statement` names the criterion;
- a command replaced: `{task, statement, from, to, <citation>}` (or with `field: "verifier.cmd"`), where a
  cited answer proposes that criterion;
- a scope path added: `{task, scope_add, answer}`, one path and no glob, citing an added answer of the previous
  round whose criterion reads that path; or `{task, field: "scope", to, <citation>}` with one path, citing as
  any other change;
- a scope glob added: `{task, field: "scope", to, answer}`, accepted only when each cited answer is an added
  answer of the previous round whose criterion reads a path under the glob, and together they read every file
  the glob newly admits at the previous round's reviewed commit, so `**`, `src/**` or `test/**` backed by one
  reading answer is refused (a glob that admits no file there passes); or `{task, field: "scope", to,
  reviewer_note}` citing a signed reviewer note whose text quotes the glob verbatim. The gate checks the quote
  only: the paths the note lists are the reviewer's judgement. Otherwise the added paths are listed one by one.
  A cited answer that carries `folded_as` is judged by that criterion, the one it became;
- a criterion, requirement or stop rule removed: `{task, field: "criterion" | "requirement" | "stop_rule",
  from, to: null, <citation>}`, where `from` is the removed text (a criterion by its statement, or as the
  criterion) and the cited text (a cited answer's `how` or the note point) quotes it verbatim and, in the same
  sentence, names it contradictory or impossible, not negated ("not contradictory" and "is not impossible" do
  not count); or citing a signed reviewer note whose text quotes the removed text verbatim and names where it
  is carried (an added answer whose criterion holds it, or another spec's items). For a reviewer note the gate
  checks the quote only: where the text is carried is the reviewer's judgement;
- a criterion, requirement or stop rule moved alone to another spec: `{kind: "move", task, field, from,
  to_spec, to_task, <citation>}`, accepted only when the receiving task holds it, itself or the end of its
  From/To chain in that spec's own replacements;
- a task moved to another spec at a split: `{kind: "move", task, to_spec, to_task, <citation>}`, accepted
  only when the receiving task holds every requirement, criterion and stop rule of the moved task, itself or
  the end of its From/To chain: the replacements for the moved task in the amendments list that records the
  move (as made at the split), each counted only with its own citation, then the receiving spec's own.

A citation is `answer: "<round>.<n>"`, an answer of the previous spec round or of an implementation round
recorded after it and before the round that cites it; `answer: "<spec>:<round>.<n>"`, an answer of another
spec's record, the spec id resolved through the manifests (never a path) and that record's rounds up to the
cited one each signed by a reviewer key, with the cited answer's disposition covered by the next round's
signature or the closing envelope; `note: "<round>.<point>"`, a numbered point of the previous round's notes;
or `reviewer_note: <n>`, an entry of the record's `reviewer_notes` list. Each reviewer note is `{n, text,
sig}`, where `sig` is a reviewer key's DSSE envelope over `{spec_id, n, text}`, so every citation rests on a
reviewer key's signature. A cited answer must be added, and it must concern the
change: an answer of the same task and, for a criterion, one whose criterion has the statement the changed
criterion had before the change (an answer of another spec's record folded into this spec is judged by the
criterion it was folded as). A note point or a reviewer note is judged by its own text.

**Moves.** An added answer whose task moved to another spec at a split is folded as `{spec, task, statement,
verifier}`. The gate resolves the spec id through the manifests under `contracts/` (a row with that id, and
the one spec file of that id in that area), never through a path the record gives. It requires the move
recorded in an amendments list of the record, and the criterion verbatim in that spec, following that spec's
own statement and verifier replacements from what the answer was folded as. The receiving spec's replacements
count only as far as its record verifies: a round's amendments when every round up to the next one is signed by
a reviewer key (or, for the last round, every round signed and its closing envelope valid), and a stop
decision's amendments when the stop is signed by a stop key.

**Signatures.** Each round carries `sig`, a DSSE envelope (`vendor/attest/signature.mjs`) by a
reviewer key over the round without what the builder writes after the reviewer answered (each
answer's disposition, reason and `folded_as`, and the round's `amendments`, `folded` and `closing`),
plus the sha256 of its snapshot file and the previous round in full. A round's dispositions and
amendments are therefore covered by the next round's signature, and those of the last round by its
`closing` envelope: a reviewer key's signature over the spec id, the round number and those
dispositions and amendments. The gate holds the reviewer public keys it accepts, never accepts a key
under `contracts/keys/` (those sign contracts), and refuses an unsigned round, a round signed by any
other key, and any edit to an earlier round, snapshot or disposition after a later round was signed.
Every round's signature counts, the implementation rounds after the last spec round included. A round
whose kind, or whose reviewer part (everything but `sig`, `closing` and the builder's fields), differs in
a later committed version of the record from the version that first committed it is refused as well.

A limit of this setup: while the builder and the reviewer run as one user on one machine, the reviewer key is
readable by both. The signature then makes tampering visible in history, but it is not separation.
Separation comes from a reviewer key the owner holds off the build machine, or from the second human
of SR-9.05.

**The stop decision.** When three rounds have passed and none is clean, the record may end with `stop`:
a decision to sign or to split, an object holding exactly `spec_id`, `spec_sha256` (of the spec on disk),
`decider`, `date`, `decision`, `open` (every answer that is not added, as round and number),
`dispositions` (the sha256 of every round's dispositions and amendments) and, when present, `amendments`.
Its `sig` is a DSSE envelope over that object under the stop's own payload type,
`application/vnd.memev.redteam-stop-sha256`, never the contract payload type, by a key in `STOP_KEYS`: the
stop-decision public keys the gate holds in code, as it holds the reviewer keys (key id 55fada3548cc507e,
whose private half the owner holds), none of them a key the engine's contract signing makes. A contract body
signed through `memev contract sign` is never a stop decision. Its key's `.pub` must also be committed under
`contracts/keys/` at the judged commit (HEAD for a spec not yet signed, the signing commit for one that is
signed): a key only in the working tree never signs a stop. The stop decision
may carry an `amendments` list, which its signature covers; the change from the last spec round's snapshot to
the spec on disk is judged with it, the last spec round being the previous round for its citations. The gate
then prints `SIGNABLE AT STOP (<n> open items)`, and `--report` lists the open items. A stop after fewer than three rounds, signed by any other key, over another spec hash, with an
open list that leaves out an answer that is not added, or followed by a change to any disposition or
amendment, is refused.

**The implementation round.** A round of kind `implementation` reviews the code instead of the spec.
It follows every rule a spec round follows (numbered after the rounds before it, signed by a reviewer
key, every answer dispositioned, clean only when it holds no high answer, dispositions covered by a
closing envelope) and names the commit it reviewed. It judges the code at that commit against the
signed contract and never changes whether the spec is SIGNABLE, apart from its signature: an unsigned
trailing round, or one signed by another key, is refused. For a contract whose record ends with
a stop decision, `memev contract verify` stays BLOCKED until the record holds a clean implementation
round whose reviewed commit has the same in-scope files as the commit being verified (task T2 of
QL-1.01 wires this into verify).

**Signed contracts in `--report`.** Each signed contract is judged against the commit that added what its
record's verdict rests on now: the clean round the record ends with, or its stop decision, never an older
commit whose record held another clean round on the same hash. A signed contract that a later signed version
supersedes (version N+1 whose `supersedes` names it) is listed as superseded, and only the last version of
each chain must equal the spec's drafted tasks and the hash its record makes signable.

Reason codes: `schema`, `spec_id`, `rounds_contiguous`, `last_clean`, `last_high`, `hash`,
`dispositions_all_rounds`, `added_verbatim`, `rejected_reason`, `never_weakens`,
`red_green_required`, `head_stale_src`, `review_sig`, `stop_decision`. Contracts signed before the gate
are listed by hash in `GRANDFATHERED`, and `--report` passes them.

## Other commands

```sh
memev contract list | status [id]
memev contract from-request "build me a CLI that ..." [--project P] [--workdir DIR]
memev contract new spec.json | sign <id> | amend <id> | decompose scope.json
```

The signing key is created on first use in `~/.config/memev/keys/` (readable only by you) and never
leaves the machine.
