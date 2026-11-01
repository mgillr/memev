// SPDX-License-Identifier: Apache-2.0
// The trust record, version 1 (PG-W-21A, WP21-01): a grant and a revocation, their validator, and one pure function that
// answers whether a subject is eligible for a purpose in a scope as of a stated time. Trust is an eligibility input only:
// nothing here grants a permission, a membership or a read, and a personal scope is never shared. Every choice in this
// file is PROVISIONAL, with its source in ADR 8 (docs/scope-one/DECISIONS.md, proposed; full text in
// docs/scope-one/design/trust-governance.md), and a change to the record is a new schema version, not an edit of
// memev-trust/1. The module has no production caller: it is a library with tests, and nothing outside the tests imports
// it. It holds no store, takes no root of its own (the roots are a parameter of evaluate), and is pure: it reads no file,
// no network, no clock and no source of randomness, makes no timer, and never changes its inputs. Its one import is the
// identity module. Documented in docs/schemas/trust-record-v1.json.
//
// What a record does not prove: the subject and the issuer of a record are unauthenticated strings. Nothing here checks a
// signature, a credential or a log, so a record names who it says it names and no more. The caller must evaluate over its
// own log, the one it already trusts as it trusts its operation log, and must write and ask with a resolved actor (never a
// name a caller supplies) and a credential-resolved subject, as the actor resolution paragraph of
// docs/scope-one/design/trust-governance.md says. A record from anywhere else is input, not authority.
//
// Fail closed: every input is copied once with structuredClone and only the copy is validated and used, so a getter runs
// once and cannot answer differently on a later read, and an input that cannot be copied is a deny. Every comparison of a
// time is written as the negation of the passing case, so a time that is not a number never lets a window pass. A record
// of kind revocation that fails the validator and names a grant denies that grant and every grant delegated from it.
// Replaying a record is idempotent: canonically equal grants count once, and different grants with one id deny.
//
// scope.parent is accepted by the validator (validateScope allows it) and is ignored by the evaluation: a grant names a
// scope by its type and id alone, and it never reaches a parent or a child scope.
import { SUBJECT_TYPES, validateScope } from '../identity.mjs';

// PROVISIONAL (ADR 8): the schema name, the two kinds, the closed lists and the field lists of version 1.
// PROVISIONAL (ADR 8, question 7, option A): two purposes, contribute and verify. A further purpose is a new schema version.
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
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const present = (x) => x !== undefined;
// A real calendar date and a real time of day: a month of 1 to 12, a day that the month has (with leap years), an hour of
// 23 or less, a minute and a second of 59 or less, and a zone offset under 24 hours. Nothing rolls over into the next day.
function isCalendarTime(x) {
  const m = ISO_TIME.exec(x);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59)) return false;
  return m[8] === 'Z' || (Number(m[9]) <= 23 && Number(m[10]) <= 59);
}
const isTime = (x) => typeof x === 'string' && ISO_TIME.test(x) && isCalendarTime(x) && Number.isFinite(Date.parse(x));
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

// The checks on a record that has already been copied. A record is read only through this, and only from the copy.
function check(r) {
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

/** { ok, errors } for one trust record, a grant or a revocation. Each error starts with the field it is about. The record is copied once and the copy is checked. */
export function validateTrustRecord(r) {
  try {
    return check(structuredClone(r));
  } catch {
    return { ok: false, errors: ['record: could not be read'] };
  }
}

// ---- the evaluation

/**
 * The rule ids: the whole set, and the only ids a decision carries. A caller may switch on them. A new id is a change to
 * this set, with a test, and never a text made up where a decision is returned.
 */
export const RULES = Object.freeze({
  ALLOW: 'allow.grant',
  BAD_REQUEST: 'deny.bad_request',
  NO_RECORDS: 'deny.no_records',
  NO_ROOTS: 'deny.no_roots',
  NO_GRANT: 'deny.no_grant',
  CONFLICTING_GRANT: 'deny.conflicting_grant',
  SCOPE_NOT_GRANTED: 'deny.scope_not_granted',
  PURPOSE_NOT_GRANTED: 'deny.purpose_not_granted',
  NOT_YET_VALID: 'deny.not_yet_valid',
  EXPIRED: 'deny.expired',
  REVOKED: 'deny.revoked',
  BAD_REVOCATION: 'deny.bad_revocation',
  UNTRUSTED_ISSUER: 'deny.untrusted_issuer',
  CHAIN_PARENT_MISSING: 'deny.chain.parent_missing',
  CHAIN_PARENT_NOT_ISSUER: 'deny.chain.parent_not_issuer',
  CHAIN_PARENT_DEPTH_ZERO: 'deny.chain.parent_depth_zero',
  CHAIN_DEPTH: 'deny.chain.depth',
  CHAIN_SCOPE: 'deny.chain.scope',
  CHAIN_PURPOSES: 'deny.chain.purposes',
  CHAIN_EXPIRY: 'deny.chain.expiry',
  CHAIN_START: 'deny.chain.start',
  CHAIN_PARENT_REVOKED: 'deny.chain.parent_revoked',
});

const deny = (rule, reason, chain = []) => ({ eligible: false, rule, reason, chain });
const allow = (reason, chain) => ({ eligible: true, rule: RULES.ALLOW, reason, chain });

// Where a grant stopped being honoured, so that the answer names the grant that came closest: a larger stage went further.
// When several denies reach the same stage, the one listed first in RULES wins, then the one whose chain sorts first by plain
// string order. That priority is fixed and never the order of the records, so the same records in any order give the same
// answer. A conflict of grant ids is the furthest stage: it is a record that cannot be told apart from another.
const STAGE = { scope: 1, purpose: 2, window: 3, revoked: 4, authority: 5, conflict: 6 };
const PRIORITY = Object.values(RULES);
const before = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPriority = (a, b) => b.stage - a.stage || PRIORITY.indexOf(a.d.rule) - PRIORITY.indexOf(b.d.rule) || before(a.d.chain.join('\n'), b.d.chain.join('\n')) || before(a.d.reason, b.d.reason);

// Canonical JSON: the keys of every object in sorted order, so that two records that differ only in key order are one record.
const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x);
const canonical = (x) => JSON.stringify(sortKeys(x));

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
 * that fail the validator are never honoured as grants. A grant is honoured when its issuer is a root, or holds a live
 * grant that delegates, names that grant as the parent, and is only narrowed by it. A revocation applies from its time,
 * when its issuer is the issuer of the grant or a root. A record of kind revocation that fails the validator and names a
 * grant denies that grant and every grant delegated from it (deny.bad_revocation), at any time. Canonically equal grants
 * count once; different grants that share an id are honoured by no one and deny (deny.conflicting_grant). The request and
 * the call are copied once, first, and only the copy is read: an input that cannot be read or copied is a deny. The chain
 * lists the grant ids from the granting end to the grant of the subject.
 */
export function evaluate(request, context) {
  try {
    const snapshot = structuredClone({ request, context });
    const bad = validRequest(snapshot.request, snapshot.context);
    if (bad) return deny(RULES.BAD_REQUEST, bad);
    return decide(snapshot.request, snapshot.context);
  } catch {
    return deny(RULES.BAD_REQUEST, 'the input could not be read');
  }
}

function decide(request, { records, roots, at }) {
  const now = ms(at);
  const checked = records.map((r) => [r, check(r).ok]);
  const valid = checked.filter(([, ok]) => ok).map(([r]) => r);
  // Grants by id. Canonically equal duplicates are one grant. Different grants with one id are a conflict: none of them is
  // honoured, and the id is refused for the subject of each and for every grant delegated from it.
  const forms = new Map();
  for (const r of valid) {
    if (r.kind !== 'grant') continue;
    const same = forms.get(r.id) ?? new Map();
    if (!same.has(canonical(r))) same.set(canonical(r), r);
    forms.set(r.id, same);
  }
  const byId = new Map(); const clash = new Map();
  for (const [id, same] of forms) { if (same.size === 1) byId.set(id, [...same.values()][0]); else clash.set(id, [...same.values()]); }
  const revocations = valid.filter((r) => r.kind === 'revocation');
  // PROVISIONAL (ADR 8, question 6, in part): a record of kind revocation that fails the validator and names a grant is not
  // ignored. It cannot be placed in time or traced to its issuer, so it denies the grant it names, at any time.
  const badRevoked = new Set(checked.filter(([r, ok]) => !ok && isObj(r) && r.kind === 'revocation' && isId(r.grant)).map(([r]) => r.grant));
  if (valid.length === 0) return deny(RULES.NO_RECORDS, 'there are no valid trust records');
  if (roots.length === 0) return deny(RULES.NO_ROOTS, 'no root was passed: there is no default root');

  // PROVISIONAL (ADR 8, question 6, in part): a revocation is applied when its issuer is the issuer of the grant or a root,
  // and from its time. This adds no role-by-action matrix: the one who granted, or a root the caller passed, may withdraw.
  // Each time comparison is the negation of the passing case, so a time that is not a number revokes, starts late and expires.
  const revokedAt = (g) => revocations.some((v) => v.grant === g.id && !(now < ms(v.time)) && (v.issuer === g.issuer || roots.includes(v.issuer)));
  const badRevokedAt = (g) => badRevoked.has(g.id);
  const notYet = (g) => !(ms(g.start) <= now);
  const over = (g) => !(now < ms(g.expires));

  // The authority of a grant: its issuer is a root, or a live parent whose subject is the issuer delegates to it and is only
  // narrowed by it. A grant with no delegation block has depth 0, so it cannot be a parent; a grant issued by a non-root
  // that names no parent has no authority. Each step up names a parent of a higher depth, so the walk ends, and a cycle or a
  // grant that names itself fails the depth rule. The chain grows at its front: the granting end first.
  function authority(g, path) {
    const here = [g.id, ...path];
    const parentId = g.delegation?.parent;
    if (parentId === undefined) {
      return roots.includes(g.issuer) ? { ok: true, chain: here } : { ok: false, rule: RULES.UNTRUSTED_ISSUER, reason: `the issuer ${g.issuer} is not a root and names no parent grant`, chain: here };
    }
    const p = byId.get(parentId);
    const stop = (rule, reason) => ({ ok: false, rule, reason, chain: [...(p ? [p.id] : []), ...here] });
    if (!p && clash.has(parentId)) return { ok: false, rule: RULES.CONFLICTING_GRANT, reason: `the parent grant id ${parentId} is held by records that differ`, chain: [parentId, ...here] };
    if (!p) return stop(RULES.CHAIN_PARENT_MISSING, `the parent grant ${parentId} is not among the records`);
    if (p.subject !== g.issuer) return stop(RULES.CHAIN_PARENT_NOT_ISSUER, `the issuer ${g.issuer} is not the subject of the parent grant ${p.id}`);
    const pd = p.delegation?.depth ?? 0;
    if (pd < 1) return stop(RULES.CHAIN_PARENT_DEPTH_ZERO, `the parent grant ${p.id} has depth 0 and cannot delegate`);
    // PROVISIONAL (ADR 8, question 9, option B): delegation only narrows. The same scope, the same or fewer purposes, no
    // later expiry, no earlier start, and a depth lower than the parent's. Any other child is not honoured.
    if (!(g.delegation.depth < pd)) return stop(RULES.CHAIN_DEPTH, `the depth ${g.delegation.depth} is not lower than the depth ${pd} of the parent grant ${p.id}`);
    if (!sameScope(g.scope, p.scope)) return stop(RULES.CHAIN_SCOPE, `the scope differs from the scope of the parent grant ${p.id}`);
    if (!g.purposes.every((x) => p.purposes.includes(x))) return stop(RULES.CHAIN_PURPOSES, `the purposes are wider than those of the parent grant ${p.id}`);
    if (!(ms(g.expires) <= ms(p.expires))) return stop(RULES.CHAIN_EXPIRY, `the expiry is later than the expiry of the parent grant ${p.id}`);
    if (!(ms(g.start) >= ms(p.start))) return stop(RULES.CHAIN_START, `the start is earlier than the start of the parent grant ${p.id}`);
    // the child is live at this time, so by the rules above its parent has started and has not ended: only a revocation is left
    if (revokedAt(p)) return stop(RULES.CHAIN_PARENT_REVOKED, `the parent grant ${p.id} is revoked at this time`);
    if (badRevokedAt(p)) return stop(RULES.BAD_REVOCATION, `a revocation of the parent grant ${p.id} is malformed, so the parent grant is denied`);
    return authority(p, here);
  }

  const mine = [...byId.values()].filter((g) => g.subject === request.subject);
  const clashed = [...clash].filter(([, gs]) => gs.some((g) => g.subject === request.subject)).map(([id]) => id);
  if (mine.length === 0 && clashed.length === 0) return deny(RULES.NO_GRANT, `no grant names ${request.subject}`);
  const allowed = []; const denied = [];
  for (const id of clashed) denied.push({ stage: STAGE.conflict, d: deny(RULES.CONFLICTING_GRANT, `the grant id ${id} is held by records that differ, so none of them is honoured`, [id]) });
  for (const g of mine) {
    const no = (stage, d) => denied.push({ stage, d });
    if (!sameScope(g.scope, request.scope)) { no(STAGE.scope, deny(RULES.SCOPE_NOT_GRANTED, `the grant ${g.id} is for another scope`, [g.id])); continue; }
    if (!g.purposes.includes(request.purpose)) { no(STAGE.purpose, deny(RULES.PURPOSE_NOT_GRANTED, `the grant ${g.id} does not name the purpose ${request.purpose}`, [g.id])); continue; }
    if (notYet(g)) { no(STAGE.window, deny(RULES.NOT_YET_VALID, `the grant ${g.id} is not yet valid at this time`, [g.id])); continue; }
    if (over(g)) { no(STAGE.window, deny(RULES.EXPIRED, `the grant ${g.id} is expired at this time`, [g.id])); continue; }
    if (revokedAt(g)) { no(STAGE.revoked, deny(RULES.REVOKED, `the grant ${g.id} is revoked at this time`, [g.id])); continue; }
    if (badRevokedAt(g)) { no(STAGE.revoked, deny(RULES.BAD_REVOCATION, `a revocation of the grant ${g.id} is malformed, so the grant is denied`, [g.id])); continue; }
    const a = authority(g, []);
    if (a.ok) allowed.push({ chain: a.chain, g }); else no(STAGE.authority, deny(a.rule, a.reason, a.chain));
  }
  // The answer does not depend on the order of the records: the eligible grant whose chain sorts first, otherwise the deny
  // that went furthest, by the fixed priority above.
  if (allowed.length > 0) {
    const [first] = allowed.sort((a, b) => before(a.chain.join('\n'), b.chain.join('\n')));
    return allow(`the grant ${first.g.id} covers ${request.purpose} in this scope at this time`, first.chain);
  }
  return denied.sort(byPriority)[0].d;
}
