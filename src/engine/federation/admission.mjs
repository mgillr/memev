// SPDX-License-Identifier: Apache-2.0
// The node's own admission of a contribution: two steps before anything is appended, then a check against replay.
//
//   format     the envelope and its signature and admission block are well formed
//   external   an external admission service, when one is configured, runs first (it is not part of this module)
//   signature  step one: the signature verifies, offline, with a key of the subject the node knows
//   authority  step two: the subject has authority for the scope, and the policy accepts the scope and the classification.
//              A signature proves a key signed; whether that subject may write there is a separate check.
//   replay     the sequence is above the high-water mark of that sender
//
// A contribution that passes is appended to the vault's operation log as federation.admitted. A failure at any step, and a replay,
// is appended as federation.rejected, and nothing of the payload goes with it. There is no store but the log: the high-water mark of
// each sender is kept in memory and rebuilt from the admitted records when the object is made, so it survives a restart.
import { validateContribution, contributionMessage } from './contribution.mjs';
import { validateIdentityDocument, validateScope, authorizeScope } from '../identity.mjs';
import { verifyNamespaced, CONTRIBUTION_NAMESPACE } from '../agentid-bind.mjs';

const ADMITTED = 'federation.admitted';
const REJECTED = 'federation.rejected';
const sameScope = (a, b) => a.type === b.type && a.id === b.id;
const live = (o, at) => !(o.revoked_at && Date.parse(o.revoked_at) <= at) && !(o.expires && Date.parse(o.expires) <= at);
const short = (v, n = 160) => (typeof v === 'string' ? v.slice(0, n) : null);

export class Admission {
  /**
   * log       the vault's OpLog (append, iterate)
   * identity  the node's own identity document (subjects with keys, scopes, memberships)
   * scope     the scope this node holds, { type, id }
   * policy    { accept: [{ scope: { type, id }, classifications: [string] }] }: deny by default
   * external  optional (envelope) => { ok, code?, reason? }, run before the two steps; a refusal or a throw is a rejection
   * verify    the signature check, agentid-bind's verifyNamespaced; replaceable for a test
   */
  constructor({ log, identity, scope, policy, external = null, verify = verifyNamespaced } = {}) {
    if (!log || typeof log.append !== 'function' || typeof log.iterate !== 'function') throw new TypeError('admission needs the vault operation log');
    const doc = validateIdentityDocument(identity);
    if (!doc.ok) throw new TypeError(`admission needs a valid identity document: ${doc.errors[0]}`);
    if (!scope || validateScope(scope).length) throw new TypeError('admission needs the scope this node holds');
    if (!policy || !Array.isArray(policy.accept) || !policy.accept.every((e) => e && e.scope && validateScope(e.scope).length === 0 && Array.isArray(e.classifications) && e.classifications.every((c) => typeof c === 'string' && c))) {
      throw new TypeError('admission needs a policy: { accept: [{ scope, classifications }] }');
    }
    this.log = log; this.identity = identity; this.scope = { type: scope.type, id: scope.id }; this.policy = policy; this.external = external; this.verify = verify;
    this.subjects = new Map(identity.subjects.map((s) => [s.id, s]));
    this.highs = new Map();
    for (const rec of log.iterate()) if (rec.type === ADMITTED && typeof rec.data?.sender === 'string' && Number.isSafeInteger(rec.data.sequence)) this.highs.set(rec.data.sender, Math.max(this.highs.get(rec.data.sender) ?? 0, rec.data.sequence));
  }

  highWater(sender) { return this.highs.get(sender) ?? 0; }
  static sender(envelope) { return `${envelope.origin.node}|${envelope.extension.contribution.subject}`; }

  /** Step one on its own: { ok: true } or { ok: false, code, reason }. It reads and writes nothing. */
  verifySignature(envelope, { at = Date.now() } = {}) {
    const v = validateContribution(envelope);
    if (!v.ok) return { ok: false, code: 'bad_contribution', reason: v.errors[0] };
    const b = envelope.extension.contribution;
    const subject = this.subjects.get(b.subject);
    if (!subject) return { ok: false, code: 'unknown_subject', reason: `${b.subject} is not a subject of this node` };
    const keys = (subject.keys ?? []).filter((k) => k.alg === 'ed25519' && k.id === b.signature.principal && live(k, at));
    if (!keys.length) return { ok: false, code: 'no_valid_key', reason: `${b.subject} has no live key named ${b.signature.principal}` };
    const message = contributionMessage(envelope);
    for (const k of keys) {
      const r = this.verify(message, b.signature.sshsig, { principal: b.signature.principal, publicKey: k.public, namespace: CONTRIBUTION_NAMESPACE });
      if (r === 'valid') return { ok: true };
      if (r === 'unavailable') return { ok: false, code: 'verifier_unavailable', reason: 'the signature could not be checked here, so the contribution is refused' };
    }
    return { ok: false, code: 'bad_signature', reason: 'the signature does not verify with a key of the subject' };
  }

  /** Step two on its own: { ok: true } or { ok: false, code, reason }. Authority and policy for the scope and the classification. */
  authorize(envelope, { at = Date.now() } = {}) {
    const b = envelope.extension.contribution;
    const here = authorizeScope(b.scope, this.scope);
    if (!here.ok) return { ok: false, code: 'scope_mismatch', reason: here.reason };
    const subject = this.subjects.get(b.subject);
    if (subject.revoked_at && Date.parse(subject.revoked_at) <= at) return { ok: false, code: 'subject_revoked', reason: `${subject.id} is revoked` };
    if (subject.expires && Date.parse(subject.expires) <= at) return { ok: false, code: 'subject_expired', reason: `${subject.id} has expired` };
    const known = this.identity.scopes.some((s) => sameScope(s, b.scope));
    const member = known && this.identity.memberships.some((m) => m.subject === subject.id && m.scope === b.scope.id && Date.parse(m.since) <= at && live(m, at));
    if (!member) return { ok: false, code: 'no_authority', reason: `${subject.id} has no membership in ${b.scope.type} ${b.scope.id}` };
    const accepted = this.policy.accept.some((e) => sameScope(e.scope, b.scope) && e.classifications.includes(b.classification));
    if (!accepted) return { ok: false, code: 'policy_denied', reason: `the policy of this node does not accept ${JSON.stringify(b.classification)} for ${b.scope.type} ${b.scope.id}` };
    return { ok: true };
  }

  /**
   * Admit one contribution. Returns { ok: true, record, sender, sequence } after it is appended, or
   * { ok: false, step, code, reason, signature_valid } after a rejected event is appended in its place.
   */
  admit(envelope, { at = Date.now() } = {}) {
    const fail = (step, code, reason, signatureValid) => {
      const rec = this._reject(envelope, step, code, reason);
      return { ok: false, step, code, reason, signature_valid: signatureValid, record: rec };
    };
    const v = validateContribution(envelope);
    if (!v.ok) return fail('format', 'bad_contribution', v.errors[0], false);
    if (this.external) {
      let r;
      try { r = this.external(envelope); } catch (e) { return fail('external', 'external_failed', `the external admission service failed: ${e?.message ?? e}`, false); }
      if (!r || r.ok !== true) return fail('external', short(r?.code, 64) || 'external_refused', short(r?.reason) || 'the external admission service refused it', false);
    }
    const sig = this.verifySignature(envelope, { at });
    if (!sig.ok) return fail('signature', sig.code, sig.reason, false);
    const auth = this.authorize(envelope, { at });
    if (!auth.ok) return fail('authority', auth.code, auth.reason, true);
    const sender = Admission.sender(envelope), b = envelope.extension.contribution;
    if (b.sequence <= this.highWater(sender)) return fail('replay', 'replay', `sequence ${b.sequence} is not above the high-water mark ${this.highWater(sender)} of ${sender}`, true);
    const record = this.log.append({ type: ADMITTED, agent: b.subject, client: envelope.origin.node, data: { envelope, sender, sequence: b.sequence } });
    this.highs.set(sender, b.sequence);
    return { ok: true, record, sender, sequence: b.sequence };
  }

  // The rejected event names the contribution, the step and the reason, and holds nothing of the payload (no payload, no extension,
  // no payload hash). Everything in it is short text or a number, whatever the sender sent.
  _reject(envelope, step, code, reason) {
    const o = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope : {};
    const b = o.extension && typeof o.extension === 'object' && o.extension.contribution && typeof o.extension.contribution === 'object' ? o.extension.contribution : {};
    const node = o.origin && typeof o.origin === 'object' ? short(o.origin.node, 128) : null;
    const subject = short(b.subject, 128);
    const scope = b.scope && typeof b.scope === 'object' && typeof b.scope.type === 'string' && typeof b.scope.id === 'string' ? `${short(b.scope.type, 32)}/${short(b.scope.id, 128)}` : null;
    return this.log.append({
      type: REJECTED, agent: subject, client: node,
      data: {
        op_id: short(o.op_id, 128), sender: node && subject ? `${node}|${subject}` : null, subject, scope,
        sequence: Number.isSafeInteger(b.sequence) ? b.sequence : null, step, code: short(code, 64), reason: short(reason),
        content_hash: typeof o.content_hash === 'string' && /^[0-9a-f]{64}$/.test(o.content_hash) ? o.content_hash : null,
      },
    });
  }
}
