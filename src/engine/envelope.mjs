// SPDX-License-Identifier: Apache-2.0
// The canonical operation envelope, version 1: one record shape that is built, written in one canonical form, hashed and checked.
//
// An envelope names who wrote an operation and where, the operation id, the operations it depends on, the project and object it
// touches, its type and payload, the evidence of authorisation, the contract or policy it ran under, the hash of the merge contract,
// how far it is verified, and one optional extension block. The content hash covers every field, the extension block included.
// The module reads the extension block as data and interprets none of it: other contracts give it fields of their own.
// docs/OPERATION-ENVELOPE.md is the specification. A change to the field list needs a new version, keeps this decoder, and has a
// change log entry there; test/envelope.test.mjs pins the fingerprints.
import crypto from 'node:crypto';

export const ENVELOPE_SCHEMA = 'memev-envelope/1';
/** Every field of version 1, sorted. `extension` is the only optional one. */
export const ENVELOPE_FIELDS = Object.freeze(['authorisation', 'content_hash', 'contract_ref', 'deps', 'extension', 'hlc', 'merge_contract_hash', 'object', 'op_id', 'origin', 'payload', 'project', 'schema', 'type', 'verification_status']);
/** What a reader may rely on: nothing beyond the writer's word, an execution that was seen, or an outcome that was checked. */
export const VERIFICATION_STATUSES = Object.freeze(['none', 'observed', 'verified']);

// The four kinds of the dispatch history keep apart, and each one carries only the status its kind earns.
const STATUS_OF_KIND = Object.freeze({ 'dispatch.requested': 'none', 'dispatch.accepted': 'none', 'execution.observed': 'observed', 'outcome.verified': 'verified' });
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const TYPE_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const HLC_RE = /^\d{13}\.\d{4,}$/;   // the clock stamp the op log writes
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_DEPTH = 64;

export class EnvelopeError extends Error {
  constructor(code, message, signal = null) { super(message); this.name = 'EnvelopeError'; this.code = code; if (signal) this.signal = signal; }
}

const sha256hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const wellFormed = (s) => typeof s === 'string' && s.isWellFormed();
const isText = (v, max) => wellFormed(v) && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);

/**
 * The canonical text of a JSON value: keys sorted by UTF-16 code unit, no whitespace, text as UTF-8, numbers as the shortest
 * round-trip form. A value JSON cannot hold (undefined, NaN, a function, a Date, a cycle) is refused, never dropped.
 */
export function canonicalize(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new EnvelopeError('bad_envelope', 'value is nested too deeply or loops back on itself');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number': if (!Number.isFinite(value)) throw new EnvelopeError('bad_envelope', 'a number must be finite'); return JSON.stringify(value);
    case 'string': if (!wellFormed(value)) throw new EnvelopeError('bad_envelope', 'text must be well-formed Unicode'); return JSON.stringify(value);
    case 'object': break;
    default: throw new EnvelopeError('bad_envelope', `a ${typeof value} is not a JSON value`);
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) { if (!(i in value) || value[i] === undefined) throw new EnvelopeError('bad_envelope', 'an array may not hold a gap or undefined'); parts.push(canonicalize(value[i], depth + 1)); }
    return `[${parts.join(',')}]`;
  }
  if (!isPlain(value) || Object.getOwnPropertySymbols(value).length) throw new EnvelopeError('bad_envelope', 'only plain objects are JSON values');
  const parts = [];
  for (const k of Object.keys(value).sort()) {
    if (!wellFormed(k)) throw new EnvelopeError('bad_envelope', 'a key must be well-formed Unicode');
    if (value[k] === undefined) throw new EnvelopeError('bad_envelope', `${k} is undefined`);
    parts.push(`${JSON.stringify(k)}:${canonicalize(value[k], depth + 1)}`);
  }
  return `{${parts.join(',')}}`;
}

/** The content hash: SHA-256 of the canonical text of every field except the hash itself. */
export function contentHash(envelope) {
  const { content_hash: own, ...rest } = envelope; void own;
  return sha256hex(canonicalize(rest));
}

/** The hash of a merge contract: the strategy, the mapping version and the policy fields. */
export function mergeContractHash(contract) {
  const bad = (m) => new EnvelopeError('bad_merge_contract', m);
  if (!isPlain(contract)) throw bad('a merge contract is an object');
  for (const k of Object.keys(contract)) if (!['strategy', 'mapping_version', 'policy'].includes(k)) throw bad(`unknown field ${k}`);
  if (!isText(contract.strategy, 64)) throw bad('strategy is required');
  if (!isText(contract.mapping_version, 64)) throw bad('mapping_version is required');
  if (!isPlain(contract.policy)) throw bad('policy is an object of fields');
  try { return sha256hex(canonicalize({ strategy: contract.strategy, mapping_version: contract.mapping_version, policy: contract.policy })); }
  catch (e) { throw bad(e.message); }
}

function fieldErrors(env) {
  const errs = [];
  const need = (f, ok, why) => { if (!(f in env)) errs.push(`${f}: missing`); else if (!ok(env[f])) errs.push(`${f}: ${why}`); };
  for (const k of Object.keys(env)) if (!ENVELOPE_FIELDS.includes(k)) errs.push(`${k}: not a field of ${ENVELOPE_SCHEMA}`);
  need('schema', (v) => v === ENVELOPE_SCHEMA, `must be ${ENVELOPE_SCHEMA}`);
  need('origin', (v) => isPlain(v) && Object.keys(v).sort().join() === 'identity,node' && isText(v.identity, 256) && isText(v.node, 256), 'must be { identity, node }, both text');
  need('op_id', (v) => typeof v === 'string' && ID_RE.test(v), 'must be an opaque id of letters, digits and . _ : -');
  need('deps', (v) => Array.isArray(v) && v.every((d) => typeof d === 'string' && ID_RE.test(d)) && v.every((d, i) => i === 0 || v[i - 1] < d) && !v.includes(env.op_id), 'must be a sorted list of distinct ids that does not name the record itself');
  need('hlc', (v) => typeof v === 'string' && HLC_RE.test(v), 'must be a clock stamp, 13 digits, a dot, then 4 or more digits');
  need('project', (v) => v === null || (typeof v === 'string' && ID_RE.test(v)), 'must be an id or null');
  need('object', (v) => v === null || (typeof v === 'string' && ID_RE.test(v)), 'must be an id or null');
  need('type', (v) => typeof v === 'string' && TYPE_RE.test(v), 'must be lower-case words joined by . _ -');
  need('payload', (v) => v === null || (isPlain(v) && jsonOk(v)), 'must be a JSON object or null');
  need('authorisation', (v) => Array.isArray(v) && v.every((a) => isPlain(a) && Object.keys(a).sort().join() === 'kind,ref' && isText(a.kind, 64) && isText(a.ref, 256)), 'must be a list of { kind, ref }');
  need('contract_ref', (v) => v === null || isText(v, 256), 'must be text or null');
  need('merge_contract_hash', (v) => typeof v === 'string' && HASH_RE.test(v), 'must be a SHA-256 in lower-case hex');
  need('verification_status', (v) => VERIFICATION_STATUSES.includes(v), `must be one of ${VERIFICATION_STATUSES.join(', ')}`);
  if (VERIFICATION_STATUSES.includes(env.verification_status) && typeof env.type === 'string' && TYPE_RE.test(env.type)) {
    const earned = STATUS_OF_KIND[env.type] ?? 'none';
    if (env.verification_status !== earned) errs.push(`verification_status: a ${env.type} record is ${earned}, not ${env.verification_status}`);
  }
  if ('extension' in env && !(isPlain(env.extension) && jsonOk(env.extension))) errs.push('extension: must be a plain JSON object');
  return errs;
}
function jsonOk(v) { try { canonicalize(v); return true; } catch { return false; } }

/** { ok, errors }: every problem, each naming its field. Never throws. */
export function validateEnvelope(envelope) {
  if (!isPlain(envelope)) return { ok: false, errors: ['envelope: must be an object'] };
  const errors = fieldErrors(envelope);
  if (!('content_hash' in envelope)) errors.push('content_hash: missing');
  else if (typeof envelope.content_hash !== 'string' || !HASH_RE.test(envelope.content_hash)) errors.push('content_hash: must be a SHA-256 in lower-case hex');
  else if (!errors.length && envelope.content_hash !== contentHash(envelope)) errors.push('content_hash: does not match the content');
  return { ok: errors.length === 0, errors };
}

/**
 * Build an envelope from its fields: the schema and the content hash are computed, the defaults are filled (no dependencies, no
 * project, no object, no authorisation, status none), the dependencies are sorted, and a merge contract given as an object is
 * hashed. The input is never changed. A record that does not validate is refused with every problem named.
 */
export function buildEnvelope(fields) {
  if (!isPlain(fields)) throw new EnvelopeError('bad_envelope', 'envelope fields must be an object');
  for (const k of ['schema', 'content_hash']) if (k in fields) throw new EnvelopeError('bad_envelope', `${k}: is computed, not given`);
  const { merge_contract: contract, ...given } = fields;
  const copy = JSON.parse(canonicalize(given));
  if (contract !== undefined) {
    const h = mergeContractHash(contract);
    if ('merge_contract_hash' in copy && copy.merge_contract_hash !== h) throw new EnvelopeError('bad_envelope', 'merge_contract_hash: does not match merge_contract');
    copy.merge_contract_hash = h;
  }
  const env = { schema: ENVELOPE_SCHEMA, deps: [], project: null, object: null, payload: null, authorisation: [], contract_ref: null, verification_status: 'none', ...copy };
  if (Array.isArray(env.deps) && env.deps.every((d) => typeof d === 'string')) env.deps = [...new Set(env.deps)].sort();
  const errs = fieldErrors(env);
  if (errs.length) throw new EnvelopeError('bad_envelope', errs.join('; '));
  env.content_hash = contentHash(env);
  return env;
}

/** The one-line canonical text of a valid envelope: the same envelope is always the same bytes. */
export function encodeEnvelope(envelope) {
  const r = validateEnvelope(envelope);
  if (!r.ok) throw new EnvelopeError('bad_envelope', r.errors.join('; '));
  return canonicalize(envelope);
}

function decodeV1(raw) {
  const r = validateEnvelope(raw);
  if (!r.ok) throw new EnvelopeError('bad_envelope', r.errors.join('; '));
  return raw;
}
/** One decoder per version. A new version adds an entry and leaves the others in place. */
export const DECODERS = Object.freeze({ [ENVELOPE_SCHEMA]: decodeV1 });

/** Read an envelope from its text or from a parsed object, with the decoder of the version it names. An unknown version is refused. */
export function decodeEnvelope(input, decoders = DECODERS) {
  let raw = input;
  if (typeof input === 'string') { try { raw = JSON.parse(input); } catch (e) { throw new EnvelopeError('bad_envelope', `not JSON: ${e.message}`); } }
  if (!isPlain(raw)) throw new EnvelopeError('bad_envelope', 'an envelope is a JSON object');
  if (typeof raw.schema !== 'string') throw new EnvelopeError('bad_envelope', 'schema: missing');
  if (!Object.hasOwn(decoders, raw.schema)) throw new EnvelopeError('unsupported_version', `no decoder for ${JSON.stringify(raw.schema)}`);
  return decoders[raw.schema](raw);
}

/** { ok: true }, or the signal that the envelope ran under another merge contract than the local one. Refuses when either hash is unusable. */
export function checkMergeContract(envelope, expected) {
  const got = envelope?.merge_contract_hash;
  if (typeof expected === 'string' && HASH_RE.test(expected) && got === expected) return { ok: true };
  return { ok: false, signal: 'merge_contract_mismatch', op_id: envelope?.op_id, expected, got };
}
/** The envelope itself when it ran under the local merge contract; otherwise an EnvelopeError that carries the signal. Nothing is merged across versions. */
export function requireMergeContract(envelope, expected) {
  const r = checkMergeContract(envelope, expected);
  if (!r.ok) throw new EnvelopeError('merge_contract_mismatch', `${r.op_id ?? 'envelope'} ran under merge contract ${r.got ?? 'none'}, not ${r.expected ?? 'none'}`, r);
  return envelope;
}

/** The order of the op log: the clock stamp, then the node, then the id. A total order, the same from any input order. */
export function compareEnvelopes(a, b) {
  const key = (e) => [e.hlc, e.origin.node, e.op_id];
  const ka = key(a), kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}
