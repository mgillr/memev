# Lab test plan

Part of the [Memev documentation](../README.md). Up: the [README](../../README.md).

This is the full test plan for Memev in a lab. Someone who has never seen Memev should be able to
run every test from this page and the two scripts in `scripts/lab/`. Where a feature is not built
yet, the test says **expect: not available**. Record what you see; don't fill in an expected result
you didn't observe.

Contents: 0 rules · 1 lab setup · 2 getting the code · 3 install paths · 4 AI app registration ·
5 CLI commands · 6 features (6.12 is the comms bus) · 7 performance · 8 security · 9 failure and recovery ·
10 Windows 11 (preview) · 11 results.

## 0. Rules

- Test in the lab only: VMs, containers or spare machines. Don't install Memev on a machine where
  someone uses it for real work, and never point a test at an existing vault. Every test below
  creates its own vault with synthetic data.
- Don't push to `main`. If you need to change code to test something, use a branch and say so in
  the report.
- Report each bug as an issue on the Memev GitHub repository with the test id in the title
  (`[LAB T-FEAT-07] recall misses Korean query`), the steps, what you expected and what happened.
- The repository is private. Don't copy it anywhere public, don't make a public fork, and don't paste
  tokens, connector URLs or vault contents into issues.
- Turn off anything that would leave the lab: no real GitHub backup repository unless the test asks
  for one (use a throwaway private repository), and no cloud AI app connected to a lab vault that
  holds anything but synthetic data.

## 1. Lab setup

Every machine needs **Node.js 22 or newer** (`node --version`), **git** and a POSIX shell. Use the
current Node 22 LTS unless a test says otherwise; also run the core tests once on the newest Node
release to catch regressions.

| Lab | Machines | What it tests | Suggested build |
|---|---|---|---|
| L1 Personal | 1 | one person, one computer, every local feature | one macOS machine (13 or newer) and one Ubuntu 24.04 VM, 2 CPUs, 4 GB RAM, 10 GB disk |
| L2 Personal with more computers | 2 or 3 | several computers using one vault through the secure link, per-computer credentials | one host (Ubuntu 24.04 VM or macOS) plus 1 or 2 client VMs; the host needs outbound internet for a quick tunnel, or Tailscale on all of them |
| L3 Business stand-in | about 10 | many computers on one vault, seat counts, `init --org`, path-limited tokens | one host VM (4 CPUs, 8 GB RAM) and 9 clients. Clients can be containers (`node:22` images) on one Docker host; each needs its own credential |
| L4 Corporate stand-in | 3 or more | an organisation server, a local model server, integrations, egress control | an org server VM (`memev init --org`), a model server (Ollama or vLLM on a GPU box, or a small CPU model for a functional check), a client VM, and a firewall or packet capture point between them and the internet |

Have ready before you start:

- Docker 24 or newer with Compose (for the Docker path and container clients).
- At least one AI app on L1, ideally several of Claude Code, Codex CLI, Gemini CLI, Cursor, Claude
  Desktop, Windsurf, VS Code and Zed. If an app isn't installed, the registration test for it can
  still run against an empty config folder (section 4).
- `tcpdump` or Wireshark (Linux), or Little Snitch / `nettop` (macOS), for the egress tests.
- `strace` on the Linux VM (optional, for the per-process egress check).
- A throwaway private GitHub repository and the `gh` CLI, for the backup test only.
- gitleaks 8.30.1 for the security section (the CI workflow shows the pinned checksum).

What is simulated and what isn't: the Business and Corporate parts that are planned (company server
with user accounts and admin console, the provider policy that restricts an organisation to one provider, sign-in with Google or Entra
ID, org chart import, departments and roles, labels, egress log, high availability, the crdt-merge
convergence engine) can't be tested yet. L3 and L4 test
what exists today on that hardware: one vault on a server, many computers with their own
credentials, path-limited tokens standing in for departments, remote access off, and no traffic
leaving the server.

## 2. Getting the code

| ID | Step | Expected |
|---|---|---|
| T-GET-01 | `gh repo view <owner>/memev` (the repository named in your handoff) | the repository shows as private and you have read access. If you get "not found", ask the owner for access |
| T-GET-02 | `gh repo clone <owner>/memev && cd memev && git checkout <commit given in your handoff>` | the commit checks out cleanly |
| T-GET-03 | `npm test` | every test passes, none skipped (the count is printed at the end; record it) |
| T-GET-04 | `node bin/memev.mjs --version` | `0.1.0` |

## 3. Install paths

| ID | Path | Status | Steps | Expected |
|---|---|---|---|---|
| T-INS-01 | From source | works today | in the clone: `node bin/memev.mjs init` | vault in `~/memev`, daemon on `127.0.0.1:7787`, apps connected, checklist printed, self-test passes |
| T-INS-02 | npm from the clone | works today | `npm install -g . && memev init` | same as T-INS-01, plus `memev` on the PATH |
| T-INS-03 | Ask your AI app | works today | in Claude Code, Codex, Gemini CLI or Cursor, paste: "Download the Memev repository, run `node bin/memev.mjs init` inside it, and show me the checklist it prints." (give the app the clone path, since the repository is private) | the app runs init and shows the checklist; same end state as T-INS-01 |
| T-INS-04 | Docker | works today | `sh scripts/docker-smoke.sh` | ends with `docker smoke: ok`; port 7787 bound on `127.0.0.1` only (`ss -ltn` or `lsof -i :7787`); MCP call without a token returns 401 |
| T-INS-05 | `npx memev init` | coming soon | `npm view memev` | expect: not available. The registry answers 404 (no package called `memev`). If a package exists, it isn't ours; don't run it, report it |
| T-INS-06 | One-line installer (macOS, Linux, Windows) | coming soon | look for an install script in the repository and on any project page | expect: not available. There is no install script, and the README lists it as coming soon |

Run T-INS-01 on both macOS and Linux. After each install path, run `memev doctor` and record the
output, then `memev uninstall --purge` before the next one (section 8).

## 4. AI app registration and the doctor

`memev init` registers Memev in every app it finds, with no prompts. Before it changes a file it
saves a copy in `~/.config/memev/backups/`. To test an app that isn't installed, create its config
folder first (for example `mkdir ~/.cursor`) and run `memev connect <id>`.

| ID | App (id) | Files to check after connect | Mode | Expected |
|---|---|---|---|---|
| T-REG-01 | Claude Code (`claude-code`) | `~/.claude.json` has an MCP server `memev`; `~/.claude/settings.json` has SessionStart, UserPromptSubmit, PreCompact and Stop hooks; `~/.claude/CLAUDE.md` has a Memev block | hooks | a new session starts with the resume card; the prompt gets matching memories |
| T-REG-02 | Codex CLI (`codex`) | `[mcp_servers.memev]` in `~/.codex/config.toml`; `~/.codex/hooks.json`; a block in `~/.codex/AGENTS.md` | hooks, trust once | checklist says to trust the hooks in `/hooks` once; after that, same as T-REG-01 |
| T-REG-03 | Gemini CLI (`gemini-cli`) | MCP server and SessionStart, BeforeAgent, PreCompress, AfterAgent hooks in `~/.gemini/settings.json`; a block in `~/.gemini/GEMINI.md` | hooks | same as T-REG-01 |
| T-REG-04 | Cursor (`cursor`) | `~/.cursor/mcp.json`; `~/.cursor/hooks.json` | hooks at session start | resume card at session start; per-prompt recall comes from MCP instructions, not hooks (expected, documented) |
| T-REG-05 | Claude Desktop (`claude-desktop`) | `claude_desktop_config.json` | instructions | Memev tools listed in the app; the app calls `memev_session_start` when it follows server instructions |
| T-REG-06 | Windsurf (`windsurf`) | `~/.codeium/windsurf/mcp_config.json`; a block in `memories/global_rules.md` | instructions | as T-REG-05 |
| T-REG-07 | VS Code (`vscode`) | `Code/User/mcp.json` | instructions | as T-REG-05 |
| T-REG-08 | Zed (`zed`) | `context_servers` in `zed/settings.json` | instructions | as T-REG-05 |
| T-REG-09 | Disconnect | `memev disconnect <id>` for each, with no edits in between | | each file restored byte for byte (`cmp` against the backup or a copy you made before init) |
| T-REG-10 | Disconnect after a user edit | edit an app config after connect, then disconnect | | only the Memev entries go; your edit stays |
| T-REG-11 | A config with comments | add a comment to a JSON config Memev would change, then connect | | Memev's entry is added in place and every comment and the layout survive; `memev disconnect` gives back the original text |
| T-REG-12 | A new app later | with the daemon running, create a new app folder and wait up to 30 minutes, or restart the daemon | | the new app is connected without a command; an app you disconnected yourself is not reconnected |
| T-REG-13 | Doctor, healthy | `memev doctor` | | exit 0; every check is ✓ or a warning with its fix |
| T-REG-14 | Doctor, broken | stop the daemon, or delete a note file, then `memev doctor`, then `memev doctor --fix` | | first run exits 1 and names the problem; `--fix` repairs it; a second `doctor` exits 0 |
| T-REG-15 | Support bundle | `memev doctor --bundle`, then search the bundle for any token (`mv_`) | | the bundle is written and holds no token or key |

## 5. CLI commands

`scripts/lab/cli-walk.sh` runs every everyday command once in a throwaway home folder (no login
service, no tunnel, no download) and checks each exit code. It sets up fake Claude Code, Codex,
Gemini CLI and Cursor folders so registration runs too.

| ID | Step | Expected |
|---|---|---|
| T-CMD-01 | `sh scripts/lab/cli-walk.sh /tmp/memev-walk` | `35 commands, 0 unexpected exit codes`; one output file per command in `/tmp/memev-walk` plus `summary.tsv`. It uses port 7797 (`MEMEV_LAB_PORT` to change) so it can't clash with another install |
| T-CMD-02 | read `C08-remember-junk.txt` | `"refused": true` with a reason |
| T-CMD-03 | read `C09-remember-dated.txt` | saved with `"flags": ["short-lived"]` and a `review_by` date a week out |
| T-CMD-04 | read `C11-recall-other-project.txt` and `C12-recall-all-projects.txt` | the billing decision is missing from the search-project recall and present with `--all-projects` |
| T-CMD-05 | read `C13-why.txt` | each item shows matched words with their share of the score and the project multiplier |
| T-CMD-06 | read `C14-review.txt` and `C15-audit.txt` | the short-lived note is in the review inbox; audit changes nothing |
| T-CMD-07 | read `C17-card.txt` | the resume card shows the checkpoint: task, in progress, next, and "Already done (do not redo)" |
| T-CMD-08 | `memev review keep <item>`, `memev review drop <item>`, `memev review reset <item>` on a short-lived note in your own L1 vault (save one with `memev remember "For now the upload test is skipped" --kind note`) | each prints the decision; the note file itself is not edited |
| T-CMD-09 | `memev init --org --no-connect --port 7798` in a fresh home | output says it is an organisation install; `.memev/config.json` has `"profile": "org"` and remote off |
| T-CMD-10 | then `memev cloud on` | exit 1, asks for `--yes`; remote stays off |
| T-CMD-11 | `memev cloud on --yes`, `memev cloud status`, `memev cloud url`, `memev cloud off` | a tunnel starts (needs internet); `url` prints a connector URL and a plain URL with a header; `off` stops it |
| T-CMD-12 | `memev token issue lab --scopes read`, `token list`, `token rotate <id>`, `token revoke <id>` | the secret is shown once; after rotate the old secret gets 401; after revoke the new one does too |
| T-CMD-13 | `memev devices enroll --kind cloud-connector --label app2`, `devices rename <id> app-two`, `devices rotate <id>`, `devices remove <id>`; then `memev devices enroll --kind remote-computer --label pc2` with no `--pubkey` | each of the first four works and the host can't be removed; the last is refused (exit 1) asking for the computer's device key |
| T-CMD-14 | `memev license status` and `--json` | "Licence: none", "Computers: 1 of 1 enrolled" and the counts; `--json` has `"enforcement": "computers"` and `"seats_licensed": 1` |
| T-CMD-15 | Licence install: `node scripts/license-dev.mjs keygen --out /tmp/lic`, then `node scripts/license-dev.mjs sign --key <private_key_file printed by keygen> --tier team --seats 3 --exp none > /tmp/team.json`, then `memev license install /tmp/team.json`; then `memev license install licences/team-3.json` from the handoff pack | the development licence is refused with "unknown signing key", because only the vendor key built into memev is trusted. The lab licence installs; `license status` shows team, 3 computers, valid |
| T-CMD-16 | `memev license install` a copy of `licences/team-3.json` with `seats` changed to 30, and a file that isn't JSON | exit 1 with a reason ("signature does not verify" or a JSON error); nothing written to `~/.config/memev/license.json` |
| T-CMD-17 | `memev license remove` | "licence removed; nothing changes for the free tier"; `license status` is back to 1 of 1 |
| T-CMD-18 | Upgrade flow: `memev upgrade`, and look for an upgrade or purchase link in `license status` and `doctor` | expect: not available. `memev upgrade` is an unknown command (exit 2) and no command sells anything. Refusals say "contact us" |
| T-CMD-19 | `memev service install`, reboot or log out and in, `memev status`, `memev service remove` | daemon comes back at login (systemd user unit on Linux, launchd agent on macOS); remove takes it away |
| T-CMD-20 | `memev github setup` against a throwaway private repository | deploy key for that repository only, first push works, a later write lands in the repository within minutes |
| T-CMD-21 | `memev github setup` against a public repository | refused |
| T-CMD-22 | `memev onboarding` after a manual step (for example trusting Codex hooks) | the checklist re-checks and the step turns ✓ |
| T-CMD-23 | `memev claims --status fact` | lists only claims with status fact (empty on a fresh vault) |
| T-CMD-24 | `memev start`, `stop`, `restart`, `status`, `serve` (Ctrl-C to end) | each does what it says; `status` exits 1 when stopped |

## 6. Features

Most feature checks have a script that measures them on synthetic data. `node scripts/lab/measure.mjs
--json /tmp/measure.json` takes about 15 seconds, prints its numbers, then one PASS or FAIL line per
target, and exits 1 if any target is missed. Run it on every lab machine.

### 6.1 Search in other scripts

| ID | Step | Expected |
|---|---|---|
| T-FEAT-01 | `measure.mjs`, section `m1_tokenizer` | 26 queries in Chinese (4), Japanese (3), Korean (3), Russian (3), Greek (3), Arabic (3), Hebrew (2), Hindi (2) and accented German and French (3): `new_recall_at_1` is 26 of 26. The old tokenizer column shows 1 of 26, for comparison |
| T-FEAT-02 | by hand: `memev remember "我们决定用东京的服务器部署数据库" --kind decision`, then `memev recall 服务器` | the note is the first hit |
| T-FEAT-03 | `memev remember "Le café naïve est fermé le lundi" --kind fact`, `memev recall naive` | found: accents are folded |
| T-FEAT-04 | a project named in a non-Latin script, `memev checkpoint --project 计费 --task test` | expect: not available as a separate project. Non-Latin project names share a file name today (listed as planned). Record the file it writes to |

### 6.2 The save quality gate

| ID | Step | Expected |
|---|---|---|
| T-FEAT-05 | `measure.mjs`, `m3_gate_labelled` | of 20 junk notes, 15 are kept out: 10 refused (acknowledgements, system noise, a fragment) and 5 short-lived ones get a review date. The other 5 (restatements of who the user is, and "The user said hello") are saved. Of 15 good notes, 0 are refused, dated or flagged |
| T-FEAT-06 | `m3c_restatement` | restating the north star word for word: 5 of 5 caught as duplicates. Reworded: 0 caught as duplicates, 5 of 5 flagged as similar |
| T-FEAT-07 | `memev remember "ok thanks" --force` | saved but flagged |
| T-FEAT-08 | save a note with `--review-by 2020-01-01`, then recall it | it is left out of recall; `memev review keep <item>` brings it back |

### 6.3 Project isolation

| ID | Step | Expected |
|---|---|---|
| T-FEAT-09 | `measure.mjs`, `m2_project_bleed` and `m2b_cross_vocabulary` | with project scope (`hard_scope`), 0 hits from other projects in both runs. Without scope (`boost_only`), the cross-vocabulary run returns other projects' notes, which shows the scope is what stops it |
| T-FEAT-10 | in Claude Code, work in two repositories with different projects; ask in one about a decision made in the other | not recalled unless you ask for all projects |

### 6.4 Graph leak fix and permissions

| ID | Step | Expected |
|---|---|---|
| T-FEAT-11 | `measure.mjs`, `m5_graph_canary` | 20 canary names in notes under `dept/hr/`. Through the unfiltered graph 4 are reachable from shared entities; through a token limited to `dept/eng/**`, 0 |
| T-FEAT-12 | `memev token issue eng --scopes read --paths 'dept/eng/**'`; call `memev_recall`, `memev_graph` and `memev_explain` over MCP with it | nothing from outside `dept/eng/` comes back, by text, by entity name or by path |
| T-FEAT-13 | with a read-only token, call `memev_remember` | refused |

To call MCP tools by hand: `curl -s -X POST http://127.0.0.1:7787/mcp -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memev_recall","arguments":{"query":"..."}}}'`.
`tools/list` gives the full tool list.

### 6.5 Fact, theory and conjecture

Rules: conjecture is speculation or support under 0.5; theory is support of 0.5 or more; fact is
support of 0.85 or more from at least two independent sources with opposition under 0.2;
contested is support and opposition both 0.3 or more; refuted is opposition of 0.6 or more and above
support.

| ID | Step | Expected |
|---|---|---|
| T-FEAT-14 | call `memev_claim` with subject `cache`, predicate `causes`, object `stale reads`, `stance: speculate`, `strength: 0.4` | status conjecture |
| T-FEAT-15 | same claim, `stance: support`, `strength: 0.6` | theory |
| T-FEAT-16 | same claim, `stance: support`, `strength: 0.8`, `path: notes/incident.md` (a second, independent source) | fact; `memev claims --status fact` lists it |
| T-FEAT-17 | same claim, `stance: oppose`, `strength: 0.5` | contested |
| T-FEAT-18 | same claim, `stance: oppose`, `strength: 0.99`, `path: notes/postmortem.md`; then `memev_provenance` for the claim | refuted; the history shows conjecture, theory, fact, contested, refuted and five pieces of evidence. Restart the daemon: the status is the same (rebuilt from the log) |

### 6.6 Compaction continuity

| ID | Step | Expected |
|---|---|---|
| T-FEAT-19 | in Claude Code, start a multi-step task, finish two steps, then run `/compact` | the new context starts with the resume card listing the finished steps under "Already done (do not redo)" and the next step |
| T-FEAT-20 | the same in Gemini CLI (PreCompress) and Codex | same result |
| T-FEAT-21 | start a task in Claude Code, open Cursor in the same project | Cursor's first context has the Claude Code checkpoint |
| T-FEAT-22 | run two apps writing at once for 10 minutes | no lost writes; `memev doctor` shows the log intact |

### 6.7 Proofline contracts

| ID | Step | Expected |
|---|---|---|
| T-FEAT-23 | in a hooks-mode app inside a small project with tests, ask "build me a CLI that prints the date" | the app drafts a contract with checks and signs it; `memev contract list` shows it open |
| T-FEAT-24 | `memev contract from-request "build me ..."` in a folder with no test command and no checks | refused with `needs_checks` and the list of requirements |
| T-FEAT-25 | compact the session halfway through | the resume card shows the contract and how many tasks pass |
| T-FEAT-26 | `memev verify`, `memev gate --workdir <project>` | FAIL and exit 1 while open; PASS and exit 0 when the work is done; a receipt in `contracts/receipts/` |
| T-FEAT-27 | edit a file under `contracts/signed/` by hand; try to commit it in the vault | the signature check fails; the vault's pre-commit hook refuses the commit |
| T-FEAT-28 | `memev contract amend <id>` then sign | version 2 supersedes version 1, which is not edited |
| T-FEAT-29 | through the tunnel with a remote token, call a contract verify that runs a command | the command does not run for a remote caller |
| T-FEAT-30 | look for any `.github/workflows` file in the project after all this | none: Memev never adds CI workflows |

### 6.8 Per-computer licensing

Each added computer has its own device key and the vault refuses computers past the licensed
number. One computer needs no licence. The lab licences are in the handoff pack under `licences/`:
`team-3.json` (3 computers, valid), `team-3-grace.json` (expired, inside its grace period) and
`team-3-expired.json` (past grace). They are signed with the vendor key and hold no personal data.

| ID | Step | Expected |
|---|---|---|
| T-FEAT-31 | L2 with no licence: on pc2 `memev devices keygen`; on the host `memev devices enroll --kind remote-computer --label pc2 --pubkey <key>` | refused, exit 1: "This vault is licensed for 1 computer. Remove one with `memev devices remove <id>` or contact us for more." Then install `licences/team-3.json` on the host and enroll again: works and prints a token. On pc2 `memev join https://<host address> --token <token>`: joins, and an app on pc2 can recall from the host's vault; `memev devices` on the host shows 2 computers |
| T-FEAT-32 | copy pc2's MCP config, `remote.json` and the token to pc3 (but not pc2's key) and use it | expect: pass. pc3 gets 401 `device_key`, "A computer's connection details only work on the computer that holds its device key" |
| T-FEAT-33 | capture one signed request from pc2 (for example with a proxy) and send it again; then paste the host's connector URL into Claude Code or Cursor on pc3 | expect: pass. The replay gets 401; the pasted connector URL gets 403 `connector_on_computer` |
| T-FEAT-34 | `memev devices remove <pc2 id>`, then enroll pc3 with its own key | pc2 and every copy of its config get 401 at once; the seat is free and pc3 enrolls |
| T-FEAT-35 | L3 with `licences/team-3.json`: enroll computers until one is refused; then enroll 9 cloud connectors | expect: pass. The third added computer (fourth in total with the host) is refused with the plain message; `license status` shows "Computers: 3 of 3 enrolled (no more can be added)". Connectors are never refused |
| T-FEAT-36 | install `licences/team-3-grace.json`, enroll one computer and write from it; then install `licences/team-3-expired.json` and try to enroll another, read from an added computer, write from it, and write on the host | expect: pass. In grace: enrolment and writes work, and `license status` notes the days of grace left. Past grace: enrolment is refused ("its grace period is over"), the added computer can read but its write is refused with a message about the expired licence, and the host still reads and writes |

### 6.9 Org structure

| ID | Step | Expected |
|---|---|---|
| T-FEAT-37 | `memev init --org` on the L3 or L4 server | organisation profile, remote access off (T-CMD-09) |
| T-FEAT-38 | stand-in for departments: write synthetic notes under `dept/sales/`, `dept/finance/`, `dept/hr/`, issue one token per department with `--paths`, and recall from each | each token sees only its own folder, in recall and in the graph |
| T-FEAT-39 | org chart import, departments and roles, sign-in with Google or Entra ID, company server with user accounts, admin console | expect: not available (planned) |
| T-FEAT-40 | `memev_graph` and `memev_explain` between two entities in the same department | the path between them and the notes behind it |

### 6.10 No telemetry

| ID | Step | Expected |
|---|---|---|
| T-FEAT-41 | Linux: `sudo tcpdump -i any -nn 'not (host 127.0.0.1 or host ::1)' -w memev.pcap` in one terminal; in another run `sh scripts/lab/cli-walk.sh` (it turns off the tunnel and downloads) | the capture has no packets from Memev. Filter out the VM's own background traffic (DNS for apt, NTP) by checking the process with the next test |
| T-FEAT-42 | Linux: `strace -f -e trace=connect -o connect.txt node bin/memev.mjs init --local-only --no-connect --port 7799` then use it for a few commands | every `connect` in `connect.txt` is to 127.0.0.1, a Unix socket, or nothing |
| T-FEAT-43 | macOS: watch `nettop -p <daemon pid>` or Little Snitch during a session of real use with remote off | no outbound connections |
| T-FEAT-44 | `docker run --rm --network none --entrypoint memev memev:local selftest` | `selftest: ok` with no network at all |
| T-FEAT-45 | known outbound traffic, so you can tell it apart: the tunnel when remote is on, the one-time pinned `cloudflared` download, and git pushes to your backup repository | each happens only when switched on |

### 6.11 Data stays on the server

| ID | Step | Expected |
|---|---|---|
| T-FEAT-46 | L4: org server with `init --org`, no backup set up; block all outbound traffic at the firewall except DNS; use it from a client for an hour | everything works; the firewall log shows nothing from the server leaving |
| T-FEAT-47 | licence checks | made offline, on the machine. Nothing is sent to check a licence. Only `memev license activate <key>` contacts the licence endpoint you configure, once. With outbound blocked, `memev license status` still works |
| T-FEAT-48 | the on-premises LLM option: point the client's AI app at the local model (Ollama or vLLM) and use Memev from it | Memev works the same; recall stays on the LAN. Memev itself doesn't call any model |
| T-FEAT-49 | rules for what reaches the AI provider, labels, egress log, pseudonymising, merging by crdt-merge | expect: not available (planned) |
| T-FEAT-50 | integrations: run a vendor's MCP server (for example a ticketing or database one) next to Memev in the same app | both work side by side. Connectors that bring that data into the vault: expect: not available (planned) |

### 6.12 Comms bus and pulse

How it should work is in docs/BUS.md. Use L1 with at least Claude Code and one other app, and L2 for
the tests that need a second computer. Seats are `<app>@host` on the vault's computer and
`<app>@<computer label>` on a joined one.

| ID | Step | Expected |
|---|---|---|
| T-BUS-01 | L1: `memev init` in a terminal with Claude Code and Cursor installed | init asks "Which AI should lead and coordinate the others?" with both seats and "decide later"; answer Claude Code. The checklist has "Agent comms bus: bus/ set up and committed in the vault; 2 seat(s): claude-code@host, cursor@host" and "Lead AI: claude-code@host leads". `memev bus roster` shows both as never joined |
| T-BUS-02 | open a Claude Code session and say anything; open Cursor and start a chat | without being asked, both join: `memev bus roster` shows them live, and `memev bus tail` has a hello from each, the Claude Code one marked [operator] |
| T-BUS-03 | L2: on pc2, `memev devices keygen`, enroll it on the host with a lab licence, `memev join …` | `join` prints "on the comms bus" with pc2's seats. After an app on pc2 opens a session, the host's roster shows it live with device pc2, and the host's Claude Code session gets pc2's hello at its next prompt |
| T-BUS-04 | `memev devices remove <pc2 id>` on the host | pc2's seats show removed in the roster; anything pc2 sends gets 401 |
| T-BUS-05 | from the Claude Code session: "post a task to cursor@host: list the TODOs in this repo" | the message is marked operator. In Cursor, at the next prompt, the task shows up; Cursor claims it (bus_send claim) and restates it. `memev bus tasks` shows it claimed by cursor@host with the restatement |
| T-BUS-06 | from Cursor, post a task to all; then try to claim the first task from a third app | the Cursor task is marked as an agent request (operator false); the second claim is refused with "already claimed by cursor@host" |
| T-BUS-07 | from the Claude Code session: "put cursor@host on hold", then "lift the hold" | Cursor's next prompt starts with an ON HOLD notice; after the release it is gone. A hold sent by Cursor or another agent changes nothing |
| T-BUS-08 | `memev bus check --timeout 20` with Claude Code in a session, Cursor closed for over 15 minutes and one app never opened | Claude Code answers after its next prompt (or straight away with `memev bus watch`); Cursor is listed "offline: last heartbeat N min ago"; the unopened app "registered, but the app has not opened a session yet"; a removed computer "removed from the vault" |
| T-BUS-09 | `memev bus watch codex@host` in a terminal, then a comms check from another session | the watch prints the check and acks it within about 5 seconds; the roster shows codex@host live |
| T-BUS-10 | close every app and wait 16 minutes; `memev doctor` | the bus check is a warning listing the stale seats; nothing fails |
| T-BUS-11 | `memev bus send all finding "key AKIA…"` (a made-up AWS-style key) and the same through `bus_send` in an app | refused: "looks like it holds a credential"; nothing written to `bus/log/` |
| T-BUS-12 | L2 with git backup on both sides: take pc2 offline, post from it, bring it back, let both sync | the offline message arrives in time order and is delivered to the host's seats as unread; `memev bus tail` shows the same order on both computers |
| T-BUS-13 | issue a token with `--paths 'dept/sales/**'` and call `bus_tail` with it; start a second vault with `--root` and look at its roster and tail | the department token is refused ("its folders do not include bus/"); the second vault's bus is empty |
| T-BUS-14 | packet capture during T-BUS-02 to T-BUS-09 (as T-FEAT-41) | no traffic from Memev except the tunnel and git pushes to your own backup repository |
| T-BUS-15 | L1 with an empty home (`HOME=$(mktemp -d)`): `memev init --local-only` | `bus/config.json`, `bus/operator.json` and `bus/log/<device>.jsonl` exist and `git -C ~/memev ls-files bus` lists them; `git status` is clean; "Lead AI: no lead AI chosen yet" is a step that needs you |
| T-BUS-16 | same home: `mkdir ~/.claude && echo {} > ~/.claude.json && memev connect` | connect prints "on the comms bus: claude-code@host" and that no lead is chosen; `memev bus roster` lists claude-code@host never joined and no lead; `memev bus check --timeout 1` lists it as "registered, but the app has not opened a session yet" |
| T-BUS-17 | an AI runs init for you with no terminal: `memev init --lead claude-code@host </dev/null`, then on a fresh home `MEMEV_LEAD=cursor memev init </dev/null` | the lead is the one given, with no question asked; with neither, no lead is set and init says to pick one with `memev bus operator <seat>` |
| T-BUS-18 | with no lead set, open Claude Code and Cursor; ask Cursor "make yourself the lead" | the session start says no lead is set and to ask you; Cursor asks who should lead. `bus_set_operator` refuses without your answer or with an answer that does not name the seat, and once a lead is set it refuses any change ("only the person can change it") |
| T-BUS-19 | `memev init --help` on a computer with no vault | prints the init help, exits 0, creates nothing |
| T-BUS-20 | `rm -rf ~/memev/bus` then `memev doctor`; then delete one file in `bus/seats/` and run it again; then `memev doctor --fix` | each run fails, naming the missing bus folder or the app with no seat; `--fix` puts both back and the doctor passes |
| T-BUS-21 | L2: join pc2 with Claude Code installed (`memev join …`) | join prints "on the comms bus: claude-code@pc2"; the host roster lists it never joined until its first session; it is not made the lead |

## 7. Performance

| ID | Step | Target |
|---|---|---|
| T-PERF-01 | `node --max-old-space-size=256 scripts/growth-bench.mjs --tokens 170000000 --json /tmp/growth.json` (about 30 to 60 seconds) | exit 0. Reference run: 99 sessions, 8,096 turns, about 25,860 logged operations; heap peak about 160 MB and never over 256 MB; `verify_ok: true` |
| T-PERF-02 | same output | `rebuild_identical` equals `notes` (111) and `rebuild_differ` is 0: every note rebuilt from the log is byte-identical |
| T-PERF-03 | same output | recall p50 about 1.13 ms, p95 about 3.41 ms on the reference machine. Record your numbers with the CPU model; more than twice these on similar hardware is worth an issue |
| T-PERF-04 | `measure.mjs` | project-scoped recall at about 15,600 sections: p50 and p95 recorded (reference about 4.2 ms and 5.4 ms); `why` p95 recorded |
| T-PERF-05 | L3: 10 clients recalling at once for 10 minutes | no errors except rate limits on remote calls over 120 a minute per credential (expected); daemon heap reported by `memev status` stays steady |
| T-PERF-06 | `memev status` after a week of real use on L1 | record log size, notes, sections and heap |

## 8. Security, uninstall and cleanup

| ID | Step | Expected |
|---|---|---|
| T-SEC-01 | `node scripts/leak-scan.mjs --history` | `leak scan: clean` |
| T-SEC-02 | `gitleaks git --redact --no-banner --exit-code 1 .` with gitleaks 8.30.1 | `no leaks found` |
| T-SEC-03 | from another machine, `curl http://<host>:7787/healthz` | connection refused: the daemon listens on 127.0.0.1 only |
| T-SEC-04 | through the tunnel, `/healthz` and `/mcp` with no token, with a local-only token, and with a remote token | `{"ok":true}` only; 401; 403; 200 |
| T-SEC-05 | through the tunnel, admin and contract signing routes with a remote token | refused: local only |
| T-SEC-06 | `memev remember "aws key AKIA..."` with a realistic fake key | refused as a secret |
| T-SEC-07 | file modes in `~/memev/.memev/` and `~/.config/memev/` | 0600 files, 0700 folders |
| T-SEC-08 | `memev uninstall` | every app config restored byte for byte; daemon stopped; the vault is still there |
| T-SEC-09 | `memev uninstall --purge` | also removes `~/.config/memev/runtime` and the launcher; the vault is still there |
| T-SEC-10 | after uninstall, `ps`, `launchctl list` or `systemctl --user list-units`, `crontab -l`, and grep app configs for `memev` | nothing left running or registered |
| T-SEC-11 | delete `~/memev` by hand at the end | no other files to clean up besides `~/.config/memev` (check with `find ~ -newer <a file made before install>`) |

## 9. Failure and recovery

| ID | Step | Expected |
|---|---|---|
| T-FAIL-01 | `kill -9` the daemon in the middle of a burst of `memev remember` calls, then `memev start` and `memev doctor` | log intact; a half-written last record is dropped or completed; doctor exits 0 |
| T-FAIL-02 | delete a note file under `memory/` with the daemon stopped, then start it | the note is rebuilt from the log, byte for byte |
| T-FAIL-03 | edit a note by hand in an editor | the change is imported into the log; nothing is overwritten |
| T-FAIL-04 | change a byte inside a sealed log segment in `.memev/oplog/` | `memev doctor` reports the log as tampered |
| T-FAIL-05 | delete `.memev/index.jsonl` | the index is rebuilt; recall gives the same results |
| T-FAIL-06 | fill the disk to 100% and save a memory | a clear error; no corrupt note; works again after freeing space |
| T-FAIL-07 | port in use: port 7787 taken by another program (for example `python3 -m http.server 7787`), then `memev init` | one line says the port is in use and which port Memev uses instead; the port is saved; `memev doctor` exits 0; the other program still has 7787 |
| T-FAIL-08 | take the network down while the tunnel is on | local apps keep working; `memev cloud status` shows the tunnel down; it recovers when the network comes back |
| T-FAIL-09 | backup remote unreachable, or its deploy key removed | writes keep working; `memev doctor` shows the git error |
| T-FAIL-10 | run every hook with no vault (`MEMEV_ROOT=/nonexistent memev hook session-start --client claude-code < /dev/null`) | exit 0 and a message: hooks never break an app session |
| T-FAIL-11 | a second computer pushing the same vault through git | a warning about a second writer, not a block |
| T-FAIL-12 | reboot during a long session | the next session starts with the last checkpoint |
| T-FAIL-14 | no-git: on a computer without git, `memev init` | it stops before writing anything, says git was not found, and prints the install command for this system; nothing is left in the home folder; after installing git, `memev init` completes and `memev doctor` exits 0 |
| T-FAIL-15 | second-vault: a second vault's daemon already on the port (another user, or `memev init --root ~/other`), then `memev init` | the new vault takes another port and never reports the other daemon as its own; each `/healthz` names its own vault id; notes saved in one are not recalled in the other; `memev doctor` in the first vault warns that there are two vaults and names both ids |
| T-FAIL-16 | node-upgrade: install Memev, then upgrade Node so the old binary is gone (`brew upgrade node`, or `nvm install` a new version and `nvm uninstall` the old one), then `memev status` and a new session in each app | Memev still runs with the Node on PATH; `memev doctor` shows which Node the launcher uses; no app loses memory or the bus without a message |
| T-FAIL-17 | second-computer: on a second computer, `memev init` without joining | it asks whether this is the first computer or one being added, and points to `memev join <invite>`; after joining, both computers see the same notes and the same bus |
| T-FAIL-18 | proxy: behind an HTTP proxy that blocks direct traffic, with `HTTPS_PROXY` (and `NO_PROXY` for local hosts) set | the cloudflared download, joining and licence activation go through the proxy; hosts in `NO_PROXY` go direct; a redirect to another host carries no credentials |
| T-FAIL-19 | windows: on the Windows 11 VM in section 10, `memev init`, then `memev doctor` | every app entry runs node.exe, never a .cmd file; the self-test passes without the Unix file-mode check; the windows-latest CI run on main is green |
| T-FAIL-13 | licence file with a future issue date, an expired date inside the grace period, and past it | not yet valid (the vault counts as free); grace (computers can still be added); expired (no computer can be added, added ones read only). The host vault keeps reading and writing in every case |

T-FAIL-07 and T-FAIL-14 to T-FAIL-19 are the failure paths found in the review. `test/fail-paths.test.mjs` runs
T-FAIL-07 and T-FAIL-14 to T-FAIL-16 on every pull request; the others need a second computer, a proxy or
Windows, so they are run here by hand (`test/proxy.test.mjs` and the windows-latest job cover parts of
T-FAIL-18 and T-FAIL-19).

## 10. Windows 11 (preview)

Windows is a preview: it has its own code paths but has not had a full lab run. Use a Windows 11 VM
(23H2 or newer, 2 CPUs, 4 GB RAM, 20 GB disk) with Node.js 22 from nodejs.org and Git for Windows.
Run the steps in PowerShell. Memev keeps its settings and launcher in `$env:APPDATA\memev` and the
vault in `$env:USERPROFILE\memev`.

| ID | Step | Expected |
|---|---|---|
| T-WIN-01 | `npm test` in the clone | record the pass and fail counts and the name of every failing test; report each failure as an issue with this id |
| T-WIN-02 | `node bin/memev.mjs init`, answer yes to the PATH question | vault in `$env:USERPROFILE\memev`, daemon on `127.0.0.1:7787`, checklist printed, self-test passes; "Start at login" reports a per-user Task Scheduler entry (`schtasks`), or a manual step if it could not be created |
| T-WIN-03 | open a new PowerShell window, then `memev --version` and `reg query HKCU\Environment /v Path` | `0.1.0`; the user PATH holds `$env:APPDATA\memev\bin`, which holds `memev.cmd` |
| T-WIN-04 | connect Claude Code, Codex, Gemini CLI and Cursor (create `.claude`, `.codex`, `.gemini` and `.cursor` under `$env:USERPROFILE` first for apps that are not installed); read each file listed in section 4 | every MCP and hook command runs `node.exe` with `$env:APPDATA\memev\runtime\<version>\bin\memev.mjs` as its first argument, never a `.cmd` file; in each installed app a new session starts with the resume card |
| T-WIN-05 | `memev doctor` | exit 0; the private files check passes |
| T-WIN-06 | `icacls "$env:USERPROFILE\memev\.memev\tokens.json" /grant Everyone:R`, then `memev doctor` | the private files check fails and names `tokens.json`; after `icacls <same file> /remove Everyone` a second `doctor` passes |
| T-WIN-07 | `memev service install` | expect: not available. It says there is no service manager support and to run `memev start` at login; nothing is written |
| T-WIN-08 | sign out and in, then `memev status` | the daemon is not running; `memev start` starts it and a new app session gets the resume card |
| T-WIN-09 | `memev uninstall --purge` | app files restored as in T-REG-09; `$env:APPDATA\memev\bin` and the runtime copy are gone; the user PATH entry stays until `node bin/memev.mjs path remove` (record what you see) |

## 11. Results

Write results in one Markdown file, one row per test id, and attach the evidence files
(command output, screenshots, packet captures) in a folder next to it.

```markdown
# Memev lab results

Commit tested: <sha>
Tester: <name or agent>
Dates: <start> to <end>
Labs used: L1 macOS <version>, L1 Ubuntu <version>, L2, L3, L4 (say which and how they were built)
Node: <version on each machine>

## Summary

Passed: N · Failed: N · Not available as expected: N · Not run: N (with reasons)
Issues filed: <links>

## Results

| Test id | Result | Evidence | Notes |
|---|---|---|---|
| T-GET-03 | pass | evidence/T-GET-03.txt | all tests pass |
| T-FEAT-32 | pass | evidence/T-FEAT-32.txt | the copy got 401 device_key |

Result is one of: pass, fail, expect: not available (confirmed), not run.

## Expected vs actual

One table per failed or surprising test.

| Test id | Expected | Actual | Issue |
|---|---|---|---|
| | | | |
```

## Test count

| Area | Tests |
|---|---|
| Getting the code (T-GET) | 4 |
| Install paths (T-INS) | 6 |
| App registration and doctor (T-REG) | 15 |
| CLI commands (T-CMD) | 24 |
| Features (T-FEAT) | 50 |
| Performance (T-PERF) | 6 |
| Security and cleanup (T-SEC) | 11 |
| Failure and recovery (T-FAIL) | 13 |
| Comms bus and pulse (T-BUS) | 14 |
| Total | 143 |
