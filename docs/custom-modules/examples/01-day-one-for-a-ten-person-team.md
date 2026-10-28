# Day one for a ten-person team

Part of the [Memev documentation](../../README.md). Up: [the walk-throughs](README.md), [custom modules](../README.md).

> **Example. Planned.** This walk-through shows the intended shape of shared memory for a company on Business. Steps marked *today* work now; steps marked *planned* do not exist yet. Names are roles, and the data is fictional. Back to [custom module use cases](../use-cases.md).

**Related use case:** [an engineering team across several AI apps](../use-cases.md#2-an-engineering-team-across-several-ai-apps).

## Steps

1. *Planned.* The lead sets up the company server on a small server in the office network and creates the
   one company vault, the first admin role and the licence.
2. *Planned.* The lead invites each member and says which areas of the vault that person is trusted
   for, for example the work area and the company area, and a role of member.
3. *Today.* Each member installs Memev on their own computer as usual and connects their AI apps.
4. *Planned.* Each member joins the company server with their invite. From then on their work data syncs into
   the company vault on every write.
5. *Today.* Their AI apps read and write the same shared areas as everyone else's. Private work
   stays outside Memev.

## What the member sees

Nothing changes in how a session works. A session starts with the north star and the active work, and
now they are the company's.

## Acceptance checks

1. A member who has joined starts a session and gets the company's north star and active work.
2. A note written by one member is readable by another within one sync cycle.
3. Private work a member keeps outside Memev never appears in the company vault.
4. A member who was not invited cannot join.
