// SPDX-License-Identifier: Apache-2.0
// The relationship record: how two parties agree to exchange state, written down so either can check it and either can end it.
//
// A relationship names both parties (a node and the scope it holds), the one scope it covers, the purpose, the time it expires,
// how it is revoked and the version of the policy both accepted. It is proposed by one party and accepted by the other; a record
// whose second acceptance is missing is not established. A personal scope or a personal vault is never a party, and never the
// scope a relationship covers: personal data does not join an organisation.
//
// The record is a value. Revoking it makes a new value with the revocation filled in; nothing is deleted. A node keeps its
// relationships in its own operation log (RelationshipBook), so a restart does not forget a revocation. There is no other store
// and nothing here opens a connection: carrying a record from one node to the other is a later contract. docs/FEDERATION.md
// describes the record, and docs/schemas/membership-v1.json is its schema.
import { validateScope } from '../identity.mjs';

export const RELATIONSHIP_SCHEMA = 'memev-membership/1';
/** The fields of a relationship record, sorted. */
export const RELATIONSHIP_FIELDS = Object.freeze(['expires', 'id', 'parties', 'policy_version', 'purpose', 'revocation', 'schema', 'scope']);
export const PARTY_FIELDS = Object.freeze(['accepted_at', 'node', 'scope']);
export const REVOCATION_FIELDS = Object.freeze(['by', 'revoked_at', 'revoked_by']);
/** Who may revoke: either party, or only the one that proposed it. */
export const REVOCATION_RULES = Object.freeze(['either_party', 'proposer']);

const RELATIONSHIP = 'federation.relationship';
const REVOKED = 'federation.relationship.revoked';
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isTime = (t) => typeof t === 'string' && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(t) && !Number.isNaN(Date.parse(t));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) && v.isWellFormed();
const personal = (s) => isObj(s) && s.type === 'personal';
const iso = (t) => new Date(t).toISOString();

/** { ok, errors }: the record is complete and well formed. A record that has not been accepted by both parties is valid but not established. */
export function validateRelationship(r) {
  if (!isObj(r)) return { ok: false, errors: ['a relationship must be an object'] };
  const errors = [];
  for (const f of RELATIONSHIP_FIELDS) if (!(f in r)) errors.push(`${f}: missing`);
  for (const k of Object.keys(r)) if (!RELATIONSHIP_FIELDS.includes(k)) errors.push(`${k}: not a field of ${RELATIONSHIP_SCHEMA}`);
  if ('schema' in r && r.schema !== RELATIONSHIP_SCHEMA) errors.push(`schema: must be ${RELATIONSHIP_SCHEMA}`);
  if ('id' in r && !(typeof r.id === 'string' && ID_RE.test(r.id))) errors.push('id: must be letters, digits and . _ : -');
  if ('purpose' in r && !text(r.purpose, 500)) errors.push('purpose: must be a short text');
  if ('policy_version' in r && !text(r.policy_version, 64)) errors.push('policy_version: must name the policy version both parties accepted');
  if ('scope' in r) {
    if (validateScope(r.scope).length) errors.push('scope: must be { type, id } with a scope type of the identity model');
    else if (personal(r.scope)) errors.push('scope: a personal scope is never the scope of a relationship');
  }
  let nodes = [];
  let accepted = [];
  if ('parties' in r) {
    if (!Array.isArray(r.parties) || r.parties.length !== 2) errors.push('parties: a relationship names two parties');
    else {
      r.parties.forEach((p, i) => {
        const at = `party ${i}`;
        if (!isObj(p)) { errors.push(`${at}: must be an object`); return; }
        for (const f of PARTY_FIELDS) if (!(f in p)) errors.push(`${at}: ${f} missing`);
        for (const k of Object.keys(p)) if (!PARTY_FIELDS.includes(k)) errors.push(`${at}: ${k} is not a field of a party; a party is a node and the scope it holds, never a personal vault`);
        if ('node' in p && !(typeof p.node === 'string' && ID_RE.test(p.node))) errors.push(`${at}: node must be a node id`);
        if ('scope' in p) {
          if (validateScope(p.scope).length) errors.push(`${at}: scope must be { type, id } with a scope type of the identity model`);
          else if (personal(p.scope)) errors.push(`${at}: a personal scope or vault is never a party`);
        }
        if ('accepted_at' in p && p.accepted_at !== null && !isTime(p.accepted_at)) errors.push(`${at}: accepted_at must be a time or null`);
      });
      nodes = r.parties.map((p) => p?.node);
      accepted = r.parties.map((p) => p?.accepted_at).filter(isTime);
      if (nodes[0] !== undefined && nodes[0] === nodes[1]) errors.push('parties: the two parties must be different nodes');
    }
  }
  if ('expires' in r) {
    if (!isTime(r.expires)) errors.push('expires: must be a time');
    else if (accepted.some((a) => Date.parse(r.expires) <= Date.parse(a))) errors.push('expires: must be after the acceptance');
  }
  if ('revocation' in r) {
    const v = r.revocation;
    if (!isObj(v)) errors.push('revocation: must be { by, revoked_at, revoked_by }');
    else {
      for (const f of REVOCATION_FIELDS) if (!(f in v)) errors.push(`revocation.${f}: missing`);
      for (const k of Object.keys(v)) if (!REVOCATION_FIELDS.includes(k)) errors.push(`revocation.${k}: not a field of the revocation`);
      if ('by' in v && !REVOCATION_RULES.includes(v.by)) errors.push(`revocation.by: must be one of ${REVOCATION_RULES.join(', ')}`);
      if ('revoked_at' in v && v.revoked_at !== null && !isTime(v.revoked_at)) errors.push('revocation.revoked_at: must be a time or null');
      if ('revoked_by' in v && v.revoked_by !== null && !nodes.includes(v.revoked_by)) errors.push('revocation.revoked_by: must name one of the two parties, or be null');
      if ((v.revoked_at ?? null) === null !== ((v.revoked_by ?? null) === null)) errors.push('revocation: revoked_at and revoked_by are both set or both null');
      else if (v.by === 'proposer' && v.revoked_by && v.revoked_by !== nodes[0]) errors.push('revocation.revoked_by: only the proposer may revoke under the proposer rule');
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The state of a record at a time (ms): proposed (not yet accepted by both), invalid, revoked, expired, not_established (accepted by
 * both but not yet at that time) or active. Revoked is named before expired.
 */
export function relationshipState(r, at = Date.now()) {
  if (!validateRelationship(r).ok) return 'invalid';
  if (r.parties.some((p) => p.accepted_at === null)) return 'proposed';
  if (r.revocation.revoked_at !== null && Date.parse(r.revocation.revoked_at) <= at) return 'revoked';
  if (Date.parse(r.expires) <= at) return 'expired';
  if (r.parties.some((p) => Date.parse(p.accepted_at) > at)) return 'not_established';
  return 'active';
}

const fail = (code, errors) => ({ ok: false, code, errors: [].concat(errors) });

/** A party proposes: the record carries its own acceptance and waits for the other's. Returns { ok, record } or { ok: false, code, errors }. */
export function proposeRelationship({ id, proposer, counterparty, scope, purpose, expires, revocable_by = 'either_party', policy_version } = {}, { at = Date.now() } = {}) {
  const record = {
    schema: RELATIONSHIP_SCHEMA, id,
    parties: [{ node: proposer?.node, scope: proposer?.scope, accepted_at: iso(at) }, { node: counterparty?.node, scope: counterparty?.scope, accepted_at: null }],
    scope, purpose, expires, revocation: { by: revocable_by, revoked_at: null, revoked_by: null }, policy_version,
  };
  const v = validateRelationship(record);
  return v.ok ? { ok: true, record } : fail('invalid', v.errors);
}

/** The other party accepts, which establishes the relationship. */
export function acceptRelationship(record, { node, at = Date.now() } = {}) {
  const v = validateRelationship(record);
  if (!v.ok) return fail('invalid', v.errors);
  const i = record.parties.findIndex((p) => p.node === node);
  if (i < 0) return fail('not_a_party', `${String(node)} is not a party of ${record.id}`);
  if (record.parties[i].accepted_at !== null) return fail('already_accepted', `${node} has already accepted ${record.id}`);
  const next = structuredClone(record);
  next.parties[i].accepted_at = iso(at);
  const w = validateRelationship(next);
  return w.ok ? { ok: true, record: next } : fail('invalid', w.errors);
}

/** A party ends it. Returns a new record with the revocation filled in; a first revocation stands and nothing undoes it. */
export function revokeRelationship(record, { by, at = Date.now() } = {}) {
  const v = validateRelationship(record);
  if (!v.ok) return fail('invalid', v.errors);
  if (record.revocation.revoked_at !== null) return fail('already_revoked', `${record.id} was revoked at ${record.revocation.revoked_at}`);
  if (!record.parties.some((p) => p.node === by)) return fail('not_a_party', `${String(by)} is not a party of ${record.id}`);
  if (record.revocation.by === 'proposer' && record.parties[0].node !== by) return fail('not_allowed', `${record.id} can be revoked only by the party that proposed it`);
  const next = structuredClone(record);
  next.revocation = { by: record.revocation.by, revoked_at: iso(at), revoked_by: by };
  return { ok: true, record: next };
}

/**
 * A node's relationships. They live in the node's own operation log (federation.relationship, federation.relationship.revoked) and
 * are rebuilt from it when the book is made, so a revocation survives a restart and an old record cannot be added again to undo it.
 */
export class RelationshipBook {
  constructor({ log } = {}) {
    if (!log || typeof log.append !== 'function' || typeof log.iterate !== 'function') throw new TypeError('a relationship book needs the vault operation log');
    this.log = log;
    this.records = new Map();
    for (const rec of log.iterate()) {
      if (rec.type === RELATIONSHIP && isObj(rec.data?.record) && validateRelationship(rec.data.record).ok && !this.records.has(rec.data.record.id)) this.records.set(rec.data.record.id, structuredClone(rec.data.record));
      else if (rec.type === REVOKED && isObj(rec.data) && this.records.has(rec.data.id)) {
        const r = revokeRelationship(this.records.get(rec.data.id), { by: rec.data.by, at: Date.parse(rec.data.at) });
        if (r.ok) this.records.set(rec.data.id, r.record);
      }
    }
  }

  get(id) { const r = this.records.get(id); return r ? structuredClone(r) : null; }
  list() { return [...this.records.values()].map((r) => structuredClone(r)); }

  /** Hold an established relationship. A record that is invalid, not accepted by both parties, or already held is refused. */
  add(record) {
    const v = validateRelationship(record);
    if (!v.ok) return fail('invalid', v.errors);
    if (relationshipState(record, 0) === 'proposed') return fail('not_established', `${record.id} has not been accepted by both parties`);
    if (this.records.has(record.id)) return fail('exists', `${record.id} is already held`);
    const rec = this.log.append({ type: RELATIONSHIP, agent: null, client: record.parties[0].node, data: { record: structuredClone(record) } });
    this.records.set(record.id, structuredClone(record));
    return { ok: true, record: structuredClone(record), seq: rec.seq };
  }

  /** Record that a party revoked a held relationship. */
  revoke(id, { by, at = Date.now() } = {}) {
    const cur = this.records.get(id);
    if (!cur) return fail('not_found', `no relationship ${String(id).slice(0, 128)}`);
    const r = revokeRelationship(cur, { by, at });
    if (!r.ok) return r;
    const rec = this.log.append({ type: REVOKED, agent: null, client: by, data: { id, by, at: iso(at) } });
    this.records.set(id, r.record);
    return { ok: true, record: structuredClone(r.record), seq: rec.seq };
  }
}

