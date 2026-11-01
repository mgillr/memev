// SPDX-License-Identifier: Apache-2.0
// The identity and scopes model, version 1 (SO-F-01): who a request is (a subject) and where it may act (a scope).
// This module holds the model, its validator and the resolution of a credential to a subject and a scope. It holds no
// store of its own: a token's subject and identity scope live in the token record (tokens.mjs), a role binding is read
// from the agents directory it already lives in (agentid-bind.mjs), and a vault names its own scope in its config.
// Everything here runs on this computer; nothing calls out. Documented in docs/IDENTITY-AND-SCOPES.md; the schema is
// docs/schemas/identity-v1.json. What is not enforced yet is labelled planned there.
import fs from 'node:fs';
import path from 'node:path';
import { verifyAgentBinding, checkRole, checkPrincipal } from './agentid-bind.mjs';

export const IDENTITY_SCHEMA = 'memev-identity/1';
export const SUBJECT_TYPES = ['person', 'agent', 'device', 'node', 'operator', 'service'];
export const SCOPE_TYPES = ['personal', 'team', 'department', 'project', 'programme', 'portfolio', 'site', 'organisation'];
export const KEY_ALGS = ['ed25519'];

/** The scope every credential of today resolves to, and the subject that owns it. */
export const PERSONAL_SCOPE = Object.freeze({ type: 'personal', id: 'personal' });
export const OWNER_SUBJECT = Object.freeze({ id: 'person:owner', type: 'person', owner: 'person:owner' });

const ID_PART = /^[A-Za-z0-9._@+-]+$/;
const SUBJECT_ID = new RegExp(`^(${SUBJECT_TYPES.join('|')}):[A-Za-z0-9._@+-]+$`);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const present = (x) => x !== undefined;
const isTime = (x) => typeof x === 'string' && Number.isFinite(Date.parse(x));
const timeOrNull = (x) => x === null || isTime(x);
const unknownFields = (o, known, what) => Object.keys(o).filter((k) => present(o[k]) && !known.includes(k)).map((k) => `${what} has an unknown field: ${k}`);

function validateKey(k, where) {
  if (!isObj(k)) return [`${where}: a key must be an object`];
  const e = [];
  if (typeof k.id !== 'string' || !ID_PART.test(k.id)) e.push(`${where}: a key needs an id`);
  if (!KEY_ALGS.includes(k.alg)) e.push(`${where}: key algorithm must be one of ${KEY_ALGS.join(', ')}`);
  if (typeof k.public !== 'string' || !k.public) e.push(`${where}: a key needs its public part`);
  if (present(k.created) && !isTime(k.created)) e.push(`${where}: key created must be a time`);
  if (present(k.expires) && !timeOrNull(k.expires)) e.push(`${where}: key expires must be a time or null`);
  if (present(k.revoked_at) && !timeOrNull(k.revoked_at)) e.push(`${where}: key revoked_at must be a time or null`);
  return [...e, ...unknownFields(k, ['id', 'alg', 'public', 'created', 'expires', 'revoked_at'], `${where}: key`)];
}

/** Errors for one subject: a person, agent, device, node, operator or service, with its owner, keys, expiry and revocation. */
export function validateSubject(s) {
  if (!isObj(s)) return ['a subject must be an object'];
  const e = [];
  const id = typeof s.id === 'string' ? s.id : '';
  if (!SUBJECT_TYPES.includes(s.type)) e.push(`subject ${id || '?'}: type must be one of ${SUBJECT_TYPES.join(', ')}`);
  if (!SUBJECT_ID.test(id) || (SUBJECT_TYPES.includes(s.type) && !id.startsWith(`${s.type}:`))) e.push(`subject ${id || '?'}: id must be <type>:<name> and match its type`);
  // every subject has an owner, and the owner is a person: a person owns itself, anything else names the person behind it
  if (typeof s.owner !== 'string' || !s.owner) e.push(`subject ${id || '?'}: an owner is required`);
  else if (!s.owner.startsWith('person:') || !SUBJECT_ID.test(s.owner)) e.push(`subject ${id || '?'}: the owner must be a person subject`);
  else if (s.type === 'person' && s.owner !== id) e.push(`subject ${id || '?'}: a person is its own owner`);
  if (s.type === 'agent') {
    if (typeof s.role !== 'string' || !ID_PART.test(s.role)) e.push(`subject ${id || '?'}: an agent subject names a role`);
    for (const f of ['provider', 'model', 'vendor']) if (present(s[f])) e.push(`subject ${id || '?'}: an agent subject names a role, never a provider (${f})`);
  } else if (present(s.role)) e.push(`subject ${id || '?'}: only an agent subject has a role`);
  if (present(s.keys)) {
    if (!Array.isArray(s.keys)) e.push(`subject ${id || '?'}: keys must be a list`);
    else s.keys.forEach((k, i) => e.push(...validateKey(k, `subject ${id || '?'} key ${i}`)));
  }
  if (present(s.expires) && !timeOrNull(s.expires)) e.push(`subject ${id || '?'}: expires must be a time or null`);
  if (present(s.revoked_at) && !timeOrNull(s.revoked_at)) e.push(`subject ${id || '?'}: revoked_at must be a time or null`);
  return [...e, ...unknownFields(s, ['id', 'type', 'owner', 'role', 'keys', 'expires', 'revoked_at'].concat(s.type === 'agent' ? ['provider', 'model', 'vendor'] : []), `subject ${id || '?'}`)];
}

/** Errors for one scope: it has an id and one of the eight types. */
export function validateScope(s) {
  if (!isObj(s)) return ['a scope must be an object'];
  const e = [];
  if (typeof s.id !== 'string' || !ID_PART.test(s.id)) e.push('a scope needs an id');
  if (!SCOPE_TYPES.includes(s.type)) e.push(`a scope needs a type, one of ${SCOPE_TYPES.join(', ')}`);
  if (present(s.parent) && (typeof s.parent !== 'string' || !ID_PART.test(s.parent))) e.push(`scope ${s.id ?? '?'}: parent must name a scope id`);
  return [...e, ...unknownFields(s, ['id', 'type', 'parent'], `scope ${s.id ?? '?'}`)];
}

/** Errors for one membership: a subject belongs to a scope from a time, until it expires or is revoked. */
export function validateMembership(m) {
  if (!isObj(m)) return ['a membership must be an object'];
  const e = [];
  if (typeof m.subject !== 'string' || !SUBJECT_ID.test(m.subject)) e.push('a membership needs a subject id');
  if (typeof m.scope !== 'string' || !ID_PART.test(m.scope)) e.push('a membership needs a scope id');
  if (!isTime(m.since)) e.push('a membership needs a since time');
  if (present(m.expires) && !timeOrNull(m.expires)) e.push('membership expires must be a time or null');
  if (present(m.revoked_at) && !timeOrNull(m.revoked_at)) e.push('membership revoked_at must be a time or null');
  return [...e, ...unknownFields(m, ['subject', 'scope', 'since', 'expires', 'revoked_at'], 'membership')];
}

/** A whole document: every part valid, ids unique, every owner and every membership pointing at something in it. */
export function validateIdentityDocument(doc) {
  if (!isObj(doc)) return { ok: false, errors: ['an identity document must be an object'] };
  const errors = [];
  if (doc.schema !== IDENTITY_SCHEMA) errors.push(`schema must be ${IDENTITY_SCHEMA}`);
  const list = (k) => (Array.isArray(doc[k]) ? doc[k] : (errors.push(`${k} must be a list`), []));
  const subjects = list('subjects'); const scopes = list('scopes'); const memberships = list('memberships');
  const ids = new Set(); const scopeIds = new Set();
  subjects.forEach((s) => { errors.push(...validateSubject(s)); if (isObj(s)) { if (ids.has(s.id)) errors.push(`subject ${s.id}: duplicate id`); ids.add(s.id); } });
  scopes.forEach((s) => { errors.push(...validateScope(s)); if (isObj(s)) { if (scopeIds.has(s.id)) errors.push(`scope ${s.id}: duplicate id`); scopeIds.add(s.id); } });
  subjects.forEach((s) => { if (isObj(s) && typeof s.owner === 'string' && s.owner && !ids.has(s.owner)) errors.push(`subject ${s.id}: the owner ${s.owner} is not a subject of this document`); });
  scopes.forEach((s) => { if (isObj(s) && s.parent && !scopeIds.has(s.parent)) errors.push(`scope ${s.id}: the parent ${s.parent} is not a scope of this document`); });
  memberships.forEach((m) => {
    errors.push(...validateMembership(m));
    if (isObj(m)) { if (m.subject && !ids.has(m.subject)) errors.push(`membership: ${m.subject} is not a subject of this document`); if (m.scope && !scopeIds.has(m.scope)) errors.push(`membership: ${m.scope} is not a scope of this document`); }
  });
  errors.push(...unknownFields(doc, ['schema', 'subjects', 'scopes', 'memberships'], 'the document'));
  return { ok: errors.length === 0, errors };
}

// ---- resolution

const refuse = (code, reason) => ({ ok: false, code, reason });
const sameScope = (a, b) => a.type === b.type && a.id === b.id;
const describe = (s) => (s.type === 'personal' ? 'a personal scope' : `the organisational scope ${s.type} ${s.id}`);

/** The scope a vault holds: the one named in its config, or the personal scope. An invalid name is a refusal object (ok: false). */
export function vaultScope(config) {
  const named = config?.identity?.scope;
  if (named === undefined) return PERSONAL_SCOPE;
  const errs = validateScope(named);
  return errs.length ? refuse('bad_scope', `this vault names an invalid scope: ${errs[0]}`) : { type: named.type, id: named.id };
}

/** Whether a credential of `scope` may read or write `target`. A personal scope and an organisational scope never mix; two organisational scopes meet only when they are the same one. */
export function authorizeScope(scope, target) {
  if (!isObj(scope) || validateScope(scope).length) return refuse('bad_scope', 'the credential names no valid scope');
  if (!isObj(target) || target.ok === false || validateScope(target).length) return refuse('bad_scope', target?.reason || 'the vault names no valid scope');
  if (sameScope(scope, target)) return { ok: true };
  const who = scope.type === 'personal' ? 'a credential issued for a personal scope' : `a credential issued for ${describe(scope)}`;
  return refuse('scope_mismatch', `${who} cannot read or write ${describe(target)}`);
}

/**
 * Resolve a verified credential (the identity tokens.verify returns) to a subject and a scope.
 * A token issued the way tokens are today has no identity scope: it resolves to the owner subject and the personal scope.
 * A token with an identity scope carries its own subject, and the scope must be one of the eight types.
 * With `target`, the scope is also held against the scope the request reaches for.
 * Returns { ok: true, subject, scope, credential } or { ok: false, code, reason }.
 */
export function resolveRequest(identity, { target, at = Date.now() } = {}) {
  if (!isObj(identity)) return refuse('no_identity', 'no credential was presented, so no subject or scope can be resolved');
  const credential = String(identity.id || identity.agent || '');
  if (!credential) return refuse('no_subject', 'the credential names no token and no agent, so no subject can be resolved');
  const named = identity.identity_scope;
  let subject; let scope;
  if (named === undefined || named === null || named.type === 'personal') {
    if (named !== undefined && named !== null && validateScope(named).length) return refuse('bad_scope', `the credential names an invalid scope: ${validateScope(named)[0]}`);
    subject = { ...OWNER_SUBJECT };
    scope = named ? { type: named.type, id: named.id } : { ...PERSONAL_SCOPE };
  } else {
    const errs = validateScope(named);
    if (errs.length) return refuse('bad_scope', `the credential names an invalid scope: ${errs[0]}`);
    scope = { type: named.type, id: named.id };
    const bad = validateSubject(identity.subject);
    if (bad.length) return refuse('no_subject', `an organisational credential must name its subject: ${bad[0]}`);
    subject = { ...identity.subject };
    if (subject.revoked_at && Date.parse(subject.revoked_at) <= at) return refuse('revoked', `the subject ${subject.id} is revoked`);
    if (subject.expires && Date.parse(subject.expires) <= at) return refuse('expired', `the subject ${subject.id} has expired`);
  }
  if (target !== undefined) {
    const a = authorizeScope(scope, target);
    if (!a.ok) return a;
  }
  return { ok: true, subject, scope, credential };
}

// ---- role bindings (MEM-145, MEM-146): an agent subject bound to a person subject, read from where the binding already is

/**
 * Resolve one role binding to an agent subject whose owner is the person that vouched for it.
 * A binding is issued for the personal scope unless `scope` says otherwise; with `target` it is held to the same rule as a token.
 */
export function resolveBinding({ role, principal, key } = {}, { scope = PERSONAL_SCOPE, target } = {}) {
  try { checkRole(role); checkPrincipal(principal); } catch (e) { return refuse('no_subject', `the binding does not name a valid role and principal: ${e.message}`); }
  if (target !== undefined) { const a = authorizeScope(scope, target); if (!a.ok) return a; }
  const person = { id: `person:${principal}`, type: 'person', owner: `person:${principal}`, keys: [] };
  const agent = { id: `agent:${role}`, type: 'agent', owner: person.id, role, keys: key ? [{ id: role, alg: 'ed25519', public: key }] : [] };
  return { ok: true, subject: agent, owner: person, scope: { type: scope.type, id: scope.id } };
}

// ---- the actor behind a credential (SO-F-09): who acted, for a caller that sets `by` from it

const ACTORS = new WeakSet();
/** Whether `x` is a result resolveActor made. A caller cannot build one: an object of the same shape is not one. */
export const isResolvedActor = (x) => ACTORS.has(x);

/**
 * Resolve a credential to the actor behind it: the subject that may be named as `by` on an event, and the scope it acts in.
 * `credential` is what tokens.verify returned for a request that is already verified, or a role binding ({ role, principal, key })
 * that agentid-bind.mjs verified, with `scope` for the scope that binding was issued for. `target` holds the scope against the scope
 * the request reaches for. This does not check the credential: whatever calls it has verified the token or the binding.
 * resolveRequest maps every token with no identity scope to the owner person, an agent's included; it is left as it is, and this
 * resolves the same token to the agent it names:
 * - a credential of the personal scope that names an agent resolves, through resolveBinding, to the agent subject agent:<name>, owned by
 *   person:owner, never to person:owner;
 * - a credential of the personal scope that carries a subject resolves to that subject, a person or an agent;
 * - any other scope resolves as resolveRequest does, to the subject the credential names.
 * Returns a frozen { ok: true, subject, owner (the person's id), scope, credential } that isResolvedActor knows, or { ok: false, code, reason }.
 */
export function resolveActor(credential, { target, at = Date.now(), scope } = {}) {
  if (!isObj(credential)) return refuse('no_identity', 'no credential was presented, so no actor can be resolved');
  let r;
  if (present(credential.role) || present(credential.principal)) {
    r = resolveBinding(credential, { ...(scope ? { scope } : {}), ...(target !== undefined ? { target } : {}) });
    if (!r.ok) return r;
    r = { ...r, credential: `agent:${credential.role}` };
  } else {
    const named = credential.identity_scope;
    const personal = named === undefined || named === null || named.type === 'personal';
    if (!personal) r = resolveRequest(credential, { target, at });
    else {
      const base = resolveRequest(credential, { target, at });
      if (!base.ok) return base;
      const subject = credential.subject;
      if (isObj(subject) && !validateSubject(subject).length && ['person', 'agent'].includes(subject.type)) r = { ...base, subject: { ...subject }, owner: subject.owner };
      else if (subject !== undefined && subject !== null) return refuse('no_subject', `the credential names a subject that is not valid: ${isObj(subject) ? validateSubject(subject)[0] : 'not an object'}`);
      else {
        const b = resolveBinding({ role: credential.agent, principal: OWNER_SUBJECT.id.slice('person:'.length) }, { scope: base.scope });
        if (!b.ok) return refuse('no_subject', 'a credential of the personal scope acts as the agent it names, and this one names none');
        r = { ...b, scope: base.scope, credential: base.credential };
      }
    }
    if (!r.ok) return r;
  }
  const owner = isObj(r.owner) ? r.owner.id : r.owner ?? r.subject.owner;
  const actor = Object.freeze({ ok: true, subject: Object.freeze({ ...r.subject }), owner, scope: Object.freeze({ ...r.scope }), credential: r.credential ?? null });
  ACTORS.add(actor);
  return actor;
}

/**
 * The subjects the bindings of an agents directory give: one agent subject per role whose binding verifies, and the person
 * subject that vouched for it. A binding that is unbound, invalid or could not be checked is not a subject; it is listed in skipped.
 * `verify` is the check of agentid-bind.mjs (OpenSSH), replaceable for a test. Nothing is written.
 */
export function subjectsFromBindings(dir, { allowedSigners, verify = verifyAgentBinding } = {}) {
  const subjects = []; const skipped = []; const seen = new Set();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.pub') && !f.endsWith('.sshsig')).sort(); } catch { return { subjects, skipped }; }
  for (const f of files) {
    const role = f.slice(0, -4);
    let principal = '';
    try { principal = fs.readFileSync(path.join(dir, `${role}.pub.principal`), 'utf8').trim(); } catch { /* no principal: unbound */ }
    if (!principal) { skipped.push({ role, status: 'unbound' }); continue; }
    const status = verify(role, { allowedSigners, principal, dir });
    if (status !== 'bound') { skipped.push({ role, status }); continue; }
    let key = '';
    try { key = fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { /* the key is optional in the subject */ }
    const r = resolveBinding({ role, principal, key });
    if (!r.ok) { skipped.push({ role, status: r.code }); continue; }
    if (!seen.has(r.owner.id)) { seen.add(r.owner.id); subjects.push(r.owner); }
    subjects.push(r.subject);
  }
  return { subjects, skipped };
}
