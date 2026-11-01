// SPDX-License-Identifier: Apache-2.0
// The project store: one canonical project state per project, under the vault's .memev directory.
// A snapshot per entity kind plus one append-only event log, a validator per entity kind, idempotency
// keys, a schema version with a one-way migration and a backup copy, and reconstruction from the log on
// every open. It writes only under .memev/projects/<id>/, one writer holds the lock at a time, so two
// processes appending to the same project serialize without interleaving a partial line.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, now, randomToken, exists, sha256 } from './util.mjs';
import { findSecrets, redactSecrets } from './secrets.mjs';
import { formatHlc, parseHlc, recordHash } from './oplog.mjs';
import { SUBJECT_TYPES } from './identity.mjs';

// The current schema version. A store at an older version is migrated forward on open; a store at a
// newer version is refused (this Memev does not know its layout) and nothing is written.
export const SCHEMA_VERSION = 2;
const STATE = '.memev';

// The merge classes an entity type may declare (SO-F-02). The core only records which class a type has: it applies none
// itself. The free path keeps both versions of a competing write, and the merge provider boundary (src/engine/merge.mjs)
// is where a class would be applied. last-writer: the newest write stands. set-union: the elements of every write stand.
// append-only: nothing is replaced, every write is kept. human-resolution: competing writes are surfaced and a person settles them.
export const MERGE_CLASSES = Object.freeze(['last-writer', 'set-union', 'append-only', 'human-resolution']);

/**
 * The decisions an approval can record. Provisional: this closed pair of values is what the store knows today, and it
 * pre-empts the seven decision states of the decision queue (SO-A-05, SO-1.08), which do not exist in code yet. When
 * they land, this list is replaced by them. Two different decisions on one task are incompatible.
 */
export const APPROVAL_DECISIONS = Object.freeze(['approve', 'reject']);

// A task in one of these states is never shown as CONFLICTED. "Terminal" means exactly an empty row in TRANSITIONS in
// project-state.mjs: no move out of the state. A test holds this list equal to those rows, because the store may not import
// the state machine. Only CANCELLED has an empty row. VERIFIED and FAILED have moves out, and the legacy DONE status of a
// coordinator without the lifecycle is not in the table, so tasks in those three do show as CONFLICTED in view().
export const TERMINAL_TASK_STATUSES = Object.freeze(['CANCELLED']);

// Why an approval's data cannot be used by the conflict rule, or null. The write path refuses such data; replay, which
// also reads what another log converged in, reports it and leaves the record in the log as it arrived.
const unusableApproval = (data) => {
  const d = data && typeof data === 'object' ? data : {};
  if (d.decision !== undefined && !APPROVAL_DECISIONS.includes(d.decision)) return `unknown decision ${JSON.stringify(d.decision)} (one of ${APPROVAL_DECISIONS.join(', ')})`;
  if (d.resolves !== undefined && !(Array.isArray(d.resolves) && d.resolves.every((x) => typeof x === 'string'))) return 'resolves is not a list of event ids';
  return null;
};

/**
 * The semantic part of conflict detection that the version check (applyUpdate in project-state.mjs) does not catch:
 * approvals on one task that say incompatible things, whatever version each was given on. Input is the approval events in
 * log order, each { event, id, task_id, decision, task_version, resolves? } where `event` is the id of the log event that
 * recorded it. Each event counts, even when two share an approval id: nothing is replaced by a later write.
 *
 * An approval with no decision is ignored. A person settles a conflict with an approval that lists event ids in
 * `resolves`. The list is honoured only when every id is an earlier approval event of the same task and the list names
 * both sides, at least one approve and at least one reject, so that one side cannot be dropped alone and another task
 * cannot clear this one. A list that fails this resolves nothing. Who may settle is not decided here: `by` is not
 * checked (ADR 5 holds the permission matrix, and the identity of a writer is resolved at the store boundary by SO-F-01).
 * task_version does not decide anything: a stale approval and a same-version pair count like any other, because this
 * rule applies no approval, it only surfaces them. Whether an approval covers the current scope is the state machine's
 * question (evidence binds to the scope version). One person who changes their mind is a conflict until a resolving
 * approval names both events.
 *
 * A task whose remaining approvals hold more than one decision gives one conflict record that names every one of those
 * events and applies none of them. Returns { conflicts, ignored }, ignored being the resolutions that were not honoured.
 * Pure: it changes nothing it is given.
 */
export function analyseApprovals(approvals) {
  const decided = (approvals ?? []).filter((a) => a && APPROVAL_DECISIONS.includes(a.decision));
  const seen = new Map();
  const settled = new Set();
  const ignored = [];
  for (const a of decided) {
    if (Array.isArray(a.resolves)) {
      const named = a.resolves.map((e) => seen.get(e));
      const reason = named.some((n) => !n) ? 'it names an event that is not an earlier approval'
        : named.some((n) => n.task_id !== a.task_id) ? 'it names an event of another task'
        : !(named.some((n) => n.decision === 'approve') && named.some((n) => n.decision === 'reject')) ? 'it does not name both an approve and a reject'
        : null;
      if (reason) ignored.push({ event: a.event, id: a.id, reason });
      else for (const e of a.resolves) settled.add(e);
    } else if (a.resolves !== undefined && !Array.isArray(a.resolves)) {
      ignored.push({ event: a.event, id: a.id, reason: 'resolves is not a list' });
    }
    seen.set(a.event, a);
  }
  const byTask = new Map();
  for (const a of decided) {
    if (settled.has(a.event)) continue;
    if (!byTask.has(a.task_id)) byTask.set(a.task_id, []);
    byTask.get(a.task_id).push(a);
  }
  const conflicts = [];
  for (const [task_id, list] of byTask) {
    const decisions = [...new Set(list.map((a) => a.decision))];
    if (decisions.length < 2) continue;
    conflicts.push({
      kind: 'semantic',
      task_id,
      events: list.map((a) => a.event),
      approvals: list.map((a) => a.id),
      decisions: list.map((a) => a.decision),
      task_versions: list.map((a) => a.task_version ?? null),
      applied: [],
      reason: `incompatible approvals on one task (${decisions.join(' and ')}): neither is applied, a person must resolve it`,
    });
  }
  return { conflicts, ignored };
}

export function semanticConflicts(approvals) { return analyseApprovals(approvals).conflicts; }

// The entity types (the handoff's section 7), each declared the way docs/schemas/project-v1.json declares it: a snapshot
// file, an id prefix, the required fields its validator enforces, the owner (a subject type of the identity model), the
// scope version field it may carry, and its merge class (SO-F-02). `event` has no snapshot: it lives only in the log.
// The store refuses an entity of a type that declares no merge class. The declarations are frozen, a test holds them equal
// to the schema file, and a test pins every owner and class.
//
// The owner is a declaration, not an enforcement and not an answer to who may write. It is not the memory authority of
// ADR 7 (proposed) and not the permission matrix of ADR 5 (open); the store checks that it is a subject type and nothing else.
// `provisional` names a declared field that waits on a decision, with the reason.
const NO_SERVICE = 'no service subject can be issued yet (docs/IDENTITY-AND-SCOPES.md), so no one can hold this ownership';
const declare = (file, prefix, required, authority, mergeClass, provisional = {}) => Object.freeze({ file, prefix, required: Object.freeze(required), authority, scopeVersionField: 'scope_version', mergeClass, provisional: Object.freeze(provisional) });
export const ENTITY_KINDS = Object.freeze({
  project: declare('project.json', 'proj', ['name'], 'person', 'last-writer'),
  task: declare('tasks.json', 'task', ['title'], 'person', 'human-resolution'),
  lease: declare('leases.json', 'lease', ['task_id'], 'service', 'human-resolution', {
    authority: NO_SERVICE,
    merge_class: 'ADR 3 (lease semantics) is open; its safe default is one active writer with contending writes queued, not merged, and no class here is a queue. human-resolution is the closest: a competing lease write is never settled by the newest one',
  }),
  attempt: declare('attempts.json', 'att', ['task_id'], 'agent', 'append-only'),
  evidence: declare('evidence.json', 'ev', ['task_id'], 'service', 'append-only', { authority: NO_SERVICE }),
  conflict: declare('conflicts.json', 'conf', ['task_id'], 'person', 'human-resolution'),
  session: declare('sessions.json', 'sess', ['project_id'], 'device', 'last-writer'),
  approval: declare('approvals.json', 'appr', ['task_id'], 'person', 'human-resolution'),
  event: declare(null, 'evt', ['type'], 'service', 'append-only', { authority: NO_SERVICE }),
});

export class ProjectStoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// A pid is alive if the kernel answers a signal-0 probe. The engine must not reach into src/cli, so
// the check lives here rather than being imported from the daemon.
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export class ProjectStore {
  constructor(root, { id, deviceId = null, fsync = true, allowSecrets = false, kinds = {} } = {}) {
    if (!id || /[/\\]|\.\./.test(String(id)) || String(id).startsWith('.')) {
      throw new ProjectStoreError('bad_id', `not a project id: ${id}`);
    }
    this.root = path.resolve(root);
    this.id = String(id);
    this.deviceId = deviceId;
    this.fsync = fsync;
    this.allowSecrets = allowSecrets;
    // a type passed in can add to the built-in ones, never replace one: the frozen declarations stay what the schema says
    for (const name of Object.keys(kinds)) {
      if (Object.hasOwn(ENTITY_KINDS, name)) throw new ProjectStoreError('bad_declaration', `refused: the entity type ${name} is built in and cannot be redeclared`);
    }
    this.kinds = Object.freeze({ ...ENTITY_KINDS, ...kinds });
    this.dir = path.join(this.root, STATE, 'projects', this.id);
    this._open = false;
    this._lockDepth = 0;
    this.seq = 0; this.generation = 0; this.entities = new Map(); this.eventKeys = new Map(); this.usedIds = new Set(); this.recovered = []; this.clock = { ms: 0, c: 0 };
    this.approvals = new Map(); this.derived = []; this._unusable = new Map(); this._ignored = [];
  }

  get eventsPath() { return path.join(this.dir, 'events.jsonl'); }
  get metaPath() { return path.join(this.dir, 'meta.json'); }
  get lockPath() { return path.join(this.dir, '.lock'); }
  snapshotPath(kind) { return path.join(this.dir, this.kinds[kind].file); }

  open() {
    const meta = readJson(this.metaPath, null);
    const v = meta?.schema_version ?? SCHEMA_VERSION;
    if (v > SCHEMA_VERSION) {
      throw new ProjectStoreError('future_schema', `refusing to open: schema version ${v} is newer than this Memev knows (${SCHEMA_VERSION})`);
    }
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (!meta) writeJson(this.metaPath, { schema_version: SCHEMA_VERSION, project_id: this.id, created: now() }, 0o600);
    if (v < SCHEMA_VERSION) this._migrate(v, readJson(this.metaPath, {}));
    this._replay();
    this._writeAllSnapshots();
    this._open = true;
    return this;
  }

  // v1 -> v2: back up each snapshot beside it, import every v1 entity into the log as an event, and
  // record one migration event. The log becomes the source of truth, so a later open rebuilds from it.
  _migrate(from, meta) {
    let seq = 0;
    for (const [kind, def] of Object.entries(this.kinds)) {
      if (!def.file) continue;
      const snapPath = this.snapshotPath(kind);
      if (!exists(snapPath)) continue;
      fs.copyFileSync(snapPath, `${snapPath}.bak-v1`);
      const entities = readJson(snapPath, {})?.entities ?? {};
      for (const [id, data] of Object.entries(entities)) {
        seq++;
        this._writeLine(this._record(seq, `${kind}.imported`, { kind, id, data }, seq - 1, { migrated: true }));
      }
    }
    seq++;
    this._writeLine(this._record(seq, 'schema.migrated', null, seq - 1, { from, to: SCHEMA_VERSION }));
    meta.schema_version = SCHEMA_VERSION;
    meta.migrated_from = from;
    meta.migrated_at = now();
    writeJson(this.metaPath, meta, 0o600);
  }

  // Rebuild the in-memory state from the log alone. A torn last line (no trailing newline) is a crash
  // fragment: it is truncated and reported. A line that does not parse in the middle of the file is
  // torn or edited: it is skipped and reported, and every valid record after it is kept.
  _replay() {
    this.seq = 0; this.generation = 0; this.entities = new Map(); this.eventKeys = new Map(); this.usedIds = new Set(); this.recovered = []; this.clock = { ms: 0, c: 0 };
    this.approvals = new Map(); this.derived = []; this._unusable = new Map(); this._ignored = [];
    if (!exists(this.eventsPath)) return;
    let content = fs.readFileSync(this.eventsPath, 'utf8');
    if (content.length && !content.endsWith('\n')) {
      const complete = content.lastIndexOf('\n') + 1;
      this.recovered.push(`events.jsonl: torn last line truncated (${content.length - complete} bytes)`);
      fs.truncateSync(this.eventsPath, complete);
      content = content.slice(0, complete);
    }
    for (const line of content.split('\n')) {
      if (!line) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { this.recovered.push('events.jsonl: unreadable record skipped'); continue; }
      this._applyRecord(rec);
    }
    this._derive();
    for (const [event, why] of this._unusable) this.recovered.push(`events.jsonl: approval event ${event}: ${why}, not used by the conflict rule`);
    for (const g of this._ignored) this.recovered.push(`events.jsonl: approval ${g.id} (event ${g.event}): resolves ignored, ${g.reason}`);
  }

  _applyRecord(rec) {
    if (rec.id) this.usedIds.add(rec.id);
    if (rec.hlc) this._observeClock(rec.hlc);
    this.seq = Math.max(this.seq, rec.seq ?? 0);
    if (rec.refused) return;   // a refused event changes no state: no entity, no key, no generation
    if (rec.key) this.eventKeys.set(rec.key, rec);
    if (rec.entity) {
      const { kind, id, data } = rec.entity;
      if (!this.entities.has(kind)) this.entities.set(kind, new Map());
      this.entities.get(kind).set(id, data);
      // every approval write is its own event: a later write with the same id replaces the entity, never the event
      if (kind === 'approval') {
        const why = unusableApproval(data);
        if (why) this._unusable.set(rec.id, why);
        else this.approvals.set(rec.id, { event: rec.id, id, data });
      }
      if (id) this.usedIds.add(id);
    }
    this.generation = Math.max(this.generation, (rec.gen ?? 0) + 1);
  }

  // Append one event. Returns the stored record, the original record for an idempotent duplicate, or
  // { busy, retry } when the lock is held by a live process. Refusals (stale generation, a secret) are
  // recorded as refused events and then thrown.
  append(event) {
    if (!this._open) throw new ProjectStoreError('not_open', 'the store is not open');
    if (this._tryAcquireLock()) return { busy: true, retry: true };
    try { return this._appendLocked(event); } finally { this._releaseLock(); }
  }

  // Hold the lock across a callback, so several appends commit as one writer turn.
  withWrite(fn) {
    if (!this._open) throw new ProjectStoreError('not_open', 'the store is not open');
    if (this._tryAcquireLock()) return { busy: true, retry: true };
    try { return fn(this); } finally { this._releaseLock(); }
  }

  // Convenience: upsert an entity of a kind. The validator runs on the data.
  put(kind, data, opts = {}) {
    return this.append({ type: `${kind}.upserted`, entity: { kind, data }, ...opts });
  }

  _appendLocked(event) {
    this._replay();   // another writer may have appended while we waited for the lock
    if (event.key && this.eventKeys.has(event.key)) return this.eventKeys.get(event.key);
    const entity = this._validate(event.entity);
    if (event.gen !== undefined && event.gen < this.generation) {
      this._recordRefused(event, entity, `stale_generation: ${event.gen} < ${this.generation}`);
      throw new ProjectStoreError('stale_generation', `refused: generation ${event.gen} is older than the current ${this.generation}`);
    }
    let redacted = false;
    if (entity) {
      const hits = findSecrets(JSON.stringify(entity.data));
      if (hits.length) {
        if (!this.allowSecrets) {
          this._recordRefused(event, entity, `secret: ${hits.join(', ')}`);
          throw new ProjectStoreError('secret', `refused: the record looks like a credential (${hits.join(', ')})`);
        }
        entity.data = this._redactValue(entity.data);
        redacted = true;
      }
    }
    const rec = this._record(this.seq + 1, event.type, entity, this.generation, {
      key: event.key ?? null, agent: event.agent ?? null, client: event.client ?? null, redacted,
    });
    this._writeLine(rec);
    this._applyRecord(rec);
    this._derive();
    if (entity) this._writeSnapshot(entity.kind);
    return rec;
  }

  // The semantic part of the project layer (SO-F-02), derived from the log and never written to it or into any entity:
  // approvals on one task that say incompatible things, whatever version each was given on, are a conflict record that
  // names every one of those log events. Neither approval is applied, and both stay in the log and as entities.
  // A person settles it with an approval that lists the events it resolves (see analyseApprovals). The record is
  // kept apart from the entities (`conflicts()`, `view()`), so no caller that reads a snapshot, changes it and writes it
  // back can persist it, and the next replay derives the same thing again.
  _derive() {
    const live = [...this.approvals.values()].map((a) => ({ event: a.event, id: a.id, task_id: a.data.task_id, decision: a.data.decision, task_version: a.data.task_version, resolves: a.data.resolves }));
    const { conflicts, ignored } = analyseApprovals(live);
    this._ignored = ignored;
    this.derived = conflicts.map((c) => ({ ...c, id: `conf_sem_${sha256(c.events.join('|')).slice(0, 12)}` }));
  }

  /** The semantic conflicts the log derives right now, as plain records. Derived, never stored. See view() for who reads it. */
  conflicts() { return this.derived.map((c) => ({ ...c })); }

  /**
   * A derived read of a kind. For `task`: the stored tasks, and where a semantic conflict stands on a task that is not in
   * a terminal state, a copy shown as CONFLICTED with `prior_status` and the conflict record. This is a display: it makes
   * no transition, a terminal task keeps its status, and the stored task is never changed, so a caller that acts on a
   * task reads `snapshot`. For `conflict`: the stored conflicts and the derived ones. Any other kind is its snapshot.
   *
   * Surfaced, not enforced: nothing in src/ calls view() or conflicts() yet, and the coordinator reads snapshot(), so a
   * conflicted task can still be claimed, reported, reassigned or cancelled. The SO-1.01 wiring will read through
   * view('task') and conflicts() on the coordinator's read side (claim, eligibility, status, around _tasksOf) and keep
   * writing from snapshot(). Changing the coordinator is outside the scope of SO-F-02.
   */
  view(kind) {
    const out = this.snapshot(kind);
    if (kind === 'task') {
      for (const c of this.derived) {
        const raw = out[c.task_id];
        if (!raw || TERMINAL_TASK_STATUSES.includes(raw.status)) continue;
        const { id, ...record } = c; void id;
        out[c.task_id] = { ...raw, status: 'CONFLICTED', prior_status: raw.status, conflict: record };
      }
    } else if (kind === 'conflict') {
      for (const c of this.derived) out[c.id] = { ...c };
    }
    return out;
  }

  // Validate an entity: the kind must be known and declare a merge class, every required field must be present, a scope
  // version must be a positive whole number, and an approval's decision must be one the schema knows. Returns the
  // entity with an id assigned (or the caller's id kept) and the data, or null for a bare event.
  _validate(ent) {
    if (!ent) return null;
    const def = this.kinds[ent.kind];
    if (!def) throw new ProjectStoreError('invalid', `unknown entity kind: ${ent.kind}`);
    if (!MERGE_CLASSES.includes(def.mergeClass)) throw new ProjectStoreError('no_merge_class', `refused: the entity type ${ent.kind} declares no merge class (one of ${MERGE_CLASSES.join(', ')})`);
    if (!SUBJECT_TYPES.includes(def.authority)) throw new ProjectStoreError('bad_declaration', `refused: the entity type ${ent.kind} declares no authority owner (a subject type: ${SUBJECT_TYPES.join(', ')})`);
    const data = ent.data ?? {};
    for (const f of def.required) {
      if (data[f] === undefined || data[f] === null || data[f] === '') {
        throw new ProjectStoreError('invalid', `missing required field: ${f}`);
      }
    }
    const sv = def.scopeVersionField;
    if (sv && Object.hasOwn(data, sv) && !(Number.isInteger(data[sv]) && data[sv] > 0)) {
      throw new ProjectStoreError('invalid', `${sv} must be a positive whole number`);
    }
    if (ent.kind === 'approval') {
      if (data.decision !== undefined && !APPROVAL_DECISIONS.includes(data.decision)) throw new ProjectStoreError('invalid', `decision must be one of ${APPROVAL_DECISIONS.join(', ')}`);
      if (data.resolves !== undefined) {
        if (!(Array.isArray(data.resolves) && data.resolves.every((x) => typeof x === 'string'))) throw new ProjectStoreError('invalid', 'resolves must be a list of event ids');
        // the same rule the derivation applies, run on this write before it is made, so a resolution that would
        // resolve nothing is refused instead of being stored as if it did
        if (data.decision === undefined) throw new ProjectStoreError('invalid', 'an approval that resolves events must carry a decision');
        const live = [...this.approvals.values()].map((a) => ({ event: a.event, id: a.id, task_id: a.data.task_id, decision: a.data.decision, resolves: a.data.resolves }));
        const probe = { event: '(this write)', id: ent.id ?? '(new)', task_id: data.task_id, decision: data.decision, resolves: data.resolves };
        const refused = analyseApprovals([...live, probe]).ignored.find((g) => g.event === probe.event);
        if (refused) throw new ProjectStoreError('invalid', `resolves must name an earlier approval event of this task on both sides, an approve and a reject: ${refused.reason}`);
      }
    }
    const id = ent.id || this._newId(ent.kind);
    return { kind: ent.kind, id, data };
  }

  _recordRefused(event, entity, reason) {
    const rec = this._record(this.seq + 1, event.type, entity, this.generation, {
      key: event.key ?? null, agent: event.agent ?? null, client: event.client ?? null, refused: true, reason,
    });
    this._writeLine(rec);
    this.seq = rec.seq;
    return rec;
  }

  _record(seq, type, entity, gen, extra = {}) {
    const rec = {
      schema_version: SCHEMA_VERSION,
      seq,
      ts: now(),
      id: this._newId('event'),
      key: extra.key ?? null,
      type,
      entity: entity ?? null,
      agent: extra.agent ?? null,
      client: extra.client ?? null,
      dev: this.deviceId,
      hlc: this._tick(),
      gen,
      redacted: extra.redacted ?? false,
      hash: null,
    };
    if (extra.refused) { rec.refused = true; rec.reason = extra.reason; }
    if (extra.migrated) rec.migrated = true;
    if (extra.from !== undefined) { rec.from = extra.from; rec.to = extra.to; }
    rec.hash = recordHash(rec);
    return rec;
  }

  _writeLine(rec) {
    fs.appendFileSync(this.eventsPath, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
    if (this.fsync) {
      const fd = fs.openSync(this.eventsPath, 'r+');
      try { fs.fdatasyncSync(fd); } finally { fs.closeSync(fd); }
    }
  }

  _writeSnapshot(kind) {
    const def = this.kinds[kind];
    if (!def?.file) return;
    const entities = Object.fromEntries(this.entities.get(kind)?.entries() ?? []);
    writeJson(this.snapshotPath(kind), { schema_version: SCHEMA_VERSION, entities }, 0o600);
  }
  _writeAllSnapshots() { for (const kind of Object.keys(this.kinds)) this._writeSnapshot(kind); }

  // compact() keeps every transition (the event log is untouched) and drops only superseded snapshots:
  // the .bak copies a migration left beside the live files.
  compact() {
    if (!this._open) throw new ProjectStoreError('not_open', 'the store is not open');
    let dropped = 0;
    for (const name of fs.readdirSync(this.dir)) {
      if (name.includes('.bak')) { fs.unlinkSync(path.join(this.dir, name)); dropped++; }
    }
    return { dropped };
  }

  // The current entities of a kind, as a plain object.
  snapshot(kind) { return Object.fromEntries(this.entities.get(kind)?.entries() ?? []); }
  stats() {
    const counts = {};
    for (const [kind, m] of this.entities) counts[kind] = m.size;
    return { seq: this.seq, generation: this.generation, entities: counts, recovered: this.recovered };
  }

  close() { this._releaseLock(); this._open = false; }

  // ---- single-writer lock: an O_EXCL file carrying the holder's pid. A live holder means busy; a
  // dead one (or our own leftover) is stale and is taken over. Reentrant within one process.
  _tryAcquireLock() {
    if (this._lockDepth > 0) { this._lockDepth++; return false; }
    // The holder can release between any two of these calls, so a vanished lock file means free, never an error.
    let held = null;
    try { held = fs.readFileSync(this.lockPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (held !== null) {
      const pid = parseInt(held.trim(), 10);
      if (pid !== process.pid && pidAlive(pid)) return true;
      // a lock file with no pid in it is a writer caught between creating and filling it: busy, not stale
      if (!Number.isInteger(pid)) {
        let age = Infinity;
        try { age = Date.now() - fs.statSync(this.lockPath).mtimeMs; } catch {}
        if (age < 5000) return true;
      }
      // remove it only if it is still the stale lock read above, not a live one taken over in the meantime
      try { if (fs.readFileSync(this.lockPath, 'utf8') === held) fs.unlinkSync(this.lockPath); } catch {}
    }
    // The lock appears whole or not at all: the pid is written to a private file, which is then linked to the lock
    // name (atomic, and refused when the name exists). Creating the lock and then writing the pid left a moment in
    // which a second process read an empty file, took it for stale and removed a live lock.
    const tmp = `${this.lockPath}.${process.pid}.${randomToken(3)}`;
    try {
      fs.writeFileSync(tmp, String(process.pid), { mode: 0o600 });
      try { fs.linkSync(tmp, this.lockPath); }
      catch (e) {
        if (e.code === 'EEXIST') return true;
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(e.code)) throw e;
        // a file system with no hard links: the exclusive create, with the pid written in the same call
        try { fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 }); }
        catch (e2) { if (e2.code === 'EEXIST') return true; throw e2; }
      }
      this._lockDepth = 1;
      return false;
    } finally { try { fs.unlinkSync(tmp); } catch {} }
  }
  _releaseLock() {
    if (this._lockDepth <= 0) return;
    this._lockDepth--;
    if (this._lockDepth === 0) { try { fs.unlinkSync(this.lockPath); } catch {} }
  }

  // ---- ids and the hybrid logical clock: ids are sortable (a zero-padded HLC prefix), unique across
  // restarts (the clock resumes from the highest seen in the log) and never reused (usedIds).
  _tick() {
    const t = Date.now();
    if (t > this.clock.ms) this.clock = { ms: t, c: 0 };
    else this.clock = { ms: this.clock.ms, c: this.clock.c + 1 };
    return formatHlc(this.clock);
  }
  _observeClock(hlc) {
    const o = parseHlc(hlc);
    if (!o) return;
    if (o.ms > this.clock.ms || (o.ms === this.clock.ms && o.c > this.clock.c)) this.clock = o;
  }
  _newId(kind) {
    const prefix = this.kinds[kind].prefix;
    for (let i = 0; i < 100; i++) {
      const id = `${prefix}_${this._tick()}_${randomToken(4)}`;
      if (!this.usedIds.has(id)) { this.usedIds.add(id); return id; }
    }
    throw new ProjectStoreError('id_collision', `could not allocate a unique ${kind} id`);
  }

  _redactValue(v) {
    if (typeof v === 'string') return redactSecrets(v);
    if (Array.isArray(v)) return v.map((x) => this._redactValue(x));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = this._redactValue(val);
      return out;
    }
    return v;
  }
}
