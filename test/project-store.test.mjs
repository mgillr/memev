// SPDX-License-Identifier: Apache-2.0
// SO-07-A: the canonical project store. Every acceptance criterion gets a test named after it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { ProjectStore, ProjectStoreError, SCHEMA_VERSION } from '../src/engine/project-store.mjs';

after(cleanup);

const dirOf = (root, id) => path.join(root, '.memev', 'projects', id);
const readLog = (dir) => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('SO-07-A AC01: records live under the vault and every project file carries schema_version', () => {
  const root = tmpdir();
  const written = new Set();
  const real = {
    writeFileSync: fs.writeFileSync, appendFileSync: fs.appendFileSync, openSync: fs.openSync,
    renameSync: fs.renameSync, truncateSync: fs.truncateSync, copyFileSync: fs.copyFileSync, mkdirSync: fs.mkdirSync,
  };
  const rec = (p) => { if (typeof p === 'string') written.add(path.resolve(p)); };
  fs.writeFileSync = (p, ...a) => { rec(p); return real.writeFileSync(p, ...a); };
  fs.appendFileSync = (p, ...a) => { rec(p); return real.appendFileSync(p, ...a); };
  fs.openSync = (p, ...a) => { rec(p); return real.openSync(p, ...a); };
  fs.renameSync = (s, d) => { rec(d); return real.renameSync(s, d); };
  fs.truncateSync = (p, ...a) => { rec(p); return real.truncateSync(p, ...a); };
  fs.copyFileSync = (s, d) => { rec(d); return real.copyFileSync(s, d); };
  fs.mkdirSync = (p, ...a) => { rec(p); return real.mkdirSync(p, ...a); };
  try {
    const store = new ProjectStore(root, { id: 'proj-1', deviceId: 'host' }).open();
    store.put('project', { name: 'demo' });
    store.put('task', { title: 'first' });
    store.append({ type: 'note', key: 'k1', entity: { kind: 'evidence', data: { task_id: 'task_x' } } });
    store.close();
    const outside = [...written].filter((p) => p !== root && !p.startsWith(root + path.sep));
    assert.equal(outside.length, 0, `paths written outside the vault: ${outside.join(', ')}`);
    const dir = dirOf(root, 'proj-1');
    assert.ok(fs.existsSync(path.join(dir, 'events.jsonl')), 'no events.jsonl');
    assert.ok(fs.existsSync(path.join(dir, 'project.json')), 'no project.json snapshot');
    assert.ok(fs.existsSync(path.join(dir, 'tasks.json')), 'no tasks.json snapshot');
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.json')) {
        assert.ok(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).schema_version !== undefined, `${name} has no schema_version`);
      }
    }
    for (const r of readLog(dir)) assert.ok(r.schema_version !== undefined, 'an event has no schema_version');
  } finally {
    for (const [k, fn] of Object.entries(real)) fs[k] = fn;
  }
});

test('SO-07-A AC02: the same event twice returns the original and a stale generation is refused', () => {
  const root = tmpdir();
  const dir = dirOf(root, 'proj-2');
  const store = new ProjectStore(root, { id: 'proj-2' }).open();
  const first = store.append({ type: 'task.created', key: 'idem-1', entity: { kind: 'task', data: { title: 't' } } });
  const second = store.append({ type: 'task.created', key: 'idem-1', entity: { kind: 'task', data: { title: 't' } } });
  assert.equal(second.id, first.id, 'the duplicate did not return the original record');
  assert.equal(second.seq, first.seq, 'the duplicate got a new seq');
  assert.equal(readLog(dir).length, 1, 'the duplicate was appended again');
  store.append({ type: 'task.created', key: 'idem-2', entity: { kind: 'task', data: { title: 't2' } } });
  assert.throws(
    () => store.append({ type: 'task.created', key: 'idem-3', gen: 0, entity: { kind: 'task', data: { title: 't3' } } }),
    (e) => e instanceof ProjectStoreError && e.code === 'stale_generation',
  );
  const refused = readLog(dir).filter((r) => r.refused);
  assert.equal(refused.length, 1, 'the stale event was not recorded as refused');
  assert.match(refused[0].reason, /stale_generation/);
  store.close();
});

test('SO-07-A AC03: state is rebuilt from the log alone, the log wins, and torn lines are recovered', () => {
  const root = tmpdir();
  const dir = dirOf(root, 'proj-3');
  const store = new ProjectStore(root, { id: 'proj-3' }).open();
  store.put('task', { title: 'a' }, { key: 'k-a' });
  store.put('task', { title: 'b' }, { key: 'k-b' });
  store.put('evidence', { task_id: 'x' }, { key: 'k-e' });
  const before = Object.keys(store.snapshot('task')).sort();
  store.close();
  // forge the snapshot so it disagrees with the log; the log must win on reopen
  const tasksPath = path.join(dir, 'tasks.json');
  const forged = { schema_version: SCHEMA_VERSION, entities: { forged: { title: 'forged' } } };
  fs.writeFileSync(tasksPath, JSON.stringify(forged, null, 2) + '\n');
  const store2 = new ProjectStore(root, { id: 'proj-3' }).open();
  assert.deepEqual(Object.keys(store2.snapshot('task')).sort(), before, 'state was not rebuilt from the log');
  assert.ok(!('forged' in store2.snapshot('task')), 'the log did not win over the forged snapshot');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(tasksPath, 'utf8')).entities).sort(), before, 'the snapshot was not rewritten from the log');
  store2.close();
  // a torn last line is truncated and reported, earlier records kept
  const root2 = tmpdir();
  const dir2 = dirOf(root2, 'proj-3b');
  const s = new ProjectStore(root2, { id: 'proj-3b' }).open();
  s.put('task', { title: 'keep' }, { key: 'k-keep' });
  s.close();
  fs.appendFileSync(path.join(dir2, 'events.jsonl'), '{"schema_version":2,"seq":99,"id":"evt_torn","type":"task.created","entity":{"kind":"task","id":"task_torn","data":{"title":"t"}');
  const s2 = new ProjectStore(root2, { id: 'proj-3b' }).open();
  assert.ok(s2.recovered.some((r) => /torn/.test(r)), 'the torn line was not reported');
  assert.ok(!('task_torn' in s2.snapshot('task')), 'the torn record was applied');
  assert.equal(Object.keys(s2.snapshot('task')).length, 1, 'the earlier record was lost');
  s2.close();
  // a bad line in the middle is skipped and reported, later records kept
  const root3 = tmpdir();
  const dir3 = dirOf(root3, 'proj-3c');
  const s3 = new ProjectStore(root3, { id: 'proj-3c' }).open();
  s3.put('task', { title: 'first' }, { key: 'k-first' });
  s3.close();
  const log3 = path.join(dir3, 'events.jsonl');
  const lines = fs.readFileSync(log3, 'utf8').split('\n').filter(Boolean);
  const after = { schema_version: SCHEMA_VERSION, seq: lines.length + 1, ts: new Date().toISOString(), id: 'evt_after', key: null, type: 'task.created', entity: { kind: 'task', id: 'task_after', data: { title: 'after' } }, agent: null, client: null, dev: null, hlc: '0000000000000.0000', gen: lines.length, redacted: false, hash: 'x' };
  fs.writeFileSync(log3, `${lines[0]}\nNOT-JSON\n${JSON.stringify(after)}\n`);
  const s4 = new ProjectStore(root3, { id: 'proj-3c' }).open();
  assert.ok(s4.recovered.some((r) => /unreadable/.test(r)), 'the bad line was not reported');
  assert.ok('task_after' in s4.snapshot('task'), 'the record after the bad line was lost');
  assert.ok(Object.values(s4.snapshot('task')).some((d) => d.title === 'first'), 'the earlier record was lost');
  s4.close();
});

test('SO-07-A AC04: a v1 store is migrated once with a backup and a future version refuses to open', () => {
  const root = tmpdir();
  const dir = dirOf(root, 'proj-4');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schema_version: 1, project_id: 'proj-4' }) + '\n');
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ schema_version: 1, entities: { task_old: { title: 'old task' } } }) + '\n');
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ schema_version: 1, entities: { proj_old: { name: 'old project' } } }) + '\n');
  const store = new ProjectStore(root, { id: 'proj-4' }).open();
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.schema_version, 2, 'meta was not migrated to v2');
  assert.equal(meta.migrated_from, 1, 'migrated_from was not recorded');
  assert.ok(fs.existsSync(path.join(dir, 'tasks.json.bak-v1')), 'no backup of tasks.json');
  assert.ok(fs.existsSync(path.join(dir, 'project.json.bak-v1')), 'no backup of project.json');
  assert.ok(readLog(dir).some((r) => r.type === 'schema.migrated'), 'no migration event');
  assert.ok('task_old' in store.snapshot('task'), 'the v1 task was not imported');
  store.close();
  const store2 = new ProjectStore(root, { id: 'proj-4' }).open();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).schema_version, 2);
  assert.equal(readLog(dir).filter((r) => r.type === 'schema.migrated').length, 1, 'migrated more than once');
  store2.close();
  const root2 = tmpdir();
  const dir2 = dirOf(root2, 'proj-4f');
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(path.join(dir2, 'meta.json'), JSON.stringify({ schema_version: 99, project_id: 'proj-4f' }) + '\n');
  const before = fs.readdirSync(dir2).sort();
  assert.throws(
    () => new ProjectStore(root2, { id: 'proj-4f' }).open(),
    (e) => e instanceof ProjectStoreError && e.code === 'future_schema' && /99/.test(e.message),
  );
  assert.deepEqual(fs.readdirSync(dir2).sort(), before, 'a future store wrote something');
});

test('SO-07-A AC05: a credential-looking record is refused or redacted and compact drops only superseded snapshots', () => {
  const root = tmpdir();
  const dir = dirOf(root, 'proj-5');
  const store = new ProjectStore(root, { id: 'proj-5' }).open();
  const secret = `ghp_${'a'.repeat(40)}`;
  assert.throws(
    () => store.append({ type: 'note', key: 's-1', entity: { kind: 'evidence', data: { task_id: 't', token: secret } } }),
    (e) => e instanceof ProjectStoreError && e.code === 'secret',
  );
  assert.ok(readLog(dir).some((r) => r.refused && /secret/.test(r.reason)), 'the secret refusal was not recorded');
  store.allowSecrets = true;
  const rec = store.append({ type: 'note', key: 's-2', entity: { kind: 'evidence', data: { task_id: 't', token: secret } } });
  assert.equal(rec.redacted, true, 'the record was not marked redacted');
  assert.ok(!JSON.stringify(rec.entity.data).includes(secret), 'the secret survived redaction');
  assert.ok(JSON.stringify(rec.entity.data).includes('[redacted]'), 'no redaction marker');
  store.close();
  const root2 = tmpdir();
  const dir2 = dirOf(root2, 'proj-5c');
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(path.join(dir2, 'meta.json'), JSON.stringify({ schema_version: 1, project_id: 'proj-5c' }) + '\n');
  fs.writeFileSync(path.join(dir2, 'tasks.json'), JSON.stringify({ schema_version: 1, entities: { task_c: { title: 'c' } } }) + '\n');
  const s2 = new ProjectStore(root2, { id: 'proj-5c' }).open();
  assert.ok(fs.existsSync(path.join(dir2, 'tasks.json.bak-v1')), 'no backup before compact');
  const logCount = readLog(dir2).length;
  const compacted = s2.compact();
  assert.ok(compacted.dropped >= 1, 'compact dropped nothing');
  assert.ok(!fs.existsSync(path.join(dir2, 'tasks.json.bak-v1')), 'compact kept a superseded snapshot');
  assert.equal(readLog(dir2).length, logCount, 'compact dropped a transition');
  assert.ok(fs.existsSync(path.join(dir2, 'tasks.json')), 'compact dropped the live snapshot');
  s2.close();
});

test('SO-07-A AC06: every entity kind has a validator and ids are sortable, unique and never reused', () => {
  const kinds = {
    project: { name: 'p' }, task: { title: 't' }, lease: { task_id: 't' }, attempt: { task_id: 't' },
    evidence: { task_id: 't' }, conflict: { task_id: 't' }, session: { project_id: 'p' }, approval: { task_id: 't' },
  };
  const root = tmpdir();
  const store = new ProjectStore(root, { id: 'proj-6' }).open();
  for (const [kind, data] of Object.entries(kinds)) {
    const rec = store.put(kind, data, { key: `k-${kind}` });
    assert.ok(rec.entity.id, `${kind} got no id`);
  }
  assert.throws(
    () => store.put('task', {}, { key: 'k-bad' }),
    (e) => e instanceof ProjectStoreError && e.code === 'invalid' && /title/.test(e.message),
  );
  for (let i = 0; i < 5; i++) store.put('task', { title: `t${i}` }, { key: `k-task-${i}` });
  const taskIds = Object.keys(store.snapshot('task'));
  assert.equal(taskIds.length, 6, 'expected the six task ids');
  assert.deepEqual([...taskIds].sort(), taskIds, 'task ids are not sortable');
  assert.equal(new Set(taskIds).size, taskIds.length, 'task ids are not unique');
  store.close();
  const store2 = new ProjectStore(root, { id: 'proj-6' }).open();
  const seen = [...store2.usedIds];
  const reused = store2.put('task', { title: 'again' }, { key: 'k-again' }).entity.id;
  assert.ok(!seen.includes(reused), 'an id was reused after a restart');
  store2.close();
});

test('SO-07-A AC07: one writer holds the lock and a second process is told to retry', async () => {
  const root = tmpdir();
  const id = 'proj-7';
  const dir = dirOf(root, id);
  // the holder: opens the store, takes the lock, sleeps, then appends and releases
  const holder = `
    import { ProjectStore } from ${JSON.stringify(path.resolve('src/engine/project-store.mjs'))};
    const store = new ProjectStore(process.env.PS_ROOT, { id: process.env.PS_ID, deviceId: 'holder' }).open();
    const done = store.withWrite((s) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 900) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); }
      return s.append({ type: 'task.created', key: 'holder-1', entity: { kind: 'task', data: { title: 'held' } } });
    });
    process.stdout.write(JSON.stringify({ busy: !!done?.busy, seq: done?.seq ?? null }));
  `;
  const contender = `
    import { ProjectStore } from ${JSON.stringify(path.resolve('src/engine/project-store.mjs'))};
    const store = new ProjectStore(process.env.PS_ROOT, { id: process.env.PS_ID, deviceId: 'contender' }).open();
    const first = store.append({ type: 'task.created', key: 'contender-1', entity: { kind: 'task', data: { title: 'retry' } } });
    const out = { busy: !!first?.busy, seq: first?.seq ?? null };
    if (first?.busy) {
      const t0 = Date.now();
      while (Date.now() - t0 < 2000) {
        const r = store.append({ type: 'task.created', key: 'contender-1', entity: { kind: 'task', data: { title: 'retry' } } });
        if (!r?.busy) { out.seq = r.seq; break; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const run = (code) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, PS_ROOT: root, PS_ID: id }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`child exited ${code}: ${err}`))));
  });
  const holderP = run(holder);
  await new Promise((r) => setTimeout(r, 300));
  const contenderOut = JSON.parse(await run(contender));
  const holderOut = JSON.parse(await holderP);
  assert.equal(holderOut.busy, false, 'the holder could not take the lock');
  assert.equal(contenderOut.busy, true, 'the contender was not told to retry while the lock was held');
  assert.ok(contenderOut.seq, 'the contender did not land after retrying');
  const recs = readLog(dir);
  for (const r of recs) assert.ok(r.key, 'a record has no key');
  assert.equal(recs.filter((r) => r.key === 'holder-1').length, 1, 'holder event not exactly once');
  assert.equal(recs.filter((r) => r.key === 'contender-1').length, 1, 'contender event not exactly once');
  assert.equal(recs.length, 2, `expected 2 records, got ${recs.length}`);
});
