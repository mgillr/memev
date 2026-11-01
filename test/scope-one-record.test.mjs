import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Parse every markdown table row in a page into an array of trimmed cells.
// Skips separator rows (| --- |) and the header row whose first cell is headerCell.
function rows(page, headerCell) {
  const out = [];
  for (const line of read(page).split('\n')) {
    const s = line.trim();
    if (!s.startsWith('|')) continue;
    const cells = s.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (headerCell && cells[0] === headerCell) continue;
    out.push(cells);
  }
  return out;
}

// A contract id is "in the inventory" when a row's id equals it or is a
// twin-branch form of it, for example "MEM-055 (1)".
function inventoryIds() {
  return rows('docs/scope-one/INVENTORY.md', 'id').map((r) => r[0]);
}
function inInventory(id, ids) {
  return ids.some((c) => c === id || c.startsWith(id + ' ('));
}

// Strict shapes from the acceptance criteria, used to validate a cited contract id.
const SHAPE = /^(MEM-\d{3}|REV-\d{3}|WO-\d{2}-[A-Z]|SO-[A-Z0-9]-[A-Z])$/;
// Permissive extraction, used to find every contract id a page names.
const EXTRACT = /\b(MEM-\d{3}|REV-\d{3}|WO-\d{2}-[A-Z]|SO-[A-Z0-9]+-[A-Z])\b/g;
const REPO_PATH = /`((?:src|bin|scripts|test|docs|templates|vendor|contracts|media)\/[A-Za-z0-9_./-]+\.(?:mjs|md|json|sh|ps1|mp4|png))`/g;

test('SO-T-A AC01: the requirement register is complete and well formed', () => {
  const re = /^\|\s(SO-REQ-\d{3})\s\|\s([^|]+?)\s\|\s([^|]+?)\s\|\s(\w+)\s\|\s*$/;
  const reg = [];
  for (const line of read('docs/scope-one/REQUIREMENTS.md').split('\n')) {
    const m = line.match(re);
    if (m) reg.push({ id: m[1], section: m[2], outcome: m[3], status: m[4] });
  }
  assert.ok(reg.length >= 86, 'register has ' + reg.length + ' rows, need at least 86');
  const seen = new Set();
  for (const r of reg) {
    assert.ok(!seen.has(r.id), 'duplicate id ' + r.id);
    seen.add(r.id);
    assert.ok(r.section.length > 0 && r.outcome.length > 0, r.id + ' has an empty field');
  }
  const STATUSES = new Set(['EXISTS_AND_VERIFIED', 'EXISTS_BUT_INCOMPLETE', 'DOCUMENTED_ONLY', 'MISSING', 'CONFLICTING', 'UNKNOWN', 'DEFERRED_BY_OWNER']);
  for (const r of reg) assert.ok(STATUSES.has(r.status), r.id + ' status ' + r.status + ' is outside the set');
  const by = (s) => reg.filter((r) => r.section === s).length;
  assert.ok(by('Scope One acceptance criteria') >= 16, 'need at least 16 Scope One acceptance criteria');
  assert.ok(by('Failure tests F01 to F20') >= 20, 'need at least 20 failure tests');
  assert.ok(by('Dashboard acceptance criteria') >= 1, 'need the dashboard criteria');
  assert.ok(by('Onboarding acceptance criteria') >= 1, 'need the onboarding criteria');
  assert.ok(by('Lead agent acceptance criteria') >= 1, 'need the lead criteria');
  assert.ok(by('Release acceptance criteria') >= 1, 'need the release criteria');
  assert.ok(by('Builder handoff checklist') >= 14, 'need at least 14 builder checklist items');
});

test('SO-T-A AC02: the traceability matrix covers every requirement and cites only real things', () => {
  const reqIds = new Set([...read('docs/scope-one/REQUIREMENTS.md').matchAll(/^\|\s(SO-REQ-\d{3})\s\|/gm)].map((m) => m[1]));
  const tRows = rows('docs/scope-one/TRACEABILITY.md', 'id');
  const tIds = new Set(tRows.map((r) => r[0]));
  for (const id of reqIds) assert.ok(tIds.has(id), 'requirement ' + id + ' has no traceability row');
  for (const id of tIds) assert.ok(reqIds.has(id), 'traceability row ' + id + ' is not a requirement');
  const invIds = inventoryIds();
  for (const r of tRows) {
    const [id, impl, contract, , evidence, status] = r;
    for (const part of contract.split(',').map((s) => s.trim()).filter(Boolean)) {
      assert.ok(part === 'unowned' || SHAPE.test(part), id + ' contract ' + part + ' has no valid shape');
      if (part !== 'unowned') assert.ok(inInventory(part, invIds), id + ' contract ' + part + ' is not in the inventory');
    }
    for (const m of impl.matchAll(REPO_PATH)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), id + ' cites a missing path ' + m[1]);
    for (const m of (impl + ' ' + evidence).matchAll(/`(test\/[A-Za-z0-9_./-]+\.test\.mjs)`/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, m[1])), id + ' cites a missing test ' + m[1]);
    }
    const citesNothing = impl === 'none' && evidence === 'none' && contract === 'unowned';
    if (citesNothing) assert.ok(status === 'MISSING' || status === 'UNKNOWN', id + ' cites nothing but its status is ' + status);
  }
});

test('SO-T-A AC03: the inventory checks every field and vocabulary', () => {
  const text = read('docs/scope-one/INVENTORY.md');
  const invRows = rows('docs/scope-one/INVENTORY.md', 'id');
  assert.ok(invRows.length > 0, 'inventory has no rows');
  const STATUSES = new Set(['queued', 'ready', 'in progress', 'blocked', 'implemented-awaiting-verification', 'verified', 'superseded', 'cancelled', 'unknown']);
  const DISPOSITIONS = new Set(['KEEP', 'INTEGRATE', 'EXTEND', 'REPAIR', 'REPLACE', 'RESEQUENCE', 'MERGE', 'SUPERSEDE', 'CANCEL_WITH_APPROVAL', 'NEW']);
  for (const r of invRows) {
    assert.equal(r.length, 8, 'row ' + r[0] + ' has ' + r.length + ' fields, need 8');
    for (const c of r) assert.ok(c.length > 0, 'row ' + r[0] + ' has an empty field');
    assert.ok(STATUSES.has(r[3]), 'row ' + r[0] + ' status ' + r[3] + ' is not in the vocabulary');
    assert.ok(DISPOSITIONS.has(r[7]), 'row ' + r[0] + ' disposition ' + r[7] + ' is not in the vocabulary');
  }
  assert.ok(/sources not read/i.test(text), 'the inventory must list the sources the author could not read');
});

test('SO-T-A AC04: the baseline is complete and the dependency graph is acyclic', () => {
  const base = read('docs/scope-one/BASELINE.md');
  assert.ok(/\b[0-9a-f]{40}\b/.test(base), 'baseline has no 40-hex commit sha');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(base.includes(pkg.scripts.test), 'baseline command is not the package.json test script');
  assert.ok(/working tree/i.test(base), 'baseline missing the working-tree state');
  assert.ok(/pass/i.test(base) && /fail/i.test(base), 'baseline missing pass/fail counts');
  assert.ok(/duration/i.test(base), 'baseline missing a duration');
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(base), 'baseline missing a date');
  const invIds = inventoryIds();
  const adj = new Map();
  const nodes = new Set();
  for (const r of rows('docs/scope-one/DEPENDENCIES.md', 'From')) {
    const [from, to] = r;
    assert.ok(inInventory(from, invIds), 'edge source ' + from + ' is absent from the inventory');
    assert.ok(inInventory(to, invIds), 'edge target ' + to + ' is absent from the inventory');
    nodes.add(from); nodes.add(to);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }
  const state = new Map();
  let cycle = null;
  const visit = (n) => {
    state.set(n, 1);
    for (const m of adj.get(n) || []) {
      if (state.get(m) === 1) { cycle = n + ' -> ' + m; return; }
      if (!state.get(m)) visit(m);
      if (cycle) return;
    }
    state.set(n, 2);
  };
  for (const n of nodes) if (!state.get(n)) visit(n);
  assert.equal(cycle, null, 'dependency graph has a cycle: ' + cycle);
});

test('SO-T-A AC05: the decisions page covers every ADR topic and the owner list', () => {
  const text = read('docs/scope-one/DECISIONS.md');
  const lower = text.toLowerCase();
  for (const t of ['store schema version and migration', 'id and event ordering', 'lease semantics', 'policy defaults', 'permission matrix']) {
    assert.ok(lower.includes(t), 'missing ADR topic: ' + t);
  }
  const statuses = [...text.matchAll(/status:\s*(proposed|decided|open)/gi)].map((m) => m[1].toLowerCase());
  assert.ok(statuses.length >= 5, 'need a status for each ADR, found ' + statuses.length);
  for (const s of statuses) assert.ok(['proposed', 'decided', 'open'].includes(s), 'bad ADR status ' + s);
  assert.ok(/question/i.test(text) && /contracts blocked/i.test(text) && /safe default/i.test(text), 'owner list missing a column');
  const ownerRows = rows('docs/scope-one/DECISIONS.md', 'Question');
  assert.ok(ownerRows.length >= 1, 'owner list has no rows');
  for (const r of ownerRows) {
    assert.ok(r.length >= 3, 'owner row has ' + r.length + ' fields, need 3');
    for (const c of r) assert.ok(c.length > 0, 'owner row has an empty field');
  }
});

test('SO-T-A AC06: the slice plan references only inventoried contracts and complete deferred rows', () => {
  const text = read('docs/scope-one/SLICE-PLAN.md');
  const invIds = inventoryIds();
  const ids = [...text.matchAll(EXTRACT)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'slice plan names no contracts');
  for (const id of new Set(ids)) assert.ok(inInventory(id, invIds), 'slice plan contract ' + id + ' is absent from the inventory');
  assert.ok(/lands:/i.test(text) && /test:/i.test(text) && /done:/i.test(text), 'a slice is missing lands/test/done');
  const defRows = rows('docs/scope-one/SLICE-PLAN.md', 'Item');
  assert.ok(defRows.length >= 1, 'no deferred rows');
  for (const r of defRows) {
    assert.ok(r.length >= 5, 'deferred row has ' + r.length + ' fields, need 5');
    for (const c of r) assert.ok(c.length > 0, 'deferred row has an empty field');
  }
});

test('SO-T-A AC07: the documentation index lists the scope-one record pages', () => {
  const readme = read('docs/README.md');
  for (const p of ['REQUIREMENTS.md', 'TRACEABILITY.md', 'INVENTORY.md', 'BASELINE.md', 'DEPENDENCIES.md', 'DECISIONS.md', 'SLICE-PLAN.md']) {
    assert.ok(readme.includes('scope-one/' + p), 'docs/README.md does not link ' + p);
  }
});
