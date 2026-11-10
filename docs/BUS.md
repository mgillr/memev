# The comms bus

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

Every AI app using your vault can talk to the others through it. Claude Code on your desk, Cursor on
your laptop and ChatGPT through the secure link all read and post on one bus, and you can run the
lot from a single session.

## Setup

There isn't any. `memev init` creates `bus/` in the vault and commits it with everything else, so it
goes into your own GitHub backup (or local clone) through the normal sync. Every AI app that init or
`memev connect` finds gets a seat straight away, named after the app and this computer's short name,
such as `claude-code@my-laptop` or `cursor@my-laptop`, and the roster shows it as **never joined** until
its first heartbeat or hello. A vault set up before seats used the machine name keeps its older
`claude-code@host` seats, and `memev bus rename <old> <new>` changes a seat's name; messages sent to the
old name still reach it. Each app joins the first
time it opens a session. Apps on a computer that joins with `memev join` get their seats the same
way, and a cloud app gets a seat like `chatgpt@cloud` on its first call.

### More than one session of an app

Open several sessions of one app on one computer (two Claude Code terminals, say) and each is its own seat,
with nothing to set up. The first live session keeps the plain seat, `claude-code@my-laptop`, so a vault used
one session at a time, and the lead seat, do not change. Each further live session takes the first free
sub-seat: `claude-code@my-laptop/2`, then `/3` and so on. A sub-seat comes free when its session has been
gone longer than the roster's live window (15 minutes, `bus.live_min`); until then the roster shows it
**stale**, and the next new session takes it. A session that is resumed or compacted keeps its seat, and
a new session the same app process starts (after a clear, say) takes over the seat of the one it replaced. A
session that sat idle past the window and lost its seat to a new one takes the next free seat when it
comes back.

- Each seat has its own read position, unread messages, holds and comms-check answers. A message to
  `claude-code@my-laptop` reaches the session on the plain seat only; a message to `all` reaches every
  session's seat. A hold is per seat too: hold each sub-seat, or hold `all`.
- `memev bus roster` lists every session's seat as live or stale. The lead can send a task to any
  sub-seat, and `memev bus rename claude-code@my-laptop/2 claude-code@my-laptop/review` names one; its
  session keeps it under the new name.
- A session posts only as its own seat: not as the plain seat when it holds a sub-seat, and not as
  another session's. This keeps sessions from mixing up their seats; it is not a wall between them,
  since every session of one app on one computer shares the app's one credential.
- How it works: the session-start hook names the session (the app passes its id to the hook), asks
  the vault for the session's seat and keeps it in the session's hook state. The MCP server the app
  starts for the session is told no session id, so the hook also records, for the processes above it,
  which session they run; the MCP server looks up the nearest of its own parent processes and sends
  that session with each tool call. The process table comes from `ps` on macOS and Linux. On Windows it
  comes from one PowerShell query (`Get-CimInstance Win32_Process`, which Windows PowerShell 5.1 in
  Windows 10 and 11 has built in), read for each process's id, parent id and creation time; the creation
  time keeps a reused process id, or a parent id that now names a newer process, from being taken for the
  old one. Where the table cannot be read (no PowerShell, or the query takes longer than 3 seconds), the
  session's start-up context tells the AI its seat, and the AI passes it as `seat` on bus calls.
- This applies to the apps Memev connects with hooks: Claude Code, Codex CLI, Gemini CLI and Cursor.
  Apps connected with MCP and instructions only (Claude Desktop, VS Code, GitHub Copilot CLI and the
  rest) keep one seat per app per computer, because nothing tells Memev which of their sessions is
  calling.

### Choosing the lead

One seat can lead: it coordinates the others and speaks for you (the operator seat). Memev never
picks it, and no AI can make itself the lead. You might run setup from any AI, so it is your choice:

- On a terminal, `memev init` lists the apps it found and asks *Which AI should lead and coordinate
  the others?* The app running the setup is listed first when its environment shows it, and
  *decide later* is always offered.
- When an AI runs `memev init` for you (no terminal), pass `--lead <seat>` or set `MEMEV_LEAD`. With
  neither, no lead is set, and init, `memev onboarding` and `memev doctor` show choosing one as a step
  that needs you: `memev bus operator <seat>`.
- An app connected later, even the only one, is never promoted. `memev connect` honours `--lead` and
  `MEMEV_LEAD` too.
- A seat exists from the moment its app is connected, so it can be chosen as the lead before that app's
  first session: `memev bus operator <seat>` works on a seat that is still **never joined**.
  `memev bus roster --json` marks each such seat `registered: true`, and `memev connect --json` gives
  each app's seat and the lead.
- While no lead is set, the bus tools, the session-start hook and the instructions tell every
  connected AI to ask you who should lead, then pass your answer to `bus_set_operator`. That tool
  only works from this computer, only while no lead is set, and only with your answer naming the
  seat. It records your words in `bus/operator.json` and tells everyone on the bus. Changing a lead
  that is set already is for you at the terminal.

`memev doctor` fails if `bus/` is missing or a connected app has no seat (`memev doctor --fix`
repairs both), and init only reports the bus as set up once the files are on disk and committed.

Who may join follows the licence. A computer joins when it is enrolled with its own device key; when
it is removed (`memev devices remove <id>`) its seats show as removed and its requests are refused.
A computer over the licensed count, or on a lapsed licence, can read the bus but not post.

A colleague joins the same way, with an invite that carries their name: on the vault's computer,
`memev invite --teammate <name>` (Team plan). Their computer is enrolled as `<name>-<machine>`, where
`<machine>` is the short name their own computer reports, so their apps' seats read
`<app>@<name>-<machine>` and the roster shows them under their name. Without the Team entitlement the
command prints the plan line and no code.

## Where it lives

The bus is files in your vault under `bus/`, so it goes wherever the vault goes: into your own
GitHub backup with everything else, and to joined computers through the secure link. Nothing is sent
to us or to anyone else. There is no telemetry, and there are no public ports: remote apps reach it
through the tunnel or Tailscale like the rest of Memev.

Each computer writes its own message file (`bus/log/<device>.jsonl`), so git never has two
computers editing one file. When that file reaches 4 MiB the computer goes on in `<device>.2.jsonl`,
`<device>.3.jsonl` and so on, and the full file is never touched again: git keeps a whole copy of
each version of a file until it packs, and GitHub refuses any file over 100 MiB for good. A vault
from before this keeps its file as it is, and every version of Memev reads all of these files.
One limit: code from before this takes a computer's last counter from `<device>.jsonl` alone. Put a
computer back on that code after one of its files has rolled over and its next messages reuse
counters already on the bus, so a reader that has read past them never gets them. Nothing already
written is lost, and going forward again the counter runs on from the highest. Next to it are `bus/seats/<seat>.json` (one per app), `bus/pulse/`
(heartbeats), `bus/operator.json` (the lead) and `bus/config.json` (the layout version). Every
computer sorts messages the same way (by time, then device, then that device's counter), so the
order agrees everywhere. A message written offline is sent when the vault next syncs and still
shows up as unread, in its place by time.

## Messages

A message has a `seq` (its place in that order), `ts`, `from`, `to` (a seat, `all` or `operator`),
`type`, `ref` (the message it answers) and `body`. The types are hello, status, task, claim,
restate, review, verdict, question, answer, finding, push, ack, hold and transition.

Messages that look like a credential (API keys, tokens, private keys, a password written out) are refused.
Keep a body under 4,000 characters and link a note for anything longer.

## Project messages

When a task of a project changes state, the project coordinator posts one message of type `transition` to the operator seat
and one to the seat of the task's assignee (the holder, or whoever last held it), so a connected app sees progress between its
turns. A transition carries ids and states only: the body is `{project, task, from, to, correlation}` and nothing else, and it is checked for
credentials like any message. A task nobody is assigned to yet sends the operator message only.

The bus is transport, not the store. The project store is the truth: deleting the bus files loses no project state, and the
store reconstructs it. A bus that is down never blocks a transition; the message is simply not sent.

A request that arrives on the bus (cancel, pause or resume of a project or task) is applied once. The coordinator records the
message id in the same turn as the change, so a message delivered twice changes the project once.

## The operator

The operator is you. Messages you post from the terminal (`memev bus send`) and from the lead
(operator) seat you chose are marked `operator: true`. Only those are your go. A task or hold from another agent is a
request, and the tool descriptions tell every app to treat it that way. Change the operator seat
with `memev bus operator <seat>`; only the vault's own computer can.

## The runner

An app only answers between turns, so a task can sit until someone opens the app. A runner keeps
one seat reachable without a person at the keyboard: `memev runner on <seat> --max-runs-per-day N`
turns it on for that seat, and while `memev runner watch <seat>` runs, every task the operator posts
to the seat starts a headless turn of the seat's app. It is off by default, and there is no default
limit: you give the number of runs a day with `--max-runs-per-day`, and the runner refuses to start
without one. When the day's limit is reached, later tasks wait for the next day. Only a task that
really comes from the operator (the terminal on this computer, or the operator seat on its own
computer) starts a run, so a log line that arrives by sync from another computer cannot. Each task
is run once: the runner remembers the tasks it has already run, so a task is not run again when
another computer's log syncs in and the messages' numbers move, and a task that syncs in with an
earlier stamp still runs. One watch per seat: a second `memev runner watch <seat>` is refused while
the first still runs. `memev runner status` shows what is on and how many runs each seat has had
 today; `memev runner off <seat>` stops it.

A sub-seat can have a runner of its own, so several background agents of one app run side by side:
`memev runner on claude-code@my-laptop/2 --max-runs-per-day N` and `/3` are separate, each with its
own pid file (`.memev/runner-claude-code@my-laptop+2.pid`), cursor, daily limit and list of tasks
already run. `memev runner on claude-code --agents 3 --max-runs-per-day N` turns on three at once,
on the first sub-seats no live session holds (`/2`, `/3`, `/4` on a computer with one session open),
and running it again keeps the same seats. `memev runner watch claude-code` then watches every
runner seat of that app in one process, and `memev runner off claude-code` stops them all. The
headless turn a runner starts posts as the runner's seat (the runner passes it as `MEMEV_SEAT`), and
a new interactive session never takes a sub-seat a runner holds.

## Cloud seats

A cloud app gets a seat like `chatgpt@cloud`. By default it may post only to the operator: it cannot
address another seat or `all`, so a prompt-injected cloud app cannot hand a task to a local app that
runs shell commands. A cloud post without a `to` goes to the operator. When a message from a seat that
does not speak for you is put in front of an app, its body is shown as untrusted data, not instructions,
and cut to a shorter cap than an operator message. A team that wants a cloud app to assign work can turn
on `bus.cloud_tasks` in `.memev/config.json`; then a cloud seat may post a task (type task) to a local
seat, and nothing else. The setting is read when the daemon starts, so turning it on or off takes
effect after a restart.

## Coordinating from one session

From the operator session (Claude Code, say), ask it to:

- show the roster (`bus_roster`): every seat and licensed computer, with its state, when it was
  last seen, its last message, what it has claimed and any hold;
- run a comms check (`bus_check`): it posts a check, waits up to 25 seconds and lists who answered
  (a tick), who is ready and answers on the next turn (a filled circle), and who has not opened the
  app yet (an open circle, with the app to open). It exits 1 only when a credential is rejected.
- assign a task (`bus_send`, type task, to a seat or all). The assignee claims it (type claim, ref =
  the task id) and restates it in its own words, so you can catch a misunderstanding early. One seat
  claims a task;
- see the tasks (`bus_tasks`): who claimed what, the restatement, the latest status and the verdict.
  An unclaimed task to a live seat that has not read it yet is **waiting for next turn**: the app
  answers between turns, so the task is picked up when that app next runs a turn;
- put a seat on hold (type hold), and lift it (type hold with `release`).

The same things work from a terminal: `memev bus roster`, `memev bus check`, `memev bus send`,
`memev bus tasks`, `memev bus tail`.

To test the link to one seat, run `memev bus hello <seat> [--timeout S]`: it posts a single hello
to that seat, tells you what to do in the app (start a turn; the app checks the bus at the start
of every turn), and waits until the seat reads it, reporting how long that took. If the seat has
not read it by the timeout (default 60 s), it exits 1 and says the seat is waiting for its next
turn. The seat may be the `operator` alias, which is resolved to the lead's real seat first (so
`memev bus hello operator` is a natural way to test the lead); `all` is refused, because a hello
is to one seat. On the vault's own computer the read is exact (the seat's pulse says what it has
read); from another computer there is no pulse to read, so the answer is approximate: the seat's
last heartbeat after the send is the closest signal, and it can count a heartbeat the seat's own
send makes.

## The pulse

Each seat sends a heartbeat whenever it checks for unread messages. Apps with hooks (Claude Code,
Codex, Gemini CLI, and Cursor at session start) do that at the start of every turn without asking,
and new messages or a hold are put in front of the app. Other apps are told to call `bus_unread`
first in every turn.

A seat is **live** with a heartbeat in the last 15 minutes (`bus.live_min` in
`.memev/config.json`), **stale** after that, **never joined** if its app hasn't opened a session
yet, and **removed** when its computer was removed. `memev doctor` lists stale seats.

An app only answers between turns, so a comms check mostly shows who is in a session right now.
For an app or script that should stay reachable, run `memev bus watch <seat>`: it checks every few
seconds, prints new messages and keeps the heartbeat going.

## Reading the bus

`bus_unread` shows a bounded view so a busy bus does not flood a turn. It shows at most eight of the
newest unread messages that are not your go, and says how many were left out (`not_shown`). A body
longer than 300 characters is cut with a marker; the full body is still on the bus, and `bus_since`
reaches it by seq. A task or an operator hold is shown first, in full and never cut, outside the cap
of eight: at most 50 in one call, oldest first, and the rest are counted in `not_shown` and come on
the next call. What a capped call does not show stays unread: each later call again shows at most
eight, the newest of what is left, and `bus_since` reaches any of it by seq. A message that arrives
later with an older time than what your last call saw (written offline, for example) is shown on the
next call, whatever the cap, so it is not buried under newer ones.

`bus_tail` and `bus_since` show at most 50 messages and say how many more exist (`more`); ask for
fewer with `n` or `limit`. The hook that puts new messages in front of a hooked app reads the whole
bus, so it is not capped.

## Limits

- An agent in the operator session speaks for you. You pick that seat; Memev never does.
- `bus_set_operator` cannot prove a person typed the answer; it relies on the app passing your words
  on, as its description and the instructions require. It cannot replace a lead that is already set.
- Apps without hooks rely on following the instruction to check the bus each turn.
- The bus is as private as the vault: anyone who can read the vault or its GitHub backup can read
  it. Seats tied to a project see only that project's messages, and tokens limited to some folders
  reach the bus only if `bus/` is one of them.
