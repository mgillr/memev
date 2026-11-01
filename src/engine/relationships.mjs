// SPDX-License-Identifier: Apache-2.0
// The relationship model of a project, over the one project store. Milestones, deliverables and work packages are store
// entities; the links between scope, milestones, plans, tasks, artifacts, checks, evidence, blockers and permissions are
// events with stable ids, validated against docs/schemas/relationships-v1.json. A change to a requirement or a scope version
// marks every dependent plan, task, artifact, approval and evidence record stale with its reason; a marker clears only by a new
// verification or an explicit re-acceptance. Every projection says which event it comes from and how fresh it is, and a value it
// cannot confirm reads "not confirmed", never a guess. Progress is derived from the links and the verified tasks under them: a
// percentage a session reports is not an input.
// The store is passed in (withWrite, append, snapshot, sourceOf, hasRecord): this module opens no store of its own.
import fs from 'node:fs';
import { sha256 } from './util.mjs';

export const SCHEMA = JSON.parse(fs.readFileSync(new URL('../../docs/schemas/relationships-v1.json', import.meta.url), 'utf8'));
export const LINK_TYPES = Object.freeze(Object.keys(SCHEMA.link_types));
export const NOT_CONFIRMED = 'not confirmed';
const ENTITY_KINDS = Object.keys(SCHEMA.entity_kinds);
const STALE_TARGETS = SCHEMA.stale_marker.targets;
const refuse = (code, reason) => ({ ok: false, code, reason });

const keyOf = (r) => `${r.kind}:${r.id}`;
const linkId = (type, from, to) => `rel_${sha256(`${type}|${keyOf(from)}|${keyOf(to)}`).slice(0, 16)}`;

/** A link event: a known type, endpoints of the kinds that type allows, and an id. */
export function validateLink(e) {
  const spec = SCHEMA.link_event;
  if (!e || e.type !== spec.type) return refuse('BAD_TYPE', `not a ${spec.type} event`);
  for (const f of spec.required) if (e[f] === undefined || e[f] === null || e[f] === '') return refuse('MISSING_FIELD', `link is missing ${f}`);
  const t = SCHEMA.link_types[e.link_type];
  if (!t) return refuse('UNKNOWN_LINK_TYPE', `unknown link type ${e.link_type}`);
  for (const side of ['from', 'to']) {
    const p = e[side];
    for (const f of spec.endpoint.required) if (!p || typeof p !== 'object' || p[f] === undefined || p[f] === null || p[f] === '') return refuse('MISSING_FIELD', `${side} is missing ${f}`);
    if (!t[side].includes(p.kind)) return refuse('WRONG_KIND', `${e.link_type} ${side} must be ${t[side].join(' or ')}, not ${p.kind}`);
  }
  return { ok: true };
}

/** Add a milestone, deliverable or work package. The store's validator checks its fields; a given id is kept. */
export function addEntity(store, kind, data, id) {
  if (!ENTITY_KINDS.includes(kind)) throw new Error(`not a relationship entity kind: ${kind}`);
  const rec = store.append({ type: `${kind}.upserted`, entity: { kind, ...(id ? { id } : {}), data } });
  return { id: rec.entity.id };
}

/** Store one link as an event whose id depends only on its type and endpoints, so linking twice stores one event. */
export function link(store, { link_type, from, to, actor = null, reason = null, now = Date.now } = {}) {
  const id = linkId(link_type, from ?? {}, to ?? {});
  const data = { type: SCHEMA.link_event.type, id, link_type, from, to, ...(actor ? { actor } : {}), ...(reason ? { reason } : {}), time: now() };
  const v = validateLink(data);
  if (!v.ok) return v;
  store.append({ type: 'task.event', key: `rel:${id}`, entity: { kind: 'event', id, data } });
  return { ok: true, id };
}

const events = (store) => Object.values(store.snapshot('event'));
const links = (store) => events(store).filter((e) => e.type === SCHEMA.link_event.type);

// The edges a change travels along. A link points from the thing that is decided to the thing that follows from it, except
// task-to-dependency, where a task depends on the one it points to, so a change reaches it the other way. A task also reaches
// the approvals and evidence records that name it.
function edgesFrom(store, node) {
  const out = [];
  for (const l of links(store)) {
    if (l.link_type === 'task-to-dependency') { if (keyOf(l.to) === keyOf(node)) out.push({ to: l.from, why: `${l.link_type} (${l.from.kind} ${l.from.id} depends on ${l.to.kind} ${l.to.id})` }); }
    else if (keyOf(l.from) === keyOf(node)) out.push({ to: l.to, why: `${l.link_type} (${l.from.kind} ${l.from.id} to ${l.to.kind} ${l.to.id})` });
  }
  if (node.kind === 'task') {
    for (const [id, a] of Object.entries(store.snapshot('approval'))) if (a.task_id === node.id) out.push({ to: { kind: 'approval', id }, why: `approval ${id} belongs to task ${node.id}` });
    for (const [id, e] of Object.entries(store.snapshot('evidence'))) if (e.task_id === node.id) out.push({ to: { kind: 'evidence', id }, why: `evidence ${id} belongs to task ${node.id}` });
  }
  return out;
}

function reached(store, sources) {
  const seen = new Map();
  const queue = sources.map((s) => ({ node: s, path: [] }));
  const start = new Set(sources.map(keyOf));
  while (queue.length) {
    const { node, path } = queue.shift();
    for (const e of edgesFrom(store, node)) {
      const k = keyOf(e.to);
      if (seen.has(k) || start.has(k)) continue;
      const p = [...path, e.why];
      seen.set(k, { target: e.to, path: p });
      queue.push({ node: e.to, path: p });
    }
  }
  return [...seen.values()].filter((x) => STALE_TARGETS.includes(x.target.kind));
}

const markers = (store) => events(store).filter((e) => e.type === SCHEMA.stale_marker.type);
const clears = (store) => new Set(events(store).filter((e) => e.type === 'stale.cleared').map((e) => e.marker_id));

/** The current stale marker of a target, or null. */
export function staleOf(store, target) {
  const cleared = clears(store);
  const mine = markers(store).filter((m) => keyOf(m.target) === keyOf(target) && !cleared.has(m.id));
  return mine.length ? mine[mine.length - 1] : null;
}

// Every node that carries this id, whatever its kind: the id a person types is not tagged with a kind.
function nodesWithId(store, id) {
  const found = new Map();
  for (const l of links(store)) for (const p of [l.from, l.to]) if (p.id === id) found.set(keyOf(p), p);
  for (const kind of ['task', 'evidence', 'approval', ...ENTITY_KINDS]) if (store.snapshot(kind)[id]) found.set(`${kind}:${id}`, { kind, id });
  return [...found.values()];
}

/** What depends on a source (a {kind, id}, or an id alone): each dependent with the reason it depends and whether it is stale now. */
export function impact(store, source) {
  const sources = typeof source === 'string' ? nodesWithId(store, source) : [source];
  const dependents = reached(store, sources).map((x) => ({ kind: x.target.kind, id: x.target.id, reason: x.path.join(', then '), stale: staleOf(store, x.target) !== null }));
  return { source: typeof source === 'string' ? source : source.id, dependents };
}

/** A change to a requirement or a scope version: a stale marker on every dependent plan, task, artifact, approval and evidence record. */
export function changeSource(store, { kind, id, version, actor, reason, now = Date.now } = {}) {
  if (!kind || !id || version === undefined || !actor || !reason) return refuse('MISSING_FIELD', 'a change names its kind, id, version, actor and reason');
  const source = { kind, id, version };
  return store.withWrite((s) => {
    const known = Object.keys(s.snapshot('evidence'));
    const out = [];
    for (const x of reached(s, [{ kind, id }])) {
      const mid = `stale_${sha256(`${keyOf(x.target)}|${kind}:${id}:${version}`).slice(0, 16)}`;
      const data = { type: SCHEMA.stale_marker.type, id: mid, target: x.target, source, reason: `${reason} (${x.path.join(', then ')})`, actor, time: now(), known_evidence: known };
      s.append({ type: 'task.event', key: `stale:${mid}`, entity: { kind: 'event', id: mid, data } });
      out.push(data);
    }
    s.append({ type: 'task.event', entity: { kind: 'event', data: { type: 'source.changed', source, actor, reason, time: now(), marked: out.length } } });
    return { ok: true, markers: out };
  });
}

/** Clear a stale marker: by a new verification (evidence that did not exist when the marker was made) or by an explicit
 *  re-acceptance (who accepted, and why). Nothing else clears one. */
export function clearStale(store, { target, via, evidence_id = null, actor = null, reason = null, now = Date.now } = {}) {
  const m = staleOf(store, target);
  if (!m) return refuse('NOT_STALE', `${keyOf(target)} has no stale marker`);
  const data = { type: 'stale.cleared', marker_id: m.id, target, via, time: now() };
  if (via === 'verification') {
    if (!evidence_id) return refuse('NO_EVIDENCE', 'a verification names its evidence');
    const ev = store.snapshot('evidence')[evidence_id];
    if (!ev) return refuse('NO_EVIDENCE', `evidence ${evidence_id} does not exist`);
    if ((m.known_evidence ?? []).includes(evidence_id)) return refuse('NOT_NEW', `evidence ${evidence_id} existed before the change, so it is not a new verification`);
    if (ev.stale) return refuse('NOT_NEW', `evidence ${evidence_id} is stale`);
    const own = target.kind === 'task' ? target.id : target.kind === 'evidence' ? store.snapshot('evidence')[target.id]?.task_id : null;
    if (own && ev.task_id !== own) return refuse('WRONG_TASK', `evidence ${evidence_id} is for task ${ev.task_id}, not ${own}`);
    data.evidence_id = evidence_id;
  } else if (via === 're-acceptance') {
    if (!actor) return refuse('NO_ACTOR', 're-acceptance names who accepted');
    if (!reason) return refuse('NO_REASON', 're-acceptance gives a reason');
    data.actor = actor; data.reason = reason;
  } else return refuse('BAD_CLEAR', `a stale marker clears by verification or re-acceptance, not by ${via}`);
  store.append({ type: 'task.event', entity: { kind: 'event', data } });
  return { ok: true };
}

/** A projection of one entity: its state, the event it comes from, when, the scope and plan version and how fresh it is. With the
 *  source event gone, or a version never recorded, the value reads "not confirmed". */
export function project(store, kind, id) {
  const ent = store.snapshot(kind)[id];
  const src = store.sourceOf(kind, id);
  if (!ent || !src || !store.hasRecord(src.id)) return { kind, id, state: NOT_CONFIRMED, source_event_id: null, time: NOT_CONFIRMED, scope_version: NOT_CONFIRMED, plan_version: NOT_CONFIRMED, freshness: NOT_CONFIRMED };
  const proj = store.snapshot('project')[store.id] ?? {};
  return {
    kind, id,
    state: ent.status ?? ent.state ?? null,
    source_event_id: src.id,
    time: src.ts,
    scope_version: ent.scope_version ?? proj.scope_version ?? NOT_CONFIRMED,
    plan_version: ent.plan_version ?? proj.plan_version ?? NOT_CONFIRMED,
    freshness: staleOf(store, { kind, id }) ? 'stale' : 'fresh',
  };
}

/** Whether the event a projection names is still in the log. */
export function confirmProjection(store, p) {
  const confirmed = !!p.source_event_id && store.hasRecord(p.source_event_id);
  return { confirmed, reason: confirmed ? null : 'the source event of this projection is not in the log' };
}

const figure = (verified, total) => ({ verified, total, percent: total ? Math.round((100 * verified) / total) : null });

/** Progress per milestone, deliverable and work package: the verified tasks under it over all the tasks under it, through the
 *  links. A task linked to no work package is in no figure. What a session says about its own progress is not read. */
export function progress(store) {
  const L = links(store);
  const down = (type, id) => L.filter((l) => l.link_type === type && l.from.id === id).map((l) => l.to.id);
  const tasks = store.snapshot('task');
  const wp = (id) => [...new Set(down('work-package-to-task', id))];
  const deliverable = (id) => [...new Set(down('deliverable-to-work-package', id).flatMap(wp))];
  const milestone = (id) => [...new Set(down('milestone-to-deliverable', id).flatMap(deliverable))];
  const count = (ids) => figure(ids.filter((t) => tasks[t]?.status === 'VERIFIED').length, ids.length);
  const out = { milestones: {}, deliverables: {}, work_packages: {} };
  for (const id of Object.keys(store.snapshot('work_package'))) out.work_packages[id] = count(wp(id));
  for (const id of Object.keys(store.snapshot('deliverable'))) out.deliverables[id] = count(deliverable(id));
  for (const id of Object.keys(store.snapshot('milestone'))) { const t = milestone(id); out.milestones[id] = { ...count(t), tasks: t }; }
  return out;
}
