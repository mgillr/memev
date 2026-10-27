# A decision made in one app, used in another

> **Example. Planned.** This walk-through shows the intended shape of shared memory for a company on Business. Steps marked *today* work now; steps marked *planned* do not exist yet. Names are roles, and the data is fictional. Back to [custom module use cases](../use-cases.md).

**Related use case:** [an engineering team across several AI apps](../use-cases.md#2-an-engineering-team-across-several-ai-apps).

## Steps

1. *Today.* In the morning, a team member tells their coding app: "We decided to ship the beta after
   the launch review." The app records it as a decision, dated, under that member's computer.
2. *Planned.* A few minutes later the hub has received the note and a second member's vault has pulled it.
3. *Planned.* The second member asks their review app "when do we ship?" and gets the decision with
   its date, source and author. Nobody pasted anything.

## Example output

```text
Decision: ship the beta after the launch review.
Recorded: this morning, by member 1, from the coding app.
```

## Acceptance checks

1. The decision is returned in a different app within one sync cycle.
2. The answer names the author, the time and the source.
3. A member not trusted for the area the decision is in does not receive it.
