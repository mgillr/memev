// The monthly verdict: each gate as a row with its measured value and its pre-written branch,
// read from the gate file, no judgement.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { renderReport } from '../scripts/metrics/report.mjs';
after(cleanup);

const REPORT = path.join(PKG, 'scripts', 'metrics', 'report.mjs');

// The counted rows: 47 package downloads, 10 release downloads, 3 issued activations across 2
// distinct licences and 1 refused, and 1 completed Business pilot among the milestone rows.
const FIXTURE = {
  package: [
    { day: '2026-10-19', downloads: 12 },
    { day: '2026-10-20', downloads: 30 },
    { day: '2026-10-26', downloads: 5 },
  ],
  release: [
    { day: '2026-10-20', file: 'memev-0.1.0-linux.tar.gz', downloads: 7 },
    { downloads: 3 },
  ],
  activations: [
    { day: '2026-10-21', licence_id: 'L1', result: 'issued' },
    { day: '2026-10-21', licence_id: 'L2', result: 'issued' },
    { day: '2026-10-22', licence_id: 'L1', result: 'issued' },
    { day: '2026-10-22', licence_id: 'L3', result: 'refused' },
  ],
  milestones: [
    { name: 'installed', date: '2026-10-19' },
    { name: 'business_pilot_completed', date: '2026-10-25' },
  ],
};

// A gate file with the installs choice made and thresholds set so the four monthly gates come out
// pass, miss, miss, pass. The branch texts are held here, in the file, not in the program.
const MONTHLY_GATES = {
  installs_proxy: 'package_downloads',
  gates: [
    { name: 'installs at or above 5,000 by month 6', metric: 'installs', threshold: 5000 },
    { name: 'free-to-paid at or above 1 percent once sync has shipped', metric: 'free_to_paid_percent', threshold: 1 },
  ],
  monthly: {
    gates: [
      { name: 'installs at or above 5,000 with the package and the directory listings live', metric: 'installs', threshold: 40, due_month: 6, branch: 'the branch the file holds for the installs gate' },
      { name: 'free-to-paid conversion at or above 1 percent once sync has shipped', metric: 'free_to_paid_percent', threshold: 100, due_month: 6, branch: 'the branch the file holds for the conversion gate' },
      { name: 'paying users at or above 600', metric: 'distinct_issued_licences', threshold: 600, due_month: 12, branch: 'the branch the file holds for the paying users gate' },
      { name: 'at least one organisation through a completed Business pilot', metric: 'milestone', milestone: 'business_pilot_completed', threshold: 1, due_month: 12, branch: 'the branch the file holds for the pilot gate' },
    ],
  },
};

function writeFixtures(dir) {
  const files = {};
  for (const [name, rows] of Object.entries(FIXTURE)) {
    files[name] = path.join(dir, `${name}.json`);
    fs.writeFileSync(files[name], JSON.stringify(rows));
  }
  return files;
}

const run = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [REPORT, ...args], { env: { PATH: process.env.PATH, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});

function baseArgs(f) {
  return ['--package', f.package, '--release', f.release, '--activations', f.activations, '--milestones', f.milestones];
}

// The lines of the monthly verdict section, from its header to the blank line after it.
function verdict(page) {
  const i = page.findIndex((l) => l.startsWith('Monthly verdict'));
  assert.notEqual(i, -1, 'the monthly verdict section is missing');
  const out = [];
  for (let j = i; j < page.length && page[j] !== ''; j++) out.push(page[j]);
  return out;
}

test('WO-12-A AC01: the report has a monthly verdict section that renders each gate as a row: the gate, its threshold read from the gate file, the measured value, the month it falls due and pass or miss', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  const gf = path.join(dir, 'gates.json');
  fs.writeFileSync(gf, JSON.stringify(MONTHLY_GATES));
  const { code, out, err } = await run([...baseArgs(f), '--gates', gf, '--month', '12']);
  assert.equal(code, 0, err);
  const rows = verdict(out.split('\n'));
  assert.equal(rows[0], 'Monthly verdict (month 12):');
  assert.deepEqual(rows.slice(1), [
    '  installs at or above 5,000 with the package and the directory listings live: measured 47, threshold 40, due month 6, pass',
    '  free-to-paid conversion at or above 1 percent once sync has shipped: measured 6.38, threshold 100 percent, due month 6, miss',
    '    branch: the branch the file holds for the conversion gate',
    '  paying users at or above 600: measured 2, threshold 600, due month 12, miss',
    '    branch: the branch the file holds for the paying users gate',
    '  at least one organisation through a completed Business pilot: measured 1, threshold 1, due month 12, pass',
  ]);
  // the threshold and due month on each row are the ones the file holds
  const file = JSON.parse(fs.readFileSync(gf, 'utf8'));
  for (const g of file.monthly.gates) {
    const unit = g.metric === 'free_to_paid_percent' ? ' percent' : '';
    assert.ok(rows.some((l) => l.includes(`threshold ${g.threshold}${unit}, due month ${g.due_month}`)), `the row for ${g.name} carries the file's threshold and due month`);
  }
  // and the shipped gate file drives the section the same way, with its own thresholds
  const shipped = await run([...baseArgs(f), '--month', '12']);
  assert.equal(shipped.code, 0, shipped.err);
  const srows = verdict(shipped.out.split('\n'));
  assert.ok(srows.includes('  paying users at or above 600: measured 2, threshold 600, due month 12, miss'));
  assert.ok(srows.includes('  at least one organisation through a completed Business pilot: measured 1, threshold 1, due month 12, pass'));
  assert.ok(srows.includes('  installs at or above 5,000 with the package and the directory listings live: measured not measured, threshold 5000, due month 6, not measured'));
});

test('WO-12-A AC02: a missed gate prints the branch text held for that gate in the gate file word for word, a met gate prints none, and no branch text is written in the program', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  const gf = path.join(dir, 'gates.json');
  fs.writeFileSync(gf, JSON.stringify(MONTHLY_GATES));
  const { code, out, err } = await run([...baseArgs(f), '--gates', gf, '--month', '12']);
  assert.equal(code, 0, err);
  const rows = verdict(out.split('\n'));
  const iInstalls = rows.findIndex((l) => l.startsWith('  installs at or above 5,000 with the package'));
  const iConv = rows.findIndex((l) => l.startsWith('  free-to-paid conversion'));
  const iPay = rows.findIndex((l) => l.startsWith('  paying users'));
  const iPilot = rows.findIndex((l) => l.startsWith('  at least one organisation'));
  assert.notEqual(iInstalls, -1, 'the installs row is there');
  assert.notEqual(iConv, -1, 'the conversion row is there');
  assert.notEqual(iPay, -1, 'the paying users row is there');
  assert.notEqual(iPilot, -1, 'the pilot row is there');
  assert.ok(rows[iInstalls].endsWith(', pass'), 'the installs gate is met');
  assert.ok(rows[iConv].endsWith(', miss'), 'the conversion gate is missed');
  assert.ok(rows[iPay].endsWith(', miss'), 'the paying users gate is missed');
  assert.ok(rows[iPilot].endsWith(', pass'), 'the pilot gate is met');
  // the missed gates print the file's branch text word for word
  assert.equal(rows[iConv + 1], `    branch: ${MONTHLY_GATES.monthly.gates[1].branch}`, 'the missed conversion gate prints the file branch word for word');
  assert.equal(rows[iPay + 1], `    branch: ${MONTHLY_GATES.monthly.gates[2].branch}`, 'the missed paying users gate prints the file branch word for word');
  // the met gates print no branch line
  assert.equal(rows[iInstalls + 1], rows[iConv], 'the met installs gate prints no branch line');
  assert.equal(iPilot + 1, rows.length, 'the met pilot gate at the end prints no branch line');
  // no branch text is written in the program
  const src = fs.readFileSync(REPORT, 'utf8');
  for (const g of MONTHLY_GATES.monthly.gates) assert.ok(!src.includes(g.branch), 'the program holds no branch text');
});

test('WO-12-A AC03: the month-6 and month-12 gates are separate rows with their own thresholds and dates, and a gate whose month has not arrived renders as not yet due, never as a miss', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  const gf = path.join(dir, 'gates.json');
  fs.writeFileSync(gf, JSON.stringify(MONTHLY_GATES));
  const args = [...baseArgs(f), '--gates', gf];
  // month 3: every gate is not yet due, even the ones that would miss
  let r = await run([...args, '--month', '3']);
  assert.equal(r.code, 0, r.err);
  let rows = verdict(r.out.split('\n'));
  assert.equal(rows[0], 'Monthly verdict (month 3):');
  assert.deepEqual(rows.slice(1), [
    '  installs at or above 5,000 with the package and the directory listings live: measured 47, threshold 40, due month 6, not yet due',
    '  free-to-paid conversion at or above 1 percent once sync has shipped: measured 6.38, threshold 100 percent, due month 6, not yet due',
    '  paying users at or above 600: measured 2, threshold 600, due month 12, not yet due',
    '  at least one organisation through a completed Business pilot: measured 1, threshold 1, due month 12, not yet due',
  ]);
  assert.ok(rows.every((l) => !l.includes('miss')), 'nothing is a miss before its month');
  // month 6: the month-6 rows are due, the month-12 rows are not yet due
  r = await run([...args, '--month', '6']);
  assert.equal(r.code, 0, r.err);
  rows = verdict(r.out.split('\n'));
  assert.ok(rows.includes('  installs at or above 5,000 with the package and the directory listings live: measured 47, threshold 40, due month 6, pass'));
  assert.ok(rows.includes('  free-to-paid conversion at or above 1 percent once sync has shipped: measured 6.38, threshold 100 percent, due month 6, miss'));
  assert.ok(rows.includes('  paying users at or above 600: measured 2, threshold 600, due month 12, not yet due'));
  assert.ok(rows.includes('  at least one organisation through a completed Business pilot: measured 1, threshold 1, due month 12, not yet due'));
  // the two months are separate rows with their own thresholds and dates
  assert.equal(rows.filter((l) => l.includes('due month 6')).length, 2, 'two month-6 rows');
  assert.equal(rows.filter((l) => l.includes('due month 12')).length, 2, 'two month-12 rows');
});

test('WO-12-A AC04: the verdict needs no judgement: the same inputs give the same section twice over byte for byte, every number in it comes from the measured counts, and a gate with no measured value renders as not measured rather than as a pass', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  const gf = path.join(dir, 'gates.json');
  fs.writeFileSync(gf, JSON.stringify(MONTHLY_GATES));
  const args = [...baseArgs(f), '--gates', gf, '--month', '12'];
  // the same inputs give the same section twice over, byte for byte
  const a = await run(args);
  const b = await run(args);
  assert.equal(a.code, 0, a.err);
  assert.deepEqual(verdict(a.out.split('\n')), verdict(b.out.split('\n')), 'the section is byte for byte the same twice over');
  // and the exported render is byte for byte the same twice over
  const gates = JSON.parse(fs.readFileSync(gf, 'utf8'));
  const input = { packageRows: FIXTURE.package, releaseRows: FIXTURE.release, activationRows: FIXTURE.activations, milestoneRows: FIXTURE.milestones, gates, gatesLabel: 'gates.json', month: 12 };
  assert.equal(renderReport(input), renderReport(input), 'the render is byte for byte the same twice over');
  // every number in the section comes from the measured counts or the file
  const rows = verdict(a.out.split('\n'));
  const byName = (prefix) => rows.find((l) => l.startsWith(`  ${prefix}`));
  const measuredOf = (row) => Number(row.match(/measured ([0-9.]+)/)[1]);
  assert.equal(measuredOf(byName('installs at or above')), 47, 'installs measured from the package download rows');
  assert.equal(measuredOf(byName('free-to-paid conversion')), 6.38, 'free-to-paid measured from the activation rows over the install rows');
  assert.equal(measuredOf(byName('paying users')), 2, 'paying users measured as the distinct issued licences');
  assert.equal(measuredOf(byName('at least one organisation')), 1, 'the pilot measured from the milestone rows');
  for (const g of gates.monthly.gates) {
    const unit = g.metric === 'free_to_paid_percent' ? ' percent' : '';
    assert.ok(byName(g.name).includes(`threshold ${g.threshold}${unit}`), `the threshold on the row is the file's`);
  }
  // and a different count moves the measured value with it
  const dir2 = tmpdir('wo12a-');
  const f2 = writeFixtures(dir2);
  const act2 = JSON.parse(fs.readFileSync(f2.activations, 'utf8'));
  act2.push({ day: '2026-10-23', licence_id: 'L9', result: 'issued' });
  fs.writeFileSync(f2.activations, JSON.stringify(act2));
  const c = await run([...baseArgs(f2), '--gates', gf, '--month', '12']);
  assert.equal(c.code, 0, c.err);
  const rows2 = verdict(c.out.split('\n'));
  assert.ok(rows2.find((l) => l.startsWith('  paying users')).includes('measured 3'), 'the measured value follows the count');
  assert.ok(rows2.find((l) => l.startsWith('  free-to-paid conversion')).includes('measured 8.51'), 'the measured value follows the count');
  // a gate with no measured value renders as not measured rather than as a pass
  const d = await run([...baseArgs(f), '--month', '12']);
  assert.equal(d.code, 0, d.err);
  const installsRow = verdict(d.out.split('\n')).find((l) => l.startsWith('  installs at or above 5,000 with the package'));
  assert.ok(installsRow.includes('measured not measured'), 'the gate with no measured value says so');
  assert.ok(installsRow.endsWith(', not measured'), 'it is not a pass');
  assert.ok(!installsRow.includes('pass'), 'it is not a pass');
});
