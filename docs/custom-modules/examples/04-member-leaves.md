# A member leaves

> **Example. Planned.** This walk-through shows the intended shape of shared memory for a company on Business. Steps marked *today* work now; steps marked *planned* do not exist yet. Names are roles, and the data is fictional. Back to [custom module use cases](../use-cases.md).

**Related use cases:** [a consultancy with strict walls between clients](../use-cases.md#3-a-consultancy-with-strict-walls-between-clients) and [a regulated company's AI programme](../use-cases.md#4-a-regulated-companys-ai-programme).

## Steps

1. *Planned.* An admin removes a member.
2. *Planned.* The hub rotates the keys for every area the member was trusted for and marks their
   computer as no longer trusted.
3. *Planned.* Anything that arrives later from that computer is held aside and not merged.

## What stays the same

The leaver's laptop keeps the files it already had, as any laptop would. It receives nothing new and
cannot write anything the team will see. We say this plainly: removing access stops new data, it does
not recall what was already on a computer.

## Acceptance checks

1. After removal, the member's computer receives no new notes.
2. A write from that computer after removal is held, not merged.
3. The audit view shows the removal, who did it and when.
4. The keys for the member's areas have changed.
