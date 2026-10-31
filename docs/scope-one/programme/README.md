# Scope One programme decomposition

Part of the [Scope One records](../../README.md) (see also [DECISIONS.md](../DECISIONS.md)). This folder holds the programme decomposition of 31 October 2026: the programme requirements (`MV-*`), how they were derived, the work packages (WP01 to WP18) as proposed contracts, and the checks run over them.

Status: **proposed and unsigned.** Every contract here is a planning draft in the `proofline/1` format. None is signed, none has a red-team record, none is accepted. Signing, re-signing and red-team records belong to the lead workstream; nothing here replaces the Scope One `WBS.md` or the `SO-1.x` contracts (the lead workstream's work, PR #324). The reconciliation of these files against that work breakdown is in [../RECONCILIATION.md](../RECONCILIATION.md).

| File | What it holds |
| --- | --- |
| [REQUIREMENTS.md](REQUIREMENTS.md) | the `MV-*` requirement register |
| [DECOMPOSITION.md](DECOMPOSITION.md) | decisions, rejected items, open questions and each requirement against the repository |
| [WBS.md](WBS.md) | the programme work breakdown (82 tasks in 18 work packages), generated from the fragments; not the Scope One `WBS.md` one level up |
| [OVERLAPS.md](OVERLAPS.md) | overlaps with existing contracts and plans, and which one is kept |
| [VALIDATION.md](VALIDATION.md) | validation and coverage output |
| [memev-programme.proofline.json](memev-programme.proofline.json) | the merged programme contract |
| [fragments/](fragments/) | one proposed contract per work package |
| [wp-graph.json](wp-graph.json), [merge-order.txt](merge-order.txt) | work package dependencies and the order the fragments merge in |

## Superseded by the owner decisions of 31 October 2026

The fragments were written before the owner decision on the engine and on tiers. Where they differ, the decision wins and the text below overrides the fragment:

- **Engine:** crdt-merge (BSL-1.1) stays in its own repository and is reached only across the call-out boundary (WO-05-A, [docs/CONVERGENCE.md](../../CONVERGENCE.md)). It is never vendored, copied or ported into Memev. There is no new Memev merge engine or repository. WP05-02 is therefore decided, and the options in WP05 that vendor or rebuild an engine are not taken. PI-04 and PI-05 (branch `dev-integration-specs`) and SR-3.01 and SR-3.03 (memev-ops) are superseded.
- **Tiers:** Free core, Personal at $12/month or $120/year for up to 3 computers, contact us for anything above. There is no Federated tier, so `MV-PRD-04` and `DEC-14` are not adopted, and WP16-01 and WP16-07 do not add a tier or machine-count pricing. Federation stays planned, not shipping.
- **Licences:** stated once, in SR-3.05 and [../../PRICING.md](../../PRICING.md): Apache-2.0 core, BSL-1.1 crdt-merge, ACFA-RS under its own licence, commercial federated services. The BSL change date (2028-03-29) is not changed here; a lawyer review of it is an open item ([DECISIONS.md](../DECISIONS.md), ADR 6).

## Contract specs

The tasks in `fragments/` are turned into signable attest/1 specs in the [programme contract manifest](../../../contracts/programme/manifest.json): one spec per work package and repository (`PG-*`) and one per work pull request (`PGP-*`). Tasks that the Scope One contracts `SO-1.01` to `SO-1.11` already own are not specified again; the manifest lists each task with the contract that holds it. All of them are proposed and unsigned.
