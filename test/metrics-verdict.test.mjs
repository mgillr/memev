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

// The counted rows: 47 package downloads, 10 release downloads, 3 paid activations across 2
// distinct licences, 2 trial activations (one marked true, one marked 1 as a SQL export gives it)
// and 1 refused, and 1 install and 1 completed Business pilot among the milestone rows.
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
    { day: '2026-10-22', licence_id: 'T1', result: 'issued', trial: true },
    { day: '2026-10-22', licence_id: 'T2', result: 'issued', trial: 1 },
    { day: '2026-10-22', licence_id: 'L3', result: 'refused' },
  ],
  milestones: [
    { id: 'r1', name: 'installed', date: '2026-10-19' },
    { id: 'r1', name: 'business_pilot_completed', date: '2026-10-25' },
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
      { name: 'paying users at or above 600', metric: 'distinct_paid_licences', threshold: 600, due_month: 12, branch: 'the branch the file holds for the paying users gate' },
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
    '  installs at or above 5,000 with the package and the directory listings live: measured 47 downloads, threshold 40, due month 6, pass',
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
  // paying users are the distinct paid licences: L1 and L2, never the trials T1 (true) and T2 (1)
  assert.ok(srows.includes('  paying users at or above 600: measured 2, threshold 600, due month 12, miss'), shipped.out);
  // installs are the downloads, package and release together (47 + 10), as the shipped file chooses
  assert.ok(srows.includes('  installs at or above 5,000 with the package and the directory listings live: measured 57 downloads, threshold 5000, due month 6, miss'), shipped.out);
  // no code records a completed Business pilot, so the shipped file marks that gate planned: it is
  // planned, not measured, even with such a row in the milestone input, and prints no branch
  const iPilot = srows.findIndex((l) => l.startsWith('  at least one organisation'));
  assert.equal(srows[iPilot], '  at least one organisation through a completed Business pilot: measured not measured, threshold 1, due month 12, planned, not measured', shipped.out);
  assert.equal(iPilot + 1, srows.length, 'the planned gate prints no branch line');
  const shippedFile = JSON.parse(fs.readFileSync(path.join(PKG, 'scripts', 'metrics', 'gates.json'), 'utf8'));
  assert.ok(shippedFile.monthly.gates.find((g) => g.milestone === 'business_pilot_completed').planned, 'the shipped file marks the pilot gate planned');
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
    '  installs at or above 5,000 with the package and the directory listings live: measured 47 downloads, threshold 40, due month 6, not yet due',
    '  free-to-paid conversion at or above 1 percent once sync has shipped: measured 6.38, threshold 100 percent, due month 6, not yet due',
    '  paying users at or above 600: measured 2, threshold 600, due month 12, not yet due',
    '  at least one organisation through a completed Business pilot: measured 1, threshold 1, due month 12, not yet due',
  ]);
  assert.ok(rows.every((l) => !l.includes('miss')), 'nothing is a miss before its month');
  // month 6: the month-6 rows are due, the month-12 rows are not yet due
  r = await run([...args, '--month', '6']);
  assert.equal(r.code, 0, r.err);
  rows = verdict(r.out.split('\n'));
  assert.ok(rows.includes('  installs at or above 5,000 with the package and the directory listings live: measured 47 downloads, threshold 40, due month 6, pass'));
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
  // a gate with no measured value renders as not measured rather than as a pass: no installs choice
  const open = path.join(dir, 'gates-open.json');
  fs.writeFileSync(open, JSON.stringify({ ...MONTHLY_GATES, installs_proxy: null }));
  const d = await run([...baseArgs(f), '--gates', open, '--month', '12']);
  assert.equal(d.code, 0, d.err);
  const installsRow = verdict(d.out.split('\n')).find((l) => l.startsWith('  installs at or above 5,000 with the package'));
  assert.ok(installsRow.includes('measured not measured'), 'the gate with no measured value says so');
  assert.ok(installsRow.endsWith(', not measured'), 'it is not a pass');
  assert.ok(!installsRow.includes('pass'), 'it is not a pass');
  // a count file that was not handed in measures nothing: with no --activations and no --milestones
  // the gates that read them are not measured, never 0 and a miss with the branch text
  const e = await run(['--package', f.package, '--gates', gf, '--month', '12']);
  assert.equal(e.code, 0, e.err);
  assert.deepEqual(verdict(e.out.split('\n')).slice(1), [
    '  installs at or above 5,000 with the package and the directory listings live: measured 47 downloads, threshold 40, due month 6, pass',
    '  free-to-paid conversion at or above 1 percent once sync has shipped: measured not measured, threshold 100 percent, due month 6, not measured',
    '  paying users at or above 600: measured not measured, threshold 600, due month 12, not measured',
    '  at least one organisation through a completed Business pilot: measured not measured, threshold 1, due month 12, not measured',
  ], e.out);
  // and installs through the downloads choice need both download files: with only one it is not measured
  const both = path.join(dir, 'gates-downloads.json');
  fs.writeFileSync(both, JSON.stringify({ ...MONTHLY_GATES, installs_proxy: 'downloads' }));
  const g = await run(['--package', f.package, '--activations', f.activations, '--gates', both, '--month', '12']);
  assert.equal(g.code, 0, g.err);
  const grows = verdict(g.out.split('\n'));
  assert.ok(grows.includes('  installs at or above 5,000 with the package and the directory listings live: measured not measured, threshold 40, due month 6, not measured'), g.out);
  assert.ok(grows.includes('  free-to-paid conversion at or above 1 percent once sync has shipped: measured not measured, threshold 100 percent, due month 6, not measured'), g.out);
  assert.ok(!g.out.includes('branch: the branch the file holds for the conversion gate'), 'no branch for a gate that was not measured');
});

test('WO-12-A AC04: a month that is not a whole number of months, 1 or more, is refused with an error and no page, never dropped in silence', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  const gf = path.join(dir, 'gates.json');
  fs.writeFileSync(gf, JSON.stringify(MONTHLY_GATES));
  for (const bad of [['--month', 'abc'], ['--month', '6.5'], ['--month', '0'], ['--month', '-3'], ['--month', ''], ['--month']]) {
    const r = await run([...baseArgs(f), '--gates', gf, ...bad]);
    assert.equal(r.code, 2, `${bad.join(' ')} exits 2`);
    assert.match(r.err, /--month is a whole number of months, 1 or more/, `${bad.join(' ')} says why`);
    assert.equal(r.out, '', `${bad.join(' ')} prints no page`);
  }
  // a flag in the place of the month is refused too, not read as a month
  const r = await run([...baseArgs(f), '--month', '--gates', gf]);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  // a whole month still renders the verdict
  const ok = await run([...baseArgs(f), '--gates', gf, '--month', '6']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(verdict(ok.out.split('\n'))[0], 'Monthly verdict (month 6):');
});

test('WO-12-A AC04: the header gates and the monthly verdict read the same handed-in counts, so a number that was not counted is not measured in both, never 0 and a miss in the header', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  const gf = path.join(dir, 'gates.json');
  fs.writeFileSync(gf, JSON.stringify(MONTHLY_GATES));
  // the file chooses package downloads for installs, and no --package is handed in
  const r = await run(['--activations', f.activations, '--milestones', f.milestones, '--gates', gf, '--month', '6']);
  assert.equal(r.code, 0, r.err);
  const page = r.out.split('\n');
  assert.ok(page.includes('  installs at or above 5,000 by month 6: measured not measured, threshold 5000, not measured'), r.out);
  assert.ok(page.includes('  free-to-paid at or above 1 percent once sync has shipped: measured not measured, threshold 1 percent, not measured'), r.out);
  assert.ok(page.includes('  installs proxy: package_downloads (a download is not an install)'), 'the choice is still named, not called open');
  const rows = verdict(page);
  assert.ok(rows.includes('  installs at or above 5,000 with the package and the directory listings live: measured not measured, threshold 40, due month 6, not measured'), r.out);
  assert.ok(rows.includes('  free-to-paid conversion at or above 1 percent once sync has shipped: measured not measured, threshold 100 percent, due month 6, not measured'), r.out);
  assert.ok(!page.some((l) => /measured 0\b/.test(l)), 'no 0 for a number that was not counted');
  // installs counted and no --activations: free-to-paid is not measured in the header as in the verdict
  const a = await run(['--package', f.package, '--gates', gf, '--month', '6']);
  assert.equal(a.code, 0, a.err);
  const pa = a.out.split('\n');
  assert.ok(pa.includes('  installs at or above 5,000 by month 6: measured 47 downloads, threshold 5000, miss'), a.out);
  assert.ok(pa.includes('  free-to-paid at or above 1 percent once sync has shipped: measured not measured, threshold 1 percent, not measured'), a.out);
  assert.ok(verdict(pa).includes('  free-to-paid conversion at or above 1 percent once sync has shipped: measured not measured, threshold 100 percent, due month 6, not measured'), a.out);
  // the shipped choice, downloads, with one of its two files: not measured in both, and still named as the choice
  const b = await run(['--package', f.package, '--activations', f.activations, '--month', '6']);
  assert.equal(b.code, 0, b.err);
  const pb = b.out.split('\n');
  assert.ok(pb.includes('  installs at or above 5,000 by month 6: measured not measured, threshold 5000, not measured'), b.out);
  assert.ok(pb.includes('  installs proxy: downloads (a download is not an install)'), b.out);
  assert.ok(verdict(pb).includes('  installs at or above 5,000 with the package and the directory listings live: measured not measured, threshold 5000, due month 6, not measured'), b.out);
});

test('WO-12-A AC01: a month with a gate file that holds no monthly gates prints one line saying so, never nothing', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  const files = { none: { installs_proxy: 'package_downloads', gates: MONTHLY_GATES.gates }, empty: { ...MONTHLY_GATES, monthly: { gates: [] } } };
  for (const [name, file] of Object.entries(files)) {
    const gf = path.join(dir, `gates-${name}.json`);
    fs.writeFileSync(gf, JSON.stringify(file));
    const r = await run([...baseArgs(f), '--gates', gf, '--month', '6']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(verdict(r.out.split('\n')), ['Monthly verdict (month 6): the gate file holds no monthly gates'], r.out);
    // with no month there is no verdict line at all
    const n = await run([...baseArgs(f), '--gates', gf]);
    assert.equal(n.code, 0, n.err);
    assert.ok(!n.out.includes('Monthly verdict'), n.out);
  }
});

test('WO-12-A AC01: the installs gate reads downloads, package and release together in the shipped file, printed as downloads, with the distinct report ids that sent the installed milestone under it as a floor of confirmed installs', async () => {
  const dir = tmpdir('wo12a-');
  const f = writeFixtures(dir);
  // the shipped file: 47 package and 10 release downloads, and one installed row among the milestones
  const r = await run([...baseArgs(f), '--month', '6']);
  assert.equal(r.code, 0, r.err);
  const page = r.out.split('\n');
  const i = page.indexOf('  installs at or above 5,000 by month 6: measured 57 downloads, threshold 5000, miss');
  assert.notEqual(i, -1, r.out);
  assert.equal(page[i + 1], '    confirmed installs, a floor: 1 (distinct report ids with the installed milestone; a report turned off and on again gets a new id, so one install can count twice)', r.out);
  assert.ok(page.includes('  installs proxy: downloads (a download is not an install)'), r.out);
  // the verdict reads the same 57 downloads
  assert.ok(verdict(page).includes('  installs at or above 5,000 with the package and the directory listings live: measured 57 downloads, threshold 5000, due month 6, miss'), r.out);
  // the floor counts installations, never rows: the report resends every recorded milestone under one id whenever a new
  // one appears, so r1's installed row arriving again counts once; a second id counts; a row with no id is shown apart
  const ms = path.join(dir, 'milestones3.json');
  fs.writeFileSync(ms, JSON.stringify([...FIXTURE.milestones, { id: 'r1', name: 'installed', date: '2026-10-19' }, { id: 'r1', name: 'invite_sent', date: '2026-10-21' }, { id: 'r2', name: 'installed', date: '2026-10-21' }, { name: 'installed', date: '2026-10-22' }]));
  const m = await run(['--package', f.package, '--release', f.release, '--activations', f.activations, '--milestones', ms]);
  assert.equal(m.code, 0, m.err);
  const pm = m.out.split('\n');
  assert.ok(pm.includes('    confirmed installs, a floor: 2 (distinct report ids with the installed milestone; a report turned off and on again gets a new id, so one install can count twice)'), m.out);
  assert.ok(pm.includes('    installed rows with no report id, not counted: 1'), m.out);
  // with no milestone input the floor is not measured, never 0
  const n = await run(['--package', f.package, '--release', f.release, '--activations', f.activations]);
  assert.equal(n.code, 0, n.err);
  const pn = n.out.split('\n');
  assert.ok(pn.includes('    confirmed installs, a floor: not measured (no milestone input)'), n.out);
  assert.ok(pn.includes('Milestones: no milestone input'), 'the milestone section says so too');
});
