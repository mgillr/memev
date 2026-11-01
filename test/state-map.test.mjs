// SPDX-License-Identifier: Apache-2.0
// PG-05.1 WP05-04 (the state map) and WP05-01 (the merge-semantics table, docs/MERGE-SEMANTICS.md).
// The state map turns a note, or the state of an agent, into structured state a provider shim can hand to the engine, and
// back, with no loss. It holds no text merge: the core has none. The table checks read docs/MERGE-SEMANTICS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG } from './helpers/tmp.mjs';
import * as map from '../src/engine/state-map.mjs';

const doc = () => fs.readFileSync(path.join(PKG, 'docs', 'MERGE-SEMANTICS.md'), 'utf8');

// The one place the merge-class names and their assignment to an entity type are written in this file. The four class names
// and the owner and class of each of the nine entity types are the final ones of SO-F-02 (#354, head 438887a). If SO-F-02
// changes one, change it here and in the table, and nowhere else.
const CLASS = Object.freeze({ union: 'set-union', newest: 'last-writer', log: 'append-only', human: 'human-resolution' });
// type: [owner, merge class, which declared fields are PROVISIONAL]
const EXPECTED = Object.freeze({
  project: ['person', CLASS.newest, []],
  task: ['person', CLASS.human, []],
  lease: ['service', CLASS.human, ['class', 'owner']],
  attempt: ['agent', CLASS.log, []],
  evidence: ['service', CLASS.log, ['owner']],
  conflict: ['person', CLASS.human, []],
  session: ['device', CLASS.newest, []],
  approval: ['person', CLASS.human, []],
  event: ['service', CLASS.log, ['owner']],
});

// The table: one row per entity type, the cells are | entity type | owner | merge class | status | rationale |.
function tableRows() {
  const rows = new Map();
  for (const line of doc().split('\n')) {
    const cells = line.split('|').map((c) => c.trim().replace(/`/g, ''));
    if (cells.length < 7 || cells[0] !== '') continue;
    const [, name, owner, cls, status, rationale] = cells;
    if (!(name in EXPECTED)) continue;
    rows.set(name, { owner, cls, status, rationale });
  }
  return rows;
}

test('state map: a note maps to structured state and back without loss', () => {
  const notes = [
    '', '\n', 'one line', 'one line\n', '# Note\n\nAlpha\nBeta\n', 'a\r\nb\r\n', 'a\n\n\n\nb', 'same\nsame\nsame\n',
    '\n\ntrailing blanks\n\n', 'caf\u00e9 \u{1F600} line\nsecond\n', ' leading and trailing  \n\ttabbed\n', 'mixed\r\nends\nhere\r',
  ];
  for (const text of notes) {
    const state = map.noteToState(text);
    assert.equal(map.stateToNote(state), text, JSON.stringify(text));
    // the state is plain data: it survives JSON unchanged, so a shim can pass it on
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    assert.equal(map.stateToNote(JSON.parse(JSON.stringify(state))), text);
    assert.deepEqual(map.noteToState(text), state, 'the same note gives the same state');
  }
  // lines become a set: a repeated line gets its own element, and an edit leaves the other elements as they were
  const s1 = map.noteToState('same\nsame\nother\n');
  assert.equal(new Set(s1.order).size, s1.order.length, 'every element has its own key');
  assert.equal(Object.keys(s1.lines).length, s1.order.length);
  const s2 = map.noteToState('same\nsame\nother\nadded\n');
  const kept = s1.order.filter((k) => k in s2.lines);
  assert.ok(kept.length >= 3, 'the unchanged lines keep their keys');
  for (const k of kept) assert.equal(s2.lines[k], s1.lines[k]);
  // agent state
  const agents = [{}, { a: 1 }, { z: 1, a: { b: [1, 2, { c: null }] }, m: 'text', n: false }, { '1': 'x', b: 'y' }];
  for (const o of agents) {
    const st = map.agentToState(o);
    assert.deepEqual(map.stateToAgent(JSON.parse(JSON.stringify(st))), o);
    assert.deepEqual(Object.keys(map.stateToAgent(st)), Object.keys(o), 'key order is kept');
  }
  // input that is not representable is refused, not guessed at
  assert.throws(() => map.noteToState(null), TypeError);
  assert.throws(() => map.noteToState(5), TypeError);
  assert.throws(() => map.stateToNote({ lines: {}, order: ['x'] }), /state/i);
  assert.throws(() => map.agentToState({ f() {} }), TypeError);
  assert.throws(() => map.agentToState([1]), TypeError);
  assert.throws(() => map.agentToState({ u: undefined }), TypeError);
});

test('state map: the core holds no text merge, only the representation', () => {
  const names = Object.keys(map).sort();
  assert.deepEqual(names, ['agentToState', 'noteToState', 'stateToAgent', 'stateToNote'].sort(), 'only the mappings are exported');
  for (const n of names) assert.doesNotMatch(n, /merge|resolve|converge|diff/i);
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'state-map.mjs'), 'utf8');
  assert.doesNotMatch(src, /diff3|three-way|3-way|mergeText/i);
  assert.doesNotMatch(src, /from '[^']*merge\.mjs'|convergence-v1/, 'the merge boundary and the convergence schema belong to SO-F-06');
  assert.doesNotMatch(src, /spawn|exec|fetch\(|crdt/i, 'the state map calls nothing outside itself');
  // nothing in the state map decides between two versions: two different notes give two different states
  assert.notDeepEqual(map.noteToState('a\n'), map.noteToState('b\n'));
});

test('merge semantics table: the nine entity types are named, each with its owner, merge class, status and rationale', () => {
  const rows = tableRows();
  assert.deepEqual([...rows.keys()].sort(), Object.keys(EXPECTED).sort());
  for (const [name, [owner, cls, provisional]] of Object.entries(EXPECTED)) {
    const row = rows.get(name);
    assert.equal(row.owner, owner, `${name}: owner`);
    assert.equal(row.cls, cls, `${name}: merge class`);
    assert.ok(row.rationale.length > 40, `${name}: a rationale`);
    if (!provisional.length) { assert.match(row.status, /^declared\b/, `${name}: status`); continue; }
    assert.match(row.status, /^PROVISIONAL\b/, `${name}: status`);
    for (const f of ['class', 'owner']) {
      assert.equal(new RegExp(`\\b${f}\\b`).test(row.status), provisional.includes(f), `${name}: ${f} is ${provisional.includes(f) ? '' : 'not '}provisional`);
    }
  }
});

test('merge semantics table: it uses exactly the four merge-class names of SO-F-02, and no type uses set-union yet', () => {
  const text = doc();
  assert.ok(text.includes('SO-F-02'));
  for (const c of Object.values(CLASS)) assert.ok(text.includes(c), c);
  const used = new Set([...tableRows().values()].map((r) => r.cls));
  assert.deepEqual([...used].sort(), [CLASS.newest, CLASS.log, CLASS.human].sort());
  assert.match(text, /no (entity )?type uses `?set-union`? yet/i);
  // the table declares and enforces nothing: that is SO-F-02, and enforcement is SO-F-06
  assert.match(text, /declares nothing|does not declare/i);
  assert.match(text, /SO-F-06/);
  assert.match(text, /cites?/i);
});

test('merge semantics table: human-resolution means competing writes are surfaced and a person settles them, never silently merged', () => {
  const text = doc();
  assert.match(text, /surfaced/i);
  assert.match(text, /a person settles/i);
  assert.match(text, /never silently merged/i);
  for (const t of ['task', 'lease', 'conflict', 'approval']) assert.equal(tableRows().get(t).cls, CLASS.human, t);
});

test('merge semantics table: a lease is provisional for class and owner, waits on ADR 3 and is not last-writer', () => {
  const lease = tableRows().get('lease');
  assert.notEqual(lease.cls, CLASS.newest);
  assert.match(lease.status, /^PROVISIONAL/);
  assert.match(lease.rationale, /ADR 3/);
  assert.match(lease.rationale, /one active writer/i);
  assert.match(lease.rationale, /queued/i);
  assert.match(lease.rationale, /not merged/i);
  assert.match(lease.rationale, /pre-empt/i, 'the newest write would pre-empt the holder');
  assert.match(lease.rationale, /coordinator/i);
  assert.match(lease.rationale, /second claim/i);
  assert.match(lease.rationale, /live lease/i);
});

test('merge semantics table: last-writer means newest in log order, the merge provider breaks ties, and scope_version only moves forward', () => {
  const text = doc();
  assert.match(text, /newest in log order/i);
  assert.match(text, /tie/i);
  assert.match(text, /merge provider/i);
  assert.match(text, /not (by )?the core/i);
  assert.match(text, /LWWRegister/);
  assert.match(text, /equal.timestamp/i);
  assert.match(text, /open follow-up/i);
  assert.match(text, /scope_version/);
  assert.match(text, /monotonic/i);
  assert.match(text, /highest[^.\n]*stands/i);
  assert.match(text, /newest write (never|does not|must not)/i);
  assert.match(tableRows().get('project').rationale, /scope_version/);
  assert.match(tableRows().get('project').rationale, /SO-F-06/);
});

test('merge semantics table: the owner is a declaration, not the memory authority of ADR 7 or the permission matrix of ADR 5', () => {
  const text = doc();
  assert.match(text, /declaration/i);
  assert.match(text, /ADR 7/);
  assert.match(text, /ADR 5/);
  assert.match(text, /memory authority/i);
  assert.match(text, /permission matrix/i);
  // the owner of a lease, evidence and event is a service, and that ownership waits on a model that can issue one
  for (const t of ['lease', 'evidence', 'event']) assert.match(tableRows().get(t).status, /owner/, t);
});

test('merge semantics table: the class on each type and its enforcement belong to SO-F-02 and SO-F-06, which the page cites', () => {
  const text = doc();
  assert.match(text, /SO-F-02[^.\n]*(declares|declaration)/i);
  assert.match(text, /SO-F-06[^.\n]*(enforce|check|apply|applies)/i);
  assert.match(text, /\(#354\)|#354/);
  assert.match(text, /438887a/);
});

test('merge semantics table: the nine object classes of MV-ARCH-05 are named, each placed on an entity type or said to have none', () => {
  const text = doc();
  const lower = text.toLowerCase();
  const names = ['observations', 'metadata', 'membership', 'counters', 'task ownership', 'task state', 'contracts', 'approvals', 'external action'];
  for (const n of names) assert.ok(lower.includes(n), n);
  const at = text.indexOf('## The object classes');
  assert.ok(at > 0, 'a section for the object classes');
  const section = text.slice(at, text.indexOf('\n## ', at + 5) > 0 ? text.indexOf('\n## ', at + 5) : undefined);
  for (const n of names) assert.ok(section.toLowerCase().includes(n), `${n} is in that section`);
  // the section places an object class only where SO-F-02 has a type for it, and declares no class of its own
  assert.match(section, /declares no class/i);
  assert.match(section, /no entity type/i);
  const row = (n) => section.split('\n').find((l) => l.toLowerCase().startsWith(`| ${n} `)) || '';
  assert.match(row('task ownership'), /`lease`/);
  assert.match(row('task state'), /`task`/);
  assert.match(row('approvals'), /`approval`/);
  assert.match(row('metadata'), /`project`/);
  assert.match(row('contracts'), /never silently merged/i);
});

test('merge semantics table: it says the engine has no three-way text merge and a provider shim outside the core maps a note to structured state', () => {
  const text = doc();
  for (const n of ['provider shim', 'three-way text merge', 'structured state', 'outside']) assert.ok(text.toLowerCase().includes(n), n);
  assert.match(text, /memev-ops|crdt-merge side|outside the (Memev )?core/i);
});

test('merge semantics table: the page keeps to the settled decisions and the licence boundary', () => {
  const text = doc();
  assert.doesNotMatch(text, /\u2014|\u2013/, 'no dashes of the long kind');
  assert.doesNotMatch(text, /federated tier|personal trial/i);
  assert.match(text, /external call-out|call-out boundary/i);
  assert.match(text, /never vendored|not vendored/i);
});
