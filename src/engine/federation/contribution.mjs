// SPDX-License-Identifier: Apache-2.0
// A contribution: an operation envelope (PG-04.1) that carries the signature and admission block in its extension block.
//
// The envelope stays the one record shape. The block lives in extension.contribution and holds what the node needs to judge the
// record: the subject, the scope, a classification string, the per-sender sequence, the provenance, the hash of the payload and the
// signature. The schema version and the causal context are the envelope's own (schema, deps, hlc). The signature is made with the
// role key through ssh-keygen in the namespace memev-contribution, over the canonical text of the envelope without the signature, so
// it covers every other field, the payload hash included. The content hash is taken after the signature is in the block.
// docs/schemas/contribution-v1.json describes the block; docs/FEDERATION.md describes the admission.
import crypto from 'node:crypto';
import { buildEnvelope, validateEnvelope, canonicalize, EnvelopeError } from '../envelope.mjs';
import { SUBJECT_TYPES, validateScope } from '../identity.mjs';
import { CONTRIBUTION_NAMESPACE } from '../agentid-bind.mjs';

export const CONTRIBUTION_SCHEMA = 'memev-contribution/1';
/** The fields of the block, sorted. */
export const CONTRIBUTION_FIELDS = Object.freeze(['classification', 'payload_hash', 'provenance', 'scope', 'schema', 'sequence', 'signature', 'subject']);
export const MESSAGE_HEADER = 'memev-contribution v1';

const SUBJECT_RE = new RegExp(`^(${SUBJECT_TYPES.join('|')}):[A-Za-z0-9._@+-]+$`);
const PRINCIPAL_RE = /^[A-Za-z0-9._@+][A-Za-z0-9._@+-]*$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) && v.isWellFormed();
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).sort().join() === [...keys].sort().join();

/** The SHA-256 of the canonical text of a payload. */
export const payloadHash = (payload) => crypto.createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');

/** { ok, errors }: the envelope is valid and its block is a valid signature and admission block. Never throws. */
export function validateContribution(envelope) {
  const env = validateEnvelope(envelope);
  if (!env.ok) return { ok: false, errors: env.errors.map((e) => `envelope: ${e}`) };
  const ext = envelope.extension;
  if (!isObj(ext) || !isObj(ext.contribution)) return { ok: false, errors: ['contribution: the extension block holds no contribution'] };
  const b = ext.contribution;
  const errors = [];
  for (const f of CONTRIBUTION_FIELDS) if (!(f in b)) errors.push(`contribution.${f}: missing`);
  for (const k of Object.keys(b)) if (!CONTRIBUTION_FIELDS.includes(k)) errors.push(`contribution.${k}: not a field of ${CONTRIBUTION_SCHEMA}`);
  const bad = (f, why) => { if (f in b) errors.push(`contribution.${f}: ${why}`); };
  if ('schema' in b && b.schema !== CONTRIBUTION_SCHEMA) bad('schema', `must be ${CONTRIBUTION_SCHEMA}`);
  if ('subject' in b && !(typeof b.subject === 'string' && SUBJECT_RE.test(b.subject) && b.subject === envelope.origin.identity)) bad('subject', 'must be a subject id and the origin identity of the envelope');
  if ('scope' in b && !(exactKeys(b.scope, ['id', 'type']) && validateScope(b.scope).length === 0)) bad('scope', 'must be { type, id } with a scope type of the identity model');
  if ('classification' in b && !text(b.classification, 128)) bad('classification', 'must be a non-empty string');
  if ('sequence' in b && !(Number.isSafeInteger(b.sequence) && b.sequence >= 1)) bad('sequence', 'must be a whole number of 1 or more');
  if ('payload_hash' in b && !(typeof b.payload_hash === 'string' && HASH_RE.test(b.payload_hash) && b.payload_hash === payloadHash(envelope.payload))) bad('payload_hash', 'must be the SHA-256 of the canonical payload');
  if ('provenance' in b) {
    const p = b.provenance;
    if (!(exactKeys(p, ['source', 'derived_from']) && text(p.source, 256) && Array.isArray(p.derived_from) && p.derived_from.every((d, i) => typeof d === 'string' && ID_RE.test(d) && (i === 0 || p.derived_from[i - 1] < d)))) bad('provenance', 'must be { source, derived_from }: text, and a sorted list of distinct operation ids');
  }
  if ('signature' in b) {
    const s = b.signature;
    if (!isObj(s)) bad('signature', 'must be { principal, namespace, sshsig }');
    else {
      for (const f of ['principal', 'namespace', 'sshsig']) if (!(f in s)) errors.push(`contribution.signature.${f}: missing`);
      for (const k of Object.keys(s)) if (!['principal', 'namespace', 'sshsig'].includes(k)) errors.push(`contribution.signature.${k}: not a field of the signature`);
      if ('principal' in s && !(typeof s.principal === 'string' && s.principal.length <= 128 && PRINCIPAL_RE.test(s.principal))) errors.push('contribution.signature.principal: must be a principal of letters, digits and . _ @ + -');
      if ('namespace' in s && s.namespace !== CONTRIBUTION_NAMESPACE) errors.push(`contribution.signature.namespace: must be ${CONTRIBUTION_NAMESPACE}`);
      if ('sshsig' in s && !(typeof s.sshsig === 'string' && s.sshsig.length <= 8192 && s.sshsig.startsWith('-----BEGIN SSH SIGNATURE-----'))) errors.push('contribution.signature.sshsig: must be an armoured SSH signature');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** The text that is signed: a header line, then the canonical text of the envelope without its content hash and without the signature. */
export function contributionMessage(envelope) {
  if (!isObj(envelope) || !isObj(envelope.extension) || !isObj(envelope.extension.contribution)) throw new EnvelopeError('bad_contribution', 'the envelope holds no contribution block');
  const { content_hash: own, ...rest } = structuredClone(envelope); void own;
  delete rest.extension.contribution.signature;
  return `${MESSAGE_HEADER}\n${canonicalize(rest)}`;
}

/**
 * Build and sign a contribution. `fields` are the fields of an envelope (see buildEnvelope) and a `contribution` object with
 * { subject, scope, classification, sequence, provenance }; the schema and the payload hash of the block are filled in.
 * `sign(message)` returns an armoured signature of the message (agentid-bind's signNamespaced, with the role key, in the
 * contribution namespace); `principal` is the key id the node knows the signer by.
 */
export function signContribution(fields, { sign, principal } = {}) {
  if (typeof sign !== 'function') throw new EnvelopeError('bad_contribution', 'a contribution needs a signer');
  const { contribution, extension, ...rest } = fields;
  const block = { schema: CONTRIBUTION_SCHEMA, ...contribution, payload_hash: payloadHash(rest.payload ?? null) };
  const draft = buildEnvelope({ ...rest, extension: { ...extension, contribution: block } });
  const sshsig = sign(contributionMessage(draft));
  const signed = buildEnvelope({ ...rest, extension: { ...extension, contribution: { ...block, signature: { principal, namespace: CONTRIBUTION_NAMESPACE, sshsig } } } });
  const v = validateContribution(signed);
  if (!v.ok) throw new EnvelopeError('bad_contribution', v.errors.join('; '));
  return signed;
}
