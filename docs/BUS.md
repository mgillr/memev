# The comms bus

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

## Where it lives

The bus is files in your vault under `bus/`, so it goes wherever the vault goes: into your own
GitHub backup with everything else, and to joined computers through the secure link. Nothing is sent
to us or to anyone else. There is no telemetry, and there are no public ports: remote apps reach it
through the tunnel or Tailscale like the rest of Memev.

Each computer writes its own message file (`bus/log/<device>.jsonl`), so git never has two
computers editing one file. Next to it are `bus/seats/<seat>.json` (one per app), `bus/pulse/`
(heartbeats), `bus/operator.json` (the lead) and `bus/config.json` (the layout version). Every
computer sorts messages the same way (by time, then device, then that device's counter), so the
order agrees everywhere. A message written offline is sent when the vault next syncs and still
shows up as unread, in its place by time.

## Messages

A message has a `seq` (its place in that order), `ts`, `from`, `to` (a seat, `all` or `operator`),
`type`, `ref` (the message it answers) and `body`. The types are hello, status, task, claim,
restate, review, verdict, question, answer, finding, push, ack and hold.

Messages that look like a credential (API keys, tokens, private keys, a password written out) are refused.
Keep a body under 4,000 characters and link a note for anything longer.

## The operator

The operator is you. Messages you post from the terminal (`memev bus send`) and from the lead
(operator) seat you chose are marked `operator: true`. Only those are your go. A task or hold from another agent is a
request, and the tool descriptions tell every app to treat it that way. Change the operator seat
with `memev bus operator <seat>`; only the vault's own computer can.

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
- see the tasks (`bus_tasks`): who claimed what, the restatement, the latest status and the verdict;
- put a seat on hold (type hold), and lift it (type hold with `release`).

The same things work from a terminal: `memev bus roster`, `memev bus check`, `memev bus send`,
`memev bus tasks`, `memev bus tail`.

To test the link to one seat, run `memev bus hello <seat> [--timeout S]`: it posts a single hello
to that seat, tells you what to do in the app (start a turn; the app checks the bus at the start
of every turn), and waits until the seat reads it, reporting how long that took. If the seat has
not read it by the timeout (default 60 s), it exits 1 and says the seat is waiting for its next
turn.

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

## Limits

- An agent in the operator session speaks for you. You pick that seat; Memev never does.
- `bus_set_operator` cannot prove a person typed the answer; it relies on the app passing your words
  on, as its description and the instructions require. It cannot replace a lead that is already set.
- Apps without hooks rely on following the instruction to check the bus each turn.
- The bus is as private as the vault: anyone who can read the vault or its GitHub backup can read
  it. Seats tied to a project see only that project's messages, and tokens limited to some folders
  reach the bus only if `bus/` is one of them.
