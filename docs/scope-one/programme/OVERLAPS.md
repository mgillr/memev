# Overlaps and conflicts with existing contracts and plans (2026-10-31, 22:50 Europe/Zurich)

Part of the [programme decomposition](README.md). Up: the [documentation index](../../README.md).

All contracts in fragments/ are unsigned proofline/1 planning drafts. Nothing was signed, merged or pushed.

| Existing item | Overlaps with | Verdict | Keep |
|---|---|---|---|
| SR-2.01 (recall that finds paraphrases, memev-ops) | MV-REC-04, WP11-05 | Same requirement | Keep SR-2.01. WP11-05 only checks the interface. |
| SR-3.01 / SR-3.03 (engine decision, Node text merge in a new repo `memev-merge`, memev-ops) | MV-ARCH-02, MV-ARCH-03, MV-PGM-07 | Conflicts with the notes (crdt-merge substrate) and with PI-04/PI-05 | Keep the decision task WP05-02 first; hold the SR-3.03 build until the owner picks. Likely both layers survive (structured state on crdt-merge; Markdown text merge in Node). |
| WO-05-A (call-out boundary, landed) | MV-INT-05, MV-LIC-01 | Consistent | Keep as the shipped boundary; PR #201 (WO-05-B) is the client behind a flag. |
| PI-04, PI-05, PI-06 on branch dev-integration-specs (vendor the Apache-2.0 crdt-merge-ts core, build a Node oplog engine, property suite) | MV-ARCH-02, MV-LIC-01, WP02 | Conflicts: says it supersedes WO-05/WO-06 although WO-05-A landed as call-out | Do not run PI-04/PI-05 until WP05-02 decides. PI-06 overlaps WP02; merge the two plans into one gate. |
| PI-02, PI-03 (Ed25519 point screening, signature context binding) | MV-CRDT-07, MV-TRU-01 | Related; different repos (memev devices.mjs vs crdt-merge E4) | Keep both; WP09-01 depends on PI-02/03 outcomes. |
| PI-07 (relay exchange protocol) | MV-INT-06, WP12 | Overlap | Fold into WP12-02; keep PI-07 as the spec. |
| PI-08 (signed oplog), PI-09/PI-17 (agent identity, human binding) | MV-INT-02, MV-TRU-01 | Overlap | Fold PI-08 into WP04-02/04, PI-09/17 into WP09-01. |
| PI-18 (conflict radar on the bus) | MV-S1-03, WP08-04 | Overlap | Keep PI-18 as the bus-event half of WP08-04. |
| SR-3.05 / SR-3.06 (one licence statement, patents) | MV-LIC-03, MV-LIC-04, WP15-02/03 | Same requirement | Keep SR-3.05/3.06; WP15 tasks consume their results. |
| SR-6.07 / SR-6.10 (site claims) | MV-PRD-02, WP16-03 | Same area | Keep SR-6.x; WP16-03 is the README/tier-page half. |
| SR-1.15 (no code without a caller) | WP07, WP04-04, WP06-03 | Consistent | Rule applied through wiring verifiers. |
| PR #224 (federation and deployment levels, draft) | MV-ARCH-01, MV-FED-06, MV-PRD-02 | Consistent with the 31 Oct owner decision | Rework (still draft, 105 commits behind main) rather than merge as is. |
| PR #222 (architecture and delivery addendum, draft) | the notes' architecture | Advisory by its own text: only recommendations with explicit acceptance become contracts; rec. 13 (federated sites) needs owner decisions first | WP12-WP14 are gated on owner acceptance of that recommendation. |
| Owner decision 31 Oct 2026 (DECISIONS.md, a8e5332) | MV-PRD-04, MV-PRD-05, OQ-01 | Closes topology, providers, tier set; no Federated tier named | WP16-01 records whether a federation offer exists above it. |
| memev attest/1 signed contracts (contracts/signed, QL gates) | all fragments here | Different format (proofline/1 here) | Keep fragments as planning contracts in memev-ops; convert to attest specs only after the owner accepts a work package and its red-team record exists (QL-1.01). Do not sign. |
| the Scope One contract effort (report of 31 Oct) | WP07, WP08 | the 31 Oct report says none of the Scope One records wrote of the SO-C/O/L-* contracts and waits for owner decisions | No duplicate: WP07/WP08 reference only the already-landed SO-04-A, SO-07-A, SO-08-A. |
| the sibling programme (PG-*), the sibling proofline programme (AT-*) | none | Separate programmes | Reuse the sibling programme's layout (precedent). |
