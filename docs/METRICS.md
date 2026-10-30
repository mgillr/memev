# Metrics

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

How Memev is measured, and what is never measured. Memev has no telemetry: nothing in the product
reports anything unless you turn on a report that is off by default. The milestones below are worked
out on your computer and stay there; the counts after them are taken from places that already hold
the number, never from your computer.

## Milestones (computed locally)

Seven things that show how far a person got. Each is worked out from files the vault already keeps
(its operation log, the comms bus and the invites file) and recorded in
`.memev/onboarding.json` under `milestones`, as `{ "name": { "at": "<time>" } }`. Nothing is sent: the
code that works them out makes no network call. `memev onboarding --milestones` lists them and
records any that are new. A milestone keeps the date it was first recorded and is never removed.

| Milestone | It is recorded when | Source |
|---|---|---|
| `installed` | the vault exists; dated by its first operation | operation log |
| `second_app_joined` | a second AI app, different from the first, has a seat or has used the vault; two seats of one app (or the terminal) do not count | bus seats, operation log |
| `first_cross_app_recall` | an app recalled a memory that a different app saved | operation log |
| `two_apps_one_memory` | the same, and the recall came within 24 hours of the save | operation log |
| `first_bus_message` | a seat sent a message other than hello, a check or an answer to a check | bus messages |
| `invite_sent` | `memev invite` made a one-time code; dated when it is first seen, because an invite carries no date | invites file |
| `comms_activation` | the first comms check that two seats other than the one that asked answered; dated when the second one answered | bus messages |

**The activation metric** is `two_apps_one_memory`: one memory, two apps, inside a day. It is the
moment the product does what it says. It is counted as reached in 24 hours when its date is within 24
hours of `installed`. **Comms activation** is `comms_activation`: the agents can reach each other.

### The seven funnel stages

| Stage | Name | Measured by |
|---|---|---|
| 1 | Get it | package and release downloads (below) |
| 2 | Install | `installed` |
| 3 | First value | `first_cross_app_recall`, then `two_apps_one_memory` |
| 4 | Comms | `first_bus_message`, then `comms_activation` |
| 5 | Expand | `second_app_joined`, `invite_sent` |
| 6 | Pay | licence activations (below) |
| 7 | Grow and retain | the vault's own activity over later weeks, read from its log; not a milestone |

Stages 1 and 6 are counted outside your computer, from public download counts and from the licence
endpoint. Stages 2 to 5 are your own file. Stage 7 is whatever the log shows you did next.

## The anonymous milestone report (off by default)

There is no telemetry by default. The one report Memev can make is opt-in:

- **Asked once.** At the end of `memev init`, on a terminal, Memev asks whether to share anonymous
  milestones, and the default is no. The question is not asked again, and it is not asked when there
  is no terminal. The checklist shows whether the report is on or off.
- **Off until you say yes.** A fresh install sends nothing. The setting is in
  `report.json` in the Memev configuration folder. `memev report on` and `memev report off` change it;
  turning it off forgets the random id, so turning it on again starts a new one that is unrelated.
- **What it holds.** Milestone names (the table above), the day each was reached (a date, no time),
  and a random id made when you turn it on. For example:

```json
{ "v": 1, "id": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "milestones": [ { "name": "installed", "date": "2026-11-01" } ] }
```

- **What it never holds.** Paths, names, memory text, app names, addresses, the licence, or anything
  about the computer.
- **See it first.** `memev report show` prints exactly the text that would be sent, and
  `memev report status` says whether it is on.
- **Where it goes.** To the address in `MEMEV_REPORT_URL` (https, or plain http for this computer).
  There is no built-in address, so with the report on and no address set nothing is sent. Only
  milestones not yet reported are sent, with a short time limit and no retry loop.
- **Separate from the milestone code.** The code that works out milestones makes no network call; the
  report is a small separate step that only runs when it is on.

## Licence activations

An activation is one successful `memev license activate <key>` call. It is counted where the call
lands, at the licence endpoint, because that is the only place that sees it.

- What the endpoint sees: the licence key and the time of the request. The client sends nothing
  else (no name, e-mail, machine, vault or version).
- What is counted: one row per activation, holding the licence id, the day and the result
  (`issued` or `refused`). Counts are per licence id and per day.
- What is not counted: licence checks. A licence is verified on the computer against the vendor
  public key, offline, so day-to-day use never reaches the endpoint and cannot be counted there.
- Where the counts are kept: beside the licence endpoint, and run by the owner with it. The
  endpoint URL comes from configuration (`--server` or `MEMEV_LICENSE_URL`); this repository holds
  no address, host, or IP. The milestone report works the same way: its URL comes from
  configuration (`MEMEV_REPORT_URL`) and there is no built-in address, so until one is set nothing
  is sent.

The queries, written for a table `activations(licence_id, day, result)`:

```sql
-- activations per day, last 30 days
SELECT day, count(*) FROM activations
WHERE result = 'issued' AND day >= date('now', '-30 day') GROUP BY day ORDER BY day;

-- distinct licences activated, all time
SELECT count(DISTINCT licence_id) FROM activations WHERE result = 'issued';

-- activations per licence (a key used on more computers than it should be shows here)
SELECT licence_id, count(*) AS n FROM activations
WHERE result = 'issued' GROUP BY licence_id HAVING n > 1 ORDER BY n DESC;

-- refused keys per day (typos, reuse, expired keys)
SELECT day, count(*) FROM activations WHERE result = 'refused' GROUP BY day ORDER BY day;
```

## Package downloads

Downloads are counted by the places that serve the files, not by Memev. Each number is public and
can be read without a login. A download is not an install and not an activation: the funnel from
one to the next is the point of reading them side by side.

**npm** (once the package is published):

```sh
# last day, last week, last month
curl -s https://api.npmjs.org/downloads/point/last-day/memev
curl -s https://api.npmjs.org/downloads/point/last-week/memev
curl -s https://api.npmjs.org/downloads/point/last-month/memev

# one row per day between two dates
curl -s https://api.npmjs.org/downloads/range/2026-11-01:2026-11-30/memev
```

The answer is `{"downloads": N, "start": "<date>", "end": "<date>", "package": "memev"}`. npm counts every fetch,
including mirrors and CI installs, so it over-counts people.

**Release downloads** (installers and tarballs attached to a release):

```sh
# downloads per file, per release
gh api repos/<owner>/<repo>/releases --paginate \
  --jq '.[] | {tag: .tag_name, files: [.assets[] | {name, downloads: .download_count}]}'

# total release downloads
gh api repos/<owner>/<repo>/releases --paginate \
  --jq '[.[].assets[].download_count] | add'
```

GitHub counts each request for an asset, so a retry counts twice. If the installers are later
served from a download host of our own, the same two numbers (per file, total) come from that
host's access log, counted by distinct day and file, with no address kept.

## Reading the three numbers together

| Number | Source | What it tells you |
|---|---|---|
| downloads | npm, releases | interest |
| activations | licence endpoint | paid or trial licences taken up |
| milestones | your own `onboarding.json`; shared only if you turn on the opt-in report, which is off by default | what you reach after installing |

## The weekly funnel report (a development tool)

`scripts/metrics/report.mjs` renders the three numbers together in one page, for the owner. It is a
development tool: it reads count files handed to it as flags, prints one page of dated numbers, and
reports nothing anywhere. It is not in the npm package file list, and it derives no count from a
person's computer.

- **Inputs, as files.** `--package` holds the package download rows (the npm range answer, one row
  per day: `{ "day": "<date>", "downloads": N }`), `--release` the release-host download rows (the
  same shape, one row per day and file), and `--activations` the licence-activation rows
  (`{ "day": "<date>", "licence_id": "...", "result": "issued" or "refused" }`, one row per
  activation). `--milestones` optionally holds the opt-in milestone rows (the report payload above,
  one row per milestone: name and day). A row without a day counts in the total only. With no
  milestone input the page says so in one line and still renders.
- **The page.** For each count set: the count per day, per week (ISO week) and the total. Nothing
  is estimated and nothing is typed into the program: every number on the page comes from the
  files.
- **The gates.** The page header renders the gates from `scripts/metrics/gates.json`: the month-6
  gates, installs at or above 5,000 by month 6, and free-to-paid at or above 1 percent once sync
  has shipped. The thresholds live in the file, never in the program, because the owner moves
  them. Each gate prints its measured value, its threshold and pass or miss.
- **The installs choice.** A download is not an install, so the file also says which counted
  number stands for installs (`installs_proxy`: `package_downloads`, `release_downloads`,
  `downloads` or `activations`). That choice is the owner's; until it is made the file says open,
  the page prints that line, and both gates stay open. Editing the file changes the header with no
  change to the program.
- **Hosts nothing.** The counts are kept beside the licence endpoint on the owner's server; this
  tool reads counts handed to it and hosts nothing.

## What is never counted

No per-user identifier, no vault content, no file paths, no names of the apps you use, and no usage
events. A milestone holds a name and a time. Nothing here is collected from a computer that has not
been told to send it.
