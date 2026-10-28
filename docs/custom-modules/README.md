# Custom modules

> **DRAFT. Status: planned.** No custom module is built or on sale. This folder describes the kind of
> work we plan to do, and each page doubles as a test plan.

A **custom module** is business-specific work that Memev can be extended with. It is delivered as
custom implementation work for **Business** and **Corporate** (both coming), priced **quoted** per job (see
[add-ons](../roadmap/add-ons.md#1-custom-implementation-services) and [services](../tiers/services.md)).

The free core stays as it is. A module sits next to it and adds what one business needs: a connection
to a tool it already uses, a check that runs when a note changes, a layout for its notes, or a
report. A module reads and proposes. Where a module would change another system, a person approves
the change first.

## What is in this folder

| Page | What it holds |
|---|---|
| [use-cases.md](use-cases.md) | 14 use cases. Each says who it is for, the problem, what Memev does today, what a module adds, an example input and output, and acceptance checks. All are planned. |
| [examples/](examples/) | 6 walk-throughs of a day in a shared memory, one file each. All are examples, written as illustrations of the intended shape. |

## How a use case works as a test case

Every use case ends with **acceptance checks**: short statements that are either true or false when
the module runs against a fictional vault. We agree them with the customer before the work starts,
run them on delivery, and hand them over so the customer can run them again after every upgrade.

A good check names one input, one expected result and one thing that must not happen. For example,
"a note for client A is never returned to a member who is not on client A" is a check. "It feels
secure" is not.

## Ground rules for every module

- **Nothing from your systems enters the Memev repository.** Test data is fictional.
- **A module proposes, a person approves.** Nothing is sent, paid, deleted or written to a system of
  record without a human step.
- **The free tier is not touched.** A module never limits, slows or removes anything in Personal.
- **Honest wording.** We do not call anything proven safe or end-to-end encrypted unless it
  is. A module that reports on evidence says what the evidence shows and no more.
- **Who owns the module's code is written into each order.**
- **Modules run with the access you give them**, so we start with modules we write ourselves and
  review before anyone else's are allowed.

## Starting a custom module

1. Pick the closest use case in [use-cases.md](use-cases.md), or describe your own.
2. We agree the scope, the inputs and outputs and the acceptance checks in writing.
3. We build it against a fictional copy of your setup, then run the checks.
4. You run the same checks yourself before it goes live.

To ask for one, contact us. See [PRICING.md](../PRICING.md).
