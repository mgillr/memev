# Organisational intelligence

[Back to the docs index](README.md)

How a shared workspace can notice something across otherwise independent work without becoming an unbounded inference engine. This page defines the one record the layer produces, a finding, and the three events that let people dismiss, correct and decide it. The code is the finding part of `src/engine/graph.mjs`, and `test/findings.test.mjs` pins what is written here.

## Status

Planned. The finding model is built and tested as a data model on the memory graph: raising, dismissing, correcting, adjudicating and verifying a finding are graph operations, and a reader sees a finding only as far as their scope allows. Nothing raises a finding yet. No code watches work across projects, detects a conflict or a link, ranks findings or routes a decision; that detection, with its precision and recall, is the next contract (SO-F-13) and stays an architectural target until it lands. The product does not offer this layer today, and the names and shapes here may change before it does.

## What a finding is

A finding is a claim in the memory graph, the same claim `src/engine/graph.mjs` already holds for `memev_claim`, with more attached to it:

- the source events it rests on, each with the version of the record it was read at, and the scope that record lives in;
- the entities it affects and the owners who would act on it, each tied to the source it came from, or to the finding as a whole;
- its own scope, and a time context (from, and until or open);
- a confidence between 0 and 1 set by whatever raised it. The confidence is advice to a reader. It does not set the status.

The status is the claim status the graph already derives: conjecture, theory, fact, contested or refuted. Findings are stored as claims, so they are saved with the graph snapshot and rebuilt from the log the same way.

## The cap

For an ordinary claim, support of 0.85 or more from at least two independent sources, with opposition under 0.2, makes it a fact. That rule is unchanged.

For a finding, evidence alone stops at theory, however strong and however many the sources. A finding is a fact only when a person has confirmed it (an adjudication) or a verification record has passed. Contested and refuted stand as the graph derives them from the evidence, because the cap guards the step to fact and nothing else. The same evidence on an ordinary claim and on a finding therefore gives fact and theory.

Who counts is decided from the event itself, never from what a session says about itself:

- an adjudication takes effect only from a person subject (SO-F-01). The same event from an agent, a device, a node, an operator or a service is recorded and does nothing;
- a verification record names an `outcome.verified` event and a result. It takes effect only when the result is a pass and it comes from a person, operator or service subject. A failed result, or one from an agent, is recorded and does nothing;
- a status change written straight to the log does not set a finding's status. It is derived, so the log cannot be used to skip the cap;
- the latest effective decision stands: a person's rejection makes the finding refuted, and a later confirmation makes it a fact.

The `by` field of an event names the subject that acted. The graph does not authenticate it; whatever writes the event sets it from the resolved credential (SO-F-01), and until a writer does, nothing in the product writes these events.

## The three events

Each is an append-only operation in the same log as claims, named for what it does. Nothing is deleted; each leaves an entry in the finding's own history with who acted, when, an optional reason and whether it took effect.

- **Dismissal** (`claim.finding.dismiss`). A person or any subject says a finding is not wanted. A dismissed finding leaves the default listing and stays in the record. A finding raised later on the same set of sources at the same versions is not taken in again, in any order of the sources. A new version of a source, a different source, or an extra source is new evidence and may raise a finding again.
- **Correction** (`claim.finding.correct`). Changes the statement (subject, predicate, object), the confidence, the time context, or the entities and owners. The history entry holds each changed field with its old and new value. Sources and scope are provenance and cannot be corrected: a finding on other sources is a new finding.
- **Adjudication** (`claim.finding.adjudicate`). A decision, confirm or reject, with a reason. It sets the status as described under the cap when a person makes it.

Verification (`claim.finding.verify`) is a separate record, not one of the three. It is how a passing verification record reaches a finding without a person.

## What a reader sees

A finding never discloses a record its reader has no permission for. Permission is the scope rule of SO-F-01: a reader's scope reads a source only when it is that source's scope.

- A reader whose scope does not reach the finding's scope gets nothing: not the finding, and not a hint that one exists. A missing finding and a forbidden one look the same.
- A reader who may read every source sees the statement, the sources with their versions and paths, and the full history.
- A reader who may read only some sources sees those sources, how many are withheld, and the status and confidence. The statement, the reasons and corrections in the history, and every entity or owner drawn from a withheld source are withheld with them, because the statement is drawn from all of the sources together.

This is a view over the graph. The ordinary claim listing and provenance calls of the vault do not know about it and are not changed here, so nothing may raise a finding through them until they route through this view.

## What is not here

- Detecting anything: conflicts, links between projects, decision routing, precision and recall (SO-F-13).
- A fact lattice. The knowledge status lattice is owned by the programme package that defines it; when it lands, the cap here maps into it as at most corroborated.
- Any merge engine. Findings travel as operations like any other graph operation, and convergence stays behind the provider boundary of `src/engine/merge.mjs`.
- A second store. Findings live in the vault's graph.

## Change log

- Version 1: the finding model, the cap, the four events and the scoped view.
