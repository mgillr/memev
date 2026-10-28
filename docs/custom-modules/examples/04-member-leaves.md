# A member leaves

> **Example. Planned.** This walk-through shows the intended shape of shared memory for a company on Business or Corporate. Steps marked *today* work now; steps marked *planned* do not exist yet. Names are roles, and the data is fictional. Back to [custom module use cases](../use-cases.md).

**Related use cases:** [a consultancy with strict walls between clients](../use-cases.md#3-a-consultancy-with-strict-walls-between-clients) and [a regulated company's AI programme](../use-cases.md#4-a-regulated-companys-ai-programme).

## Steps

1. *Planned.* An org admin removes a member. All of that member's vault access ends.
2. *Planned.* The member's keys are revoked, for the work vault and for every area of the company
   vault they were trusted for, and their devices are removed.
3. *Planned.* The local cache on those devices is wiped.
4. *Planned.* The member's work vault stays with the company.
5. *Planned.* Anything that arrives later from those devices is held aside and not merged.

## What stays the same

The member's personal or home vault is not part of this. It never crossed into the company, it has
its own identity and keys, and it is untouched. We say this plainly: removing access wipes the
company's cache on the member's devices and stops all new data, but it does not recall what the
person already read or copied outside Memev.

## Acceptance checks

1. After removal, the member's devices receive no new notes and hold no cached company notes.
2. A write from those devices after removal is held, not merged.
3. The audit view shows the removal, who did it and when.
4. The member's keys are revoked, and the work vault is still with the company.
5. The member's personal vault is unchanged.
