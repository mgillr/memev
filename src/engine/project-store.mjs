// SPDX-License-Identifier: Apache-2.0
// The project store: one canonical project state per project, under the vault's .memev directory.
// A snapshot per entity kind plus one append-only event log, a validator per entity kind, idempotency
// keys, a schema version with a one-way migration and a backup copy, and reconstruction from the log on
// every open. It writes only under .memev/projects/<id>/, one writer holds the lock at a time, so two
// processes appending to the same project serialize without interleaving a partial line.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, now, randomToken, exists } from './util.mjs';
import { findSecrets, redactSecrets } from './secrets.mjs';
import { formatHlc, parseHlc, recordHash } from './oplog.mjs';

// The current schema version. A store at an older version is migrated forward on open; a store at a
// newer version is refused (this Memev does not know its layout) and nothing is written.
export const SCHEMA_VERSION = 2;
const STATE = '.memev';

// The handoff's minimum entities (section 7). Each kind has a snapshot file, an id prefix and the
// required fields its validator enforces. `event` has no snapshot: it lives only in the log.
const KINDS = {
  project: { file: 'project.json', prefix: 'proj', required: ['name'] },
  task: { file: 'tasks.json', prefix: 'task', required: ['title'] },
  lease: { file: 'leases.json', prefix: 'lease', required: ['task_id'] },
  attempt: { file: 'attempts.json', prefix: 'att', required: ['task_id'] },
  evidence: { file: 'evidence.json', prefix: 'ev', required: ['task_id'] },
  conflict: { file: 'conflicts.json', prefix: 'conf', required: ['task_id'] },
  session: { file: 'sessions.json', prefix: 'sess', required: ['project_id'] },
  approval: { file: 'approvals.json', prefix: 'appr', required: ['task_id'] },
  event: { file: null, prefix: 'evt', required: ['type'] },
};

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
  constructor(root, { id, deviceId = null, fsync = true, allowSecrets = false } = {}) {
    if (!id || /[/\\]|\.\./.test(String(id)) || String(id).startsWith('.')) {
      throw new ProjectStoreError('bad_id', `not a project id: ${id}`);
    }
    this.root = path.resolve(root);
    this.id = String(id);
    this.deviceId = deviceId;
    this.fsync = fsync;
    this.allowSecrets = allowSecrets;
    this.dir = path.join(this.root, STATE, 'projects', this.id);
    this._open = false;
    this._lockDepth = 0;
    this.seq = 0; this.generation = 0; this.entities = new Map(); this.eventKeys = new Map(); this.usedIds = new Set(); this.recovered = []; this.clock = { ms: 0, c: 0 };
  }

  get eventsPath() { return path.join(this.dir, 'events.jsonl'); }
  get metaPath() { return path.join(this.dir, 'meta.json'); }
  get lockPath() { return path.join(this.dir, '.lock'); }
  snapshotPath(kind) { return path.join(this.dir, KINDS[kind].file); }

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
    for (const [kind, def] of Object.entries(KINDS)) {
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
    if (entity) this._writeSnapshot(entity.kind);
    return rec;
  }

  // Validate an entity: the kind must be known and every required field must be present. Returns the
  // entity with an id assigned (or the caller's id kept) and the data, or null for a bare event.
  _validate(ent) {
    if (!ent) return null;
    const def = KINDS[ent.kind];
    if (!def) throw new ProjectStoreError('invalid', `unknown entity kind: ${ent.kind}`);
    const data = ent.data ?? {};
    for (const f of def.required) {
      if (data[f] === undefined || data[f] === null || data[f] === '') {
        throw new ProjectStoreError('invalid', `missing required field: ${f}`);
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
    const def = KINDS[kind];
    if (!def?.file) return;
    const entities = Object.fromEntries(this.entities.get(kind)?.entries() ?? []);
    writeJson(this.snapshotPath(kind), { schema_version: SCHEMA_VERSION, entities }, 0o600);
  }
  _writeAllSnapshots() { for (const kind of Object.keys(KINDS)) this._writeSnapshot(kind); }

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
    if (exists(this.lockPath)) {
      const pid = parseInt(fs.readFileSync(this.lockPath, 'utf8').trim(), 10);
      if (pid !== process.pid && pidAlive(pid)) return true;
      // a lock file with no pid in it is a writer caught between creating and filling it: busy, not stale
      if (!Number.isInteger(pid) && Date.now() - fs.statSync(this.lockPath).mtimeMs < 5000) return true;
      try { fs.unlinkSync(this.lockPath); } catch {}
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
    const prefix = KINDS[kind].prefix;
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
