// SR-1.35's ceilings can fail: a number past its ceiling, a number that did not come back, and a word in place of a number all fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CEILINGS, evaluate } from '../scripts/bench/speed/targets.mjs';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bench', 'speed', 'targets.mjs');
const atCeiling = () => Object.fromEntries(Object.entries(CEILINGS).map(([k, [c]]) => [k, c]));

test('every axis has a ceiling', () => {
  for (const axis of ['a1_', 'a2_', 'a3_', 'a4_', 'a5_', 'a6_', 'a7_', 'a8_']) assert.ok(Object.keys(CEILINGS).some((k) => k.startsWith(axis)), axis);
});

test('numbers at their ceilings pass', () => {
  assert.equal(evaluate(atCeiling()).ok, true);
});

test('one number past its ceiling fails, for every ceiling', () => {
  for (const name of Object.keys(CEILINGS)) {
    const r = evaluate({ ...atCeiling(), [name]: CEILINGS[name][0] + 1 });
    assert.equal(r.ok, false, name);
    assert.deepEqual(r.rows.filter((x) => !x.ok).map((x) => x.name), [name]);
  }
});

test('a number that did not come back fails, so a broken bench cannot read as a fast one', () => {
  for (const bad of [undefined, null, NaN, Infinity, '5', {}]) {
    for (const name of Object.keys(CEILINGS)) assert.equal(evaluate({ ...atCeiling(), [name]: bad }).ok, false, `${name} ${String(bad)}`);
  }
  assert.equal(evaluate({}).ok, false);
  assert.equal(evaluate(null).ok, false);
});

test('the command exits 1 on a failing file and 0 on a passing one, and runs no bench for it', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-targets-'));
  const f = path.join(d, 'n.json');
  const run = () => spawnSync(process.execPath, [TOOL, '--evaluate', f], { encoding: 'utf8', timeout: 20000 });
  fs.writeFileSync(f, JSON.stringify(atCeiling()));
  const good = run(); assert.equal(good.status, 0, good.stdout + good.stderr);
  fs.writeFileSync(f, JSON.stringify({ ...atCeiling(), a6_roster_ms: 2904 }));
  const bad = run(); assert.equal(bad.status, 1); assert.match(bad.stdout, /FAIL a6_roster_ms 2904/);
  fs.rmSync(d, { recursive: true, force: true });
});
