# The audit

> **Example. Planned.** This walk-through shows the intended shape of shared memory for a company on Business. Steps marked *today* work now; steps marked *planned* do not exist yet. Names are roles, and the data is fictional. Back to [custom module use cases](../use-cases.md).

**Related use case:** [a regulated company's AI programme](../use-cases.md#4-a-regulated-companys-ai-programme).

## Steps

1. *Planned.* A reviewer asks what the team's assistants knew about one customer since the start of the
   quarter, and who wrote it.
2. *Planned.* The audit view lists every operation on that customer's notes: the computer, the member,
   the time, and a fingerprint of the operation linked to the one before it, so the reviewer can check
   the chain themselves.
3. *Planned.* The reviewer exports one area to a file, decrypted for the reviewer only.

## What this shows and does not show

It shows the record was not changed after the fact. It does not show the record is true, and it does
not make anyone compliant. It is evidence for the reviewer. See the
[Evidence Pack](../../roadmap/add-ons.md#2-evidence-pack).

## Acceptance checks

1. Every row names a computer, a member and a time.
2. Changing an old entry breaks the chain, and the reviewer's check reports it.
3. An export for one area holds nothing from other areas.
4. The export is readable only by the reviewer it was made for.
