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

// A day is YYYY-MM-DD and a real calendar date; anything else (2026-13-45, 2026-02-30) is no day.
function dayOf(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

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

// A count file that was not handed in reads as null, so the monthly verdict can tell it from an empty one.
function readRows(file) {
  if (!file) return null;
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
// A trial licence is marked on its activation row with "trial": true, as on the licence itself, or
// with 1, as a SQL export of the activations table gives it. A trial is counted on its own and never
// as paid. false or 0 is paid, and so is a row with no trial field (or any other value), as the
// product reads a licence with none; those issued rows are counted on a line of their own.
const isTrial = (row) => row.trial === true || row.trial === 1;
const unmarked = (row) => (row.result === 'issued' && ![true, 1, false, 0].includes(row.trial) ? 1 : 0);
const paid = (row) => (row.result === 'issued' && !isTrial(row) ? 1 : 0);
const trial = (row) => (row.result === 'issued' && isTrial(row) ? 1 : 0);
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

// The counted numbers that may stand for installs. Activations are not one of them: free-to-paid
// divides paid activations by installs, so with activations as installs it would always read 100.
const PROXIES = {
  package_downloads: (t) => t.package,
  release_downloads: (t) => t.release,
  downloads: (t) => (t.package === null || t.release === null ? null : t.package + t.release),
};

function pct(n) {
  return String(Math.round(n * 100) / 100);
}

// How a measured value prints. Every installs choice is a download count, and a download is not an
// install, so installs print as downloads; no measured value prints as not measured.
function shown(g, value) {
  if (value === null) return 'not measured';
  return g.metric === 'installs' ? `${value} downloads` : value;
}

// The header gates read the same counted values as the monthly verdict, so one page never gives two
// answers for one number: with no installs choice in the file both gates are open, and a gate whose
// count file was not handed in is not measured, never 0 and a miss. Under each installs gate the
// distinct report ids with the installed milestone print as a floor of confirmed installs.
function gateLines(gates, counted, label) {
  const lines = [`Gates (${label}):`];
  const proxy = gates.installs_proxy;
  const chosen = Boolean(proxy) && Object.hasOwn(PROXIES, proxy);
  for (const g of gates.gates || []) {
    let measured = 'open';
    let verdict = 'open';
    if (chosen) {
      const value = measuredValue(g, counted);
      measured = shown(g, value);
      verdict = value === null ? 'not measured' : value >= g.threshold ? 'pass' : 'miss';
    }
    const unit = g.metric === 'free_to_paid_percent' ? ' percent' : '';
    lines.push(`  ${g.name}: measured ${measured}, threshold ${g.threshold}${unit}, ${verdict}`);
    if (g.metric === 'installs') {
      lines.push(counted.installed === null
        ? '    confirmed installs, a floor: not measured (no milestone input)'
        : `    confirmed installs, a floor: ${counted.installed} (distinct report ids with the installed milestone; a report turned off and on again gets a new id, so one install can count twice)`);
      if (counted.installedNoId > 0) lines.push(`    installed rows with no report id, not counted: ${counted.installedNoId}`);
    }
  }
  if (chosen) lines.push(`  installs proxy: ${proxy} (a download is not an install)`);
  else if (proxy) lines.push(`  installs proxy: open (${JSON.stringify(proxy)} is not a choice; pick one of ${Object.keys(PROXIES).join(', ')})`);
  else lines.push(`  installs proxy: open (${gates.installs_proxy_note || "which counted number stands for installs is the owner's choice"})`);
  return lines;
}

// The measured value of one gate, in the header or the monthly verdict, from the counted rows alone.
// A gate whose count file was not handed in has no measured value (null), and neither has a gate the
// file marks as planned.
function measuredValue(g, counted) {
  if (g.planned) return null;
  if (g.metric === 'installs') return counted.installs;
  if (g.metric === 'free_to_paid_percent') {
    if (counted.installs === null || counted.activations === null) return null;
    return counted.installs > 0 ? pct((counted.activations / counted.installs) * 100) : 0;
  }
  if (g.metric === 'distinct_paid_licences') return counted.paidLicences;
  if (g.metric === 'milestone') return counted.milestones === null ? null : counted.milestones.get(g.milestone) || 0;
  return null;
}

// The monthly verdict: each of the file's monthly gates as a row. A gate whose due month has not
// arrived is not yet due, never a miss; a gate with no measured value is not measured, never a
// pass; a gate the file marks as planned is planned, not measured; a missed gate prints the branch
// text held for it in the file, word for word.
function verdictLines(gates, month, counted) {
  const lines = [`Monthly verdict (month ${month}):`];
  for (const g of gates.monthly.gates) {
    const measured = measuredValue(g, counted);
    let status;
    if (g.planned) status = 'planned, not measured';
    else if (g.due_month > month) status = 'not yet due';
    else if (measured === null) status = 'not measured';
    else if (measured >= g.threshold) status = 'pass';
    else status = 'miss';
    const unit = g.metric === 'free_to_paid_percent' ? ' percent' : '';
    lines.push(`  ${g.name}: measured ${shown(g, measured)}, threshold ${g.threshold}${unit}, due month ${g.due_month}, ${status}`);
    if (status === 'miss' && g.branch) lines.push(`    branch: ${g.branch}`);
  }
  return lines;
}

export function renderReport({ packageRows = [], releaseRows = [], activationRows = [], milestoneRows = [], gates, gatesLabel = 'gates.json', month = null }) {
  if (!gates || !Array.isArray(gates.gates)) throw new Error('gates file must hold a "gates" array');
  // null is a count file that was not handed in: no rows here, and not measured in the monthly verdict
  const given = { package: packageRows !== null, release: releaseRows !== null, activations: activationRows !== null, milestones: milestoneRows !== null };
  packageRows = packageRows || [];
  releaseRows = releaseRows || [];
  activationRows = activationRows || [];
  milestoneRows = milestoneRows || [];
  const pkg = aggregate(packageRows, num, (r) => dayOf(r.day));
  const rel = aggregate(releaseRows, num, (r) => dayOf(r.day));
  const act = aggregate(activationRows, paid, (r) => dayOf(r.day));
  const tri = aggregate(activationRows, trial, (r) => dayOf(r.day));
  const ref = aggregate(activationRows, refused, (r) => dayOf(r.day));
  const unm = aggregate(activationRows, unmarked, (r) => dayOf(r.day));
  const mst = aggregate(milestoneRows, () => 1, (r) => dayOf(r.date));
  const names = new Map();
  for (const row of milestoneRows) if (row && row.name) names.set(row.name, (names.get(row.name) || 0) + 1);
  const days = [...pkg.perDay.keys(), ...rel.perDay.keys(), ...act.perDay.keys(), ...mst.perDay.keys()].sort();
  // the counted values, once, for the header and the monthly verdict alike
  const proxy = gates.installs_proxy;
  const counts = { package: given.package ? pkg.total : null, release: given.release ? rel.total : null };
  const counted = {
    installs: proxy && Object.hasOwn(PROXIES, proxy) ? PROXIES[proxy](counts) : null,
    activations: given.activations ? act.total : null,
    paidLicences: given.activations ? new Set(activationRows.filter((r) => r && paid(r) && r.licence_id).map((r) => r.licence_id)).size : null,
    milestones: given.milestones ? names : null,
    // installations, never rows: the opt-in report sends every recorded milestone again whenever a new one appears, so
    // one installation sends its installed row many times under one id. A row with no id cannot be told from a resend,
    // so it stays out of the floor and is counted on its own line.
    installed: given.milestones ? new Set(milestoneRows.filter((r) => r && r.name === 'installed' && r.id).map((r) => String(r.id))).size : null,
    installedNoId: given.milestones ? milestoneRows.filter((r) => r && r.name === 'installed' && !r.id).length : 0,
  };

  const lines = ['Memev weekly funnel report'];
  lines.push(days.length ? `days ${days[0]} to ${days[days.length - 1]}` : 'days: none');
  lines.push('');
  lines.push(...gateLines(gates, counted, gatesLabel));
  lines.push('');
  if (Number.isInteger(month) && month > 0) {
    // a month with no monthly gates in the file says so in one line, never nothing
    if (gates.monthly && Array.isArray(gates.monthly.gates) && gates.monthly.gates.length) lines.push(...verdictLines(gates, month, counted));
    else lines.push(`Monthly verdict (month ${month}): the gate file holds no monthly gates`);
    lines.push('');
  }
  lines.push(...section('Package downloads', pkg, { hasRows: packageRows.length > 0 }));
  lines.push('');
  lines.push(...section('Release downloads', rel, { hasRows: releaseRows.length > 0 }));
  lines.push('');
  lines.push(...section('Licence activations (paid)', act, {
    hasRows: activationRows.length > 0,
    extra: [
      `  trials, not counted as paid: ${tri.total}`,
      ...(unm.total > 0 ? [`  issued with no trial field, counted as paid: ${unm.total}`] : []),
      ...(ref.total > 0 ? [`  refused: ${ref.total}`] : []),
    ],
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
  // a month that is not a whole number of months, 1 or more, is refused, never dropped in silence
  if ('month' in args && !(/^\d+$/.test(args.month || '') && Number(args.month) >= 1)) {
    console.error(`report.mjs: --month is a whole number of months, 1 or more (got ${args.month === undefined ? 'nothing' : JSON.stringify(args.month)})`);
    process.exit(2);
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
