// SPDX-License-Identifier: Apache-2.0
// The policy document and the evaluation function.
//
// A policy states, for each data class, whether each of six actions is allowed (discover, read, replicate, compute, retain, export)
// and the recovery objectives of the class. The class list is open: any class name the classification schema of a later contract
// pins is allowed here, and a class the policy does not list has no rule. evaluate() maps (subject, scope, action, class) to allow or
// deny with the id of the rule that decided, and denies by default: no relationship for the scope, one that is revoked, expired or not
// yet established, a policy version the relationship did not accept, a class or action the policy does not allow, a personal scope,
// or a request it cannot read are all a denial with a rule id. It never throws.
//
// The subject is checked to be a subject id and no rule here depends on which subject it is, because who may act inside a site is
// the membership of the identity model. relationshipGate() turns evaluate() into the optional check that the node's
// admission runs before its two steps. docs/FEDERATION.md describes the policy, and docs/schemas/policy-v1.json is its schema.
import { SUBJECT_TYPES, validateScope } from '../identity.mjs';
import { validateRelationship, relationshipState } from './membership.mjs';

export const POLICY_SCHEMA = 'memev-policy/1';
export const POLICY_ACTIONS = Object.freeze(['discover', 'read', 'replicate', 'compute', 'retain', 'export']);
export const RECOVERY_FIELDS = Object.freeze(['rpo_seconds', 'rto_seconds']);
/** The ids of the rules that deny. An allow carries `allow:<policy id>:<class>:<action>`. */
export const DENY_RULES = Object.freeze(['deny.bad_request', 'deny.personal_scope', 'deny.no_relationship', 'deny.not_established', 'deny.revoked', 'deny.expired', 'deny.policy_version', 'deny.no_rule', 'deny.action']);

const NAME_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SUBJECT_RE = new RegExp(`^(${SUBJECT_TYPES.join('|')}):[A-Za-z0-9._@+-]+$`);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const sameScope = (a, b) => a.type === b.type && a.id === b.id;

/** { ok, errors }: a policy document of schema memev-policy/1. */
export function validatePolicy(p) {
  if (!isObj(p)) return { ok: false, errors: ['a policy must be an object'] };
  const errors = [];
  for (const f of ['schema', 'id', 'version', 'classes']) if (!(f in p)) errors.push(`${f}: missing`);
  for (const k of Object.keys(p)) if (!['schema', 'id', 'version', 'classes'].includes(k)) errors.push(`${k}: not a field of ${POLICY_SCHEMA}`);
  if ('schema' in p && p.schema !== POLICY_SCHEMA) errors.push(`schema: must be ${POLICY_SCHEMA}`);
  if ('id' in p && !(typeof p.id === 'string' && NAME_RE.test(p.id))) errors.push('id: must be letters, digits and . _ : -');
  if ('version' in p && !text(p.version, 64)) errors.push('version: must be a short text');
  if ('classes' in p) {
    if (!isObj(p.classes) || !Object.keys(p.classes).length) errors.push('classes: a policy lists at least one data class');
    else {
      for (const [name, c] of Object.entries(p.classes)) {
        const at = `classes.${name}`;
        if (!NAME_RE.test(name)) errors.push(`${at}: a class name is letters, digits and . _ : - with no spaces`);
        if (!isObj(c)) { errors.push(`${at}: must be an object`); continue; }
        for (const a of POLICY_ACTIONS) {
          if (!(a in c)) errors.push(`${at}.${a}: missing`);
          else if (typeof c[a] !== 'boolean') errors.push(`${at}.${a}: must be true or false`);
        }
        for (const k of Object.keys(c)) if (!POLICY_ACTIONS.includes(k) && k !== 'recovery') errors.push(`${at}.${k}: is not an action of ${POLICY_SCHEMA}`);
        if (!('recovery' in c)) errors.push(`${at}.recovery: missing`);
        else if (!isObj(c.recovery)) errors.push(`${at}.recovery: must be { rpo_seconds, rto_seconds }`);
        else {
          for (const f of RECOVERY_FIELDS) if (!(Number.isSafeInteger(c.recovery[f]) && c.recovery[f] >= 0)) errors.push(`${at}.recovery.${f}: must be a whole number of seconds, 0 or more`);
          for (const k of Object.keys(c.recovery)) if (!RECOVERY_FIELDS.includes(k)) errors.push(`${at}.recovery.${k}: not a field of the recovery objectives`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

const verdict = (decision, rule, reason, relationship = null) => ({ decision, rule, reason, relationship });
const deny = (rule, reason, relationship = null) => verdict('deny', rule, reason, relationship);

/**
 * Evaluate one request: { subject, scope, action, class } against the relationships and the policy at a time (ms).
 * Returns { decision: 'allow' | 'deny', rule, reason, relationship }.
 */
export function evaluate(request, { relationships, policy, at = Date.now() } = {}) {
  try {
    if (!isObj(request)) return deny('deny.bad_request', 'the request is not an object');
    const { subject, scope, action, class: dataClass } = request;
    if (typeof subject !== 'string' || !SUBJECT_RE.test(subject)) return deny('deny.bad_request', 'the subject is not a subject id');
    if (!isObj(scope) || validateScope(scope).length) return deny('deny.bad_request', 'the scope is not a valid scope');
    if (!POLICY_ACTIONS.includes(action)) return deny('deny.bad_request', `the action is not one of ${POLICY_ACTIONS.join(', ')}`);
    if (typeof dataClass !== 'string' || !NAME_RE.test(dataClass)) return deny('deny.bad_request', 'the class is not a class name');
    if (scope.type === 'personal') return deny('deny.personal_scope', 'a personal scope is never shared');
    if (!Number.isFinite(at)) return deny('deny.bad_request', 'the time is not a number');
    const p = validatePolicy(policy);
    if (!p.ok) return deny('deny.bad_request', `the policy is not valid: ${p.errors[0]}`);
    if (!Array.isArray(relationships)) return deny('deny.bad_request', 'the relationships are not a list');
    const mine = relationships.filter((r) => validateRelationship(r).ok && sameScope(r.scope, scope));
    if (!mine.length) return deny('deny.no_relationship', 'no relationship covers this scope');
    const states = mine.map((r) => [r, relationshipState(r, at)]);
    const live = states.find(([, s]) => s === 'active');
    if (!live) {
      const order = [['revoked', 'deny.revoked'], ['expired', 'deny.expired']];
      for (const [state, rule] of order) { const hit = states.find(([, s]) => s === state); if (hit) return deny(rule, `the relationship is ${state}`, hit[0].id); }
      return deny('deny.not_established', 'the relationship is not established yet', states[0][0].id);
    }
    const rel = live[0];
    if (rel.policy_version !== policy.version) return deny('deny.policy_version', 'the relationship did not accept this version of the policy', rel.id);
    const rule = Object.hasOwn(policy.classes, dataClass) ? policy.classes[dataClass] : null;
    if (!rule) return deny('deny.no_rule', 'the policy has no rule for this class', rel.id);
    if (rule[action] !== true) return deny('deny.action', `the policy does not allow ${action} for this class`, rel.id);
    return verdict('allow', `allow:${policy.id}:${dataClass}:${action}`, `the policy allows ${action} for this class`, rel.id);
  } catch (e) {
    return deny('deny.bad_request', `the request could not be evaluated: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

/**
 * The check a node's admission runs before its two steps (the `external` option of Admission): a contribution is a request to replicate
 * its class into its scope, and the relationships of the node's book and the policy decide. `now` gives the time to decide at.
 * Returns (envelope) => { ok: true } or { ok: false, code: <rule id>, reason }.
 */
export function relationshipGate({ book, policy, now = Date.now } = {}) {
  if (!book || typeof book.list !== 'function') throw new TypeError('a gate needs a relationship book');
  const valid = validatePolicy(policy);
  if (!valid.ok) throw new TypeError(`a gate needs a valid policy: ${valid.errors[0]}`);
  return (envelope) => {
    const b = envelope?.extension?.contribution;
    const r = evaluate({ subject: b?.subject, scope: b?.scope, action: 'replicate', class: b?.classification }, { relationships: book.list(), policy, at: now() });
    return r.decision === 'allow' ? { ok: true, rule: r.rule } : { ok: false, code: r.rule, reason: r.reason };
  };
}
