// WO-08-A: the doctor's checks and the troubleshooting table cannot drift apart.
// One row per check id, pinned in both directions, and the row and the check agree on severity.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { PKG, cleanup } from './helpers/tmp.mjs';

after(cleanup);

const DOC = path.join(PKG, 'docs', 'TROUBLESHOOTING.md');
const DOCTOR = path.join(PKG, 'src', 'cli', 'doctor.mjs');

// Parse the troubleshooting table into { id, severity, symptom, fix } rows.
// Only rows whose first cell is a backticked check id count; the header and
// separator rows are skipped.
function rows() {
  const out = [];
  for (const line of fs.readFileSync(DOC, 'utf8').split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const [idCell, severity, symptom, fix] = cells;
    if (!/^`[a-z][a-z0-9-]*`$/.test(idCell)) continue;
    out.push({ id: idCell.slice(1, -1), severity, symptom, fix });
  }
  return out;
}

// Every check id the doctor can report, read straight from the source: the
// first argument of each C(id, ...) call. An id has to be a plain string
// literal in any quote style, so the table can be checked against it; an id
// built at run time fails here instead of slipping past the table.
function reportableIds() {
  const src = fs.readFileSync(DOCTOR, 'utf8');
  const ids = new Set();
  for (const m of src.matchAll(/\bC\(\s*([^,)]*)/g)) {
    const lit = /^(['"`])([a-z][a-z0-9-]*)\1$/.exec(m[1].trim());
    assert.ok(lit, `a check id in doctor.mjs is not a plain string literal: C(${m[1].trim()}`);
    ids.add(lit[2]);
  }
  return ids;
}

function freshSandbox() {
  const sb = sandbox();
  const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  assert.equal(r.code, 0, `init failed: ${r.out}${r.err}`);
  return sb;
}

function doctorJson(sb) {
  const d = sb.run(['doctor', '--json']);
  const checks = JSON.parse(d.out);
  assert.ok(Array.isArray(checks) && checks.length, `doctor --json returned no checks: ${d.out}${d.err}`);
  return checks;
}

test('WO-08-A AC01: every check id the doctor reports in a sandbox vault has a troubleshooting row with a symptom and a fix', () => {
  const sb = freshSandbox();
  try {
    const checks = doctorJson(sb);
    const byId = new Map(rows().map((r) => [r.id, r]));
    for (const c of checks) {
      const row = byId.get(c.id);
      assert.ok(row, `no troubleshooting row for check ${c.id}`);
      assert.ok(row.symptom.length > 0, `row for ${c.id} has no symptom`);
      assert.ok(row.fix.length > 0, `row for ${c.id} has no fix`);
    }
  } finally {
    sb.stop();
  }
});

test('WO-08-A AC02: every troubleshooting row names a check the doctor can report, and every check it can report has a row', () => {
  const table = rows();
  const ids = reportableIds();
  assert.ok(ids.size > 0, 'no check ids found in doctor.mjs');
  const seen = new Set();
  for (const r of table) {
    assert.ok(ids.has(r.id), `row names a check the doctor cannot report: ${r.id}`);
    assert.ok(!seen.has(r.id), `two rows for check ${r.id}`);
    seen.add(r.id);
  }
  for (const id of ids) assert.ok(seen.has(id), `no row for check ${id}`);
});

// A raw JavaScript error is a stack frame, a node:internal path, or an error
// type prefix. A clean CLI failure names the reason in plain words instead.
const RAW_ERROR = /at .+\(.+:\d+:\d+\)|node:internal\/|\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|AggregateError):/;

test('WO-08-A AC03: a row whose fix is a command names one the help lists, and it runs in a sandbox vault without a raw JavaScript error', () => {
  const sb = freshSandbox();
  try {
    const help = sb.run(['--help']);
    assert.equal(help.code, 0, `--help failed: ${help.out}${help.err}`);
    const helpLines = help.out.split('\n').filter((l) => l.trimStart().startsWith('memev '));
    const listed = (sub) => helpLines.some((l) => new RegExp(`\\b${sub}\\b`).test(l));

    const table = rows();
    assert.ok(table.length > 0, 'the troubleshooting table has no check rows');
    const cmds = new Set();
    for (const r of table) {
      for (const m of r.fix.matchAll(/`memev ([^`]+)`/g)) {
        const cmd = m[1].trim();
        const sub = cmd.split(/\s+/)[0];
        assert.ok(listed(sub), `fix for ${r.id} names a command the help does not list: memev ${sub}`);
        cmds.add(cmd);
      }
    }
    assert.ok(cmds.size > 0, 'no row names a memev command as its fix');
    for (const cmd of cmds) {
      // github setup signs in to GitHub in a browser when gh is signed out, as it
      // is in the sandbox; --no-login stops at that step with its message.
      const args = cmd.split(/\s+/);
      if (args[0] === 'github' && args[1] === 'setup') args.push('--no-login');
      const r = sb.run(args);
      const out = `${r.out || ''}${r.err || ''}`;
      assert.ok(!RAW_ERROR.test(out), `memev ${cmd} printed a raw JavaScript error:\n${out}`);
      if (r.code !== 0) assert.ok(out.trim().length > 0, `memev ${cmd} exited ${r.code} without a message`);
    }
  } finally {
    sb.stop();
  }
});

test('WO-08-A AC04: a warning row says warning, and a failing check says the vault needs the fix before it works', () => {
  const byId = new Map(rows().map((r) => [r.id, r]));
  const sb = freshSandbox();
  try {
    for (const c of doctorJson(sb)) {
      if (c.status !== 'warn') continue;
      const row = byId.get(c.id);
      assert.ok(row, `no row for check ${c.id}`);
      assert.match(row.severity, /warning/i, `check ${c.id} is a warning but its row says: ${row.severity}`);
    }
    // Stop the daemon so the doctor reports a real failure, then check the
    // failing checks against their rows.
    assert.equal(sb.stop().code, 0, 'stop failed');
    for (const c of doctorJson(sb)) {
      if (c.status !== 'fail') continue;
      const row = byId.get(c.id);
      assert.ok(row, `no row for check ${c.id}`);
      assert.ok(
        row.severity.includes('the vault needs the fix before it works'),
        `check ${c.id} fails but its row does not say the vault needs the fix before it works: ${row.severity}`,
      );
    }
  } finally {
    sb.stop();
  }
});
