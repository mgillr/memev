# The operation envelope

[Back to the docs index](README.md)

One record shape for an operation, written the same way on every device, so that two devices can compare, order and hash what they did without agreeing on anything else. This page is the specification of version 1. The module is `src/engine/envelope.mjs`, and `test/envelope.test.mjs` pins what is written here.

## Status

Version 1 is specified, the module is built, and the op log reaches it. This is what the code does today:

- **The module.** `src/engine/envelope.mjs` builds, validates, encodes and decodes envelopes, compares two of them in the order described below, and checks the merge contract hash.
- **The adapters.** `src/engine/envelope-adapters.mjs` converts each of the three record shapes in [why one envelope](#why-one-envelope) to an envelope and back without loss: `oplogRecordToEnvelope`, `busMessageToEnvelope` and `projectEventToEnvelope`, and `envelopeToOplogRecord`, `envelopeToBusMessage` and `envelopeToProjectEvent`. The text of the source record is carried unchanged in `payload.record_text`, beside `payload.shape`, so the record that comes back has the same bytes. The envelope `type` is the source type under the prefix `oplog.`, `bus.` or `store.`. The adapters add no extension block, no authorisation evidence and no contract reference, and every record they write has the status `none`, because the shape of a record is not evidence. An envelope that holds more than the record it carries is refused on the way back, as `lossy_conversion`, and is never converted with a loss.
- **The op-log write path.** After `OpLog.append` has written a record, it builds the envelope of that record with `oplogRecordToEnvelope`, under the merge contract the log was opened with (the `mergeContract` option; by default the one the adapters export as `LOCAL_MERGE_CONTRACT`: the strategy `oplog-order`, the mapping version `oplog-1` and an empty policy). `src/engine/vault.mjs` (line 62) opens its op log with `deviceId` and no `mergeContract` or `envelopes` option, so it gets the defaults and a write through the vault builds one too. The envelope is held in memory only, as `lastEnvelope`, for the latest append. Nothing of it is written to the log, the record on disk is unchanged, and no other code in `src` reads it. A record that cannot be an envelope is still written, because the log is the authority: `lastEnvelope` is then `null`, `envelopeFailures` counts it and `lastEnvelopeError` holds the message. The option `envelopes: false` turns the build off. The engine's entry module, `src/engine/index.mjs`, exports `buildEnvelope`. `test/envelope-wired.test.mjs` pins that an append and a write through the vault build an envelope that converts back to the record, that the record on disk is unchanged and no segment, snapshot or manifest file holds an envelope, that a reopened log has no `lastEnvelope`, that the `mergeContract` option and `envelopes: false` work, and that a record that cannot be an envelope is still written and counted. It does not pin that no other code in `src` reads `lastEnvelope`.
- **Contributions.** `src/engine/federation/contribution.mjs` builds envelopes whose extension block carries `extension.contribution` (the subject, the scope, the per-sender sequence, the payload hash and the signature), with `signContribution` and `validateContribution`. It does not use the adapters, and the op log does not build its envelope this way.
- **What does not use it.** The bus (`src/engine/bus.mjs`) and the project store (`src/engine/project-store.mjs`) do not call their adapters when they write: they still write their own record shapes. The op-log write path does not store its envelope. The only code that stores one is SO-F-03 admission (`src/engine/federation/admission.mjs`): `Admission` appends `federation.admitted` with the contribution envelope in `data.envelope`; it is built, but not yet called from the engine. Nothing in the engine sends an envelope to another device, orders records by envelope, or calls `checkMergeContract` or `requireMergeContract` outside the tests. The three shapes have no common stored form yet.

Two things are named here and defined elsewhere: [what other contracts add](#what-other-contracts-add), and what is [left open](#what-is-left-open).

## Why one envelope

Today the system has three record shapes for the same idea of "something happened": the op-log record (`src/engine/oplog.mjs`: a sequence number, a path, a hash chain, a clock stamp and the device), the bus message (`src/engine/bus.mjs`: an id, a sender, a recipient and a body) and the project-store event (`src/engine/project-store.mjs`: an id, a kind and a data object). They cannot be compared with each other, and none of them is written in a form two devices would produce byte for byte. The envelope is the one form they convert to when a record has to cross from one place to another.

## The fields

An envelope is one JSON object. Every field below is required except the extension block. A field that is not on this list is refused: a place to put more is the extension block.

| Field | What it holds |
|---|---|
| `schema` | The version, `memev-envelope/1`. |
| `origin` | `{ identity, node }`: who wrote the operation and on which node. Both are non-empty text. |
| `op_id` | The operation id: an opaque string of letters, digits and `. _ : -`, at most 128 characters, assigned when the operation is written. |
| `deps` | The causal dependencies: the ids of the operations this one was written after and depends on, sorted and without repeats. It never names the record itself. |
| `hlc` | The clock stamp: 13 digits of milliseconds, a dot, and a counter of 4 or more digits. It is the stamp the op log writes. |
| `project` | The project id, or `null`. |
| `object` | The id of the object the operation touches, or `null`. |
| `type` | What kind of operation it is: lower-case words joined by `.`, `_` or `-`, for example `dispatch.requested`. |
| `payload` | The operation's data: a JSON object, or `null`. |
| `authorisation` | The evidence that the writer was allowed to do it: a list of `{ kind, ref }`, each a reference to the evidence and never the evidence itself. The list may be empty. |
| `contract_ref` | A reference to the contract or policy the operation ran under, or `null`. |
| `merge_contract_hash` | The hash of the merge contract the operation ran under (see [the merge contract hash](#the-merge-contract-hash)). |
| `verification_status` | How far the operation is verified: `none`, `observed` or `verified` (see [verification status](#verification-status)). |
| `content_hash` | The SHA-256 of the canonical text of every other field. |
| `extension` | Optional. One JSON object that the content hash covers (see [the extension block](#the-extension-block)). |

## Deterministic serialisation

The canonical text of an envelope is its JSON, written in one way only:

- keys sorted by UTF-16 code unit, at every depth;
- no whitespace between tokens, and the whole record on one line;
- text written as UTF-8, with only the escapes JSON requires;
- numbers written in their shortest round-trip form;
- arrays keep their order.

A value JSON cannot hold is refused and never dropped or changed: `undefined`, a number that is not finite, a function, a date, a map, text that is not well-formed Unicode, a key that is not, an array with a gap, and an object that loops back on itself. The same envelope is therefore always the same bytes, whatever order its keys were built in.

## The content hash

`content_hash` is the lower-case hex SHA-256 of the canonical text of the envelope without `content_hash`. It covers the version, every field and the extension block, so a change to any of them is a different hash, and an envelope whose hash does not match its content is refused. A hand-edited `merge_contract_hash` is caught the same way.

## Verification status

`verification_status` states what a reader may rely on, and a record cannot claim more than its kind earns. The dispatch history keeps four kinds of event apart: a requested action, an accepted dispatch, an observed execution and a verified outcome.

| `type` | `verification_status` |
|---|---|
| `dispatch.requested` | `none` |
| `dispatch.accepted` | `none` |
| `execution.observed` | `observed` |
| `outcome.verified` | `verified` |
| any other type | `none` |

A record of another status for its type is refused. A provider's success-shaped answer is therefore never recorded as a confirmed outcome by the shape of the answer alone: only a record that is itself an `outcome.verified` event can be `verified`. What makes an outcome verified is the job of the contract that records it, not of the envelope.

## Identity and order

This section resolves ADR 2 (id and event ordering, `docs/scope-one/DECISIONS.md`) with its safe default, and the DECISIONS page is not edited here.

- **Ids are opaque.** An `op_id` is a string assigned when the operation is written. Nothing reads meaning into it, and it is never reused.
- **The order is the op-log order.** Envelopes are ordered by `hlc`, then by `origin.node`, then by `op_id`. That is the clock-then-device rule the op log already applies to its own records (the log breaks the last tie with its own sequence number). It is a total order, and the same from any input order. There is no reordering and no second sequence.
- **The log's own sequence number stays local.** It numbers one log, so it is not a field of the envelope.
- **Dependencies carry causality.** `deps` records what an operation was written after, so causality is in the record and does not rest on clocks alone.

## The extension block

The envelope reserves one optional extension block, `extension`. It is one JSON object that the content hash covers. The module writes, reads, round-trips and hashes it, and it interprets none of its fields: it does not look at their names, check their values or act on them. An absent block stays absent, and an empty object is a different envelope. Contracts that need fields of their own put them there, as listed in [what other contracts add](#what-other-contracts-add). Because the block is hashed, a change to it is visible, and because it is opaque to this module, adding to it never changes this module.

## The merge contract hash

Every envelope carries `merge_contract_hash`: the SHA-256 of the canonical text of the merge contract the operation ran under, which is the merge strategy, the mapping version and the policy fields: `{ strategy, mapping_version, policy }`. It follows the pattern of the merge gate of the converge engine, which is source-available under BUSL-1.1, so the pattern is described here and no code is copied.

An envelope whose hash differs from the local merge contract is refused with a signal, `merge_contract_mismatch`, that names the operation and both hashes. It is never merged silently across versions. `checkMergeContract` returns the signal and `requireMergeContract` raises it. An envelope with no hash, or a local hash that is not a SHA-256, is refused the same way. This module only compares the hashes; the merge itself stays behind the provider boundary of `src/engine/merge.mjs`.

## Wire compatibility

The envelope follows the wire-compatibility policy of the acfa-rs project (Apache-2.0), which is cited as the model:

- A change to the field list, to a field's meaning, or to the canonical text needs a new version: a new `schema` value.
- The old decoder is kept. The module holds one decoder per version, and adding a version adds a decoder and leaves the others in place. A record of a version nobody has registered is refused as `unsupported_version`, and is never read as the nearest version.
- Within a version, a record with a field that is not on the list is refused. More fields go in the extension block, not in the envelope.
- Every version is pinned by a fingerprint: the content hash of a fixed envelope, and the hash of the sorted field list. A silent change to a pinned fingerprint is a defect. `test/envelope.test.mjs` holds both values, and they are on this page.
- Every version has an entry in the change log below.

## What other contracts add

- **SO-F-03** adds the signature and admission block, the per-sender sequence and the rejected event on top of this envelope, as an extension block with fields of its own. None of them is defined here, and the envelope does not interpret them.
- **SO-F-12** adds scope and classification to the same envelope for stream records, and defines no second record format.

Both extend this envelope. Neither defines another.

## What is left open

- The bus and the project store write their own records and do not build an envelope. Their adapters exist and are tested, and nothing on their write paths calls them.
- The envelope the op log builds on each append is held in memory only. The op-log write path does not store it; the only code that stores an envelope is SO-F-03 admission, built but not yet called from the engine. Sending it to another device, and merging or ordering by it, are not done, and no real code path compares merge contract hashes between devices yet. The merge itself stays behind the provider boundary of `src/engine/merge.mjs`.
- The authorisation evidence is a list of references. What a reference points at, and how it is checked, belongs to the contract that checks it. The adapters write an empty list.
- The `type` values other than the four of the dispatch history are not enumerated here. The adapters write the source type under the prefix of its shape.

## Change log

| Version | Change |
|---|---|
| `memev-envelope/1` | The first version. Fields: `authorisation`, `content_hash`, `contract_ref`, `deps`, `extension`, `hlc`, `merge_contract_hash`, `object`, `op_id`, `origin`, `payload`, `project`, `schema`, `type`, `verification_status`. Fingerprint of the field list: `bfa0d253db251d903ba96317ca754420d447dd433486f9602e2f536d8a24566a`. Fingerprint of the fixed envelope of `test/envelope.test.mjs`: `26b671f3399d84fcb74e0adf5abad4ac4090c6e1a56bdd83e85fbb9b8018652a`. |
