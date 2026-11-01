// SPDX-License-Identifier: Apache-2.0
// Adapters between the three record shapes the engine writes today and the canonical operation envelope (version 1):
// the op-log record (src/engine/oplog.mjs), the bus message (src/engine/bus.mjs) and the project-store event
// (src/engine/project-store.mjs). Each one converts to an envelope and back without loss: the text of the source record is
// carried in the payload exactly as JSON.stringify wrote it, so the record that comes back has the same key order, the same
// bytes and the same record hash. The fields of the envelope are mapped from the record on top of that, so records of the
// three shapes can be compared, hashed and put in one order. docs/OPERATION-ENVELOPE.md is the specification.
//
// What the adapters do not do: they add no field of their own to the envelope and no extension block, and they never claim
// that a record was observed or verified, because the shape of a record is not evidence (every record is status `none`).
// Splitting the log, stamping a scope on a record and the signature block belong to other contracts. This module reads no file.
import { EnvelopeError, buildEnvelope, decodeEnvelope, mergeContractHash } from './envelope.mjs';
import { sha256 } from './util.mjs';

/** The three source shapes, as named in `payload.shape`. */
export const ADAPTER_SHAPES = Object.freeze(['oplog', 'bus', 'project_event']);
/**
 * The merge contract of a log that only orders its own records: the op-log order of the clock stamp, the node, then the id.
 * A caller that runs under another contract passes its own, and the envelope carries the hash of the one it ran under.
 */
export const LOCAL_MERGE_CONTRACT = Object.freeze({ strategy: 'oplog-order', mapping_version: 'oplog-1', policy: Object.freeze({}) });

// the envelope `type` is the source type under the name of its shape, so the three shapes never share a type
const TYPE_PREFIX = Object.freeze({ oplog: 'oplog', bus: 'bus', project_event: 'store' });
const UNATTRIBUTED = 'unattributed';   // a record with no agent
const LOCAL_NODE = 'local';            // a record with no device
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const HLC_RE = /^\d{13}\.\d{4,}$/;

const refuse = (message, code = 'bad_adapter_input') => new EnvelopeError(code, message);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const textOr = (v, fallback) => (typeof v === 'string' && v.length > 0 ? v : fallback);
const idOrNull = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);

function mergeHashOf(opts) {
  const o = opts ?? {};
  if (o.mergeContract !== undefined && o.mergeContractHash !== undefined) throw refuse('give the merge contract or its hash, not both');
  if (o.mergeContract !== undefined) return mergeContractHash(o.mergeContract);
  if (typeof o.mergeContractHash === 'string' && HASH_RE.test(o.mergeContractHash)) return o.mergeContractHash;
  throw refuse('the merge contract (mergeContract) or its SHA-256 (mergeContractHash) is required: an envelope always names the contract it ran under');
}

// The clock stamp of a record: the one it carries, or the one the op log orders a record without one by (its time, then 0000).
function stampOf(rec) {
  if (rec.hlc) { if (typeof rec.hlc === 'string' && HLC_RE.test(rec.hlc)) return rec.hlc; throw refuse(`hlc is not a clock stamp: ${JSON.stringify(rec.hlc)}`); }
  const ms = Date.parse(rec.ts);
  if (!Number.isFinite(ms) || ms < 0 || ms > 9999999999999) throw refuse('the record has no clock stamp and its time (ts) is not a date');
  return `${String(ms).padStart(13, '0')}.0000`;
}

function textOf(rec) {
  let text;
  try { text = JSON.stringify(rec); } catch (e) { throw refuse(`the record cannot be written as JSON: ${e.message}`); }
  if (typeof text !== 'string') throw refuse('the record cannot be written as JSON');
  return text;
}

function make(shape, rec, fields, opts) {
  return buildEnvelope({
    origin: fields.origin,
    op_id: fields.op_id,
    deps: fields.deps ?? [],
    hlc: stampOf(rec),
    project: fields.project ?? null,
    object: fields.object ?? null,
    type: `${TYPE_PREFIX[shape]}.${rec.type}`,
    payload: { shape, record_text: textOf(rec) },
    merge_contract_hash: mergeHashOf(opts),
  });
}

function oplogFields(rec) {
  if (!isObject(rec)) throw refuse('an op-log record is an object');
  if (!Number.isInteger(rec.seq) || rec.seq < 1) throw refuse('seq: an op-log record has a sequence number');
  if (typeof rec.type !== 'string') throw refuse('type: an op-log record has a type');
  if (typeof rec.hash !== 'string' || !HASH_RE.test(rec.hash)) throw refuse('hash: an op-log record has the SHA-256 the log wrote');
  if (rec.prev !== undefined && rec.prev !== null && !(typeof rec.prev === 'string' && HASH_RE.test(rec.prev))) throw refuse('prev: must be the hash of the previous record of the note, or null');
  if (rec.path !== undefined && rec.path !== null && typeof rec.path !== 'string') throw refuse('path: must be text or null');
  return {
    origin: { identity: textOr(rec.agent, UNATTRIBUTED), node: textOr(rec.dev, LOCAL_NODE) },
    op_id: `oplog:${rec.hash}`,
    deps: rec.prev ? [`oplog:${rec.prev}`] : [],   // the hash chain of a note is its causal order
    object: rec.path ? `path:${sha256(rec.path)}` : null,
  };
}

function busFields(msg) {
  if (!isObject(msg)) throw refuse('a bus message is an object');
  for (const k of ['id', 'device', 'from', 'type']) if (typeof msg[k] !== 'string') throw refuse(`${k}: a bus message has it as text`);
  return {
    origin: { identity: msg.from, node: msg.device },
    op_id: `bus:${msg.id}`,
    project: idOrNull(msg.project),
    object: idOrNull(msg.ref),
  };
}

function projectEventFields(rec, opts) {
  if (!isObject(rec)) throw refuse('a project-store event is an object');
  if (typeof rec.id !== 'string') throw refuse('id: a project-store event has an id');
  if (typeof rec.type !== 'string') throw refuse('type: a project-store event has a type');
  // a stored event does not hold the id of its project, so the caller says which project the log belongs to
  const project = opts?.project ?? null;
  if (project !== null && !(typeof project === 'string' && ID_RE.test(project))) throw refuse('project: must be a project id or null');
  return {
    origin: { identity: textOr(rec.agent, UNATTRIBUTED), node: textOr(rec.dev, LOCAL_NODE) },
    op_id: `store:${rec.id}`,
    project,
    object: idOrNull(rec.entity?.id),
  };
}

/** Op-log record to envelope. `opts`: { mergeContract } or { mergeContractHash }, one of them required. */
export function oplogRecordToEnvelope(rec, opts) { return make('oplog', rec, oplogFields(rec), opts); }
/** Bus message to envelope. */
export function busMessageToEnvelope(msg, opts) { return make('bus', msg, busFields(msg), opts); }
/** Project-store event to envelope. `opts.project` names the project the log belongs to. */
export function projectEventToEnvelope(rec, opts) { return make('project_event', rec, projectEventFields(rec, opts), opts); }

const TO_ENVELOPE = { oplog: oplogRecordToEnvelope, bus: busMessageToEnvelope, project_event: projectEventToEnvelope };

/** The shape an adapter wrote an envelope from, or null for an envelope that did not come from one. Does not check the envelope. */
export function shapeOfEnvelope(envelope) {
  const p = envelope?.payload;
  if (!isObject(p) || Object.keys(p).sort().join() !== 'record_text,shape') return null;
  return ADAPTER_SHAPES.includes(p.shape) ? p.shape : null;
}

function recordOf(shape, envelope) {
  const env = decodeEnvelope(envelope);
  if (shapeOfEnvelope(env) !== shape) throw refuse(`the envelope is not an adapter envelope of shape ${shape}`, 'wrong_shape');
  let rec;
  try { rec = JSON.parse(env.payload.record_text); } catch (e) { throw new EnvelopeError('bad_envelope', `payload.record_text is not JSON: ${e.message}`); }
  // Rebuild the envelope the adapter would write for this record. An envelope that differs holds something a record cannot
  // (an extension block, authorisation evidence, a contract reference) or maps its fields differently, and converting it
  // would drop that without a word, so it is refused.
  const again = TO_ENVELOPE[shape](rec, { mergeContractHash: env.merge_contract_hash, project: env.project });
  if (again.content_hash !== env.content_hash) throw refuse('the envelope holds more than the record it carries, or its fields do not match the record: converting it would lose data', 'lossy_conversion');
  return rec;
}

/** Envelope to op-log record: the record exactly as it was written. */
export function envelopeToOplogRecord(envelope) { return recordOf('oplog', envelope); }
/** Envelope to bus message. */
export function envelopeToBusMessage(envelope) { return recordOf('bus', envelope); }
/** Envelope to project-store event. */
export function envelopeToProjectEvent(envelope) { return recordOf('project_event', envelope); }
