// SPDX-License-Identifier: Apache-2.0
// The trust record, version 1 (PG-W-21A, WP21-01): a grant and a revocation, their validator, and one pure function that
// answers whether a subject is eligible for a purpose in a scope as of a stated time. Trust is an eligibility input only:
// nothing here grants a permission, a membership or a read, and a personal scope is never shared. Every choice in this
// file is PROVISIONAL, with its source in ADR 8 (docs/scope-one/DECISIONS.md, proposed; full text in
// docs/scope-one/design/trust-governance.md), and a change to the record is a new schema version, not an edit of
// memev-trust/1. The module has no production caller: it is a library with tests. It holds no store, takes no root of
// its own (the roots are a parameter of evaluate), reads no file, no network and no clock, and never changes its inputs.
// Documented in docs/schemas/trust-record-v1.json.
import { SUBJECT_TYPES, validateScope } from '../identity.mjs';

// PROVISIONAL (ADR 8): the schema name, the two kinds, the closed lists and the field lists of version 1.
export const TRUST_SCHEMA = 'memev-trust/1';
export const TRUST_KINDS = Object.freeze(['grant', 'revocation']);
export const TRUST_PURPOSES = Object.freeze(['contribute', 'verify']);
export const REVOCATION_REASONS = Object.freeze(['compromised', 'left', 'error', 'other']);
export const GRANT_FIELDS = Object.freeze(['schema', 'kind', 'id', 'subject', 'issuer', 'scope', 'purposes', 'start', 'expires', 'evidence', 'delegation']);
export const REVOCATION_FIELDS = Object.freeze(['schema', 'kind', 'id', 'grant', 'issuer', 'time', 'reason']);
export const DELEGATION_FIELDS = Object.freeze(['depth', 'parent']);
export const MAX_EVIDENCE = 8;
export const MAX_EVIDENCE_LENGTH = 128;

const ID_PART = /^[A-Za-z0-9._@+-]+$/;
const SUBJECT_ID = new RegExp(`^(${SUBJECT_TYPES.join('|')}):[A-Za-z0-9._@+-]+$`);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const present = (x) => x !== undefined;
const isTime = (x) => typeof x === 'string' && ISO_TIME.test(x) && Number.isFinite(Date.parse(x));
const ms = (x) => Date.parse(x);
const isId = (x) => typeof x === 'string' && ID_PART.test(x);
const isSubject = (x) => typeof x === 'string' && SUBJECT_ID.test(x);
const sameScope = (a, b) => a.type === b.type && a.id === b.id;

// ---- the validator

function validateDelegation(d) {
  if (!isObj(d)) return ['delegation: must be an object with a depth'];
  const e = [];
  if (!Number.isInteger(d.depth) || d.depth < 0) e.push('delegation.depth: must be a whole number, 0 or more');
  if (present(d.parent) && !isId(d.parent)) e.push('delegation.parent: must be a grant id');
  for (const k of Object.keys(d)) if (present(d[k]) && !DELEGATION_FIELDS.includes(k)) e.push(`delegation: unknown field: ${k}`);
  return e;
}

function validateGrant(r) {
  const e = [];
  if (!isId(r.id)) e.push('id: a grant needs an id');
  if (!isSubject(r.subject)) e.push(`subject: must be a subject id, <type>:<name> with a type of ${SUBJECT_TYPES.join(', ')}`);
  if (!isSubject(r.issuer)) e.push(`issuer: must be a subject id, <type>:<name> with a type of ${SUBJECT_TYPES.join(', ')}`);
  if (!isObj(r.scope)) e.push('scope: must be an object with a type and an id');
  else {
    e.push(...validateScope(r.scope).map((m) => `scope: ${m}`));
    if (r.scope.type === 'personal') e.push('scope: a personal scope is never shared');
  }
  if (!Array.isArray(r.purposes) || r.purposes.length === 0) e.push(`purposes: must be a non-empty list of ${TRUST_PURPOSES.join(', ')}`);
  else if (!r.purposes.every((p) => TRUST_PURPOSES.includes(p))) e.push(`purposes: every purpose must be one of ${TRUST_PURPOSES.join(', ')}`);
  if (!isTime(r.start)) e.push('start: must be a time (ISO 8601 with a zone)');
  if (!present(r.expires) || r.expires === null) e.push('expires: an expiry is required');
  else if (!isTime(r.expires)) e.push('expires: must be a time (ISO 8601 with a zone)');
  else if (isTime(r.start) && !(ms(r.expires) > ms(r.start))) e.push('expires: must be after the start');
  if (present(r.evidence)) {
    if (!Array.isArray(r.evidence)) e.push('evidence: must be a list of texts');
    else {
      if (r.evidence.length > MAX_EVIDENCE) e.push(`evidence: at most ${MAX_EVIDENCE} references`);
      r.evidence.forEach((x, i) => { if (typeof x !== 'string') e.push(`evidence[${i}]: must be a text`); else if (x.length > MAX_EVIDENCE_LENGTH) e.push(`evidence[${i}]: at most ${MAX_EVIDENCE_LENGTH} characters`); });
    }
  }
  if (present(r.delegation)) e.push(...validateDelegation(r.delegation));
  return e;
}

function validateRevocation(r) {
  const e = [];
  if (!isId(r.id)) e.push('id: a revocation needs an id');
  if (!isId(r.grant)) e.push('grant: a revocation names the grant it revokes');
  if (!isSubject(r.issuer)) e.push(`issuer: must be a subject id, <type>:<name> with a type of ${SUBJECT_TYPES.join(', ')}`);
  if (!isTime(r.time)) e.push('time: must be a time (ISO 8601 with a zone)');
  if (!REVOCATION_REASONS.includes(r.reason)) e.push(`reason: must be one of ${REVOCATION_REASONS.join(', ')}`);
  return e;
}

/** { ok, errors } for one trust record, a grant or a revocation. Each error starts with the field it is about. */
export function validateTrustRecord(r) {
  try {
    if (!isObj(r)) return { ok: false, errors: ['record: a trust record must be an object'] };
    const e = [];
    if (r.schema !== TRUST_SCHEMA) e.push(`schema: must be ${TRUST_SCHEMA}`);
    if (!TRUST_KINDS.includes(r.kind)) e.push(`kind: must be one of ${TRUST_KINDS.join(', ')}`);
    else {
      e.push(...(r.kind === 'grant' ? validateGrant(r) : validateRevocation(r)));
      const known = r.kind === 'grant' ? GRANT_FIELDS : REVOCATION_FIELDS;
      for (const k of Object.keys(r)) if (present(r[k]) && !known.includes(k)) e.push(`record: unknown field: ${k}`);
    }
    return { ok: e.length === 0, errors: e };
  } catch {
    return { ok: false, errors: ['record: could not be read'] };
  }
}

// ---- the evaluation

const deny = (rule, reason, chain = []) => ({ eligible: false, rule, reason, chain });
const allow = (reason, chain) => ({ eligible: true, rule: 'allow.grant', reason, chain });

// Where a grant stopped being honoured, so that the answer names the grant that came closest: a larger stage went further.
const STAGE = { scope: 1, purpose: 2, window: 3, revoked: 4, authority: 5 };

function validRequest(req, c) {
  if (!isObj(req) || !isSubject(req.subject)) return 'the request needs a subject id';
  if (!isObj(req.scope) || validateScope(req.scope).length > 0) return 'the request needs a valid scope';
  if (req.scope.type === 'personal') return 'a personal scope is never shared';
  if (!TRUST_PURPOSES.includes(req.purpose)) return `the request needs a purpose, one of ${TRUST_PURPOSES.join(', ')}`;
  if (!isObj(c)) return 'the call needs records, roots and a time';
  if (!isTime(c.at)) return 'at is required and must be a time: the clock is never read';
  if (!Array.isArray(c.records)) return 'records must be a list';
  if (!Array.isArray(c.roots) || !c.roots.every(isSubject)) return 'roots must be a list of subject ids';
  return null;
}

/**
 * evaluate(request { subject, scope, purpose }, { records, roots, at }) -> { eligible, rule, reason, chain }.
 * Denies by default. A root is a subject id the caller passes: there is no default root and no default grant. Records
 * that fail the validator are never honoured, and neither are two grants that share an id. A grant is honoured when its
 * issuer is a root, or holds a live grant that delegates, names that grant as the parent, and is only narrowed by it.
 * A revocation applies from its time, when its issuer is the issuer of the grant or a root. The chain lists the grant ids
 * from the granting end to the grant of the subject.
 */
export function evaluate(request, context) {
  try {
    const bad = validRequest(request, context);
    if (bad) return deny('deny.bad_request', bad);
    return decide(request, context);
  } catch {
    return deny('deny.bad_request', 'the input could not be read');
  }
}

function decide(request, { records, roots, at }) {
  const now = ms(at);
  const valid = records.filter((r) => validateTrustRecord(r).ok);
  const counts = new Map();
  for (const r of valid) if (r.kind === 'grant') counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  const grants = valid.filter((r) => r.kind === 'grant' && counts.get(r.id) === 1);
  const byId = new Map(grants.map((g) => [g.id, g]));
  const revocations = valid.filter((r) => r.kind === 'revocation');
  if (valid.length === 0 || records.length === 0) return deny('deny.no_records', 'there are no trust records');
  if (roots.length === 0) return deny('deny.no_roots', 'no root was passed: there is no default root');

  const revokedAt = (g) => revocations.some((v) => v.grant === g.id && ms(v.time) <= now && (v.issuer === g.issuer || roots.includes(v.issuer)));
  const windowRule = (g) => (now < ms(g.start) ? 'not_yet_valid' : now >= ms(g.expires) ? 'expired' : null);

  // The authority of a grant: its issuer is a root, or a live parent of the same issuer delegates to it and only narrows.
  // Each step up names a parent of a higher depth, so the walk ends. The chain grows at its front: the granting end first.
  function authority(g, path) {
    const here = [g.id, ...path];
    const parentId = g.delegation?.parent;
    if (parentId === undefined) {
      return roots.includes(g.issuer) ? { ok: true, chain: here } : { ok: false, rule: 'deny.untrusted_issuer', reason: `the issuer ${g.issuer} is not a root and names no parent grant`, chain: here };
    }
    const p = byId.get(parentId);
    const stop = (rule, reason) => ({ ok: false, rule, reason, chain: [...(p ? [p.id] : []), ...here] });
    if (!p) return stop('deny.chain.parent_missing', `the parent grant ${parentId} is not among the records`);
    if (p.subject !== g.issuer) return stop('deny.chain.parent_not_issuer', `the issuer ${g.issuer} is not the subject of the parent grant ${p.id}`);
    const pd = p.delegation?.depth ?? 0;
    if (pd < 1) return stop('deny.chain.parent_depth_zero', `the parent grant ${p.id} has depth 0 and cannot delegate`);
    if (!(g.delegation.depth < pd)) return stop('deny.chain.depth', `the depth ${g.delegation.depth} is not lower than the depth ${pd} of the parent grant ${p.id}`);
    if (!sameScope(g.scope, p.scope)) return stop('deny.chain.scope', `the scope differs from the scope of the parent grant ${p.id}`);
    if (!g.purposes.every((x) => p.purposes.includes(x))) return stop('deny.chain.purposes', `the purposes are wider than those of the parent grant ${p.id}`);
    if (ms(g.expires) > ms(p.expires)) return stop('deny.chain.expiry', `the expiry is later than the expiry of the parent grant ${p.id}`);
    const w = windowRule(p);
    if (w) return stop(`deny.chain.parent_${w}`, `the parent grant ${p.id} is ${w === 'expired' ? 'expired' : 'not yet valid'} at this time`);
    if (revokedAt(p)) return stop('deny.chain.parent_revoked', `the parent grant ${p.id} is revoked at this time`);
    return authority(p, here);
  }

  const mine = grants.filter((g) => g.subject === request.subject);
  if (mine.length === 0) return deny('deny.no_grant', `no grant names ${request.subject}`);
  let best = null;
  const consider = (stage, d) => { if (!best || stage > best.stage) best = { stage, d }; };
  for (const g of mine) {
    if (!sameScope(g.scope, request.scope)) { consider(STAGE.scope, deny('deny.scope_not_granted', `the grant ${g.id} is for another scope`, [g.id])); continue; }
    if (!g.purposes.includes(request.purpose)) { consider(STAGE.purpose, deny('deny.purpose_not_granted', `the grant ${g.id} does not name the purpose ${request.purpose}`, [g.id])); continue; }
    const w = windowRule(g);
    if (w) { consider(STAGE.window, deny(`deny.${w}`, `the grant ${g.id} is ${w === 'expired' ? 'expired' : 'not yet valid'} at this time`, [g.id])); continue; }
    if (revokedAt(g)) { consider(STAGE.revoked, deny('deny.revoked', `the grant ${g.id} is revoked at this time`, [g.id])); continue; }
    const a = authority(g, []);
    if (a.ok) return allow(`the grant ${g.id} covers ${request.purpose} in this scope at this time`, a.chain);
    consider(STAGE.authority, deny(a.rule, a.reason, a.chain));
  }
  return best.d;
}
