# Problems and solutions

People who use AI memory tools complain about the same things again and again. We collected 205
public complaints about memory in ChatGPT, Claude, Gemini, Cursor, mem0, Zep, Basic Memory, Glean,
Microsoft 365 Copilot and others, sorted them into 13 groups, and checked each group against Memev's
code. This page lists every group: why it happens, what Memev does about it, which tier it belongs
to, and the command that proves it works.

The counts come from issue trackers, forums and review sites (about 70% from Hacker News and GitHub),
so they show what those sources say, not how common each problem is everywhere.

Status: "built" means the code and tests are in this repository. "Planned" means it is not built
yet, and nothing on this page claims otherwise.

Many fixes here are things a careful memory tool should do anyway. Where a fix is ordinary, the
"Why it matters for Memev" line says so. The parts that are hard for others to copy are listed at the
end.

## 1. Wrong, junk or stale memories (39 complaints)

**Why it happens.** Memory tools save too much. Most of them tell the model to save anything that
might matter, and nothing checks what gets written. A public audit of one mem0 store found 97.8% of
10,134 entries were junk, and over half of that junk was the model re-saving its own setup
instructions. Memev's own instruction used to say "save a durable memory the moment it surfaces",
which invites the same result. Temporary notes ("for now we skip the tests") are then treated as
permanent.

**What Memev does (built).**
- A quality check runs before every save, on your machine, with fixed rules: no model call, so no
  text leaves the computer to decide what to keep. It refuses acknowledgements ("ok, thanks"),
  heartbeat and cron noise, fragments under three words, and duplicates of anything already in
  memory, and it says why. `force` saves a refused memory anyway, marked as forced.
- Notes that read as short-lived get a review date. After it they drop out of recall unless someone
  keeps them. You can also set the date yourself (`--review-by 2026-12-01` or a number of days).
- Hedged notes ("maybe", "I think") and near-duplicates are flagged for review.
- `memev review` (and the `memev_review` tool) lists flagged and expired memories; `keep` and `drop`
  are recorded in the log. The note itself is never edited, so nothing is lost.
- `memev audit` (and `memev_audit`) reports what the check would refuse today, duplicates, expired
  notes, hedged notes, memories never recalled after 30 days and memories rated unhelpful. It changes
  nothing.
- The instruction Memev gives every AI app now asks for memories that will still matter in a later
  session, with the reason, and says that greetings and status updates will be refused.

**Why it matters for Memev.** Filtering junk is basic hygiene and other tools do it too. What is
different is that the check is local and explains itself, and that a dropped memory stays in the log
and in git, so a mistake can be undone.

**Limit.** A restatement in different words gets through (it is flagged as similar, not refused).
Comparing new memories against what Memev itself showed the session is planned.

**Tier.** Free.

**Done check.** `node --test test/memory-quality.test.mjs` (gate, review dates, inbox, audit).

## 2. Forgetting across sessions and after compaction (24)

**Why it happens.** Apps compact long conversations and drop what was decided. Instruction files
such as `CLAUDE.md` are read once and fade.

**What Memev does (built).** In apps with hooks (Claude Code, Codex, Gemini CLI) Memev injects a
resume card at session start, adds relevant memories to each prompt and saves a checkpoint before
compaction. Cursor has hooks at session start only. Claude Desktop, Windsurf, VS Code and Zed get the
same steps as MCP instructions, which work only if the model follows them.

**Planned.** A published benchmark of how much each app keeps across a compaction, and a way to keep
the current task visible in apps without hooks.

**Why it matters for Memev.** One memory that every app reads at the right moments is the main
reason to use Memev at all. Vendors have little reason to build memory that works across their
competitors' apps.

**Tier.** Free.

**Done check.** `node --test test/continuity.test.mjs`.

## 3. Privacy: data leaving, and recalled text going to the cloud (18)

**Why it happens.** Most memory products are cloud services. Even a local tool sends what it recalls
to whichever cloud model the app uses.

**What Memev does.**
- Built: no telemetry, no runtime dependencies, the daemon listens on `127.0.0.1` only, files are
  readable only by you, and every remote request needs a per-device token and is logged.
- Built: an organisation install (`memev init --org`) starts with the tunnel off, and switching it on
  needs `memev cloud on --yes`. Personal installs keep the tunnel on by default, as before.
- Planned for the Business tier: labels on notes, rules for what each kind of client may receive,
  pseudonymising names and amounts before they go to a cloud model, and a log of every byte returned
  to a non-local client.

**What Memev cannot do.** Once text reaches a cloud model, Memev has no control over it. Protection
there is a contract with the provider, not a technical guarantee.

**Tier.** Free for the local guarantees; Business and Enterprise for labels, egress rules and the
egress log.

**Done check.** `node --test test/memory-quality.test.mjs` (the `--org` test) and
`node --test test/http.test.mjs` (remote rules).

## 4. Reliability, setup and capacity (26)

**Why it happens.** Memory tools often need a database, an API key and a cloud account, and they
slow down as memory grows.

**What Memev does (built).** One command sets everything up. `memev doctor` checks and repairs the
install. A growth benchmark replays 170 million tokens of use: the heap peaks at 160 MB, recall takes
1.1 ms at the median, and every note rebuilds byte-identical from the log.

**Planned.** A public list of known issues and long soak tests on Windows and Linux.

**Tier.** Free. Business support adds response times.

**Done check.** `npm test` and `node --max-old-space-size=256 scripts/growth-bench.mjs`.

## 5. Memory scattered across tools (17)

**Why it happens.** Each app keeps its own memory: ChatGPT memory, Claude projects, Cursor rules.

**What Memev does (built).** Eight local apps and any cloud app that takes an MCP URL share one
vault. It is plain Markdown in git, so you can read it and take it with you.

**Planned.** One rules file that Memev writes into `CLAUDE.md`, `AGENTS.md` and Cursor rules for you.

**Why it matters for Memev.** Basic Memory and OpenMemory share the idea. Memev's difference is the
hooks in each app and the tests behind them.

**Tier.** Free.

**Done check.** `node --test test/clients.test.mjs`.

## 6. Memory bleeding across projects (11)

**Why it happens.** Most tools have one pool of memory. Memev used to rank the current project
higher but still return other projects' notes.

**What Memev does (built).** When recall has a project (the hooks pass the project from the working
folder), it searches only that project's notes and notes that belong to no project. Other projects'
notes are filtered out before ranking. `all_projects` (or `--all-projects`) widens the search and
ranks the current project first, as before. The resume card uses the same rule.

**Measured.** On a 15,600-section test vault where projects share most of their words, the old boost
already kept other projects out of the top four. When a query named something that belonged to
another project, the boost returned that project's notes every time; the hard scope returned none.
So the value is a guarantee, not a better average.

**Limit.** Project names written only in non-Latin scripts still map to the same file name; see
the planned list.

**Tier.** Free.

**Done check.** `node --test test/memory-quality.test.mjs` (project scope test).

## 7. Rules and instructions ignored (16)

**Why it happens.** A model can always ignore an instruction, and instructions fade after compaction.

**What Memev does (built).** Hooks repeat the relevant context on every prompt and after compaction.
For work that must meet requirements, Memev turns the request into a signed contract with checks
that run on your machine, and the work counts as done only when the checks pass.

**Tier.** Free.

**Done check.** `node --test test/proofline-flow.test.mjs`.

## 8. Shutdowns and removed features (9)

**Why it happens.** Rewind was shut down after its acquisition. Cursor removed its Memories UI.
Users lost what they had stored.

**What Memev does (built).** The vault is Markdown in your own git, under Apache-2.0, with no
server Memev depends on. If Memev stopped tomorrow your memory would still be readable files.

**Planned for business buyers.** Source escrow and a written succession plan.

**Tier.** Free; escrow is an Enterprise option.

**Done check.** `memev selftest`.

## 9. Can't see, explain, edit or undo memory (13)

**Why it happens.** Users can't tell which memory shaped an answer, and deleted memories come back.

**What Memev does (built).**
- `memev why "<query>"` (and `memev_why`) shows, for each result, the words that matched and their
  share of the score, the project and feedback weights, the review state and how often it was used
  before. With `--item path#heading` it also says why a note was *not* returned (another project,
  dropped, past its review date, no matching words) and where it came from: every write and commit.
- Recall is keyword-based, so this is exact: the parts multiply back to the score. On a test vault
  with 15,600 sections, all 600 explained results matched their recall score.
- Every change is a record in an append-only log and a git commit. A dropped memory is a log record,
  not an erased one.

**Why it matters for Memev.** Several open memory servers can explain their recall too. Memev ties
the explanation to the log and git history, so you can see who wrote a memory and when.

**Planned.** A small read-only web view of the vault.

**Tier.** Free.

**Done check.** `node --test test/memory-quality.test.mjs` (the `why` test).

## 10. Permissions and oversharing (8)

**Why it happens.** Enterprise search tools index everything a service account can see, and
Microsoft's own guidance calls oversharing the largest risk in a Copilot rollout.

**What Memev does.**
- Built: tokens can be limited to paths, and recall filters by those paths before ranking.
- Built: the knowledge graph (`memev_graph`, `memev_explain`) now hides people, projects and terms
  that appear only in notes the token may not read. Before this change those names could leak
  through the graph.
- Planned: departments, roles and path grants with deny by default, a separate index and graph per
  scope, and "restricted" notes that only a local model may receive.

**Tier.** Business and Enterprise for roles and scopes.

**Done check.** `node --test test/memory-quality.test.mjs` (graph path test).

## 11. No multi-user, SSO or login when self-hosted (10)

**Why it happens.** Self-hosted AI tools often start single-user with authentication off.

**What Memev does.** Built: every computer and app has its own credential, which can be revoked.
Planned: a company hub, sign-in with Google or Microsoft Entra ID, a member list from an org chart,
and offboarding.

**Tier.** Business and Enterprise.

**Done check.** `node --test test/licensing.test.mjs` (device credentials). The hub has no check yet
because it does not exist yet.

## 12. Price and access for small companies (9)

**Why it happens.** Enterprise knowledge tools sell to large companies. One review says vendors
ignore firms under 50 people.

**What Memev does.** One person on one computer gets all of Memev for free, for good
([CHARTER.md](../CHARTER.md)). Team, Office, Business and
Enterprise are priced on request; see [PRICING.md](PRICING.md) and [tiers/](tiers/README.md).

**Tier.** All.

## 13. English-only search (5)

**Why it happens.** Memev's old tokenizer kept only `a-z`, `0-9` and a few symbols, so Chinese,
Japanese, Korean, Cyrillic, Greek and Arabic text was never indexed, and accented words were split
in two. mem0 and Supermemory have open issues about the same problem.

**What Memev does (built).** Words are split by Unicode letter and digit, so every script is
indexed. Accents on Latin and Greek letters are folded (café matches cafe). Chinese, Japanese and
Korean runs are indexed as single characters plus overlapping pairs, so 東京 matches without a
dictionary. ASCII text splits exactly as before. The index format version went up, so an existing
vault reindexes once on its next start.

**Measured.** 26 test queries in 9 scripts: the old tokenizer matched 1, the new one returns the
right note first for all 26. Indexing speed: about 17 million characters a second for ASCII and 6
million for mixed scripts.

**Planned.** Optional local embeddings through Ollama, for paraphrases.

**Tier.** Free.

**Done check.** `node --test test/memory-quality.test.mjs` (tokenizer tests).

## Also found and fixed

Two memories saved in the same minute by the same app used to get the same heading, and the heading
is how review, feedback and `why` name a memory. A second memory in the same minute now gets a
number (`· 2`).

## What sets Memev apart

Most fixes above are ordinary. A few things would be hard for a competitor to copy.

It works across vendors: one memory for Claude Code, Codex, Gemini CLI, Cursor and the cloud apps.
The model companies have every reason to keep memory inside their own products.

The hooks are tested in each app, so context arrives at session start, on each prompt and after a
compaction without the user asking.

There is a record you can audit. The append-only log, git history, provenance, claims with a status
and signed contracts mean every recall can be explained and every change traced.

The decisions stay on your machine. The quality check, the explanations and the project scope need
no model call and no server.

For companies of 10 to 100 people, a self-hosted memory is planned with permissions that follow the
org chart, sensitive departments kept on a local model, and a log of what leaves. See
[tiers/](tiers/README.md).

## Planned work in order

| Item | Tier | Status |
|---|---|---|
| Compare new memories against what Memev showed the session (catches restatements) | Free | planned |
| Count a repeated save as confirmation instead of discarding it | Free | planned |
| Compaction benchmark across apps | Free | planned |
| One rules file written into every app's instruction file | Free | planned |
| Project names in any script (today non-Latin names share a file name) | Free | planned |
| Local read-only web view | Free | planned |
| End-to-end encrypted sync between your computers | Personal | planned |
| Company hub, org chart import, roles and path grants | Business | planned |
| Sign-in with Google or Microsoft Entra ID, offboarding | Business | planned |
| Labels, egress rules, egress log, pseudonymising for cloud models | Business | planned |
| High availability, air-gapped install, SIEM export, retention and legal hold | Enterprise | planned |

The signed contract for this work, its public key and the receipt from its verification run are
in [contracts/](../contracts/). It was drafted with `memev contract new` and signed with
`memev contract sign`.
