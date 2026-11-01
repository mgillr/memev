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
import { ProjectStore, ProjectStoreError, SCHEMA_VERSION, ENTITY_KINDS, MERGE_CLASSES, APPROVAL_DECISIONS, TERMINAL_TASK_STATUSES, semanticConflicts } from '../src/engine/project-store.mjs';
import { TRANSITIONS } from '../src/engine/project-state.mjs';
import { SUBJECT_TYPES } from '../src/engine/identity.mjs';
import { recordHash } from '../src/engine/oplog.mjs';

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
      { authority: s.authority, scope_version_field: s.scope_version_field, merge_class: s.merge_class, file: s.file, id_prefix: s.id_prefix, required: s.required, provisional: s.provisional ?? {} },
      { authority: d.authority, scope_version_field: d.scopeVersionField, merge_class: d.mergeClass, file: d.file, id_prefix: d.prefix, required: d.required, provisional: d.provisional },
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
    // any import form and either quote, a path with or without the extension: from, side-effect import, import() and require()
    assert.ok(!/(?:from|import|require)\s*\(?\s*['"`][^'"`]*\/merge(?:\.mjs)?['"`]/.test(read(f)), `${f} does not reach the merge provider boundary`);
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
  assert.equal(store.snapshot('task')['task-1'].status, 'PROPOSED', 'the stored task is not changed');
  const task = store.view('task')['task-1'];
  assert.equal(task.status, 'CONFLICTED');
  assert.equal(task.prior_status, 'PROPOSED');
  assert.equal(task.conflict.kind, 'semantic');
  assert.deepEqual(task.conflict.events.slice().sort(), approvalEvents.map((r) => r.id).sort(), 'the record names both events');
  assert.deepEqual(task.conflict.approvals.slice().sort(), ['appr-a', 'appr-b']);
  assert.deepEqual(task.conflict.applied, [], 'neither approval is applied');
  assert.equal(task.approved, undefined);
  // a conflict entity carries the same record
  const confs = store.conflicts();
  assert.equal(confs.length, 1);
  assert.equal(Object.keys(store.snapshot('conflict')).length, 0, 'it is derived, not stored as an entity');
  assert.equal(Object.values(store.view('conflict')).filter((c) => c.kind === 'semantic').length, 1);
  assert.deepEqual(confs[0].events, task.conflict.events);
  // both inputs stay intact: the two approvals and their events, byte for byte
  assert.deepEqual(store.snapshot('approval')['appr-a'], { task_id: 'task-1', decision: 'approve', task_version: 1, by: 'person:p1' });
  assert.deepEqual(store.snapshot('approval')['appr-b'], { task_id: 'task-1', decision: 'reject', task_version: 2, by: 'person:p2' });
  assert.deepEqual(logLines(dir), before, 'opening the store wrote nothing to the log');
  store.close();
  // the snapshot on disk holds the stored task, and the derivation is the same on the next open
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).entities['task-1'];
  assert.equal(onDisk.status, 'PROPOSED');
  assert.equal(onDisk.conflict, undefined);
  const again = new ProjectStore(root, { id, deviceId: 'dev-a' }).open();
  assert.deepEqual(again.view('task')['task-1'], task, 'the derivation is repeatable');
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
  assert.equal(store.view('task')['task-1'].status, 'PROPOSED');
  assert.equal(store.view('task')['task-1'].conflict, undefined);
  assert.equal(Object.keys(store.view('conflict')).length, 0);
  // an incompatible one arrives live: the conflict appears at once, without a reopen, and the caller's record is not touched
  const rec = store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-3', data: { task_id: 'task-1', decision: 'reject', task_version: 3 } } });
  assert.equal(store.view('task')['task-1'].status, 'CONFLICTED');
  assert.equal(store.snapshot('task')['task-1'].status, 'PROPOSED', 'the stored task is not changed');
  assert.equal(rec.entity.data.decision, 'reject');
  assert.equal(store.view('task')['task-1'].conflict.events.length, 3, 'every live approval of the task is named');
  store.close();
});

test('SO-F-02 AC03: a resolving approval ends the conflict, and the log still holds both inputs', () => {
  const { root, id, dir } = convergedStore();
  const store = new ProjectStore(root, { id, deviceId: 'dev-a' }).open();
  const both = store.view('task')['task-1'].conflict.events;
  assert.equal(both.length, 2);
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr-r', data: { task_id: 'task-1', decision: 'approve', task_version: 2, resolves: both, by: 'person:p1' } } });
  const task = store.view('task')['task-1'];
  assert.equal(task.status, 'PROPOSED', 'the stored state shows again, and nothing was applied on the way');
  assert.equal(task.conflict, undefined);
  assert.equal(store.conflicts().length, 0);
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

test('SO-F-02 AC05: docs/PROJECTS.md lists every entity type with its authority owner and merge class, and names the rule', () => {
  const page = read('docs/PROJECTS.md');
  for (const [kind, d] of Object.entries(ENTITY_KINDS)) {
    assert.ok(page.includes(`| \`${kind}\` | \`${d.authority}\` | \`${d.mergeClass}\` |`), `${kind} is in the table with ${d.authority} and ${d.mergeClass}`);
  }
  for (const c of MERGE_CLASSES) assert.ok(page.includes(`\`${c}\``), `${c} is described`);
  assert.match(page, /merge class/);
  assert.match(page, /## The semantic conflict rule/);
  assert.match(page, /applies neither approval/);
  assert.match(page, /not the memory authority of ADR 7/);
  assert.match(page, /not the permission matrix of ADR 5/);
  assert.match(page, /newest in log order/);
  assert.match(page, /tie is broken by the merge provider/);
  assert.match(page, /Only approvals are surfaced today/);
  assert.match(page, /ADR 3 \(lease semantics\)/);
  for (const [kind, d] of Object.entries(ENTITY_KINDS)) {
    if (Object.keys(d.provisional).length) assert.ok(new RegExp(`\\| \`${kind}\` \\|[^\\n]*provisional`).test(page), `${kind} is marked provisional in the table`);
  }
});

// ---- review response: tests that pin the declarations and the conflict rule by behaviour ----

const open = (id) => new ProjectStore(tmpdir(), { id }).open();
const putTask = (s, id, status = 'PROPOSED') => s.append({ type: 'task.upserted', entity: { kind: 'task', id, data: { title: id, status } } });
const putAppr = (s, id, task, decision, extra = {}) => s.append({ type: 'approval.upserted', entity: { kind: 'approval', id, data: { task_id: task, decision, ...extra } } });
const semanticOf = (s) => s.conflicts();
// a record that arrived by convergence from another log: it was never checked by this store's write path
function injectApproval(store, dir, id, data) {
  const last = readLog(dir).at(-1);
  const rec = { ...last, seq: last.seq + 1, id: `evt_injected_${id}`, entity: { kind: 'approval', id, data }, hash: null };
  rec.hash = recordHash(rec);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(rec)}\n`);
  return rec;
}

test('SO-F-02 AC02: each entity type pins its authority owner and merge class, so a flip of any one fails', () => {
  const expected = {
    project: ['person', 'last-writer'],
    task: ['person', 'human-resolution'],
    lease: ['service', 'human-resolution'],
    attempt: ['agent', 'append-only'],
    evidence: ['service', 'append-only'],
    conflict: ['person', 'human-resolution'],
    session: ['device', 'last-writer'],
    approval: ['person', 'human-resolution'],
    event: ['service', 'append-only'],
  };
  assert.deepEqual(Object.keys(ENTITY_KINDS).sort(), Object.keys(expected).sort());
  for (const [kind, [authority, mergeClass]] of Object.entries(expected)) {
    assert.equal(ENTITY_KINDS[kind].authority, authority, `${kind} owner`);
    assert.equal(ENTITY_KINDS[kind].mergeClass, mergeClass, `${kind} class`);
    assert.equal(SCHEMA.entities[kind].authority, authority, `${kind} owner in the schema`);
    assert.equal(SCHEMA.entities[kind].merge_class, mergeClass, `${kind} class in the schema`);
  }
  // a decision a person settles is never a last-writer type
  for (const kind of ['approval', 'conflict', 'task', 'lease']) assert.equal(ENTITY_KINDS[kind].mergeClass, 'human-resolution', kind);
  for (const kind of ['event', 'evidence', 'attempt']) assert.equal(ENTITY_KINDS[kind].mergeClass, 'append-only', kind);
});

test('SO-F-02 AC02: a type declared through kinds cannot take the name of a built-in type', () => {
  const root = tmpdir();
  assert.throws(
    () => new ProjectStore(root, { id: 'p-shadow', kinds: { approval: { ...ENTITY_KINDS.approval, mergeClass: 'last-writer' } } }),
    (e) => e instanceof ProjectStoreError && e.code === 'bad_declaration' && /approval/.test(e.message),
  );
});

test('SO-F-02 AC03: a resolution is honoured only for its own task, so another task cannot clear a conflict', () => {
  const pure = [ev('a', 't1', 'approve', 1), ev('b', 't1', 'reject', 1), ev('r', 't2', 'approve', 1, { resolves: ['evt-a', 'evt-b'] })];
  assert.equal(semanticConflicts(pure).length, 1, 'an approval on t2 does not resolve t1');
  const s = open('p-cross');
  putTask(s, 'task-1'); putTask(s, 'task-2');
  const a = putAppr(s, 'a', 'task-1', 'approve');
  const b = putAppr(s, 'b', 'task-1', 'reject');
  assert.throws(() => putAppr(s, 'r', 'task-2', 'approve', { resolves: [a.id, b.id] }), (e) => e.code === 'invalid' && /task/.test(e.message), 'refused at write time');
  assert.equal(semanticOf(s).length, 1, 'task-1 is still in conflict');
  s.close();
});

test('SO-F-02 AC03: a resolution must name both sides, so one side cannot be dropped alone', () => {
  const base = [ev('a', 't1', 'approve', 1), ev('b', 't1', 'reject', 1)];
  assert.equal(semanticConflicts([...base, ev('r', 't1', 'approve', 1, { resolves: ['evt-b'] })]).length, 1, 'naming only the reject resolves nothing');
  assert.equal(semanticConflicts([...base, ev('r', 't1', 'reject', 1, { resolves: ['evt-a'] })]).length, 1, 'naming only the approve resolves nothing');
  assert.equal(semanticConflicts([...base, ev('r', 't1', 'approve', 1, { resolves: ['evt-a', 'evt-b'] })]).length, 0, 'naming both resolves it');
  const s = open('p-sides');
  putTask(s, 'task-1');
  const a = putAppr(s, 'a', 'task-1', 'approve');
  const b = putAppr(s, 'b', 'task-1', 'reject');
  assert.throws(() => putAppr(s, 'r', 'task-1', 'approve', { resolves: [b.id] }), (e) => e.code === 'invalid', 'one-sided, refused at write time');
  assert.equal(semanticOf(s).length, 1);
  assert.ok(putAppr(s, 'r', 'task-1', 'approve', { resolves: [a.id, b.id] }), 'both sides is accepted');
  assert.equal(semanticOf(s).length, 0);
  s.close();
});

test('SO-F-02 AC03: a resolves entry must be an approval event of the same task, and a resolving approval carries a decision', () => {
  const s = open('p-valid');
  putTask(s, 'task-1');
  const a = putAppr(s, 'a', 'task-1', 'approve');
  const b = putAppr(s, 'b', 'task-1', 'reject');
  for (const [name, resolves] of [['an id no event has', [a.id, 'evt_nope']], ['an approval id, not an event id', ['a', 'b']], ['an empty list', []]]) {
    assert.throws(() => putAppr(s, 'r', 'task-1', 'approve', { resolves }), (e) => e.code === 'invalid' && /resolves/.test(e.message), name);
  }
  assert.throws(() => s.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'r', data: { task_id: 'task-1', resolves: [a.id, b.id] } } }), (e) => e.code === 'invalid' && /decision/.test(e.message));
  const t = s.append({ type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { title: 'again' } } });
  assert.throws(() => putAppr(s, 'r', 'task-1', 'approve', { resolves: [a.id, t.id] }), (e) => e.code === 'invalid', 'a task event is no approval event');
  s.close();
});

test('SO-F-02 AC03: approvals are keyed by event, so two writes with one id, one approving and one rejecting, are a conflict', () => {
  const s = open('p-sameid');
  putTask(s, 'task-1');
  putAppr(s, 'appr-1', 'task-1', 'approve');
  putAppr(s, 'appr-1', 'task-1', 'reject');
  const [c] = semanticOf(s);
  assert.ok(c, 'the conflict is not hidden by the shared id');
  assert.equal(c.events.length, 2);
  assert.deepEqual(c.decisions.slice().sort(), ['approve', 'reject']);
  s.close();
});

test('SO-F-02 AC03: a conflict never writes CONFLICTED into the stored task, and a terminal task is not revived', () => {
  const s = open('p-term');
  putTask(s, 'task-1', 'CANCELLED');
  putAppr(s, 'a', 'task-1', 'approve');
  putAppr(s, 'b', 'task-1', 'reject');
  assert.equal(s.snapshot('task')['task-1'].status, 'CANCELLED', 'a cancelled task stays cancelled');
  s.close();
  const s2 = open('p-spread');
  putTask(s2, 'task-1');
  const a = putAppr(s2, 'a', 'task-1', 'approve');
  const b = putAppr(s2, 'b', 'task-1', 'reject');
  // what the coordinator does: read the task, spread it, write it back
  s2.append({ type: 'task.upserted', entity: { kind: 'task', id: 'task-1', data: { ...s2.snapshot('task')['task-1'], note: 'touched' } } });
  const stored = readLog(s2.dir).filter((r) => r.entity?.kind === 'task').map((r) => r.entity.data);
  for (const d of stored) {
    assert.notEqual(d.status, 'CONFLICTED', 'no stored task is CONFLICTED');
    assert.equal(d.conflict, undefined, 'no conflict record is stored on a task');
    assert.equal(d.prior_status, undefined);
  }
  putAppr(s2, 'r', 'task-1', 'approve', { resolves: [a.id, b.id] });
  assert.equal(s2.snapshot('task')['task-1'].status, 'PROPOSED');
  s2.close();
  const s3 = new ProjectStore(s2.root, { id: 'p-spread' }).open();
  assert.equal(s3.snapshot('task')['task-1'].status, 'PROPOSED', 'the task is not left CONFLICTED across a reopen');
  s3.close();
});

test('SO-F-02 AC03: replay checks an approval that arrived by convergence, and reports one it cannot use', () => {
  const s = open('p-replay');
  putTask(s, 'task-1');
  putAppr(s, 'a', 'task-1', 'approve');
  s.close();
  injectApproval(s, s.dir, 'b', { task_id: 'task-1', decision: 'maybe' });
  const s2 = new ProjectStore(s.root, { id: 'p-replay' }).open();
  assert.ok(s2.stats().recovered.some((m) => /maybe/.test(m) && /approval/.test(m)), 'the decision it cannot use is reported, not silently ignored');
  assert.equal(semanticOf(s2).length, 0, 'it is not a decision');
  assert.deepEqual(s2.snapshot('approval').b, { task_id: 'task-1', decision: 'maybe' }, 'and it stays in the log as it arrived');
  s2.close();
});

test('SO-F-02 AC03: replay ignores a resolution from another task that arrived by convergence', () => {
  const s = open('p-replay2');
  putTask(s, 'task-1'); putTask(s, 'task-2');
  const a = putAppr(s, 'a', 'task-1', 'approve');
  const b = putAppr(s, 'b', 'task-1', 'reject');
  s.close();
  injectApproval(s, s.dir, 'r', { task_id: 'task-2', decision: 'approve', resolves: [a.id, b.id] });
  const s2 = new ProjectStore(s.root, { id: 'p-replay2' }).open();
  assert.equal(semanticOf(s2).length, 1, 'task-1 is still in conflict');
  assert.ok(s2.stats().recovered.some((m) => /resolves/.test(m)), 'the resolution that was ignored is reported');
  s2.close();
});

test('SO-F-02 AC02: provisional declarations are named and carry a reason', () => {
  const prov = Object.fromEntries(Object.entries(ENTITY_KINDS).filter(([, d]) => Object.keys(d.provisional).length).map(([k, d]) => [k, Object.keys(d.provisional).sort()]));
  assert.deepEqual(prov, { lease: ['authority', 'merge_class'], evidence: ['authority'], event: ['authority'] });
  for (const d of Object.values(ENTITY_KINDS)) for (const r of Object.values(d.provisional)) assert.ok(r.length > 20);
  assert.match(ENTITY_KINDS.lease.provisional.merge_class, /ADR 3/);
  assert.match(ENTITY_KINDS.lease.provisional.authority, /service subject/);
  assert.ok(!Object.values(ENTITY_KINDS).some((d) => d.authority !== 'service' && d.provisional.authority), 'only the service owner is provisional');
});

test('SO-F-02 AC02: the schema file validates against itself', () => {
  // no validator library is a dependency, so the checks the schema makes of its own declarations are made here by hand
  const top = SCHEMA.properties;
  for (const k of SCHEMA.required) assert.ok(Object.hasOwn(SCHEMA, k), `the file has ${k}`);
  assert.equal(SCHEMA.schema, top.schema.const);
  assert.equal(SCHEMA.store_schema_version, top.store_schema_version.const);
  for (const k of Object.keys(SCHEMA)) assert.ok(Object.hasOwn(top, k), `${k} is a key the schema allows at the top`);
  const decl = SCHEMA.$defs.entityDeclaration;
  for (const [kind, e] of Object.entries(SCHEMA.entities)) {
    for (const k of decl.required) assert.ok(Object.hasOwn(e, k), `${kind} has ${k}`);
    for (const k of Object.keys(e)) assert.ok(Object.hasOwn(decl.properties, k), `${kind}: ${k} is a declared key`);
    assert.ok(SCHEMA.$defs.authority.enum.includes(e.authority));
    assert.ok(SCHEMA.$defs.mergeClass.enum.includes(e.merge_class));
    assert.match(e.scope_version_field, new RegExp(decl.properties.scope_version_field.pattern));
    for (const f of Object.keys(e.provisional ?? {})) assert.ok(decl.properties.provisional.propertyNames.enum.includes(f));
  }
  assert.deepEqual(SCHEMA.$defs.approval.properties.decision.enum, APPROVAL_DECISIONS);
  assert.match(SCHEMA.$defs.approval.properties.decision.description, /Provisional/);
});

test('SO-F-02 AC03: a terminal task is one the state machine has no move out of', () => {
  const terminal = Object.entries(TRANSITIONS).filter(([, to]) => to.length === 0).map(([from]) => from).sort();
  assert.deepEqual(terminal, TERMINAL_TASK_STATUSES.slice().sort());
});

test('SO-F-02 AC03: the derived view shows CONFLICTED on a live task and leaves a terminal one as it is', () => {
  const s = open('p-view');
  putTask(s, 'task-1', 'IN_PROGRESS'); putTask(s, 'task-2', 'CANCELLED');
  for (const t of ['task-1', 'task-2']) { putAppr(s, `a-${t}`, t, 'approve'); putAppr(s, `b-${t}`, t, 'reject'); }
  const v = s.view('task');
  assert.equal(v['task-1'].status, 'CONFLICTED');
  assert.equal(v['task-1'].prior_status, 'IN_PROGRESS');
  assert.equal(v['task-2'].status, 'CANCELLED', 'never applied to a terminal task');
  assert.equal(s.conflicts().length, 2, 'both conflicts are still surfaced');
  assert.equal(s.snapshot('task')['task-1'].status, 'IN_PROGRESS', 'the stored task is not changed');
  assert.equal(s.snapshot('task')['task-1'].conflict, undefined);
  s.view('task')['task-1'].status = 'DONE';
  assert.equal(s.snapshot('task')['task-1'].status, 'IN_PROGRESS', 'a view is a copy');
  s.close();
});

test('SO-F-02 AC03: terminal means an empty row of the transition table, so VERIFIED, FAILED and legacy DONE show as CONFLICTED', () => {
  const s = open('p-view2');
  const statuses = ['VERIFIED', 'FAILED', 'DONE', 'CANCELLED'];
  statuses.forEach((st, i) => { putTask(s, `task-${i}`, st); putAppr(s, `a${i}`, `task-${i}`, 'approve'); putAppr(s, `b${i}`, `task-${i}`, 'reject'); });
  const v = s.view('task');
  assert.deepEqual(statuses.map((_, i) => v[`task-${i}`].status), ['CONFLICTED', 'CONFLICTED', 'CONFLICTED', 'CANCELLED']);
  assert.deepEqual(statuses.slice(0, 3).map((_, i) => v[`task-${i}`].prior_status), ['VERIFIED', 'FAILED', 'DONE']);
  assert.ok(TRANSITIONS.VERIFIED.length > 0 && TRANSITIONS.FAILED.length > 0 && !Object.hasOwn(TRANSITIONS, 'DONE'));
  s.close();
});

test('SO-F-02 AC03: one person who changes their mind, and a stale version, are conflicts until a resolution names both events', () => {
  const s = open('p-mind');
  putTask(s, 'task-1');
  const a = putAppr(s, 'a', 'task-1', 'approve', { task_version: 1, by: 'person:p1' });
  const b = putAppr(s, 'b', 'task-1', 'reject', { task_version: 2, by: 'person:p1' });
  assert.equal(s.conflicts().length, 1, 'a change of mind is a conflict');
  putAppr(s, 'r', 'task-1', 'reject', { task_version: 2, resolves: [a.id, b.id], by: 'person:p1' });
  assert.equal(s.conflicts().length, 0);
  putAppr(s, 'c', 'task-1', 'approve', { task_version: 1 });
  assert.equal(s.conflicts().length, 1, 'a later approval of an old version still counts, and conflicts with the resolving reject');
  s.close();
});

test('SO-F-02 AC03: the docs and the changelog say the conflict is surfaced, not enforced, and what will read it', () => {
  for (const [name, text] of [['docs/PROJECTS.md', read('docs/PROJECTS.md')], ['changelog.d/SO-F-02.md', read('changelog.d/SO-F-02.md')]]) {
    assert.match(text, /surfaced and not enforced/, name);
    assert.match(text, /SO-1\.01 wiring will (?:make the coordinator )?consume `view\('task'\)` and `conflicts\(\)`/, name);
    assert.match(text, /`?claim`?, (?:the )?eligibility(?: check)?, `?status`?/, name);
    assert.match(text, /around `_tasksOf`/, name);
    assert.match(text, /snapshot\(\)/, name);
    assert.match(text, /can still be claimed, reported, reassigned or cancelled/, name);
    assert.match(text, /VERIFIED/, name);
    assert.match(text, /DONE/, name);
  }
});

test('SO-F-02 AC03: the resolver is not checked, and the documentation says so', () => {
  const s = open('p-by');
  putTask(s, 'task-1');
  const a = putAppr(s, 'a', 'task-1', 'approve', { by: 'person:p1' });
  const b = putAppr(s, 'b', 'task-1', 'reject', { by: 'person:p2' });
  putAppr(s, 'r', 'task-1', 'approve', { resolves: [a.id, b.id], by: 'agent:x' });
  assert.equal(s.conflicts().length, 0, 'a decision on who may settle is not made here');
  s.close();
  const page = read('docs/PROJECTS.md');
  assert.match(page, /Who may settle a conflict is not checked/);
  assert.match(page, /any writer can settle a conflict by naming both sides/);
  assert.match(page, /ADR 5 \(the permission matrix, open\) or SO-03-A should close that/);
});
