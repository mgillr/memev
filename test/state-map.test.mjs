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
// and the owner and class of each of the nine entity types are those of SO-F-02 (#354, at 9955a0d). If SO-F-02
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

// Every way a module can be named: from-imports, side-effect imports, dynamic imports, re-exports and require all hold the
// path in a string literal, so the guard looks at the literal and not at the form of the statement.
const NAMES_MERGE_BOUNDARY = /['"`][^'"`\n]*(?:merge\.mjs|\/merge)(?:[?#][^'"`\n]*)?['"`]|convergence-v1/;

test('state map: the guard on the merge boundary catches every form of import, and the state map has none', () => {
  for (const bad of [
    "import { x } from './merge.mjs';", 'import { x } from "./merge.mjs";', "import './merge.mjs';", 'import "./merge.mjs"',
    "import * as m from '../engine/merge.mjs'", "import('./merge.mjs')", "await import(`./merge.mjs`)", "export * from './merge.mjs'",
    "export { commandProvider } from './merge.mjs';", "require('./merge.mjs')", "import './merge';", "import './merge.mjs?x=1';",
    "import '/abs/src/engine/merge.mjs'", "const p = './merge.mjs';", "import schema from './convergence-v1.json'",
  ]) assert.match(bad, NAMES_MERGE_BOUNDARY, bad);
  for (const ok of ["import { sha256 } from './util.mjs';", "import './util.mjs';", '// the boundary is src/engine/merge.mjs', "import { mergeText } from './util.mjs'"]) {
    assert.doesNotMatch(ok, NAMES_MERGE_BOUNDARY, ok);
  }
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'state-map.mjs'), 'utf8');
  assert.doesNotMatch(src, NAMES_MERGE_BOUNDARY, 'the merge boundary and the convergence schema belong to SO-F-06');
});

test('state map: the core holds no text merge, only the representation', () => {
  const names = Object.keys(map).sort();
  assert.deepEqual(names, ['agentToState', 'noteToState', 'stateToAgent', 'stateToNote'].sort(), 'only the mappings are exported');
  for (const n of names) assert.doesNotMatch(n, /merge|resolve|converge|diff/i);
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'state-map.mjs'), 'utf8');
  assert.doesNotMatch(src, /diff3|three-way|3-way|mergeText/i);
  assert.doesNotMatch(src, NAMES_MERGE_BOUNDARY, 'the merge boundary and the convergence schema belong to SO-F-06');
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
    if (name === 'approval') continue; // its status is pinned in its own test
    if (!provisional.length) { assert.equal(row.status, 'declared, not surfaced yet', `${name}: status`); continue; }
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
  // a fifth class name must not appear anywhere in the prose: not in code spans, and not beside the word class
  const named = new Set();
  for (const m of text.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) named.add(m[1]);
  for (const m of text.matchAll(/\b([a-z]+(?:-[a-z]+)+)\s+(?:merge\s+)?class(?:es)?\b/g)) named.add(m[1].toLowerCase());
  for (const m of text.matchAll(/\bclass(?:es)?\s+(?:of\s+|is\s+|named\s+|called\s+)?`?([a-z]+(?:-[a-z]+)+)/g)) named.add(m[1].toLowerCase());
  assert.deepEqual([...named].filter((n) => !Object.values(CLASS).includes(n)), [], 'no class name other than the four');
  const list = text.slice(text.indexOf('The four classes mean:'), text.indexOf('No type uses'));
  assert.equal(list.split('\n').filter((l) => l.startsWith('- ')).length, 4, 'four items in the list of classes');
  // the table declares and enforces nothing: that is SO-F-02, and enforcement is SO-F-06
  assert.match(text, /declares nothing|does not declare/i);
  assert.match(text, /SO-F-06/);
  assert.match(text, /cites?/i);
});

test('merge semantics table: human-resolution means competing writes go to a person, are never silently merged, and only approvals are surfaced today', () => {
  const text = doc();
  assert.match(text, /surfaced/i);
  assert.match(text, /a person settles/i);
  assert.match(text, /never silently merged/i);
  // only approvals are surfaced today, and the page does not say that the other types' competing writes are
  assert.match(text, /Only approvals are surfaced today/);
  assert.doesNotMatch(text, /competing writes are surfaced/i);
  for (const t of ['task', 'conflict']) assert.doesNotMatch(tableRows().get(t).rationale, /\b(are|is) surfaced\b/i, `${t}: not said to be surfaced`);
  assert.match(tableRows().get('task').rationale, /not surfaced yet/i);
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
  assert.match(tableRows().get('project').rationale, /no contract enforces this yet/i);
  assert.doesNotMatch(tableRows().get('project').rationale, /SO-F-06/, 'no contract is named as the enforcer of scope_version');
  const at = text.indexOf('### The scope version moves only forward');
  const section = text.slice(at, text.indexOf('\n### ', at + 5));
  assert.match(section, /no contract enforces this yet/i);
  assert.doesNotMatch(section, /SO-F-06/);
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
  assert.match(text, /9955a0d/);
  assert.doesNotMatch(text, /438887a/, 'the old pin of #354 is gone');
  assert.doesNotMatch(text, /final head/i, '#354 is still open, so no head of it is final');
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

test('merge semantics table: the approve and reject set is PROVISIONAL against SO-A-05, and the same id replaces the entity and keeps both events', () => {
  const row = tableRows().get('approval');
  assert.match(row.status, /^declared, surfaced\b/, 'approvals are the one type that is surfaced today');
  assert.match(row.status, /PROVISIONAL/);
  assert.match(row.status, /SO-A-05/);
  assert.match(row.rationale, /Incompatible decisions on one task, for example an approve and a reject, are surfaced, neither is applied, and a person settles it/);
  assert.match(row.rationale, /PROVISIONAL against SO-A-05/);
  assert.match(row.rationale, /approve and reject/i);
  assert.match(row.rationale, /on the same (approval )?id, a later write replaces the stored entity and both events stay in the log/i);
  assert.doesNotMatch(row.rationale, /does not overwrite|never overwrite/i, 'a later write on one id does replace the stored entity');
  // the object class table says the same of approvals
  const text = doc();
  const objects = text.slice(text.indexOf('## The object classes'));
  const line = objects.split('\n').find((l) => l.startsWith('| approvals ')) || '';
  assert.match(line, /PROVISIONAL against SO-A-05/);
  assert.match(line, /approve and reject/i);
  // the other types are not provisional for that reason
  for (const [name, r] of tableRows()) if (name !== 'approval') assert.doesNotMatch(r.status, /SO-A-05/, name);
});

test('merge semantics table: an external action is an append-only attempt entry with kind external, and the coordinator dedups by key', () => {
  const text = doc();
  const at = text.indexOf('## The object classes');
  const section = text.slice(at, text.indexOf('\n## ', at + 5));
  const line = section.split('\n').find((l) => l.toLowerCase().startsWith('| external actions ')) || '';
  assert.match(line, /No entity type of its own in SO-F-02 yet/);
  assert.match(line, /`attempt` entry with `kind: 'external'`/);
  assert.match(line, /append-only/);
  assert.match(line, /`external` method of `src\/engine\/coordinator\.mjs`/);
  assert.match(line, /dedup by key is the coordinator's job/i);
  // the row says what the code does: read the method it points at
  const code = fs.readFileSync(path.join(PKG, 'src', 'engine', 'coordinator.mjs'), 'utf8');
  const from = code.indexOf('  external(taskId, kind, key, payload, fn) {');
  assert.ok(from > 0, 'the coordinator has an external method');
  const body = code.slice(from, code.indexOf('\n  }\n', from));
  assert.match(body, /type: 'attempt\.upserted'/);
  assert.match(body, /kind: 'attempt'/);
  assert.match(body, /kind: 'external'/);
  assert.match(body, /a\.kind === 'external' && a\.key === key/, 'the coordinator is what dedups by key');
  assert.equal(tableRows().get('attempt').cls, CLASS.log, 'an attempt is append-only');
});

test('merge semantics table: the page says Memev is local first and leaves ADR 7 as proposed, and the status wording matches SO-F-02', () => {
  const text = doc();
  assert.ok(text.includes('Memev is local first (decided 31 Oct 2026). Whether the vault is the only authority is ADR 7, proposed.'));
  assert.equal(text.match(/only authority/gi).length, 1, 'the vault is not called the only authority anywhere else');
  assert.doesNotMatch(text, /The vault is the only authority/);
  assert.match(text, /declared, not surfaced yet/);
  const rows = tableRows();
  for (const t of ['project', 'task', 'attempt', 'conflict', 'session']) assert.equal(rows.get(t).status, 'declared, not surfaced yet', t);
});

test('round trip test: its header says it uses commandProvider until the WO-05-B client lands in #201', () => {
  const head = fs.readFileSync(path.join(PKG, 'test', 'engine-roundtrip.test.mjs'), 'utf8').split('\n').slice(0, 12).join('\n');
  assert.match(head, /commandProvider/);
  assert.match(head, /#201/);
  assert.match(head, /WO-05-B client/);
  assert.match(head, /does not exercise/i);
});

test('docs/CONVERGENCE.md only links to the merge semantics page', () => {
  const text = fs.readFileSync(path.join(PKG, 'docs', 'CONVERGENCE.md'), 'utf8');
  const lines = text.split('\n').filter((l) => l.includes('MERGE-SEMANTICS.md'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].trim(), '[MERGE-SEMANTICS.md](MERGE-SEMANTICS.md)');
  assert.doesNotMatch(text, /names no engine strategy either/);
});
