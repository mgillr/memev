// The weekly funnel report: one page of dated numbers from count files, gates from a file, nothing sent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { renderReport } from '../scripts/metrics/report.mjs';
after(cleanup);

const REPORT = path.join(PKG, 'scripts', 'metrics', 'report.mjs');
const GATES = path.join(PKG, 'scripts', 'metrics', 'gates.json');

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
    { day: '2026-10-22', licence_id: 'L3', result: 'refused' },
  ],
  milestones: [
    { name: 'installed', date: '2026-10-19' },
    { name: 'first_cross_app_recall', date: '2026-10-19' },
    { name: 'two_apps_one_memory', date: '2026-10-20' },
  ],
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

// The lines of one section of the page, from its header to the blank line after it.
function block(page, title) {
  const i = page.indexOf(`${title}:`);
  assert.notEqual(i, -1, `section ${title} is missing`);
  const out = [];
  for (let j = i + 1; j < page.length && page[j] !== ''; j++) out.push(page[j]);
  return out;
}

test('WO-04-A AC01: the page holds the count per day, per week and the total for each count set, all from the fixture files', async () => {
  const dir = tmpdir('wo04a-');
  const f = writeFixtures(dir);
  const args = ['--package', f.package, '--release', f.release, '--activations', f.activations, '--milestones', f.milestones];
  const first = await run(args);
  assert.equal(first.code, 0, first.err);
  const page = first.out.split('\n');
  assert.ok(page[0] === 'Memev weekly funnel report', 'the page opens with its title');
  assert.ok(page.includes('days 2026-10-19 to 2026-10-26'), 'the page is dated from the rows');
  // package downloads: per day, per week, total, straight from the file
  assert.deepEqual(block(page, 'Package downloads'), [
    '  per day:',
    '    2026-10-19: 12',
    '    2026-10-20: 30',
    '    2026-10-26: 5',
    '  per week:',
    '    2026-W43: 42',
    '    2026-W44: 5',
    '  total: 47',
  ]);
  // release downloads: the undated row counts in the total only
  assert.deepEqual(block(page, 'Release downloads'), [
    '  per day:',
    '    2026-10-20: 7',
    '  per week:',
    '    2026-W43: 7',
    '  total: 10',
  ]);
  // licence activations: issued rows counted, refused rows shown apart
  assert.deepEqual(block(page, 'Licence activations'), [
    '  per day:',
    '    2026-10-21: 2',
    '  per week:',
    '    2026-W43: 2',
    '  total: 2',
    '  refused: 1',
  ]);
  // milestones: the opt-in rows, per day, per week, total and per name
  assert.deepEqual(block(page, 'Milestones'), [
    '  per day:',
    '    2026-10-19: 2',
    '    2026-10-20: 1',
    '  per week:',
    '    2026-W43: 3',
    '  total: 3',
    '  per name:',
    '    first_cross_app_recall: 1',
    '    installed: 1',
    '    two_apps_one_memory: 1',
  ]);
  // nothing is estimated and nothing is typed into the program: the files alone make the page
  const again = await run(args);
  assert.equal(again.out, first.out);
});

test('WO-04-A AC02: the header renders the two gates from the gates file with measured value, threshold and pass or miss, and editing the file changes the header with no change to the program', async () => {
  const dir = tmpdir('wo04a-');
  const f = writeFixtures(dir);
  const args = ['--package', f.package, '--release', f.release, '--activations', f.activations];
  // the shipped file: the thresholds live in it, the installs choice is open, so both gates stay open
  const gates = JSON.parse(fs.readFileSync(GATES, 'utf8'));
  assert.equal(gates.installs_proxy, null, 'the file says the installs choice is open');
  const first = await run(args);
  assert.equal(first.code, 0, first.err);
  const page = first.out.split('\n');
  assert.ok(page.some((l) => l.startsWith('Gates (')), 'the header carries the gates');
  assert.ok(page.includes('  installs at or above 5,000 by month 6: measured open, threshold 5000, open'));
  assert.ok(page.includes('  free-to-paid at or above 1 percent once sync has shipped: measured open, threshold 1 percent, open'));
  assert.ok(page.some((l) => l.startsWith('  installs proxy: open')), 'the page prints which counted number stands for installs');
  // editing the file changes the header with no change to the program: a proxy and a low threshold pass
  const g1 = { ...gates, installs_proxy: 'package_downloads', gates: [
    { name: 'installs at or above 5,000 by month 6', metric: 'installs', threshold: 10 },
    { name: 'free-to-paid at or above 1 percent once sync has shipped', metric: 'free_to_paid_percent', threshold: 1 },
  ] };
  const g1f = path.join(dir, 'gates1.json');
  fs.writeFileSync(g1f, JSON.stringify(g1));
  const r1 = await run([...args, '--gates', g1f]);
  assert.equal(r1.code, 0, r1.err);
  const p1 = r1.out.split('\n');
  assert.ok(p1.includes('  installs proxy: package_downloads'));
  assert.ok(p1.includes('  installs at or above 5,000 by month 6: measured 47, threshold 10, pass'));
  assert.ok(p1.includes('  free-to-paid at or above 1 percent once sync has shipped: measured 4.26, threshold 1 percent, pass'));
  // and a high threshold flips the verdict to miss, still from the file alone
  const g2 = { ...g1, gates: [
    { name: 'installs at or above 5,000 by month 6', metric: 'installs', threshold: 5000 },
    { name: 'free-to-paid at or above 1 percent once sync has shipped', metric: 'free_to_paid_percent', threshold: 100 },
  ] };
  const g2f = path.join(dir, 'gates2.json');
  fs.writeFileSync(g2f, JSON.stringify(g2));
  const r2 = await run([...args, '--gates', g2f]);
  assert.equal(r2.code, 0, r2.err);
  const p2 = r2.out.split('\n');
  assert.ok(p2.includes('  installs at or above 5,000 by month 6: measured 47, threshold 5000, miss'));
  assert.ok(p2.includes('  free-to-paid at or above 1 percent once sync has shipped: measured 4.26, threshold 100 percent, miss'));
});

test('WO-04-A AC03: the report is a development tool that reports nothing anywhere: no vault import, no call of its own, not in the package file list, and no milestone input says so in one line', async () => {
  // the code: only the file and path built-ins, no vault module, nothing that can reach a network or start a program
  const src = fs.readFileSync(REPORT, 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(imports.sort(), ['node:fs', 'node:path', 'node:process', 'node:url']);
  assert.equal(src.includes('src/'), false, 'no vault module');
  // the behaviour: with every way out of the process stubbed, rendering makes no call
  const calls = [];
  const keep = { fetch: globalThis.fetch, connect: net.Socket.prototype.connect, hreq: http.request, sreq: https.request };
  globalThis.fetch = () => { calls.push('fetch'); throw new Error('network'); };
  net.Socket.prototype.connect = function () { calls.push('connect'); throw new Error('network'); };
  http.request = () => { calls.push('http'); throw new Error('network'); };
  https.request = () => { calls.push('https'); throw new Error('network'); };
  try {
    const gates = JSON.parse(fs.readFileSync(GATES, 'utf8'));
    const page = renderReport({ packageRows: FIXTURE.package, releaseRows: FIXTURE.release, activationRows: FIXTURE.activations, milestoneRows: FIXTURE.milestones, gates, gatesLabel: 'gates.json' });
    assert.ok(page.startsWith('Memev weekly funnel report'));
  } finally {
    globalThis.fetch = keep.fetch;
    net.Socket.prototype.connect = keep.connect;
    http.request = keep.hreq;
    https.request = keep.sreq;
  }
  assert.deepEqual(calls, []);
  // the package file list does not ship it
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  for (const entry of pkg.files) assert.ok(!entry.startsWith('scripts'), `the package ships ${entry}`);
  // with no milestone input the page says so in one line and still renders
  const dir = tmpdir('wo04a-');
  const f = writeFixtures(dir);
  const args = ['--package', f.package, '--release', f.release, '--activations', f.activations];
  const { code, out } = await run(args);
  assert.equal(code, 0, out);
  const page = out.split('\n');
  assert.ok(page.includes('Milestones: no milestone input'));
  assert.equal(page.filter((l) => l.includes('Milestones')).length, 1, 'one line');
  assert.ok(page.includes('Package downloads:'), 'the rest of the page still renders');
  assert.ok(page.includes('  total: 47'));
  // and a run with every way out of the process stubbed at the environment level still renders
  const dead = 'http://127.0.0.1:9';
  const stubbed = await run(args, { HTTP_PROXY: dead, HTTPS_PROXY: dead, ALL_PROXY: dead, NO_PROXY: '' });
  assert.equal(stubbed.code, 0, stubbed.err);
  assert.ok(stubbed.out.includes('Memev weekly funnel report'));
});
