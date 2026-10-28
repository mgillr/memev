# An incident at three in the morning

Part of the [Memev documentation](../../README.md). Up: [the walk-throughs](README.md), [custom modules](../README.md).

> **Example. Planned.** This walk-through shows the intended shape of shared memory for a company on Business. Steps marked *today* work now; steps marked *planned* do not exist yet. Names are roles, and the data is fictional. Back to [custom module use cases](../use-cases.md).

**Related use case:** [an incident that spans apps and people](../use-cases.md#6-an-incident-that-spans-apps-and-people).

## Steps

1. *Today.* While fixing an outage, the on-call engineer records a lesson in their coding app: "The
   worker needs a smaller connection pool after a failover. The default runs out."
2. *Planned.* Ten minutes later a colleague's app, asked why the worker is slow, recalls the lesson
   from the shared memory, with its author and time.
3. *Planned.* The incident note grows through the night from three people's sessions. If two of them
   disagree, both versions are kept with their times.

## Acceptance checks

1. The lesson is recalled by a second person's app within one sync cycle.
2. Only members of the on-call group could have written to the incident area.
3. Two disagreeing entries are both kept, in time order.
4. The closing summary names every contributor.
