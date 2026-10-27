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
import { slug, truncate } from './util.mjs';
import { sections } from './index.mjs';

const noisyOr = (xs) => 1 - xs.reduce((p, x) => p * (1 - Math.max(0, Math.min(1, x))), 1);
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
    this.cooc = new Map();          // "a|b" -> weight
    this.edges = [];                // explicit edges { from, to, type, by, seq, why }
    this.claims = new Map();        // id -> claim
    this.usage = new Map();         // itemKey -> { count, last: [{ seq, ts, client, session, query }] }
  }

  // ---- derived: from the notes
  indexNote(p, body) {
    this.removeNote(p);
    const keys = [];
    for (const s of sections(body)) {
      const key = `${p}#${s.heading || ''}`;
      const ents = extractEntities(`${s.heading || ''}\n${s.text}`);
      const ids = ents.map((e) => e.id);
      for (const e of ents) {
        if (!this.entities.has(e.id)) this.entities.set(e.id, { id: e.id, name: e.name, kind: e.kind, sections: new Set() });
        this.entities.get(e.id).sections.add(key);
      }
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`; this.cooc.set(k, (this.cooc.get(k) || 0) + 1); }
      this.sectionEnts.set(key, ids); keys.push(key);
    }
    this.notesSections.set(p, keys);
  }
  removeNote(p) {
    for (const key of this.notesSections.get(p) || []) {
      const ids = this.sectionEnts.get(key) || [];
      for (const id of ids) { const e = this.entities.get(id); if (e) { e.sections.delete(key); if (!e.sections.size) this.entities.delete(id); } }
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`; const w = (this.cooc.get(k) || 0) - 1; if (w > 0) this.cooc.set(k, w); else this.cooc.delete(k); }
      this.sectionEnts.delete(key);
    }
    this.notesSections.delete(p);
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
    } else if (rec.type === 'claim.retract') { const c = this.claims.get(d.id); if (c) for (const e of c.evidence) if (e.seq === d.seq) e.retracted = true; }
    else if (rec.type === 'claim.status') { const c = this.claims.get(d.id); if (c) { c.status = d.to; c.history.push({ from: d.from, to: d.to, seq: rec.seq, ts: rec.ts }); } }
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
    return { status, support: Number(sup.toFixed(3)), opposition: Number(opp.toFixed(3)), speculation: Number(spec.toFixed(3)), sources };
  }

  findClaim(subject, predicate, object = null) {
    const key = [subject, predicate, object ?? ''].map((x) => slug(x, 80)).join('|');
    for (const c of this.claims.values()) if ([c.subject, c.predicate, c.object ?? ''].map((x) => slug(x, 80)).join('|') === key) return c;
    return null;
  }

  neighbours(entityOrKey, limit = 12) {
    const id = this.entities.has(entityOrKey) ? entityOrKey : slug(entityOrKey);
    const out = [];
    for (const [k, w] of this.cooc) { const [a, b] = k.split('|'); if (a === id) out.push({ entity: b, weight: w, via: 'co_occurs' }); else if (b === id) out.push({ entity: a, weight: w, via: 'co_occurs' }); }
    for (const e of this.edges) if (!e.retracted && (e.from === id || e.to === id)) out.push({ entity: e.from === id ? e.to : e.from, weight: 3, via: e.type, why: e.why, seq: e.seq });
    return out.sort((x, y) => y.weight - x.weight).slice(0, limit).map((n) => ({ ...n, name: this.entities.get(n.entity)?.name || n.entity }));
  }

  /** Shortest chain of connections between two entities (BFS over co-occurrence and explicit edges). */
  explain(a, b, maxDepth = 4) {
    const s = slug(a), t = slug(b);
    if (!this.entities.has(s) && !this.edges.some((e) => e.from === s || e.to === s)) return { found: false, reason: `nothing in memory names ${a}` };
    const prev = new Map([[s, null]]); let frontier = [s];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next = [];
      for (const n of frontier) for (const nb of this.neighbours(n, 50)) if (!prev.has(nb.entity)) { prev.set(nb.entity, { from: n, via: nb.via, why: nb.why }); next.push(nb.entity); }
      if (prev.has(t)) break; frontier = next;
    }
    if (!prev.has(t)) return { found: false, reason: `no chain of up to ${maxDepth} links between ${a} and ${b}` };
    const steps = []; let cur = t;
    while (prev.get(cur)) { const p = prev.get(cur); steps.unshift({ from: this.entities.get(p.from)?.name || p.from, to: this.entities.get(cur)?.name || cur, via: p.via, why: p.why || null, evidence: this.sharedSections(p.from, cur).slice(0, 3) }); cur = p.from; }
    return { found: true, steps };
  }
  sharedSections(a, b) { const A = this.entities.get(a)?.sections, B = this.entities.get(b)?.sections; if (!A || !B) return []; return [...A].filter((k) => B.has(k)); }

  stats() { return { entities: this.entities.size, co_occurrences: this.cooc.size, explicit_edges: this.edges.filter((e) => !e.retracted).length, claims: this.claims.size, used_items: this.usage.size }; }
}
