# Metrics

How Memev is counted, and what is never counted. Memev has no telemetry: nothing in the product
reports anything unless you turn on a report that is off by default, and the counts below are taken
from places that already hold the number, never from your computer.

## Licence activations

An activation is one successful `memev license activate <key>` call. It is counted where the call
lands, at the licence endpoint, because that is the only place that sees it.

- What the endpoint sees: the licence key and the time of the request. The client sends nothing
  else (no name, e-mail, machine, vault or version).
- What is counted: one row per activation, holding the licence id, the day and the result
  (`issued` or `refused`). Counts are per licence id and per day.
- What is not counted: licence checks. A licence is verified on the computer against the vendor
  public key, offline, so day-to-day use never reaches the endpoint and cannot be counted there.
- Where the counts are kept, and who operates the endpoint, is for the owner to decide. Until that
  is decided the client has no built-in endpoint address (`--server` or `MEMEV_LICENSE_URL`), so
  there is nothing to count against yet.

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
| installs that report | the opt-in milestone report, if the owner turns it on | what people reach after installing |

## What is never counted

No per-user identifier, no vault content, no file paths, no app names beyond what a person types into
a form themselves, and no usage events. Nothing here is collected from a computer that has not been
told to send it.
