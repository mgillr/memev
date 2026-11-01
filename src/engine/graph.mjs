// SPDX-License-Identifier: Apache-2.0
// The memory graph: what is connected to what, how sure the vault is of each claim, and where each
// memory came from and was used.
//
// Nodes:   note sections (note:<path>#<heading>), entities (ent:<slug>), claims (claim:<id>).
// Edges:   mentions (section -> entity), co_occurs (entity <-> entity, weighted), in_project,
//          links_to (explicit [[wikilink]]), supports / opposes (evidence section -> claim), and any
//          explicit edge an agent records (related, causes, depends_on, contradicts, derived_from).
// Derived edges are recomputed from the Markdown on every write (they are a pure function of the notes).
// Explicit edges, claims, evidence, status changes and usage are operations in the append-only log, so
// the graph is lossless: nothing is deleted, a retraction is a new operation.
//
// Epistemic status of a claim, from its evidence (noisy-OR over distinct sources):
//   conjecture  speculation, or support below 0.5
//   theory      support >= 0.5
//   fact        support >= 0.85 from >= 2 independent sources and opposition < 0.2
//   contested   support and opposition both >= 0.3
//   refuted     opposition >= 0.6 and above support
// Promotion and demotion happen as evidence arrives; every change is logged as a claim.status op.
//
// A finding is a claim that carries its source events and versions, the entities and owners it affects,
// its scope and time context and a confidence (see docs/ORGANISATIONAL-INTELLIGENCE.md). Evidence alone
// takes it no further than theory; fact needs a person's adjudication or a passing verification record.
// Raising, dismissing, correcting, adjudicating and verifying a finding are operations in the same log.
// A reader is shown a finding only as far as the scope of each source lets them read, and a partial view withholds
// everything drawn from the whole of the sources (the statement, id, status, confidence, context).
// Who acted comes from a credential: Graph.readerFor resolves one (identity.mjs) into a reader that only this module can
// make, and bindFinding and bindEvent set `by` from it and ignore any value the caller passes. The log is replayed as
// written, so a record that did not come through them is as trusted as the log file itself.
import { slug, truncate } from './util.mjs';
import { sections, own } from './index.mjs';
import { SUBJECT_TYPES, OWNER_SUBJECT, validateScope, authorizeScope, resolveRequest, resolveBinding } from './identity.mjs';

const noisyOr = (xs) => 1 - xs.reduce((p, x) => p * (1 - Math.max(0, Math.min(1, x))), 1);
export const FINDING_EVENTS = Object.freeze(['claim.finding.dismiss', 'claim.finding.correct', 'claim.finding.adjudicate', 'claim.finding.verify']);
const FINDING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT_ID = /^[A-Za-z0-9._:@+/-]{1,128}$/;
const SUBJECT_RE = new RegExp(`^(${SUBJECT_TYPES.join('|')}):[A-Za-z0-9._@+-]+$`);
const subjectType = (id) => (typeof id === 'string' && SUBJECT_RE.test(id) ? id.split(':')[0] : null);
const isTime = (t) => typeof t === 'string' && /^\d{4}-\d\d-\d\d/.test(t) && !Number.isNaN(Date.parse(t));
const isText = (t, max) => typeof t === 'string' && t.length > 0 && t.length <= max;
const CORRECTABLE = ['subject', 'predicate', 'object', 'confidence', 'context', 'entities', 'owners'];
// Provisional (ADR 5, the permission matrix, is open): who may adjudicate, verify, correct and dismiss is what is written here and
// nothing more. An adjudication counts from a person, a verification from a person, an operator or a service (the service and
// operator subjects cannot be issued yet), and a dismissal or a correction from any subject. The confirm and reject outcomes
// are provisional too: they stand in for the seven decision states of SO-A-05 and SO-1.08, which are not in code yet.
const VERIFIER_TYPES = ['person', 'operator', 'service'];
// the readers this module has made: a reader is a credential resolved here, never an object a caller built
const READERS = new WeakSet();
export const EDGE_TYPES = ['related', 'causes', 'depends_on', 'contradicts', 'derived_from', 'part_of', 'supersedes'];

/** Entities named in a section: [[wikilinks]], Project: lines, #tags, `code names`, Capitalised Multi Words. */
export function extractEntities(text) {
  const out = new Map();
  const add = (name, kind) => { const n = String(name).trim(); if (n.length < 2 || n.length > 60) return; const id = slug(n); if (!out.has(id)) out.set(id, { id, name: n, kind }); };
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) add(m[1], 'link');
  for (const m of text.matchAll(/^project:\s*(.+)$/gim)) add(m[1], 'project');
  for (const m of text.matchAll(/(?:^|\s)#([A-Za-z][\w-]{1,30})/g)) add(m[1], 'tag');
  for (const m of text.matchAll(/`([A-Za-z][\w.-]{2,40})`/g)) add(m[1], 'code');
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) add(m[1], 'name');
  for (const m of text.matchAll(/\b([a-z]+_[a-z_]+|[a-z]+-[a-z]+-[a-z0-9-]+)\b/g)) add(m[1], 'identifier');
  return [...out.values()];
}

export class Graph {
  constructor() {
    this.entities = new Map();      // id -> { id, name, kind, sections:Set }
    this.sectionEnts = new Map();   // sectionKey -> [entity ids]
    this.notesSections = new Map(); // path -> [sectionKeys]
    this.noteEnts = new Map();      // path -> [[entity ids] per section], to undo co-occurrence exactly
    this.cooc = new Map();          // "a|b" -> weight
    this.edges = [];                // explicit edges { from, to, type, by, seq, why }
    this.claims = new Map();        // id -> claim
    this.usage = new Map();         // itemKey -> { count, last: [{ seq, ts, client, session, query }] }
  }

  // ---- derived: from the notes
  indexNote(p, body) { this.removeNote(p); this.indexSections(p, sections(body)); }
  /** Add sections to a note's entry (an append adds only its new sections). */
  indexSections(p, secs) {
    const keys = this.notesSections.get(p) || []; const lists = this.noteEnts.get(p) || [];
    for (const s of secs) {
      const key = own(`${p}#${s.heading || ''}`);
      const ents = extractEntities(`${s.heading || ''}\n${s.text}`);
      for (const e of ents) {
        if (!this.entities.has(e.id)) this.entities.set(own(e.id), { id: own(e.id), name: own(e.name), kind: e.kind, sections: new Set() });
        this.entities.get(e.id).sections.add(key);
      }
      // ids are the entity map's own strings, never views of the note text
      const ids = ents.map((e) => this.entities.get(e.id).id);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`; this.cooc.set(k, (this.cooc.get(k) || 0) + 1); }
      if (!this.sectionEnts.has(key)) { keys.push(key); this.sectionEnts.set(key, ids); }
      else this.sectionEnts.set(key, [...new Set([...this.sectionEnts.get(key), ...ids])]);
      if (ids.length) lists.push(ids);
    }
    this.notesSections.set(p, keys); this.noteEnts.set(p, lists);
  }
  removeNote(p) {
    for (const key of this.notesSections.get(p) || []) {
      for (const id of this.sectionEnts.get(key) || []) { const e = this.entities.get(id); if (e) { e.sections.delete(key); if (!e.sections.size) this.entities.delete(id); } }
      this.sectionEnts.delete(key);
    }
    for (const ids of this.noteEnts.get(p) || []) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`; const w = (this.cooc.get(k) || 0) - 1; if (w > 0) this.cooc.set(k, w); else this.cooc.delete(k); }
    this.notesSections.delete(p); this.noteEnts.delete(p);
  }

  // ---- logged: applied from operations (live and on replay)
  applyOp(rec) {
    const d = rec.data || {};
    if (rec.type === 'graph.edge') this.edges.push({ from: d.from, to: d.to, type: d.type, why: d.why || null, by: rec.client || rec.agent, seq: rec.seq, ts: rec.ts, retracted: false });
    else if (rec.type === 'graph.edge.retract') { for (const e of this.edges) if (e.seq === d.seq) e.retracted = true; }
    else if (rec.type === 'claim') {
      let c = this.claims.get(d.id);
      if (!c) { c = { id: d.id, subject: d.subject, predicate: d.predicate, object: d.object ?? null, evidence: [], status: null, history: [], created: rec.ts, seq: rec.seq }; this.claims.set(d.id, c); }
      c.evidence.push({ stance: d.stance, strength: d.strength, path: d.path || null, text: d.text || null, source: d.source || rec.client || rec.agent, seq: rec.seq, ts: rec.ts, retracted: false });
      if (c.finding) this._refresh(c, rec);
    } else if (rec.type === 'claim.retract') { const c = this.claims.get(d.id); if (c) { for (const e of c.evidence) if (e.seq === d.seq) e.retracted = true; if (c.finding) this._refresh(c, rec); } }
    // a finding's status is derived from its evidence and its decisions, so a logged status change cannot set it
    else if (rec.type === 'claim.status') { const c = this.claims.get(d.id); if (c && !c.finding) { c.status = d.to; c.history.push({ from: d.from, to: d.to, seq: rec.seq, ts: rec.ts }); } }
    else if (rec.type === 'claim.finding') this._raise(rec);
    else if (FINDING_EVENTS.includes(rec.type)) this._decide(rec);
    else if (rec.type === 'usage') {
      for (const item of d.items || []) {
        if (!this.usage.has(item)) this.usage.set(item, { count: 0, last: [] });
        const u = this.usage.get(item); u.count++; u.last.push({ seq: rec.seq, ts: rec.ts, client: rec.client, session: d.session || null, query: truncate(d.query || '', 120) });
        if (u.last.length > 20) u.last.shift();
      }
    }
  }

  /** The status a claim's live evidence implies. */
  static assess(c) {
    const live = c.evidence.filter((e) => !e.retracted);
    const best = (stance) => { const m = new Map(); for (const e of live.filter((x) => x.stance === stance)) m.set(e.source + '|' + (e.path || ''), Math.max(m.get(e.source + '|' + (e.path || '')) || 0, e.strength)); return [...m.values()]; };
    const sup = noisyOr(best('support')), opp = noisyOr(best('oppose')), spec = noisyOr(best('speculate'));
    const sources = new Set(live.filter((e) => e.stance === 'support').map((e) => e.source)).size;
    let status;
    if (opp >= 0.6 && opp > sup) status = 'refuted';
    else if (sup >= 0.3 && opp >= 0.3) status = 'contested';
    else if (sup >= 0.85 && sources >= 2 && opp < 0.2) status = 'fact';
    else if (sup >= 0.5) status = 'theory';
    else status = 'conjecture';
    const out = { status, support: Number(sup.toFixed(3)), opposition: Number(opp.toFixed(3)), speculation: Number(spec.toFixed(3)), sources };
    if (!c.finding) return out;
    // a finding: evidence alone stops at theory; a person's confirmation or a passing verification makes it a fact,
    // a person's rejection refutes it, and the latest effective decision stands. A verification never replaces a person's
    // decision (_decide). A decision stands over the evidence, and says so in `overridden` when the evidence pointed the
    // other way (provisional until the knowledge status lattice of PG-10.1 lands): a confirmation over contested or
    // refuted evidence, or a rejection over evidence strong enough for a fact.
    const decision = c.finding.decision;
    if (decision?.outcome === 'confirm') out.status = 'fact';
    else if (decision?.outcome === 'reject') out.status = 'refuted';
    if ((decision?.outcome === 'confirm' && (status === 'contested' || status === 'refuted')) || (decision?.outcome === 'reject' && status === 'fact')) out.overridden = status;
    out.capped = !decision && status === 'fact';
    if (out.capped) out.status = 'theory';
    return out;
  }

  // ---- findings
  /** Errors for the parts of a finding that are checked the same way when it is raised and when it is corrected. */
  static _findingParts(d, errs, fields) {
    const nSources = Array.isArray(d.sources) ? d.sources.length : 0;
    const refOk = (r) => r === null || r === undefined || (Number.isInteger(r) && r >= 0 && r < nSources);
    if (fields.includes('subject') && !isText(d.subject, 300)) errs.push('a finding needs a subject');
    if (fields.includes('predicate') && !isText(d.predicate, 300)) errs.push('a finding needs a predicate');
    if (fields.includes('object') && d.object !== null && d.object !== undefined && !isText(d.object, 300)) errs.push('the object must be text or null');
    if (fields.includes('confidence') && !(typeof d.confidence === 'number' && d.confidence >= 0 && d.confidence <= 1)) errs.push('confidence must be a number from 0 to 1');
    if (fields.includes('context')) {
      const c = d.context;
      if (!c || typeof c !== 'object' || !isTime(c.from) || (c.to !== null && c.to !== undefined && (!isTime(c.to) || Date.parse(c.to) < Date.parse(c.from)))) errs.push('context needs a from time and a to time that is null or not before it');
    }
    if (fields.includes('entities')) {
      if (!Array.isArray(d.entities)) errs.push('entities must be a list');
      else d.entities.forEach((e, i) => { if (!e || !isText(e.id, 80) || !refOk(e.source)) errs.push(`entity ${i}: needs an id and a source that is null or a listed source`); });
    }
    if (fields.includes('owners')) {
      if (!Array.isArray(d.owners)) errs.push('owners must be a list');
      else d.owners.forEach((o, i) => { if (!o || !subjectType(o.subject) || !refOk(o.source)) errs.push(`owner ${i}: needs a subject id and a source that is null or a listed source`); });
    }
    return errs;
  }

  /** Errors for a finding as raised: the shape only. */
  static validateFinding(d) {
    const errs = [];
    if (!d || typeof d !== 'object') return ['a finding must be an object'];
    if (typeof d.id !== 'string' || !FINDING_ID.test(d.id)) errs.push('a finding needs an id of letters, digits, underscore and hyphen');
    if (!subjectType(d.by)) errs.push('by must be a subject id such as person:name');
    if (validateScope(d.scope).length) errs.push('a finding needs a valid scope');
    if (!Array.isArray(d.sources) || !d.sources.length) errs.push('a finding needs at least one source');
    else if (d.sources.length > 50) errs.push('a finding has at most 50 sources');
    else d.sources.forEach((s, i) => {
      if (!s || typeof s !== 'object') { errs.push(`source ${i}: must be an object`); return; }
      if (typeof s.event !== 'string' || !EVENT_ID.test(s.event)) errs.push(`source ${i}: event must be an event id`);
      if (!Number.isInteger(s.version) || s.version < 1) errs.push(`source ${i}: version must be a positive integer`);
      if (s.scope !== undefined && validateScope(s.scope).length) errs.push(`source ${i}: scope is not a valid scope`);
      for (const f of ['path', 'excerpt']) if (s[f] !== undefined && s[f] !== null && !isText(s[f], 500)) errs.push(`source ${i}: ${f} must be short text`);
    });
    return Graph._findingParts({ entities: [], owners: [], ...d }, errs, ['subject', 'predicate', 'object', 'confidence', 'context', 'entities', 'owners']);
  }

  /**
   * The key two findings share when they rest on the same sources at the same versions in the same scopes: the finding's scope,
   * and for each source its scope (the finding's own when it names none), event and version, as a set.
   */
  static findingKey(sources, scope) {
    const at = (x) => (x && typeof x.type === 'string' && typeof x.id === 'string' ? `${x.type}:${x.id}` : '');
    return JSON.stringify([at(scope), [...new Set((sources || []).map((s) => `${at(s.scope ?? scope)}/${s.event}@${s.version}`))].sort()]);
  }

  /**
   * Whether a finding may be raised: its shape, a free id, and no dismissed finding on the same sources and versions in the same
   * scope. A dismissal is permanent for that key and any subject can make one (provisional, ADR 5): only a new version of a source,
   * another source or another scope raises it again. The refusal says that a dismissal exists and not which finding it was.
   */
  admitFinding(d) {
    const errors = Graph.validateFinding(d);
    if (errors.length) return { ok: false, code: 'invalid', errors };
    if (this.claims.has(d.id)) return { ok: false, code: 'exists', errors: [`${d.id} is already a claim`] };
    const key = Graph.findingKey(d.sources, d.scope);
    for (const c of this.claims.values()) if (c.finding?.dismissed && c.finding.key === key) return { ok: false, code: 'dismissed', errors: ['a finding on these sources and versions was dismissed in this scope'] };
    return { ok: true };
  }

  _raise(rec) {
    const d = rec.data || {};
    if (!this.admitFinding(d).ok) return;
    const scope = { type: d.scope.type, id: d.scope.id };
    const c = {
      id: d.id, subject: d.subject, predicate: d.predicate, object: d.object ?? null, evidence: [], status: null, history: [], created: rec.ts, seq: rec.seq,
      finding: {
        key: Graph.findingKey(d.sources, d.scope),
        sources: d.sources.map((s) => ({ event: s.event, version: s.version, scope: s.scope ? { type: s.scope.type, id: s.scope.id } : { ...scope }, path: s.path ?? null, excerpt: s.excerpt ?? null })),
        entities: d.entities.map((e) => ({ id: e.id, source: e.source ?? null })),
        owners: d.owners.map((o) => ({ subject: o.subject, source: o.source ?? null })),
        scope, context: { from: d.context.from, to: d.context.to ?? null }, confidence: d.confidence,
        raised_by: d.by, dismissed: null, decision: null, history: [],
      },
    };
    c.status = Graph.assess(c).status;
    this.claims.set(c.id, c);
  }

  /** Keep a finding's stored status equal to what its evidence and decisions imply, logging the change in its status history. */
  _refresh(c, rec) {
    const s = Graph.assess(c).status;
    if (s !== c.status) { c.history.push({ from: c.status, to: s, seq: rec.seq, ts: rec.ts }); c.status = s; }
  }

  /** Errors for a dismissal, correction, adjudication or verification, and whether the finding exists. */
  checkFindingEvent(type, d) {
    const errors = [];
    if (!FINDING_EVENTS.includes(type)) return { ok: false, code: 'invalid', errors: [`${type} is not a finding event`] };
    if (!d || typeof d !== 'object') return { ok: false, code: 'invalid', errors: ['an event must be an object'] };
    if (!subjectType(d.by)) errors.push('by must be a subject id such as person:name');
    if (d.why !== undefined && d.why !== null && !isText(d.why, 500)) errors.push('why must be short text');
    if (type === 'claim.finding.adjudicate' && !['confirm', 'reject'].includes(d.outcome)) errors.push('outcome must be confirm or reject');
    if (type === 'claim.finding.verify') {
      const r = d.record;
      if (!r || r.kind !== 'outcome.verified' || typeof r.event !== 'string' || !EVENT_ID.test(r.event) || !['pass', 'fail'].includes(r.result)) errors.push('record must be an outcome.verified record naming its event and a pass or fail result');
      else if (this.claims.get(d.id)?.finding && !this.claims.get(d.id).finding.sources.some((s) => s.event === r.event)) errors.push('record.event must be one of the source events the finding rests on');
    }
    if (type === 'claim.finding.correct') {
      const ch = d.changes;
      if (!ch || typeof ch !== 'object' || Array.isArray(ch) || !Object.keys(ch).length) errors.push('changes must name at least one field to correct');
      else {
        const bad = Object.keys(ch).filter((k) => !CORRECTABLE.includes(k));
        if (bad.length) errors.push(`${bad.join(', ')} cannot be corrected: sources and scope are provenance, a new finding replaces them`);
        const c = this.claims.get(d.id);
        Graph._findingParts({ sources: c?.finding?.sources, ...ch }, errors, Object.keys(ch).filter((k) => CORRECTABLE.includes(k)));
      }
    }
    if (errors.length) return { ok: false, code: 'invalid', errors };
    if (typeof d.id !== 'string' || !this.claims.get(d.id)?.finding) return { ok: false, code: 'not_found', errors: [`no finding ${String(d.id).slice(0, 64)}`] };
    return { ok: true };
  }

  _decide(rec) {
    const d = rec.data || {};
    if (!this.checkFindingEvent(rec.type, d).ok) return;
    const c = this.claims.get(d.id); const f = c.finding;
    const entry = { kind: rec.type.slice('claim.finding.'.length), by: d.by, why: d.why ?? null, seq: rec.seq, ts: rec.ts, effective: true };
    if (rec.type === 'claim.finding.dismiss') { if (!f.dismissed) f.dismissed = { by: d.by, why: d.why ?? null, seq: rec.seq, ts: rec.ts }; }
    else if (rec.type === 'claim.finding.correct') {
      entry.changed = {};
      for (const k of CORRECTABLE.filter((x) => x in d.changes)) {
        const from = ['subject', 'predicate', 'object'].includes(k) ? c[k] : f[k];
        const to = k === 'object' ? (d.changes.object ?? null) : JSON.parse(JSON.stringify(d.changes[k]));
        if (JSON.stringify(from) === JSON.stringify(to)) continue;
        entry.changed[k] = { from, to };
        if (['subject', 'predicate', 'object'].includes(k)) c[k] = to; else f[k] = k === 'context' ? { from: to.from, to: to.to ?? null } : to;
      }
      if (!Object.keys(entry.changed).length) return;
    } else if (rec.type === 'claim.finding.adjudicate') {
      entry.outcome = d.outcome;
      entry.effective = subjectType(d.by) === 'person';
      if (entry.effective) f.decision = { kind: 'adjudicate', outcome: d.outcome, by: d.by, seq: rec.seq };
    } else {
      entry.record = { kind: d.record.kind, event: d.record.event, result: d.record.result };
      // a verification is recorded but never replaces a person's standing decision: only a person can change that
      entry.effective = d.record.result === 'pass' && VERIFIER_TYPES.includes(subjectType(d.by)) && f.decision?.kind !== 'adjudicate';
      if (entry.effective) f.decision = { kind: 'verify', outcome: 'confirm', by: d.by, seq: rec.seq };
    }
    f.history.push(entry);
    this._refresh(c, rec);
  }

  /**
   * Resolve a credential into a reader, and a reader only comes from here: viewFinding, listFindings, bindFinding and bindEvent refuse any
   * other object. `identity` is what tokens.verify returned for a request that is already verified, and `binding` is a role binding
   * that agentid-bind.mjs verified ({ role, principal, key }, with `scope` for the scope it was issued for). Both go through
   * resolveRequest or resolveBinding (identity.mjs), and `target` holds the credential's scope against the scope it reaches for.
   * resolveRequest maps every token with no identity scope to the owner subject, an agent's included, so a token of that kind does not
   * become a person here: it is the agent subject named by the token, which an adjudication from does nothing. A person subject comes only
   * from an organisational credential that names one. Returns the reader, or { ok: false, code, reason }.
   */
  static readerFor({ identity, binding, scope, target } = {}) {
    if ((identity === undefined) === (binding === undefined)) return { ok: false, code: 'no_identity', reason: 'give a verified token identity or a verified role binding, one of them' };
    let r; let subject;
    if (binding !== undefined) {
      r = resolveBinding(binding, { ...(scope ? { scope } : {}), ...(target !== undefined ? { target } : {}) });
      if (!r.ok) return r;
      subject = r.subject;
    } else {
      r = resolveRequest(identity, { target });
      if (!r.ok) return r;
      subject = r.subject;
      const named = identity.identity_scope;
      if (named === undefined || named === null || named.type === 'personal') {
        const id = `agent:${identity.agent ?? ''}`;
        if (!subjectType(id)) return { ok: false, code: 'no_subject', reason: 'a personal-scope credential acts as the agent it names, and this one names none' };
        subject = { id, type: 'agent', owner: OWNER_SUBJECT.id };
      }
    }
    const reader = Object.freeze({ ok: true, subject: Object.freeze({ ...subject }), scope: Object.freeze({ ...r.scope }), credential: r.credential ?? null });
    READERS.add(reader);
    return reader;
  }

  /**
   * The operation that raises a finding, for a writer to append: `by` is the reader's subject and any `by` in `fields` is replaced. The
   * reader's scope must be the finding's scope. The scopes of the sources are what the raiser declares, and they are held against a reader
   * only when it is shown. Returns { ok: true, type, data } or { ok: false, code, errors }.
   */
  bindFinding(reader, fields) {
    if (!READERS.has(reader)) return { ok: false, code: 'no_credential', errors: ['a finding is raised with a reader made by Graph.readerFor'] };
    const d = { ...(fields && typeof fields === 'object' ? fields : {}), by: reader.subject.id };
    if (!validateScope(d.scope).length && !authorizeScope(reader.scope, d.scope).ok) return { ok: false, code: 'scope_mismatch', errors: ['the credential does not reach the scope of this finding'] };
    const r = this.admitFinding(d);
    return r.ok ? { ok: true, type: 'claim.finding', data: d } : r;
  }

  /**
   * The operation that dismisses, corrects, adjudicates or verifies a finding, for a writer to append: `by` is the reader's subject and any
   * `by` in `fields` is replaced. A finding the credential does not reach is reported as not found, the same as a missing one.
   * Returns { ok: true, type, data } or { ok: false, code, errors }.
   */
  bindEvent(reader, type, fields) {
    if (!READERS.has(reader)) return { ok: false, code: 'no_credential', errors: ['a finding event is made with a reader made by Graph.readerFor'] };
    const d = { ...(fields && typeof fields === 'object' ? fields : {}), by: reader.subject.id };
    const c = typeof d.id === 'string' ? this.claims.get(d.id) : null;
    if (c?.finding && !authorizeScope(reader.scope, c.finding.scope).ok) return { ok: false, code: 'not_found', errors: [`no finding ${d.id.slice(0, 64)}`] };
    const r = this.checkFindingEvent(type, d);
    return r.ok ? { ok: true, type, data: d } : r;
  }

  /**
   * One finding as `reader` may see it, or null when the reader is not one made by readerFor, its scope does not reach the finding's scope,
   * or the id names no finding. A source is shown only when the reader may read its scope. When every source is readable the view is whole.
   * When any is withheld it is a partial view and fails closed: the id (which the raiser chose and may describe the statement), the
   * statement, status, capped and overridden flags, confidence, time context and dismissed flag are all null, and the history keeps only the
   * kind and time of each entry. What is left is the finding's scope, the readable sources, how many are withheld, and the entities and
   * owners drawn from readable sources. An entity or owner tied to the finding as a whole (no source) counts as drawn from all of them.
   */
  viewFinding(id, reader) {
    const c = this.claims.get(id);
    if (!c?.finding || !READERS.has(reader) || !authorizeScope(reader.scope, c.finding.scope).ok) return null;
    const f = c.finding;
    const readable = f.sources.map((s) => authorizeScope(reader.scope, s.scope).ok);
    const full = readable.every(Boolean);
    const shown = (src) => (src === null ? full : readable[src]);
    const common = {
      scope: { ...f.scope },
      sources: f.sources.filter((_, i) => readable[i]).map((s) => ({ event: s.event, version: s.version, scope: { ...s.scope }, path: s.path, excerpt: s.excerpt })),
      hidden_sources: readable.filter((r) => !r).length,
      entities: f.entities.filter((e) => shown(e.source)).map((e) => ({ id: e.id })),
      owners: f.owners.filter((o) => shown(o.source)).map((o) => ({ subject: o.subject })),
    };
    if (!full) {
      return { id: null, status: null, capped: null, overridden: null, confidence: null, context: null, dismissed: null, withheld: true, statement: null, ...common, history: f.history.map((h) => ({ kind: h.kind, seq: h.seq, ts: h.ts })) };
    }
    const a = Graph.assess(c);
    return {
      id: c.id, status: a.status, capped: a.capped, overridden: a.overridden ?? null, confidence: f.confidence, context: { ...f.context }, dismissed: !!f.dismissed,
      withheld: false, statement: { subject: c.subject, predicate: c.predicate, object: c.object }, ...common,
      history: f.history.map((h) => JSON.parse(JSON.stringify(h))),
    };
  }

  /**
   * The findings `reader` may reach, oldest first, each as viewFinding shows it. Dismissed findings are left out unless asked for, and
   * `status` selects findings by status; both apply only to whole views, because a partial view does not show a status or a dismissal
   * and a filter would give them away. A partial view is therefore listed whatever the filter.
   */
  listFindings(reader, { includeDismissed = false, status = null } = {}) {
    const out = [];
    for (const c of this.claims.values()) {
      if (!c.finding) continue;
      const v = this.viewFinding(c.id, reader);
      if (!v) continue;
      if (!v.withheld && ((c.finding.dismissed && !includeDismissed) || (status && c.status !== status))) continue;
      out.push(v);
    }
    return out;
  }

  findClaim(subject, predicate, object = null) {
    const key = [subject, predicate, object ?? ''].map((x) => slug(x, 80)).join('|');
    for (const c of this.claims.values()) if ([c.subject, c.predicate, c.object ?? ''].map((x) => slug(x, 80)).join('|') === key) return c;
    return null;
  }

  /** `view` (from Vault.graphView) hides entities that only appear in notes the caller may not read. */
  neighbours(entityOrKey, limit = 12, view = null) {
    const id = this.entities.has(entityOrKey) ? entityOrKey : slug(entityOrKey);
    if (view && !view.entity(id)) return [];
    let out = [];
    for (const [k, w] of this.cooc) { const [a, b] = k.split('|'); if (a === id) out.push({ entity: b, weight: w, via: 'co_occurs' }); else if (b === id) out.push({ entity: a, weight: w, via: 'co_occurs' }); }
    for (const e of this.edges) if (!e.retracted && (e.from === id || e.to === id)) out.push({ entity: e.from === id ? e.to : e.from, weight: 3, via: e.type, why: e.why, seq: e.seq });
    if (view) out = out.filter((n) => view.entity(n.entity));
    return out.sort((x, y) => y.weight - x.weight).slice(0, limit).map((n) => ({ ...n, name: this.entities.get(n.entity)?.name || n.entity }));
  }

  /** Shortest chain of connections between two entities (BFS over co-occurrence and explicit edges). */
  explain(a, b, maxDepth = 4, view = null) {
    const s = slug(a), t = slug(b);
    if ((!this.entities.has(s) && !this.edges.some((e) => e.from === s || e.to === s)) || (view && !view.entity(s))) return { found: false, reason: `nothing in memory names ${a}` };
    const prev = new Map([[s, null]]); let frontier = [s];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next = [];
      for (const n of frontier) for (const nb of this.neighbours(n, 50, view)) if (!prev.has(nb.entity)) { prev.set(nb.entity, { from: n, via: nb.via, why: nb.why }); next.push(nb.entity); }
      if (prev.has(t)) break; frontier = next;
    }
    if (!prev.has(t)) return { found: false, reason: `no chain of up to ${maxDepth} links between ${a} and ${b}` };
    const steps = []; let cur = t;
    while (prev.get(cur)) { const p = prev.get(cur); steps.unshift({ from: this.entities.get(p.from)?.name || p.from, to: this.entities.get(cur)?.name || cur, via: p.via, why: p.why || null, evidence: this.sharedSections(p.from, cur).filter((k) => !view || view.section(k)).slice(0, 3) }); cur = p.from; }
    return { found: true, steps };
  }
  sharedSections(a, b) { const A = this.entities.get(a)?.sections, B = this.entities.get(b)?.sections; if (!A || !B) return []; return [...A].filter((k) => B.has(k)); }

  stats() { return { entities: this.entities.size, co_occurrences: this.cooc.size, explicit_edges: this.edges.filter((e) => !e.retracted).length, claims: this.claims.size, used_items: this.usage.size }; }
}
