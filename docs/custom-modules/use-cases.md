# Custom module use cases

Part of the [Memev documentation](../README.md). Up: [custom modules](README.md).

> **DRAFT. Every use case here is planned.** Nothing is built or on sale, and there are no dates or
> prices on this page. Custom module work is for Business and Corporate (both coming) and is quoted per job. See
> [README.md](README.md) for how to read these as test cases, and [examples/](examples/) for six
> walk-throughs.

Each use case has the same parts: who it is for, the problem, what Memev does for it today, what a
custom module adds, an example input and output, and acceptance checks. The inputs and outputs are
fictional and show the intended shape, not a finished product.

| # | Use case | Status |
|---|---|---|
| 1 | [Cross-team plan clash checking](#1-cross-team-plan-clash-checking) | planned |
| 2 | [An engineering team across several AI apps](#2-an-engineering-team-across-several-ai-apps) | planned |
| 3 | [A consultancy with strict walls between clients](#3-a-consultancy-with-strict-walls-between-clients) | planned |
| 4 | [A regulated company's AI programme](#4-a-regulated-companys-ai-programme) | planned |
| 5 | [Support and sales sharing customers](#5-support-and-sales-sharing-customers) | planned |
| 6 | [An incident that spans apps and people](#6-an-incident-that-spans-apps-and-people) | planned |
| 7 | [A research group that must not lose a result](#7-a-research-group-that-must-not-lose-a-result) | planned |
| 8 | [Onboarding a new hire](#8-onboarding-a-new-hire) | planned |
| 9 | [Memory without a new vendor in the data path](#9-memory-without-a-new-vendor-in-the-data-path) | planned |
| 10 | [Accounting: supplier bill intake](#10-accounting-supplier-bill-intake) | planned |
| 11 | [Logistics: quote request drafting](#11-logistics-quote-request-drafting) | planned |
| 12 | [Property management: maintenance triage](#12-property-management-maintenance-triage) | planned |
| 13 | [Construction: information request intake](#13-construction-information-request-intake) | planned |
| 14 | [Healthcare administration: prior approval preparation](#14-healthcare-administration-prior-approval-preparation) | planned |

---

## 1. Cross-team plan clash checking

**Status:** planned.

**Who it is for.** A business with several teams that each keep their own plan in the project
management tool the company already uses: a delivery team, a design team, an operations team.

**The problem.** Each team edits its own plan. Nobody sees the effect on the others until a deadline
slips. One change can double-book a person, break a dependency, move a date that another team was
counting on, or push the whole project's critical path out.

**What Memev does today.** It keeps one memory that every AI app and every team member can read, with
the decisions and their sources in it. It does not read project plans.

**What the custom module adds.** When a team member updates a plan in the client's project tool, the
module reads the change, compares it with the other teams' plans, and writes what it finds into Memev
as a note that names the plans and the people involved. It can tell those people. It looks for:

- **double-booked people**: one person assigned to overlapping work in two plans;
- **dependency conflicts**: a task that now starts before something it depends on finishes;
- **date conflicts**: a milestone that moved across a date another plan relies on;
- **critical-path impact**: a change that lengthens the longest chain of dependent work;
- **schedule creep**: the same task or milestone moving later, change after change;
- **scope creep**: work added to a plan with no matching decision recorded.

The module only reads the plans and proposes. It does not edit a plan. A person decides what to do.

**Example input.** Team B's plan change, as the module sees it:

```text
plan: Team B / Fit-out
change: task "Install controls" moved from week 6 to week 9
assigned: person P3
```

**Example output.** A note in Memev, and a message to the owners of the affected plans:

```text
Clash found after a change to Team B / Fit-out
1. Double-booked: P3 is also on Team A / Commissioning, weeks 8 to 9.
2. Dependency: Team A / Handover now starts before "Install controls" ends.
3. Critical path: the longest chain grows by 3 weeks (was 14, now 17).
Sources: Team B change of this morning, Team A plan version 12.
Decision needed from: owner of Team A, owner of Team B.
```

**How we would test it.** Acceptance checks, run on a fictional set of three plans:

1. A change that overlaps one person across two plans reports exactly that person and both plans.
2. A change that makes a task start before its dependency ends reports a dependency conflict.
3. A change that moves a milestone past a date another plan relies on reports a date conflict.
4. A change that lengthens the longest dependent chain reports the old and new length.
5. A task moved later in three changes in a row is reported once as schedule creep, with the three dates.
6. Work added with no matching recorded decision is reported as scope creep; work added with a recorded decision is not.
7. A change with no effect on other plans produces no message.
8. The module never edits a plan and never reports a plan the reader is not allowed to see.

---

## 2. An engineering team across several AI apps

**Status:** planned.

**Who it is for.** An engineering team of around fifteen people who use one AI app for coding, another
for review and a third on the phone for thinking.

**The problem.** A decision made in one session is gone in the next, and bringing a teammate's
assistant up to date takes a wall of pasted context every morning.

**What Memev does today.** One person's apps share one memory. A session starts with the north star,
the active work and the latest decisions already loaded.

**What the custom module adds.** One memory for the team, with a rule for what counts as a decision
for this team, who is trusted to write to the work area, and a morning summary of what changed.

**Example input.** A coding session records: "We ship the beta after the launch review."

**Example output.** The review session of a teammate, asked "when do we ship?", answers with the
decision, its date, its source and who recorded it.

**How we would test it.**

1. A decision recorded in app A is returned by app B within one sync cycle, with source and author.
2. A person who is not trusted for the work area cannot write to it, and the attempt is logged.
3. The morning summary lists only changes since the last one.
4. Nothing needs pasting by the person asking.

---

## 3. A consultancy with strict walls between clients

**Status:** planned.

**Who it is for.** A consultancy with many clients, where each engagement has its own team and client
material must never cross engagements.

**The problem.** One shared knowledge base leaks by default. One tool per client means no shared
memory at all.

**What Memev does today.** Hard project scope, path-limited tokens and a graph filtered by path.

**What the custom module adds.** A layout of one area per client, a rule that a member sees and writes
only the engagements they are on, and a roll-off step that removes access when someone leaves an
engagement.

**Example input.** A member of client A's team asks about client B.

**Example output.** "Nothing in the vault." The member's computer never received client B's area.

**How we would test it.**

1. A member on client A can read and write client A and cannot read client B.
2. The same question returns no hint that client B's note exists.
3. After roll-off, the member receives no new notes for that client.
4. The audit view shows who read and wrote what, per engagement.

---

## 4. A regulated company's AI programme

**Status:** planned.

**Who it is for.** The person who runs AI tooling at a bank or an insurer, facing a security review.

**The problem.** Every AI tool keeps its own memory in its own cloud, and the review asks where the
data is, who can read it, how it is deleted and how to show it.

**What Memev does today.** Memory is plain files you can inspect, in a place you own.

**What the custom module adds.** A report built for the review: where the memory lives, who has
access, what was read and written in a period, how long things are kept and how to delete them. It
pairs with the [Evidence Pack](../roadmap/add-ons.md#2-evidence-pack) when that exists. The report
gives evidence for the reviewer. It does not say the company is compliant.

**Example input.** A reviewer asks what the assistants knew about one customer since the start of the
quarter.

**Example output.** A list of every write and read on that customer's notes, with the app, the person
and the time, ready to export.

**How we would test it.**

1. Every row names an app, a person and a time.
2. A note that was changed after the fact shows as changed.
3. An export for one path contains nothing from other paths.
4. The report wording never claims certification or compliance.

---

## 5. Support and sales sharing customers

**Status:** planned.

**Who it is for.** Support, success and sales teams at a software company.

**The problem.** What sales promised, what support learned and what success renewed sit in three
systems, and no one's assistant knows all three.

**What Memev does today.** One memory that any app can read and write.

**What the custom module adds.** One note per customer, a layout for it, and a connection that adds
the key facts from the company's CRM and ticketing tools into it, so every assistant answers from the
same note.

**Example input.** "What did we promise customer C?"

**Example output.** The same answer in every app: the promise, who made it, when, and the ticket it
relates to.

**How we would test it.**

1. A fact added from the ticket system appears in the customer note and is attributed to that source.
2. Two apps asked the same question return the same answer.
3. A customer's note is not readable by a member without access to that customer's area.
4. Removing a connection stops new facts and leaves the old ones in place.

---

## 6. An incident that spans apps and people

**Status:** planned.

**Who it is for.** On-call engineers working through a night incident.

**The problem.** The person who fixed it last time is asleep, and the fix lives in their head or their
own assistant.

**What Memev does today.** A lesson recorded once is recalled in that person's later sessions.

**What the custom module adds.** An incident area that several people write to during the night, with
a rule that only the on-call group may write, a timeline view, and a closing summary.

**Example input.** An on-call engineer records: "The worker needs a smaller pool after a failover."

**Example output.** Ten minutes later a colleague asks why the worker is slow and the answer includes
the lesson, its author and its time.

**How we would test it.**

1. A lesson recorded by one person is recalled by another within one sync cycle.
2. A person outside the on-call group cannot write to the incident area.
3. When two people disagree, both versions are kept with their times.
4. The closing summary lists every contributor.

---

## 7. A research group that must not lose a result

**Status:** planned.

**Who it is for.** A lab or an analytics team.

**The problem.** Results, dead ends and decisions are scattered across notebooks, chats and people.

**What Memev does today.** Facts are added, not overwritten. Conflicts are kept side by side with
dates and sources. The history is the lab book.

**What the custom module adds.** A shared lab book layout, an entry template for a result and a dead
end, and attribution of every entry to a person and a computer. Two people's offline notes are merged
without anyone resolving it by hand, where the changes do not clash.

**Example input.** Two people each record a result for the same experiment while offline.

**Example output.** Both results are in the lab book, each with its author, time and source, and any
disagreement is shown side by side.

**How we would test it.**

1. Two offline entries merge into one document with both present.
2. No entry is overwritten.
3. Every entry has an author, a computer and a time.
4. A disagreement is listed, not silently resolved.

---

## 8. Onboarding a new hire

**Status:** planned.

**Who it is for.** A new designer joining a small agency.

**The problem.** The first month goes on asking what was decided and why.

**What Memev does today.** A session starts with the north star, the active work and recent decisions.

**What the custom module adds.** A first-session pack for a role: the company's north star, the active
work and the last quarter's decisions, filtered to what the new person is allowed to see. What the
new person learns goes back into the memory for the next hire.

**Example input.** A new hire's first session.

**Example output.** A summary of the north star, active work and recent decisions, and nothing from
areas the person is not on.

**How we would test it.**

1. The first session returns the north star, active work and recent decisions.
2. It returns nothing from an area the person is not trusted for.
3. A question about an area outside their access returns "nothing in the vault".
4. A fact the new person adds is returned to the next new hire.

---

## 9. Memory without a new vendor in the data path

**Status:** planned.

**Who it is for.** A company whose policy forbids a third-party memory service from holding company
knowledge.

**The problem.** Most memory services put a vendor database in the middle.

**What Memev does today.** No account, no vendor database and no telemetry by default. The memory is
files you run and own.

**What the custom module adds.** A deployment checklist and a check script for the company's own
environment, which confirm where the data is, that nothing leaves except what the company allows, and
who can reach the company server. If a hosted option is used instead, the module says clearly that we are then in
the data path as the company's processor and what we can read while serving.

**Example input.** The company runs the check script in its own network.

**Example output.** A pass or fail for each item, with the evidence.

**How we would test it.**

1. With no outside connection allowed, Memev still starts and recalls.
2. The script reports every outbound connection Memev tries, and there are none by default.
3. For a hosted setup the report states that the company server can read what it serves.

---

## 10. Accounting: supplier bill intake

**Status:** planned.

**Who it is for.** Accounting and bookkeeping firms.

**The problem.** Supplier bills arrive by email, and most of the time goes on typing them in, matching
them and chasing exceptions.

**What Memev does today.** Remembers a firm's rules, supplier habits and past exceptions for every AI
app.

**What the custom module adds.** It reads bills from a shared inbox, extracts the fields, matches the
supplier and the purchase order, checks for duplicates, and proposes a draft bill with its coding, or
routes the bill as an exception. It stops at a person: nothing is posted to the ledger until a
bookkeeper approves.

**Example input.** A bill from a supplier with a changed bank detail.

**Example output.** "Exception: the bank detail differs from the one on file. Held for a person. No draft created."

**How we would test it.**

1. A normal bill produces a draft with coded lines and the supplier matched.
2. A duplicate bill is routed as an exception.
3. A changed bank detail is always an exception.
4. The module never posts to the ledger and never deletes anything.
5. A bill with a missing field produces a request for the field, not a guess.

---

## 11. Logistics: quote request drafting

**Status:** planned.

**Who it is for.** Freight forwarders and brokers.

**The problem.** Quote requests wait in an inbox, and slow replies lose the business.

**What Memev does today.** Remembers the firm's rate rules and customer habits across AI apps.

**What the custom module adds.** It finds quote requests, extracts the route, mode, weight, dates and
terms, prices them from the firm's own rate sheet and drafts the reply for the dispatcher. A missing
field produces a question to the customer instead of a guess. A person approves every price.

**Example input.** A request that names a route and weight but no dates.

**Example output.** A draft reply asking for the dates, and no price.

**How we would test it.**

1. A complete request produces a draft price from the rate sheet.
2. A request with a missing field produces a question and no price.
3. A dangerous goods request is routed to a person with no draft price.
4. Nothing is sent without a person's approval.

---

## 12. Property management: maintenance triage

**Status:** planned.

**Who it is for.** Property managers and coordinators.

**The problem.** Maintenance requests come in all day, and routine admin takes most of the week.

**What Memev does today.** Remembers each property's history, vendors and rules across AI apps.

**What the custom module adds.** It reads tenant requests, sorts them by trade and priority, checks
for an open duplicate and proposes the work order and the reply to the tenant. An emergency is
handed to a person immediately and is never queued.

**Example input.** "I can smell gas in the kitchen."

**Example output.** "Emergency. Call now." routed to the on-duty person, with no draft work order held back.

**How we would test it.**

1. A gas, flood, heat or electrical emergency is escalated at once.
2. A routine request produces a work order proposal with trade and priority.
3. A request that matches an open work order is flagged as a duplicate.
4. Nothing is sent to a tenant or a vendor without approval, except the emergency escalation to staff.

---

## 13. Construction: information request intake

**Status:** planned.

**Who it is for.** Contractors and subcontractors who run project administration.

**The problem.** Requests for information pile up, take days to answer and cost real time to log and
route.

**What Memev does today.** Remembers a project's decisions, specs and earlier answers.

**What the custom module adds.** It reads incoming requests, checks they are complete, finds the
related spec and drawing references and similar answered requests, proposes the log entry, who holds
the ball and the due date, and drafts the transmittal. It flags anything that touches structure, life
safety, cost or schedule. It never answers a design question. The design professional does. This
pairs with [plan clash checking](#1-cross-team-plan-clash-checking).

**Example input.** A request about a beam size.

**Example output.** A log entry proposal, the related drawing and an earlier answer, flagged as touching structure and routed to the design professional.

**How we would test it.**

1. A complete request produces a log entry with a due date.
2. A request touching structure is flagged and routed to a person.
3. A request that duplicates an answered one points to that answer.
4. The module never writes an answer to a design question.

---

## 14. Healthcare administration: prior approval preparation

**Status:** planned.

**Who it is for.** Practices that prepare prior approvals for a scheduled service. Non-clinical work only.

**The problem.** Assembling a prior approval packet takes hours every week.

**What Memev does today.** Remembers the practice's payer rules and checklists, never patient records.

**What the custom module adds.** For a scheduled service it checks whether the payer's rules need
prior approval, lists what the packet needs and what is missing, and proposes the submission for staff
to send. It never makes or suggests a clinical decision, never contacts a patient or a payer, and
runs only on the practice's own hosting under the practice's own privacy rules. It carries the minimum
patient data needed.

**Example input.** A scheduled service whose packet lacks a signed note.

**Example output.** "Needs prior approval. Missing: the clinician's signed note. Not ready to send."

**How we would test it.**

1. A service that needs prior approval produces a packet checklist.
2. A missing item is listed and the packet is marked not ready.
3. A clinical field in a payload is refused.
4. Nothing is sent to a payer or patient.
5. Test data is fictional and holds no real patient information.
