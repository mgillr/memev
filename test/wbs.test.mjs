// SO-1.02: the work breakdown holds every requirement, every contract and every ledger row once, with a status from
// the four the page defines, and its summary counts are the counts of its rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const wbs = read('docs/scope-one/WBS.md');
const STATUSES = ['delivered', 'covered', 'new', 'blocked'];

/** Leaf rows: a table row whose first cell is a WBS number. */
function leaves() {
  const out = [];
  for (const line of wbs.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (/^\d+\.\d+(\.\d+)?$/.test(cells[0])) out.push({ wbs: cells[0], cells, line });
  }
  return out;
}
const rows = leaves();
const statusOf = (row) => row.cells.find((c, i) => i > 0 && STATUSES.includes(c));

test('SO-1.02 every leaf has one of the four statuses and a unique number', () => {
  const seen = new Set();
  for (const r of rows) {
    assert.ok(statusOf(r), `leaf ${r.wbs} has no status of ${STATUSES.join(', ')}`);
    assert.ok(!seen.has(r.wbs), `leaf number ${r.wbs} is used twice`);
    seen.add(r.wbs);
  }
});

test('SO-1.02 every requirement of the register is one leaf of section 3, with its recorded status', () => {
  const reg = read('docs/scope-one/REQUIREMENTS.md').split('\n').filter((l) => l.startsWith('| SO-REQ'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  assert.equal(reg.length, 98);
  for (const [id, , , status] of reg) {
    const hits = rows.filter((r) => r.wbs.startsWith('3.') && r.cells[1] === id);
    assert.equal(hits.length, 1, `${id} appears ${hits.length} times in section 3`);
    assert.equal(hits[0].cells[3], status, `${id}: recorded status differs from the register`);
  }
});

test('SO-1.02 every contract of every manifest is a leaf of section 1 or 2, or a new one of section 9', () => {
  for (const area of ['seed-readiness', 'quality-loop', 'scope-one']) {
    const m = JSON.parse(read(`contracts/${area}/manifest.json`));
    for (const c of m.contracts) {
      const inLeaves = rows.filter((r) => /^[12]\./.test(r.wbs) && r.cells[1] === c.id).length;
      const inIndex = new RegExp(`^\\| ${c.id.replace('.', '\\.')} \\|`, 'm').test(wbs);
      assert.ok(inLeaves === 1 || (area === 'scope-one' && inIndex), `${c.id} is not placed once`);
    }
  }
});

test('SO-1.02 every new owner named on a leaf is a contract of the scope-one manifest', () => {
  const ids = new Set(JSON.parse(read('contracts/scope-one/manifest.json')).contracts.map((c) => c.id));
  for (const id of new Set(wbs.match(/\bSO-1\.\d\d\b/g) || [])) assert.ok(ids.has(id), `${id} is not in the manifest`);
  for (const id of ids) assert.ok(wbs.includes(id), `${id} is not named in the WBS`);
});

test('SO-1.02 the summary counts equal the counts of the leaf rows', () => {
  // sections 1 to 8 are counted; the owner index of section 9 is a table of contracts, not leaves.
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) counts[statusOf(r)]++;
  const total = rows.length;
  const m = /Leaves: (\d+)\. delivered (\d+), covered (\d+), new (\d+), blocked (\d+)\./.exec(wbs);
  assert.ok(m, 'the summary line is missing');
  assert.deepEqual(m.slice(1).map(Number), [total, counts.delivered, counts.covered, counts.new, counts.blocked]);
});

test('SO-1.02 a dagger names only ids the review of #222 names, and says they are unchecked', () => {
  const allowed = new Set(['SO-02-A', 'SO-02-B', 'SO-03-A', 'SO-05-B', 'SO-05-C', 'SO-05-D', 'SO-08-B', 'SO-09-A', 'SO-11-A',
    'SO-C-A', 'SO-C-B', 'SO-C-C', 'SO-L-A', 'SO-O-A', 'SO-O-B', 'SO-O-C', 'SO-R-C', 'D-SO-MEMORY-AUTHORITY']);
  for (const m of wbs.matchAll(/\b((?:D-)?SO-[A-Z0-9]+(?:-[A-Z0-9]+)?)†/g)) assert.ok(allowed.has(m[1]), `${m[1]}† is not named by the review`);
  assert.match(wbs, /cannot be checked from here/);
});
