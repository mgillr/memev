// SPDX-License-Identifier: Apache-2.0
// SO-F-02: the canonical project schema, version 1. Every entity type declares its owner authority, its scope version
// field and its merge class; the store refuses an entity of a type that has no merge class; and two incompatible approval
// events on different versions derive to a semantic conflict, never to an applied state. Test names start with the id the
// contract's checks select on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { ProjectStore, ProjectStoreError, SCHEMA_VERSION, ENTITY_KINDS, MERGE_CLASSES, semanticConflicts } from '../src/engine/project-store.mjs';
import { SUBJECT_TYPES } from '../src/engine/identity.mjs';

after(cleanup);

const SCHEMA = JSON.parse(fs.readFileSync(path.join(PKG, 'docs', 'schemas', 'project-v1.json'), 'utf8'));
const dirOf = (root, id) => path.join(root, '.memev', 'projects', id);
const logLines = (dir) => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
const readLog = (dir) => logLines(dir).map((l) => JSON.parse(l));
const read = (rel) => fs.readFileSync(path.join(PKG, rel), 'utf8');

test('SO-F-02 AC02: every entity type in the schema declares an authority owner, a scope version field and a merge class', () => {
  assert.equal(SCHEMA.properties.schema.const, 'memev-project/1');
  assert.deepEqual(SCHEMA.$defs.mergeClass.enum, MERGE_CLASSES);
  assert.deepEqual(MERGE_CLASSES, ['last-writer', 'set-union', 'append-only', 'human-resolution']);
  assert.deepEqual(SCHEMA.$defs.authority.enum, SUBJECT_TYPES, 'an authority owner is a subject type of the identity model');
  assert.deepEqual(SCHEMA.$defs.entityDeclaration.required.slice().sort(), ['authority', 'merge_class', 'scope_version_field']);
  assert.deepEqual(Object.keys(SCHEMA.entities).sort(), Object.keys(ENTITY_KINDS).sort(), 'the schema and the store name the same entity types');
  assert.equal(Object.keys(ENTITY_KINDS).length, 9);
  for (const [kind, d] of Object.entries(ENTITY_KINDS)) {
    const s = SCHEMA.entities[kind];
    assert.ok(SUBJECT_TYPES.includes(d.authority), `${kind}: authority ${d.authority}`);
    assert.ok(MERGE_CLASSES.includes(d.mergeClass), `${kind}: merge class ${d.mergeClass}`);
    assert.match(d.scopeVersionField, /^[a-z_]+$/, `${kind}: scope version field`);
    assert.deepEqual(
      { authority: s.authority, scope_version_field: s.scope_version_field, merge_class: s.merge_class, file: s.file, id_prefix: s.id_prefix, required: s.required },
      { authority: d.authority, scope_version_field: d.scopeVersionField, merge_class: d.mergeClass, file: d.file, id_prefix: d.prefix, required: d.required },
      `${kind}: the schema and the store declare the same thing`,
    );
  }
  assert.equal(SCHEMA.store_schema_version, SCHEMA_VERSION);
  assert.ok(Object.isFrozen(ENTITY_KINDS) && Object.values(ENTITY_KINDS).every(Object.isFrozen), 'the declarations cannot be changed at run time');
});

test('SO-F-02 AC02: the store refuses an entity of a type that has no merge class', () => {
  const root = tmpdir();
  const bad = { note: { file: 'notes.json', prefix: 'note', required: ['text'], authority: 'person', scopeVersionField: 'scope_version' } };
  const store = new ProjectStore(root, { id: 'p-class', kinds: bad }).open();
  assert.throws(() => store.put('note', { text: 'x' }), (e) => e instanceof ProjectStoreError && e.code === 'no_merge_class' && /note/.test(e.message));
  const written = fs.existsSync(path.join(dirOf(root, 'p-class'), 'events.jsonl')) ? readLog(dirOf(root, 'p-class')) : [];
  assert.equal(written.some((r) => r.entity?.kind === 'note'), false, 'nothing was written');
  store.close();
  for (const [name, patch] of [['an unknown class', { mergeClass: 'newest-wins' }], ['no authority', { mergeClass: 'append-only', authority: undefined }], ['an authority that is no subject type', { mergeClass: 'append-only', authority: 'robot' }]]) {
    const root2 = tmpdir();
    const s = new ProjectStore(root2, { id: 'p-class2', kinds: { note: { ...bad.note, ...patch } } }).open();
    assert.throws(() => s.put('note', { text: 'x' }), (e) => e instanceof ProjectStoreError && /^(no_merge_class|bad_declaration)$/.test(e.code), name);
    s.close();
  }
  const root3 = tmpdir();
  const ok = new ProjectStore(root3, { id: 'p-class3', kinds: { note: { ...bad.note, mergeClass: 'append-only' } } }).open();
  assert.ok(ok.put('note', { text: 'x' }).entity.id, 'a type with a merge class is accepted');
  ok.close();
  // the nine built-in types all have one, so the ordinary kinds keep working
  const root4 = tmpdir();
  const plain = new ProjectStore(root4, { id: 'p-class4' }).open();
  assert.ok(plain.put('task', { title: 'a' }).entity.id);
  assert.throws(() => plain.put('galaxy', { x: 1 }), (e) => e.code === 'invalid');
  plain.close();
});

test('SO-F-02 AC02: a scope version, when an entity carries one, is a positive whole number', () => {
  const root = tmpdir();
  const store = new ProjectStore(root, { id: 'p-sv' }).open();
  for (const v of [0, -1, 1.5, '2', null]) {
    assert.throws(() => store.put('task', { title: 't', scope_version: v }), (e) => e.code === 'invalid' && /scope_version/.test(e.message), String(v));
  }
  assert.ok(store.put('task', { title: 't', scope_version: 2 }));
  assert.ok(store.put('task', { title: 'no field' }), 'an entity with no scope version is still accepted');
  store.close();
});

test('SO-F-02 AC02: a migration carries the schema version, in the file and on every record', () => {
  const root = tmpdir();
  const dir = dirOf(root, 'p-mig');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schema_version: 1, project_id: 'p-mig' }) + '\n');
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ schema_version: 1, entities: { task_old: { title: 'old' } } }) + '\n');
  const store = new ProjectStore(root, { id: 'p-mig' }).open();
  const log = readLog(dir);
  assert.ok(log.length >= 2);
  for (const r of log) assert.equal(r.schema_version, SCHEMA_VERSION, `record ${r.type} carries the schema version`);
  const m = log.find((r) => r.type === 'schema.migrated');
  assert.deepEqual([m.from, m.to], [1, SCHEMA_VERSION]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).schema_version, SCHEMA_VERSION);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).schema_version, SCHEMA_VERSION);
  assert.equal(SCHEMA.store_schema_version, SCHEMA_VERSION, 'the schema names the store version the migrations end at');
  store.close();
});

test('SO-F-02 AC02: the core applies no merge class itself, and the free path keeps both versions', () => {
  for (const f of ['src/engine/project-store.mjs', 'src/engine/project-state.mjs']) {
    assert.ok(!/from '\.\/merge\.mjs'|import\(['"]\.\/merge\.mjs/.test(read(f)), `${f} does not reach the merge provider boundary`);
    assert.ok(!/crdt-merge/.test(read(f).replace(/\/\/.*$/gm, '')), `${f} holds no merge engine`);
  }
  const root = tmpdir();
  const dir = dirOf(root, 'p-both');
  const store = new ProjectStore(root, { id: 'p-both' }).open();
  store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { title: 'one', labels: ['a'] } }, agent: 'x' });
  store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { title: 'two', labels: ['b'] } }, agent: 'y' });
  // both versions are kept in the log; the snapshot shows the later one as it is, with no union of the two labels
  const versions = readLog(dir).filter((r) => r.entity?.id === 'task-1').map((r) => r.entity.data.title);
  assert.deepEqual(versions, ['one', 'two']);
  assert.deepEqual(store.snapshot('task')['task-1'].labels, ['b']);
  store.close();
});

const ev = (id, task, decision, version, extra = {}) => ({ event: `evt-${id}`, id: `appr-${id}`, task_id: task, decision, task_version: version, ...extra });

test('SO-F-02 AC03: two incompatible approvals on different versions are one semantic conflict naming both events', () => {
  const [c, ...rest] = semanticConflicts([ev('a', 't1', 'approve', 1), ev('b', 't1', 'reject', 2)]);
  assert.equal(rest.length, 0);
  assert.equal(c.kind, 'semantic');
  assert.equal(c.task_id, 't1');
  assert.deepEqual(c.events, ['evt-a', 'evt-b']);
  assert.deepEqual(c.approvals, ['appr-a', 'appr-b']);
  assert.deepEqual(c.task_versions, [1, 2]);
  assert.deepEqual(c.applied, [], 'neither approval is applied');
  assert.match(c.reason, /incompatible/);
  // the order of the events decides nothing about who is named: both are
  assert.deepEqual(semanticConflicts([ev('b', 't1', 'reject', 2), ev('a', 't1', 'approve', 1)])[0].events.slice().sort(), ['evt-a', 'evt-b']);
  // compatible, single, other-task, undecided and resolved approvals are not conflicts
  assert.deepEqual(semanticConflicts([ev('a', 't1', 'approve', 1), ev('b', 't1', 'approve', 2)]), []);
  assert.deepEqual(semanticConflicts([ev('a', 't1', 'approve', 1)]), []);
  assert.deepEqual(semanticConflicts([ev('a', 't1', 'approve', 1), ev('b', 't2', 'reject', 1)]), []);
  assert.deepEqual(semanticConflicts([ev('a', 't1', 'approve', 1), { event: 'evt-n', id: 'appr-n', task_id: 't1', note: 'no decision' }]), []);
  assert.deepEqual(semanticConflicts([ev('a', 't1', 'approve', 1), ev('b', 't1', 'reject', 2), ev('r', 't1', 'approve', 2, { resolves: ['evt-a', 'evt-b'] })]), []);
  assert.equal(semanticConflicts([ev('a', 't1', 'approve', 1), ev('b', 't1', 'reject', 2), ev('r', 't1', 'approve', 2, { resolves: ['evt-a'] })]).length, 1, 'a resolution that leaves one side standing resolves nothing');
  assert.equal(semanticConflicts([ev('a', 't1', 'approve', 1), ev('b', 't2', 'reject', 1), ev('c', 't1', 'reject', 1), ev('d', 't2', 'approve', 2)]).length, 2, 'one conflict per task');
  assert.deepEqual(semanticConflicts([]), []);
});

// Two computers share a project, each records one approval, and the logs converge by one appending the other's new lines.
function convergedStore() {
  const rootA = tmpdir(); const rootB = tmpdir();
  const id = 'p-conv';
  const a = new ProjectStore(rootA, { id, deviceId: 'dev-a' }).open();
  a.append({ type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { title: 'ship it', status: 'PROPOSED', scope_version: 1, version: 1 } } });
  a.close();
  fs.mkdirSync(dirOf(rootB, id), { recursive: true });
  for (const f of ['events.jsonl', 'meta.json']) fs.copyFileSync(path.join(dirOf(rootA, id), f), path.join(dirOf(rootB, id), f));
  const shared = logLines(dirOf(rootA, id)).length;
  const sa = new ProjectStore(rootA, { id, deviceId: 'dev-a' }).open();
  sa.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-a', data: { task_id: 'task-1', decision: 'approve', task_version: 1, by: 'person:p1' } } });
  sa.close();
  const sb = new ProjectStore(rootB, { id, deviceId: 'dev-b' }).open();
  sb.append({ type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { title: 'ship it', status: 'PROPOSED', scope_version: 2, version: 2 } } });
  sb.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-b', data: { task_id: 'task-1', decision: 'reject', task_version: 2, by: 'person:p2' } } });
  sb.close();
  const foreign = logLines(dirOf(rootB, id)).slice(shared);
  fs.appendFileSync(path.join(dirOf(rootA, id), 'events.jsonl'), `${foreign.join('\n')}\n`);
  return { root: rootA, id, dir: dirOf(rootA, id), shared };
}

test('SO-F-02 AC03: converging two incompatible approval events gives CONFLICTED with a record naming both, and both inputs stay intact', () => {
  const { root, id, dir } = convergedStore();
  const before = logLines(dir);
  const approvalEvents = readLog(dir).filter((r) => r.entity?.kind === 'approval');
  assert.equal(approvalEvents.length, 2);
  const store = new ProjectStore(root, { id, deviceId: 'dev-a' }).open();
  const task = store.snapshot('task')['task-1'];
  assert.equal(task.status, 'CONFLICTED');
  assert.equal(task.prior_status, 'PROPOSED');
  assert.equal(task.conflict.kind, 'semantic');
  assert.deepEqual(task.conflict.events.slice().sort(), approvalEvents.map((r) => r.id).sort(), 'the record names both events');
  assert.deepEqual(task.conflict.approvals.slice().sort(), ['appr-a', 'appr-b']);
  assert.deepEqual(task.conflict.applied, [], 'neither approval is applied');
  assert.equal(task.approved, undefined);
  // a conflict entity carries the same record
  const confs = Object.values(store.snapshot('conflict')).filter((c) => c.kind === 'semantic');
  assert.equal(confs.length, 1);
  assert.deepEqual(confs[0].events, task.conflict.events);
  // both inputs stay intact: the two approvals and their events, byte for byte
  assert.deepEqual(store.snapshot('approval')['appr-a'], { task_id: 'task-1', decision: 'approve', task_version: 1, by: 'person:p1' });
  assert.deepEqual(store.snapshot('approval')['appr-b'], { task_id: 'task-1', decision: 'reject', task_version: 2, by: 'person:p2' });
  assert.deepEqual(logLines(dir), before, 'opening the store wrote nothing to the log');
  store.close();
  // the snapshot on disk shows the derived state, and the log still wins on the next open
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).entities['task-1'].status, 'CONFLICTED');
  const again = new ProjectStore(root, { id, deviceId: 'dev-a' }).open();
  assert.deepEqual(again.snapshot('task')['task-1'], task, 'the derivation is repeatable');
  assert.deepEqual(logLines(dir), before);
  again.close();
});

test('SO-F-02 AC03: a state with only one approval, or compatible ones, is not a conflict', () => {
  const root = tmpdir();
  const store = new ProjectStore(root, { id: 'p-ok' }).open();
  store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { title: 't', status: 'PROPOSED' } } });
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-1', data: { task_id: 'task-1', decision: 'approve', task_version: 1 } } });
  assert.equal(store.snapshot('task')['task-1'].status, 'PROPOSED');
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-2', data: { task_id: 'task-1', decision: 'approve', task_version: 2 } } });
  assert.equal(store.snapshot('task')['task-1'].status, 'PROPOSED');
  assert.equal(store.snapshot('task')['task-1'].conflict, undefined);
  assert.equal(Object.keys(store.snapshot('conflict')).length, 0);
  // an incompatible one arrives live: the conflict appears at once, without a reopen, and the caller's record is not touched
  const rec = store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-3', data: { task_id: 'task-1', decision: 'reject', task_version: 3 } } });
  assert.equal(store.snapshot('task')['task-1'].status, 'CONFLICTED');
  assert.equal(rec.entity.data.decision, 'reject');
  assert.equal(store.snapshot('task')['task-1'].conflict.events.length, 3, 'every live approval of the task is named');
  store.close();
});

test('SO-F-02 AC03: a resolving approval ends the conflict, and the log still holds both inputs', () => {
  const { root, id, dir } = convergedStore();
  const store = new ProjectStore(root, { id, deviceId: 'dev-a' }).open();
  const both = store.snapshot('task')['task-1'].conflict.events;
  assert.equal(both.length, 2);
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-r', data: { task_id: 'task-1', decision: 'approve', task_version: 2, resolves: both, by: 'person:p1' } } });
  const task = store.snapshot('task')['task-1'];
  assert.equal(task.status, 'PROPOSED', 'the stored state is back, and nothing was applied on the way');
  assert.equal(task.conflict, undefined);
  assert.equal(Object.values(store.snapshot('conflict')).filter((c) => c.kind === 'semantic').length, 0);
  const inLog = readLog(dir).filter((r) => r.entity?.kind === 'approval').map((r) => r.entity.id).sort();
  assert.deepEqual(inLog, ['appr-a', 'appr-b', 'appr-r']);
  store.close();
});

test('SO-F-02 AC03: an approval names a decision the schema knows, or none', () => {
  const root = tmpdir();
  const store = new ProjectStore(root, { id: 'p-dec' }).open();
  assert.throws(() => store.put('approval', { task_id: 't', decision: 'maybe' }), (e) => e.code === 'invalid' && /decision/.test(e.message));
  assert.throws(() => store.put('approval', { task_id: 't', decision: 'approve', resolves: 'evt-1' }), (e) => e.code === 'invalid' && /resolves/.test(e.message));
  assert.ok(store.put('approval', { task_id: 't', decision: 'reject' }));
  assert.ok(store.put('approval', { task_id: 't', note: 'an approval from before the decision field' }), 'an older approval with no decision is still accepted');
  store.close();
});
