// SO-08-A: the coordinator's duplicate-work controls, over a store with the ProjectStore API.
// The store is a self-contained double in this file (same public API, O_EXCL single-writer lock,
// append-only log, replay, per-record generation, idempotency keys), written before the store was on main; one AC01
// subtest runs over the real ProjectStore. Concurrency claims use two real processes; no fixed port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Coordinator } from '../src/engine/coordinator.mjs';
import { ProjectStore } from '../src/engine/project-store.mjs';

// ---- the store double: same public API as the SO-07-A ProjectStore (withWrite, append, put,
// snapshot, stats, close), a single-writer O_EXCL lock, an append-only log, replay on every write,
// a per-record generation, and idempotency keys. Self-contained so it can be embedded in a worker.
class Store {
  static KINDS = {
    project: { prefix: 'proj', required: ['name'] },
    task: { prefix: 'task', required: ['title'] },
    lease: { prefix: 'lease', required: ['task_id'] },
    attempt: { prefix: 'att', required: ['task_id'] },
    evidence: { prefix: 'ev', required: ['task_id'] },
    conflict: { prefix: 'conf', required: ['task_id'] },
    session: { prefix: 'sess', required: ['project_id'] },
    approval: { prefix: 'appr', required: ['task_id'] },
    event: { prefix: 'evt', required: ['type'] },
  };
  static pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }
  constructor(dir) {
    this.dir = dir;
    this.eventsPath = path.join(dir, 'events.jsonl');
    this.lockPath = path.join(dir, '.lock');
    this._open = false;
    this._lockDepth = 0;
    this.seq = 0; this.generation = 0; this.entities = new Map(); this.eventKeys = new Map(); this.usedIds = new Set();
  }
  open() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this._replay();
    this._open = true;
    return this;
  }
  _replay() {
    this.seq = 0; this.generation = 0; this.entities = new Map(); this.eventKeys = new Map(); this.usedIds = new Set();
    if (!fs.existsSync(this.eventsPath)) return;
    const content = fs.readFileSync(this.eventsPath, 'utf8');
    for (const line of content.split('\n')) {
      if (!line) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      this._applyRecord(rec);
    }
  }
  _applyRecord(rec) {
    if (rec.id) this.usedIds.add(rec.id);
    this.seq = Math.max(this.seq, rec.seq ?? 0);
    if (rec.refused) return;
    if (rec.key) this.eventKeys.set(rec.key, rec);
    if (rec.entity) {
      const { kind, id, data } = rec.entity;
      if (!this.entities.has(kind)) this.entities.set(kind, new Map());
      this.entities.get(kind).set(id, data);
      if (id) this.usedIds.add(id);
    }
    this.generation = Math.max(this.generation, (rec.gen ?? 0) + 1);
  }
  append(event) {
    if (!this._open) throw new Error('not_open');
    if (this._tryAcquireLock()) return { busy: true, retry: true };
    try { return this._appendLocked(event); } finally { this._releaseLock(); }
  }
  withWrite(fn) {
    if (!this._open) throw new Error('not_open');
    if (this._tryAcquireLock()) return { busy: true, retry: true };
    try { return fn(this); } finally { this._releaseLock(); }
  }
  put(kind, data, opts = {}) { return this.append({ type: `${kind}.upserted`, entity: { kind, data }, ...opts }); }
  _appendLocked(event) {
    this._replay();
    if (event.key && this.eventKeys.has(event.key)) return this.eventKeys.get(event.key);
    const entity = this._validate(event.entity);
    if (event.gen !== undefined && event.gen < this.generation) {
      this._recordRefused(event, entity, 'stale_generation');
      throw new Error('stale_generation');
    }
    const rec = this._record(this.seq + 1, event.type, entity, this.generation, { key: event.key ?? null, agent: event.agent ?? null });
    this._writeLine(rec);
    this._applyRecord(rec);
    return rec;
  }
  _validate(ent) {
    if (!ent) return null;
    const def = Store.KINDS[ent.kind];
    if (!def) throw new Error(`unknown kind: ${ent.kind}`);
    const data = ent.data ?? {};
    for (const f of def.required) {
      if (data[f] === undefined || data[f] === null || data[f] === '') throw new Error(`missing ${f}`);
    }
    const id = ent.id || this._newId(ent.kind);
    return { kind: ent.kind, id, data };
  }
  _recordRefused(event, entity, reason) {
    const rec = this._record(this.seq + 1, event.type, entity, this.generation, { key: event.key ?? null, refused: true, reason });
    this._writeLine(rec);
    this.seq = rec.seq;
    return rec;
  }
  _record(seq, type, entity, gen, extra = {}) {
    const rec = { seq, ts: Date.now(), id: this._newId('event'), key: extra.key ?? null, type, entity: entity ?? null, agent: extra.agent ?? null, gen, refused: false };
    if (extra.refused) { rec.refused = true; rec.reason = extra.reason; }
    return rec;
  }
  _writeLine(rec) { fs.appendFileSync(this.eventsPath, `${JSON.stringify(rec)}\n`, { mode: 0o600 }); }
  snapshot(kind) { return Object.fromEntries(this.entities.get(kind)?.entries() ?? []); }
  stats() {
    const counts = {};
    for (const [kind, m] of this.entities) counts[kind] = m.size;
    return { seq: this.seq, generation: this.generation, entities: counts };
  }
  close() { this._releaseLock(); this._open = false; }
  _tryAcquireLock() {
    if (this._lockDepth > 0) { this._lockDepth++; return false; }
    // The holder can release between any two of these calls, so a vanished lock file means free, as in the real store.
    let held = null;
    try { held = fs.readFileSync(this.lockPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (held !== null) {
      const pid = parseInt(held.trim(), 10);
      if (pid !== process.pid && Store.pidAlive(pid)) return true;
      // as in the real store (project-store.mjs _tryAcquireLock): a lock with no pid yet is a writer between creating and
      // filling it, so busy, not stale; and it is removed only if it is still the stale lock read above (issue 457)
      if (!Number.isInteger(pid)) {
        let age = Infinity;
        try { age = Date.now() - fs.statSync(this.lockPath).mtimeMs; } catch {}
        if (age < 5000) return true;
      }
      try { if (fs.readFileSync(this.lockPath, 'utf8') === held) fs.unlinkSync(this.lockPath); } catch {}
    }
    // the lock appears whole or not at all: the pid goes to a private file, which is then linked to the lock name
    const tmp = `${this.lockPath}.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, String(process.pid), { mode: 0o600 });
      try { fs.linkSync(tmp, this.lockPath); }
      catch (e) {
        if (e.code === 'EEXIST') return true;
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(e.code)) throw e;
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
  _newId(kind) {
    const prefix = Store.KINDS[kind].prefix;
    for (let i = 0; i < 100; i++) {
      const id = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      if (!this.usedIds.has(id)) { this.usedIds.add(id); return id; }
    }
    throw new Error('id_collision');
  }
}

// ---- helpers
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'so08a-'));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const lastLine = (out) => out.trim().split('\n').pop();

// Write a worker script that embeds the store double and the coordinator, opens the store, waits for
// a start file, then runs one claim and prints the result as JSON. Used for the two-process tests.
let workerFile = null;
function ensureWorker() {
  if (workerFile && fs.existsSync(workerFile)) return workerFile;
  workerFile = path.join(os.tmpdir(), `so08a-worker-${process.pid}.mjs`);
  const src = `
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Coordinator } from ${JSON.stringify(path.resolve('src/engine/coordinator.mjs'))};
${Store.toString()}
const [agent, dir, taskId, ttlStr, startFile] = process.argv.slice(2);
const ttl = Number(ttlStr);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const store = new Store(dir).open();
const coord = new Coordinator(store);
process.stdout.write('READY\\n');
let guard = 0;
while (!fs.existsSync(startFile)) { if (++guard > 3000) { process.exit(3); } sleep(2); }
const res = coord.claim(taskId, agent, ttl);
process.stdout.write(JSON.stringify(res) + '\\n');
store.close();
`;
  fs.writeFileSync(workerFile, src, { mode: 0o700 });
  return workerFile;
}

function spawnWorker(args) {
  const child = spawn(process.execPath, [ensureWorker(), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { out: '', err: '', ready: false, done: new Promise((res) => { child.on('close', (code) => res({ code, out: state.out, err: state.err })); }) };
  child.stdout.on('data', (d) => { state.out += d; if (!state.ready && state.out.includes('READY')) state.ready = true; });
  child.stderr.on('data', (d) => { state.err += d; });
  return state;
}

async function waitFor(pred, timeoutMs) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---- AC01: atomic claim across two processes; release records the reason
test('SO-08-A AC01: two claimants in two processes, exactly one wins a lease; release records the reason', async () => {
  const dir = tmpdir();
  const startFile = path.join(dir, 'start');
  {
    const store = new Store(dir).open();
    new Coordinator(store).plan('p1', [{ id: 'T1', title: 'task one' }]);
    store.close();
  }
  const a = spawnWorker(['agent-A', dir, 'T1', '60000', startFile]);
  const b = spawnWorker(['agent-B', dir, 'T1', '60000', startFile]);
  await waitFor(() => a.ready && b.ready, 8000);
  fs.writeFileSync(startFile, 'go');
  const ra = await a.done;
  const rb = await b.done;
  assert.equal(ra.code, 0, `worker A: ${ra.err}`);
  assert.equal(rb.code, 0, `worker B: ${rb.err}`);
  const A = JSON.parse(lastLine(ra.out));
  const B = JSON.parse(lastLine(rb.out));
  const winners = [A, B].filter((r) => r.ok && r.lease);
  const losers = [A, B].filter((r) => !r.ok && r.conflict);
  assert.equal(winners.length, 1, 'exactly one claimant receives a lease');
  assert.equal(losers.length, 1, 'the other receives a conflict');
  const lease = winners[0].lease;
  assert.ok(lease.generation >= 1, 'the lease carries a generation token');
  assert.ok(lease.issued > 0, 'the lease carries an issue time');
  assert.ok(lease.expires > lease.issued, 'the lease carries an expiry after the issue');
  assert.ok(losers[0].conflict.holder, 'the conflict names the holder');
  assert.ok(losers[0].conflict.expires > 0, 'the conflict names the expiry');
  const store = new Store(dir).open();
  const coord = new Coordinator(store);
  const rel = coord.release(lease, 'done by test');
  assert.equal(rel.ok, true);
  assert.equal(store.snapshot('lease')[lease.id].release_reason, 'done by test');
  store.close();
});

// The same claim over the real ProjectStore, which refuses a stale append with code stale_generation and a message that
// does not contain it. Two stores on one folder are both opened before either claims, so the second claim is stale.
test('SO-08-A AC01: over the real ProjectStore, the claimant that loses on a stale generation gets a conflict naming the holder', () => {
  const dir = tmpdir();
  const open = () => new ProjectStore(dir, { id: 'p1', fsync: false }).open();
  { const s = open(); new Coordinator(s).plan('p1', [{ id: 'T1', title: 'task one' }]); s.close(); }
  const s1 = open(); const s2 = open();
  try {
    const won = new Coordinator(s1).claim('T1', 'agent-A', 60000);
    assert.equal(won.ok, true, 'the first claimant receives a lease');
    const lost = new Coordinator(s2).claim('T1', 'agent-B', 60000);
    assert.equal(lost.ok, false, 'the second claimant does not win');
    assert.equal(lost.conflict.holder, 'agent-A', 'the conflict names the holder');
    assert.equal(lost.conflict.expires, won.lease.expires, 'the conflict names the expiry');
  } finally { s1.close(); s2.close(); }
});

// ---- AC02: a stale owner cannot commit
test('SO-08-A AC02: a report under a superseded generation is refused, kept as evidence, canonical unchanged', () => {
  const dir = tmpdir();
  const store = new Store(dir).open();
  const coord = new Coordinator(store);
  coord.plan('p1', [{ id: 'T1', title: 'task one' }]);
  const l1 = coord.claim('T1', 'agent-A', 60000);
  assert.equal(l1.ok, true);
  coord.release(l1.lease, 'reassign');
  const l2 = coord.claim('T1', 'agent-B', 60000);
  assert.equal(l2.ok, true);
  const before = JSON.stringify(store.snapshot('task')['T1']);
  const rep = coord.report(l1.lease, { output: 'stale work', artifacts: ['a.mjs'] });
  assert.equal(rep.ok, false);
  assert.equal(rep.stale, true, 'the superseded report is refused as stale');
  const attempts = Object.values(store.snapshot('attempt'));
  const staleAtt = attempts.find((a) => a.lease_id === l1.lease.id);
  assert.ok(staleAtt, 'the refused report is recorded as an attempt');
  assert.equal(staleAtt.status, 'stale');
  assert.equal(staleAtt.output, 'stale work', 'the output is kept');
  assert.ok(Object.values(store.snapshot('evidence')).some((e) => e.ref === rep.attempt && e.output === 'stale work'), 'the output is kept as evidence');
  assert.equal(JSON.stringify(store.snapshot('task')['T1']), before, 'canonical state is unchanged');
  store.close();
});

// ---- AC03: eligibility from dependencies and locks
test('SO-08-A AC03: eligible returns READY tasks with deps met and no shared lock; the lock is visible on the task', () => {
  const dir = tmpdir();
  const store = new Store(dir).open();
  const coord = new Coordinator(store);
  coord.plan('p1', [
    { id: 'A', title: 'A', resources: ['db'] },
    { id: 'B', title: 'B', resources: ['db'] },
    { id: 'C', title: 'C', resources: ['net'] },
    { id: 'D', title: 'D', deps: ['A'] },
  ]);
  let elig = coord.eligible('p1');
  assert.ok(elig.includes('A') && elig.includes('B') && elig.includes('C'), 'independent READY tasks are eligible');
  assert.ok(!elig.includes('D'), 'a task with an unsatisfied dependency is not eligible');
  const la = coord.claim('A', 'agent-A', 60000);
  assert.equal(la.ok, true);
  assert.deepEqual(store.snapshot('task')['A'].locks, ['db'], 'the lock is visible on the task record');
  elig = coord.eligible('p1');
  assert.ok(!elig.includes('A'), 'an in-progress task is not eligible');
  assert.ok(!elig.includes('B'), 'a task sharing a lock with an in-progress task is serialized out');
  assert.ok(elig.includes('C'), 'an independent task still runs in parallel');
  coord.report(la.lease, { output: 'A done', artifacts: [] });
  assert.ok(coord.eligible('p1').includes('D'), 'a task becomes eligible once its dependency is DONE');
  store.close();
});

// ---- AC04: heartbeat extends within the ttl; an expired lease blocks, not reassigns
test('SO-08-A AC04: heartbeat extends within the ttl; an expired lease blocks the task as owner_lost with its checkpoint and is not reassigned', () => {
  let clock = 1000;
  const dir = tmpdir();
  const store = new Store(dir).open();
  const coord = new Coordinator(store, { now: () => clock });
  coord.plan('p1', [{ id: 'T1', title: 'task' }]);
  const l = coord.claim('T1', 'agent-A', 100);
  assert.equal(l.ok, true);
  assert.equal(l.lease.expires, 1100);
  clock = 1050;
  const hb = coord.heartbeat(l.lease, { checkpoint: 'ckpt-1' });
  assert.equal(hb.ok, true);
  assert.equal(hb.expires, 1150, 'the heartbeat extends the expiry within the ttl');
  clock = 1120;
  assert.equal(store.snapshot('lease')[l.lease.id].status, 'active', 'still active past the original expiry, within the extension');
  clock = 1200;
  const sw = coord.sweep();
  assert.ok(sw.expired.includes(l.lease.id), 'the lease is marked expired');
  assert.equal(store.snapshot('lease')[l.lease.id].status, 'expired');
  const task = store.snapshot('task')['T1'];
  assert.equal(task.status, 'BLOCKED');
  assert.equal(task.blocked_reason, 'owner_lost');
  assert.equal(task.checkpoint, 'ckpt-1', 'the checkpoint reference is kept on the task');
  assert.equal(task.status, 'BLOCKED', 'the task is not reassigned to READY');
  assert.equal(Object.values(store.snapshot('lease')).filter((x) => x.status === 'active').length, 0, 'no new lease is issued');
  store.close();
});

// ---- AC05: idempotency for dispatch and external actions
test('SO-08-A AC05: dispatch sends once per key; a non-idempotent external requires a key; a retry reads the recorded outcome and does not repeat a success; policies differ', () => {
  const dir = tmpdir();
  const store = new Store(dir).open();
  const coord = new Coordinator(store);
  coord.plan('p1', [{ id: 'T1', title: 'task' }]);

  let sends = 0;
  const send = () => { sends++; return { n: sends }; };
  const d1 = coord.dispatch('T1', 'agent-A', 'K1', { x: 1 }, send);
  const d2 = coord.dispatch('T1', 'agent-A', 'K1', { x: 1 }, send);
  assert.equal(d1.sent, true);
  assert.equal(d2.sent, false, 'the same key does not send again');
  assert.equal(d2.duplicate, true);
  assert.deepEqual(d2.result, d1.result, 'the recorded result is returned');
  assert.equal(sends, 1, 'the payload was sent exactly once');

  const noKey = coord.external('T1', 'nonIdempotent', null, {}, () => ({ status: 'success' }));
  assert.equal(noKey.ok, false, 'a non-idempotent external action requires a key');
  assert.equal(noKey.error, 'key_required');

  let extSends = 0;
  const extDo = () => { extSends++; return { status: 'success' }; };
  coord.external('T1', 'nonIdempotent', 'K2', {}, extDo);
  const retry = coord.retryExternal('T1', 'nonIdempotent', 'K2', {}, extDo);
  assert.equal(retry.ok, true);
  assert.equal(retry.repeated, false, 'a retry does not repeat an action whose outcome is already success');
  assert.equal(extSends, 1, 'the external action ran once');

  let failSends = 0;
  const failDo = () => { failSends++; return { status: 'failed' }; };
  coord.external('T1', 'nonIdempotent', 'K3', {}, failDo);
  const refused = coord.retryExternal('T1', 'nonIdempotent', 'K3', {}, failDo);
  assert.equal(refused.ok, false, 'a failed non-idempotent action is not resent');
  assert.equal(refused.error, 'retry_refused');
  assert.equal(failSends, 1);

  let idemSends = 0;
  const idemDo = () => { idemSends++; return { status: 'failed' }; };
  coord.external('T1', 'idempotent', 'K4', {}, idemDo);
  const allowed = coord.retryExternal('T1', 'idempotent', 'K4', {}, idemDo);
  assert.equal(allowed.ok, true, 'a failed idempotent action may be resent');
  assert.equal(allowed.repeated, true);
  assert.equal(idemSends, 2);
  store.close();
});

// ---- AC06: overlap flagged at plan time and serialized; a shared artifact is a conflict
test('SO-08-A AC06: overlapping artifacts are flagged at plan time and serialized; two attempts that changed the same artifact are a conflict and CONFLICTED', () => {
  const dir = tmpdir();
  const store = new Store(dir).open();
  const coord = new Coordinator(store);
  const plan = coord.plan('p1', [
    { id: 'T1', title: 'T1', artifacts: ['a.mjs'] },
    { id: 'T2', title: 'T2', artifacts: ['a.mjs'] },
  ]);
  assert.ok(plan.overlap.some((o) => o.artifact === 'a.mjs'), 'the overlap is flagged at plan time');
  assert.ok(store.snapshot('task')['T1'].overlap.includes('T2'), 'the overlap is visible on the task record');

  const l1 = coord.claim('T1', 'agent-A', 60000);
  assert.equal(l1.ok, true);
  assert.ok(!coord.eligible('p1').includes('T2'), 'the overlapping task is serialized while the other is in progress');
  coord.report(l1.lease, { output: 'T1 wrote a.mjs', artifacts: ['a.mjs'] });

  const l2 = coord.claim('T2', 'agent-B', 60000);
  assert.equal(l2.ok, true);
  const rep = coord.report(l2.lease, { output: 'T2 wrote a.mjs', artifacts: ['a.mjs'] });
  assert.equal(rep.ok, false);
  assert.ok(rep.conflict, 'two attempts that changed the same artifact produce a conflict');
  assert.ok(rep.conflict.artifacts.includes('a.mjs'));
  assert.ok(Object.keys(store.snapshot('conflict')).length >= 1, 'a conflict record is written');
  assert.equal(store.snapshot('task')['T2'].status, 'CONFLICTED');
  store.close();
});

// ---- AC07: late results are preserved and not applied
test('SO-08-A AC07: a report under a released lease is stored as an attempt with status late, visible on the task, and changes no canonical field', () => {
  const dir = tmpdir();
  const store = new Store(dir).open();
  const coord = new Coordinator(store);
  coord.plan('p1', [{ id: 'T1', title: 'task' }]);
  const l1 = coord.claim('T1', 'agent-A', 60000);
  assert.equal(l1.ok, true);
  coord.release(l1.lease, 'released before the report');
  const before = JSON.stringify(store.snapshot('task')['T1']);
  const rep = coord.report(l1.lease, { output: 'late work', artifacts: [] });
  assert.equal(rep.ok, false);
  assert.equal(rep.late, true, 'the report under a released lease is late');
  const attempts = Object.values(store.snapshot('attempt')).filter((a) => a.task_id === 'T1');
  assert.ok(attempts.some((a) => a.status === 'late' && a.output === 'late work'), 'the late attempt is visible on the task');
  assert.ok(Object.values(store.snapshot('evidence')).some((e) => e.task_id === 'T1' && e.output === 'late work'), 'the late output is kept as evidence');
  assert.equal(JSON.stringify(store.snapshot('task')['T1']), before, 'no canonical field changes');
  store.close();
});
