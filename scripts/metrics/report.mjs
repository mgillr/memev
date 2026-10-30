#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The weekly funnel report: downloads, activations and milestones in one page. A development tool
// for the owner: it reads count files handed to it (package download rows, release-host download
// rows, licence-activation rows, and optionally the opt-in milestone rows), renders one page of
// dated numbers, and prints a header of gates read from scripts/metrics/gates.json. When a month
// is given it adds the monthly verdict: each of the file's monthly gates as a row with its
// threshold, its measured value, the month it falls due and pass or miss, and for a missed gate
// the branch text held for that gate in the file. The thresholds, due months and branch text live
// in the file, never in this program. It reports nothing anywhere, holds no address, and is not
// in the npm package file list.
// Usage: node scripts/metrics/report.mjs [--package FILE] [--release FILE] [--activations FILE]
//        [--milestones FILE] [--gates FILE] [--month N]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ISO week (the week that holds the Thursday), as YYYY-Www.
function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back + 3);
  const year = d.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  const firstBack = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - firstBack + 3);
  const week = 1 + Math.round((d.getTime() - first.getTime()) / (7 * 86400e3));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function readRows(file) {
  if (!file) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`count file must hold a JSON array of rows: ${file}`);
  return data;
}

function aggregate(rows, valueOf, dateOf) {
  const perDay = new Map();
  const perWeek = new Map();
  let total = 0;
  for (const row of rows) {
    const n = valueOf(row);
    if (!Number.isFinite(n)) continue;
    total += n;
    if (n === 0) continue;
    const day = dateOf(row);
    if (!day) continue;
    perDay.set(day, (perDay.get(day) || 0) + n);
    const week = isoWeek(day);
    perWeek.set(week, (perWeek.get(week) || 0) + n);
  }
  return { perDay, perWeek, total };
}

const num = (row) => (Number.isFinite(row.downloads) ? row.downloads : 0);
const issued = (row) => (row.result === 'issued' ? 1 : 0);
const refused = (row) => (row.result === 'refused' ? 1 : 0);

function section(title, agg, { hasRows, noInput, extra = [] } = {}) {
  if (!hasRows) return [`${title}: ${noInput || 'no input'}`];
  const lines = [`${title}:`];
  if (agg.perDay.size) {
    lines.push('  per day:');
    for (const [day, n] of [...agg.perDay].sort()) lines.push(`    ${day}: ${n}`);
  }
  if (agg.perWeek.size) {
    lines.push('  per week:');
    for (const [week, n] of [...agg.perWeek].sort()) lines.push(`    ${week}: ${n}`);
  }
  lines.push(`  total: ${agg.total}`);
  for (const line of extra) lines.push(line);
  return lines;
}

const PROXIES = {
  package_downloads: (t) => t.package,
  release_downloads: (t) => t.release,
  downloads: (t) => t.package + t.release,
  activations: (t) => t.activations,
};

function pct(n) {
  return String(Math.round(n * 100) / 100);
}

function gateLines(gates, totals, label) {
  const lines = [`Gates (${label}):`];
  const proxy = gates.installs_proxy;
  const installs = proxy && PROXIES[proxy] ? PROXIES[proxy](totals) : null;
  for (const g of gates.gates || []) {
    let measured = 'open';
    let verdict = 'open';
    if (installs !== null) {
      if (g.metric === 'installs') measured = installs;
      else if (g.metric === 'free_to_paid_percent') measured = installs > 0 ? pct((totals.activations / installs) * 100) : 0;
      verdict = measured >= g.threshold ? 'pass' : 'miss';
    }
    const unit = g.metric === 'free_to_paid_percent' ? ' percent' : '';
    lines.push(`  ${g.name}: measured ${measured}, threshold ${g.threshold}${unit}, ${verdict}`);
  }
  if (proxy && PROXIES[proxy]) lines.push(`  installs proxy: ${proxy}`);
  else lines.push(`  installs proxy: open (${gates.installs_proxy_note || "which counted number stands for installs is the owner's choice"})`);
  return lines;
}

// The measured value of one monthly gate, from the counted rows alone.
function monthlyValue(g, totals, installs, issuedLicences, milestoneNames) {
  if (g.metric === 'installs') return installs;
  if (g.metric === 'free_to_paid_percent') return installs === null ? null : installs > 0 ? pct((totals.activations / installs) * 100) : 0;
  if (g.metric === 'distinct_issued_licences') return issuedLicences;
  if (g.metric === 'milestone') return milestoneNames.get(g.milestone) || 0;
  return null;
}

// The monthly verdict: each of the file's monthly gates as a row. A gate whose due month has not
// arrived is not yet due, never a miss; a gate with no measured value is not measured, never a
// pass; a missed gate prints the branch text held for it in the file, word for word.
function verdictLines(gates, month, totals, activationRows, milestoneRows) {
  const lines = [`Monthly verdict (month ${month}):`];
  const proxy = gates.installs_proxy;
  const installs = proxy && PROXIES[proxy] ? PROXIES[proxy](totals) : null;
  const issuedLicences = new Set(activationRows.filter((r) => r && r.result === 'issued' && r.licence_id).map((r) => r.licence_id)).size;
  const milestoneNames = new Map();
  for (const row of milestoneRows) if (row && row.name) milestoneNames.set(row.name, (milestoneNames.get(row.name) || 0) + 1);
  for (const g of (gates.monthly && gates.monthly.gates) || []) {
    const measured = monthlyValue(g, totals, installs, issuedLicences, milestoneNames);
    let status;
    if (g.due_month > month) status = 'not yet due';
    else if (measured === null) status = 'not measured';
    else if (measured >= g.threshold) status = 'pass';
    else status = 'miss';
    const unit = g.metric === 'free_to_paid_percent' ? ' percent' : '';
    lines.push(`  ${g.name}: measured ${measured === null ? 'not measured' : measured}, threshold ${g.threshold}${unit}, due month ${g.due_month}, ${status}`);
    if (status === 'miss' && g.branch) lines.push(`    branch: ${g.branch}`);
  }
  return lines;
}

export function renderReport({ packageRows = [], releaseRows = [], activationRows = [], milestoneRows = [], gates, gatesLabel = 'gates.json', month = null }) {
  if (!gates || !Array.isArray(gates.gates)) throw new Error('gates file must hold a "gates" array');
  const pkg = aggregate(packageRows, num, (r) => (DAY.test(r.day) ? r.day : null));
  const rel = aggregate(releaseRows, num, (r) => (DAY.test(r.day) ? r.day : null));
  const act = aggregate(activationRows, issued, (r) => (DAY.test(r.day) ? r.day : null));
  const ref = aggregate(activationRows, refused, (r) => (DAY.test(r.day) ? r.day : null));
  const mst = aggregate(milestoneRows, () => 1, (r) => (DAY.test(r.date) ? r.date : null));
  const names = new Map();
  for (const row of milestoneRows) if (row && row.name) names.set(row.name, (names.get(row.name) || 0) + 1);
  const totals = { package: pkg.total, release: rel.total, activations: act.total };
  const days = [...pkg.perDay.keys(), ...rel.perDay.keys(), ...act.perDay.keys(), ...mst.perDay.keys()].sort();

  const lines = ['Memev weekly funnel report'];
  lines.push(days.length ? `days ${days[0]} to ${days[days.length - 1]}` : 'days: none');
  lines.push('');
  lines.push(...gateLines(gates, totals, gatesLabel));
  lines.push('');
  if (Number.isInteger(month) && month > 0 && gates.monthly && Array.isArray(gates.monthly.gates)) {
    lines.push(...verdictLines(gates, month, totals, activationRows, milestoneRows));
    lines.push('');
  }
  lines.push(...section('Package downloads', pkg, { hasRows: packageRows.length > 0 }));
  lines.push('');
  lines.push(...section('Release downloads', rel, { hasRows: releaseRows.length > 0 }));
  lines.push('');
  lines.push(...section('Licence activations', act, {
    hasRows: activationRows.length > 0,
    extra: ref.total > 0 ? [`  refused: ${ref.total}`] : [],
  }));
  lines.push('');
  lines.push(...section('Milestones', mst, {
    hasRows: milestoneRows.length > 0,
    noInput: 'no milestone input',
    extra: names.size ? ['  per name:', ...[...names].sort().map(([name, n]) => `    ${name}: ${n}`)] : [],
  }));
  return lines.join('\n');
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package' || a === '--release' || a === '--activations' || a === '--milestones' || a === '--gates' || a === '--month') args[a.slice(2)] = argv[++i];
  }
  const gatesFile = args.gates || path.join(here, 'gates.json');
  const gates = JSON.parse(fs.readFileSync(gatesFile, 'utf8'));
  const label = path.relative(process.cwd(), gatesFile) || gatesFile;
  const page = renderReport({
    packageRows: readRows(args.package),
    releaseRows: readRows(args.release),
    activationRows: readRows(args.activations),
    milestoneRows: readRows(args.milestones),
    gates,
    gatesLabel: label,
    month: args.month === undefined ? null : Number(args.month),
  });
  process.stdout.write(`${page}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
