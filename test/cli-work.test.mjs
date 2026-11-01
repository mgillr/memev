// PG-19.2: the work command is dispatched to runWork from src/cli/main.mjs, and runWork reads project data through a port that goes
// through Vault#tasksReader, a read-only reader with one member. WP19-01 tests cover the dispatch and the port; PG-19.2 WP19-03 tests cover the reader.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { newVault, cleanup, PKG } from './helpers/tmp.mjs';
import { addEntity, link } from '../src/engine/relationships.mjs';
after(cleanup);

const read = (f) => fs.readFileSync(path.join(PKG, f), 'utf8');
const MAIN = () => read('src/cli/main.mjs');
const PORT = 'src/cli/work-store.mjs';
const ref = (kind, id) => ({ kind, id });

// A real vault with a project whose scope S1 reaches a milestone, a deliverable, a work package and two tasks.
function vaultWithProject() {
  const { root, v } = newVault();
  const store = v.projectStore('p');
  for (const id of ['T1', 'T2']) store.append({ type: 'task.upserted', entity: { kind: 'task', id, data: { title: `task ${id}`, project: 'p', status: 'READY', scope_version: 1 } } });
  for (const [kind, id] of [['milestone', 'M1'], ['deliverable', 'D1'], ['work_package', 'W1']]) addEntity(store, kind, { title: `${kind} ${id}` }, id);
  for (const [t, f, to] of [['scope-to-milestone', ref('scope', 'S1'), ref('milestone', 'M1')], ['milestone-to-deliverable', ref('milestone', 'M1'), ref('deliverable', 'D1')], ['deliverable-to-work-package', ref('deliverable', 'D1'), ref('work_package', 'W1')], ['work-package-to-task', ref('work_package', 'W1'), ref('task', 'T1')], ['work-package-to-task', ref('work_package', 'W1'), ref('task', 'T2')]]) {
    assert.equal(link(store, { link_type: t, from: f, to, actor: 'planner' }).ok, true);
  }
  const tasks = Object.keys(store.snapshot('task'));
  v.close();
  return { root, tasks };
}
const cli = (sb, root, args) => sb.run(args, { extraEnv: { MEMEV_ROOT: root } });

test('WP19-01 AC01: the work dispatch tests fail before and pass after: memev work impact reads the real project store', () => {
  const { root } = vaultWithProject();
  const sb = sandbox();
  const r = cli(sb, root, ['work', 'impact', 'S1', '--project', 'p']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /S1: \d+ dependent/);
  for (const t of ['task T1', 'task T2', 'work_package W1', 'milestone M1']) assert.ok(r.out.includes(t), `${t} is listed:\n${r.out}`);
  const j = cli(sb, root, ['work', 'impact', 'S1', '--project', 'p', '--json']);
  assert.equal(j.code, 0, j.err);
  const data = JSON.parse(j.out);
  assert.equal(data.source, 'S1');
  assert.ok(data.dependents.some((d) => d.kind === 'task' && d.id === 'T1'));
});

test('WP19-01 AC01: memev work impact exits 1 with one line for a project that does not exist, and does not create it', () => {
  const { root } = vaultWithProject();
  const sb = sandbox();
  const r = cli(sb, root, ['work', 'impact', 'S1', '--project', 'nope']);
  assert.equal(r.code, 1);
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
  assert.match(r.err, /no project nope/);
  assert.equal(fs.existsSync(path.join(root, '.memev', 'projects', 'nope')), false);
  const none = cli(sb, root, ['work', 'impact', 'S1']);
  assert.equal(none.code, 1, 'impact names its project');
  assert.match(none.err, /--project/);
});

test('WP19-01 AC02: main.mjs reaches runWork', () => {
  const src = MAIN();
  assert.match(src, /import\(['"]\.\/work\.mjs['"]\)/);
  assert.match(src, /\brunWork\(pos, flags, \{/);
});

test('WP19-01 AC03: main.mjs has one case for the work command, and impact is dispatched through it', () => {
  const src = MAIN();
  assert.equal((src.match(/case 'work'/g) || []).length, 1, 'exactly one work case');
  const body = src.slice(src.indexOf("case 'work'"));
  assert.match(body.slice(0, body.indexOf("case 'claims'")), /'impact'/);
});

test('WP19-01 AC04: the port module exists', () => {
  assert.ok(fs.existsSync(path.join(PKG, PORT)));
});

test('WP19-01 AC05: the port exports openStore and main.mjs imports it', async () => {
  assert.match(read(PORT), /export (async )?function openStore/);
  assert.match(MAIN(), /from '\.\/work-store\.mjs'|import\(.\.\/work-store\.mjs.\)/);
  const m = await import('../src/cli/work-store.mjs');
  assert.equal(typeof m.openStore, 'function');
});

test('WP19-01 AC06: the production port holds no test double', () => {
  assert.doesNotMatch(read(PORT), /mock|stub|fake|test double|in-memory|inmemory/i);
});

test('WP19-01 AC05: openStore reads the vault\'s own project, adds no second store, and returns null for an unknown project', async () => {
  const { root, tasks } = vaultWithProject();
  const { openStore } = await import('../src/cli/work-store.mjs');
  const reader = openStore('p', { root });
  assert.deepEqual(Object.keys(reader.snapshot('task')).sort(), tasks.sort(), 'it reads the tasks that were written');
  assert.equal(openStore('nope', { root }), null);
  assert.equal(fs.existsSync(path.join(root, '.memev', 'projects', 'nope')), false, 'an unknown project is not created');
  assert.throws(() => openStore('p'), /needs the vault/, 'the port needs the vault root');
});

// Every value reachable from the object through its own properties and prototype chain, never entering a function's closure.
function reachable(root) {
  const seen = new Set(); const out = [];
  const walk = (o) => {
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) return;
    seen.add(o); out.push(o);
    for (const k of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); walk(d.value); walk(d.get); walk(d.set); }
    walk(Object.getPrototypeOf(o));
  };
  walk(root);
  return out;
}

// PG-19.2 WP19-03: Vault#tasksReader(identity, project) is the one read-only door from the vault to project data for the CLI.
const READER = { agent: 'cli', scopes: ['read'], paths: ['**'] };
const eventsOf = (root, id = 'p') => path.join(root, '.memev', 'projects', id, 'events.jsonl');

test('PG-19.2 WP19-03 AC01: the reader is frozen: assigning to snapshot, adding a key and deleting snapshot each throw and change nothing', () => {
  const { root, v } = newVault(); const store = v.projectStore('p');
  store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'T1', data: { title: 'task T1', project: 'p', status: 'READY', scope_version: 1 } } });
  assert.equal(typeof v.tasksReader, 'function', 'Vault#tasksReader exists');
  const reader = v.tasksReader(READER, 'p');
  assert.equal(Object.isFrozen(reader), true);
  const snap = reader.snapshot;
  assert.throws(() => { 'use strict'; reader.snapshot = () => ({}); }, TypeError);
  assert.throws(() => { 'use strict'; reader.extra = 1; }, TypeError);
  assert.throws(() => { 'use strict'; delete reader.snapshot; }, TypeError);
  assert.equal(reader.snapshot, snap, 'nothing changed');
  assert.equal(Reflect.ownKeys(reader).length, 1);
  assert.ok(root);
  v.close();
});

test('PG-19.2 WP19-03 AC02: the reader has exactly one member, snapshot, and nothing on its prototype', () => {
  const { v } = newVault(); v.projectStore('p').append({ type: 'task.upserted', entity: { kind: 'task', id: 'T1', data: { title: 't', project: 'p', status: 'READY', scope_version: 1 } } });
  const reader = v.tasksReader(READER, 'p');
  assert.deepEqual(Reflect.ownKeys(reader), ['snapshot']);
  assert.equal(typeof reader.snapshot, 'function');
  const proto = Object.getPrototypeOf(reader);
  assert.ok(proto === Object.prototype || proto === null, 'the prototype is Object.prototype or null');
  if (proto) assert.deepEqual(Reflect.ownKeys(proto).sort(), Reflect.ownKeys(Object.prototype).sort(), 'the prototype has no member of its own');
  v.close();
});

test('PG-19.2 WP19-03 AC03: the records it returns are copies: changing one changes nothing in the store or in a second read', () => {
  const { root, v } = newVault();
  const store = v.projectStore('p');
  store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'T1', data: { title: 'task T1', project: 'p', status: 'READY', scope_version: 1, nested: { deep: ['a'] } } } });
  store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'T2', data: { title: 'task T2', project: 'p', status: 'READY', scope_version: 1 } } });
  const reader = v.tasksReader(READER, 'p');
  const first = reader.snapshot('task');
  const storeBefore = JSON.stringify(store.snapshot('task'));
  first.T1.title = 'changed'; first.T1.nested.deep.push('b'); first.T1.nested.added = true; delete first.T2; first.T3 = { title: 'x' };
  assert.equal(JSON.stringify(reader.snapshot('task')), storeBefore, 'a second read is unchanged');
  assert.equal(JSON.stringify(store.snapshot('task')), storeBefore, 'the store is unchanged');
  assert.notEqual(reader.snapshot('task'), reader.snapshot('task'), 'two calls return different objects');
  assert.notEqual(reader.snapshot('task').T1, reader.snapshot('task').T1);
  assert.ok(root);
  v.close();
});

test('PG-19.2 WP19-03 AC04: the reader cannot write: no write method, and the event log bytes are the same after every call', () => {
  const { root, v } = newVault();
  const store = v.projectStore('p');
  store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'T1', data: { title: 'task T1', project: 'p', status: 'READY', scope_version: 1 } } });
  const bytes = () => fs.readFileSync(eventsOf(root));
  const before = bytes();
  const reader = v.tasksReader(READER, 'p');
  for (const w of ['append', 'put', 'withWrite', 'close', 'open', 'update', 'delete', 'remove', 'set', 'write']) {
    assert.equal(typeof reader[w], 'undefined', `${w} does not exist`);
    assert.throws(() => reader[w](), TypeError, `calling ${w} fails`);
  }
  const tasks = reader.snapshot('task');
  tasks.T1.status = 'DONE'; for (const k of Object.keys(tasks.T1)) if (typeof tasks.T1[k] === 'function') tasks.T1[k]();
  assert.throws(() => reader.snapshot.call(null, 'task').T1.append(), TypeError);
  reader.snapshot('nothing-of-this-kind');
  assert.deepEqual(bytes(), before, 'the event log is byte for byte the same');
  assert.equal(store.snapshot('task').T1.status, 'READY', 'no event reached the store');
  v.close();
});

test('PG-19.2 WP19-03 AC05: the reader does not expose the ProjectStore: nothing reachable is a store, and what snapshot returns survives structuredClone and JSON', async () => {
  const { v } = newVault(); const store = v.projectStore('p');
  for (const id of ['T1', 'T2']) store.append({ type: 'task.upserted', entity: { kind: 'task', id, data: { title: `task ${id}`, project: 'p', status: 'READY', scope_version: 1 } } });
  addEntity(store, 'milestone', { title: 'm' }, 'M1');
  const { ProjectStore } = await import('../src/engine/project-store.mjs');
  const reader = v.tasksReader(READER, 'p');
  assert.equal(reader instanceof ProjectStore, false);
  const kinds = ['project', 'task', 'lease', 'attempt', 'evidence', 'conflict', 'session', 'approval', 'event', 'milestone', 'deliverable', 'work_package'];
  const all = [...reachable(reader), ...kinds.flatMap((k) => reachable(reader.snapshot(k)))];
  assert.ok(all.length > 3);
  for (const o of all) {
    assert.equal(o instanceof ProjectStore, false, 'nothing reachable is a store');
    assert.notEqual(o.constructor, ProjectStore, 'nothing reachable has the store constructor');
    for (const k of ['withWrite', 'append', 'snapshotPath', 'sourceOf', 'hasRecord']) assert.equal(Object.hasOwn(o, k) && typeof o[k] === 'function' && o !== Object.prototype, false, `${k} is not reachable`);
  }
  assert.equal(all.some((o) => typeof o === 'object' && Reflect.ownKeys(o).some((k) => typeof k === 'symbol' && o[k] instanceof ProjectStore)), false, 'no symbol key holds a store');
  for (const k of kinds) { const snap = reader.snapshot(k); assert.deepEqual(structuredClone(snap), snap); assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap); }
  v.close();
});

test('PG-19.2 WP19-03 AC06: the reader serves what impact needs, returns null for a project with no store and creates none, and refuses a credential that may not read', () => {
  const { root, v } = newVault();
  const store = v.projectStore('p');
  for (const id of ['T1', 'T2']) store.append({ type: 'task.upserted', entity: { kind: 'task', id, data: { title: `task ${id}`, project: 'p', status: 'READY', scope_version: 1 } } });
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'AP1', data: { task_id: 'T1', state: 'pending' } } });
  store.append({ type: 'evidence.upserted', entity: { kind: 'evidence', id: 'E1', data: { task_id: 'T1', criterion: 'c1' } } });
  addEntity(store, 'milestone', { title: 'm' }, 'M1');
  assert.equal(link(store, { link_type: 'scope-to-milestone', from: ref('scope', 'S1'), to: ref('milestone', 'M1'), actor: 'planner' }).ok, true);
  const reader = v.tasksReader(READER, 'p');
  for (const kind of ['project', 'task', 'lease', 'attempt', 'evidence', 'conflict', 'session', 'approval', 'event', 'milestone', 'deliverable', 'work_package']) {
    assert.deepEqual(reader.snapshot(kind), store.snapshot(kind), `${kind} agrees with the store`);
  }
  assert.equal(v.tasksReader(READER, 'nope'), null, 'a project with no store gives null');
  assert.equal(fs.existsSync(path.join(root, '.memev', 'projects', 'nope')), false, 'and none is created');
  assert.throws(() => v.tasksReader({ agent: 'w', scopes: ['write'], paths: ['**'] }, 'p'), /may not read/, 'a credential that may not read is refused');
  assert.throws(() => v.tasksReader(null, 'p'), /may not read/, 'no credential is refused');
  assert.throws(() => v.tasksReader(READER, ''), /project name/);
  v.close();
});

test('PG-19.2 WP19-03 AC06: the reader skips a torn last line of the event log without cutting it', () => {
  const { root, v } = newVault();
  v.projectStore('p').append({ type: 'task.upserted', entity: { kind: 'task', id: 'T1', data: { title: 't', project: 'p', status: 'READY', scope_version: 1 } } });
  const file = eventsOf(root);
  fs.appendFileSync(file, '{"seq":99,"entity":{"kind":"task","id":"T9","da');
  const before = fs.readFileSync(file, 'utf8');
  const reader = v.tasksReader(READER, 'p');
  assert.equal(reader.snapshot('task').T9, undefined, 'an unfinished line is not read');
  assert.ok(reader.snapshot('task').T1);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'and it is not cut: that is the writer\'s to finish');
  v.close();
});

test('WP19-01 AC05: the port goes through the vault method tasksReader and nothing else', () => {
  assert.match(read(PORT), /tasksReader/);
  assert.doesNotMatch(read(PORT) + MAIN(), /ProjectStore|projectStore|project-store|[Cc]oordinator/);
});

test('WP19-01 scope: the work case added no recovery or control subcommand of its own and work.mjs is unchanged by it', () => {
  const body = MAIN().slice(MAIN().indexOf("case 'work'"));
  const work = body.slice(0, body.indexOf("case 'claims'"));
  assert.equal((work.match(/openStore/g) || []).length >= 1, true, 'the work case fills the port');
  assert.doesNotMatch(work, /recover\(|reconstruct\(|eligibilityPass|applyBusMessage/);
});
