// PG-19.1 (WP19-01): the work command is dispatched to runWork from src/cli/main.mjs, and runWork reads the project store through
// a port that opens the real store of the vault. Each test name starts with WP19-01 and the criterion it covers.
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

test('WP19-01 AC05: the object openStore returns cannot write: it has no write method and rejects mutation', async () => {
  const { root } = vaultWithProject();
  const { openStore } = await import('../src/cli/work-store.mjs');
  const reader = openStore('p', { root });
  assert.equal(Object.isFrozen(reader), true, 'the object is frozen');
  assert.deepEqual(Object.keys(reader), ['snapshot'], 'the one read function and nothing else');
  for (const w of ['append', 'put', 'withWrite', 'close', 'open', 'update', 'delete', 'remove']) {
    assert.equal(typeof reader[w], 'undefined', `${w} does not exist`);
    assert.throws(() => reader[w](), TypeError, `calling ${w} fails`);
    assert.throws(() => { reader[w] = () => {}; }, TypeError, `assigning ${w} fails`);
  }
  assert.throws(() => { reader.snapshot = () => ({}); }, TypeError, 'the read function cannot be replaced');
  assert.throws(() => { delete reader.snapshot; }, TypeError);
  // what it returns is a copy: changing it changes nothing in the store
  const before = fs.readFileSync(path.join(root, '.memev', 'projects', 'p', 'events.jsonl'), 'utf8');
  const tasks = reader.snapshot('task');
  tasks.T1.title = 'changed'; delete tasks.T2;
  assert.equal(reader.snapshot('task').T1.title, 'task T1', 'a second read is unchanged');
  assert.ok(reader.snapshot('task').T2);
  assert.equal(fs.readFileSync(path.join(root, '.memev', 'projects', 'p', 'events.jsonl'), 'utf8'), before, 'the store file is untouched');
});

test('WP19-01 AC05: the object openStore returns does not expose the store itself', async () => {
  const { root } = vaultWithProject();
  const { openStore } = await import('../src/cli/work-store.mjs');
  const { ProjectStore } = await import('../src/engine/project-store.mjs');
  const reader = openStore('p', { root });
  assert.equal(reader instanceof ProjectStore, false);
  const all = [...reachable(reader), ...['task', 'event', 'approval'].flatMap((k) => reachable(reader.snapshot(k)))];
  assert.ok(all.length > 3);
  for (const o of all) {
    assert.equal(o instanceof ProjectStore, false, 'nothing reachable is a store');
    for (const k of ['withWrite', 'append', 'snapshotPath', 'sourceOf', 'hasRecord']) assert.equal(Object.hasOwn(o, k) && typeof o[k] === 'function' && o !== Object.prototype, false, `${k} is not reachable`);
  }
  assert.equal(Object.getPrototypeOf(reader), Object.prototype, 'a plain object, with no class behind it');
});

test('WP19-01 AC05: the read-only view agrees with the store on every kind of record, and skips a torn last line without cutting it', async () => {
  const { root, v } = newVault();
  const store = v.projectStore('p');
  for (const id of ['T1', 'T2']) store.append({ type: 'task.upserted', entity: { kind: 'task', id, data: { title: `task ${id}`, project: 'p', status: 'READY', scope_version: 1 } } });
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'AP1', data: { task_id: 'T1', state: 'pending' } } });
  store.append({ type: 'evidence.upserted', entity: { kind: 'evidence', id: 'E1', data: { task_id: 'T1', criterion: 'c1' } } });
  addEntity(store, 'milestone', { title: 'm' }, 'M1');
  assert.equal(link(store, { link_type: 'scope-to-milestone', from: ref('scope', 'S1'), to: ref('milestone', 'M1'), actor: 'planner' }).ok, true);
  const { openStore } = await import('../src/cli/work-store.mjs');
  const reader = openStore('p', { root });
  for (const kind of ['project', 'task', 'lease', 'attempt', 'evidence', 'conflict', 'session', 'approval', 'event', 'milestone', 'deliverable', 'work_package']) {
    assert.deepEqual(reader.snapshot(kind), store.snapshot(kind), `${kind} agrees with the store`);
  }
  const file = path.join(root, '.memev', 'projects', 'p', 'events.jsonl');
  fs.appendFileSync(file, '{"seq":99,"entity":{"kind":"task","id":"T9","da');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(openStore('p', { root }).snapshot('task').T9, undefined, 'an unfinished line is not read');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'and it is not cut: that is the writer\'s to finish');
  v.close();
});

test('WP19-01 scope: the work case added no recovery or control subcommand of its own and work.mjs is unchanged by it', () => {
  const body = MAIN().slice(MAIN().indexOf("case 'work'"));
  const work = body.slice(0, body.indexOf("case 'claims'"));
  assert.equal((work.match(/openStore/g) || []).length >= 1, true, 'the work case fills the port');
  assert.doesNotMatch(work, /recover\(|reconstruct\(|eligibilityPass|applyBusMessage/);
});
