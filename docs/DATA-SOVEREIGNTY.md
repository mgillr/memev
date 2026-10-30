# Data sovereignty

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[Federation](FEDERATION.md), [Federated computation](FEDERATED-COMPUTATION.md),
[Threat model](THREAT-MODEL.md), [Cloud access](CLOUD.md).

## Purpose

Memev must support deployments where data, derived information and computation are subject to
different organisational and jurisdictional rules. Sovereignty is an architectural policy, not a
frontend preference or a single setting on a vault.

The rules apply to source records and also to summaries, embeddings, indexes, graph edges, caches,
logs, telemetry, backups, model context, model updates and disaster-recovery copies.

## Policy dimensions

A policy should be evaluated against at least:

- data owner and responsible organisation;
- source location and applicable jurisdiction;
- classification and purpose limitation;
- permitted users, agents, services and sites;
- allowed processing locations;
- allowed replication and backup destinations;
- permitted derived data and disclosure levels;
- retention, legal hold and deletion requirements;
- encryption and key custody;
- audit, evidence and policy version;
- recovery requirements and approved recovery locations.

## Replication classes

A federation should be able to distinguish:

1. **Local only:** source data and restricted derivatives remain within the originating boundary.
2. **In-jurisdiction replication:** copies may be held at approved locations in the same jurisdiction.
3. **Federation metadata:** identity, status, version, permitted references or minimal coordination
   metadata may be shared.
4. **Approved derived state:** specific summaries, metrics, model updates or evidence may be shared
   after policy checks.
5. **Cross-border replication:** explicitly permitted classes may be transferred to named
   jurisdictions and destinations.
6. **Recovery copies:** designated data may be replicated to approved recovery sites under defined
   RPO/RTO and access controls.

The policy must not assume that because a source record can be read by one user, it can be copied
to every site or included in every model context.

## Source residency and computational participation

A participant may be prohibited from exporting source data but permitted to execute an approved
calculation locally and return a restricted result. That result still requires review: gradients,
model updates, embeddings, statistics and other derived outputs can disclose sensitive information.

Federated computation is not automatically privacy-preserving. Data-local execution, secure
aggregation, differential privacy, encryption and output controls must be selected according to
the workload's threat model and legal requirements.

## Revocation, deletion and derived data

When access or a policy changes, Memev must identify affected replicas and derived objects and
re-evaluate whether they remain permitted. Revocation cannot recall information already copied or
observed outside the system, but the platform should stop future access, propagation and processing
where possible, invalidate controlled caches, and record the action and its limits.

Deletion and retention rules must distinguish:
- active source records;
- replicas and materialised views;
- derived summaries and embeddings;
- caches and indexes;
- logs and audit evidence;
- backups and immutable recovery copies;
- model artefacts and updates that may contain information from source data.

Some records may need to be retained for audit or legal hold. The policy engine must make that
conflict explicit rather than silently deleting or retaining data.

## Site failure and recovery

A failed site must not cause the federation to pretend that its source data is available elsewhere.
Other sites may continue using the last authorised state they hold, with visible freshness and
availability labels. The latest changes that had not been replicated before the failure may be
unavailable.

Every data class needs defined:
- permitted recovery locations;
- recovery-point objective (RPO);
- recovery-time objective (RTO);
- backup frequency and integrity checks;
- key recovery and access controls;
- reconciliation procedure after the site returns.

Resilience replication does not grant every replica operator access to raw source data. Storage,
processing, query and administrative permissions remain separate.

## Acceptance criteria

A deployment claiming sovereignty support must test:

1. a jurisdiction matrix covering source, processing, replication, backup and recovery;
2. denial of unauthorised cross-border transfers;
3. enforcement for derived records, embeddings, caches, logs and model context;
4. policy changes and revocation against queued and previously replicated objects;
5. local computation with restricted result export;
6. site outage with visible last-known state and freshness;
7. recovery against declared RPO/RTO;
8. deletion, retention and legal-hold interactions;
9. auditability of policy decisions and exceptions.

## Status

The current product has local storage, optional remote access, per-device credentials and scoped
access mechanisms. Full jurisdiction-aware replication, policy propagation, derived-data
governance and sovereign disaster recovery are architectural targets and require dedicated
implementation and testing. This document specifies the direction; it does not claim legal
compliance or shipped functionality.
