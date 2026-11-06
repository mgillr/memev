// SR-1.35's ceilings can fail: a number past its ceiling, a number that did not come back, and a word in place of a number all fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bench', 'speed', 'targets.mjs');
// Loaded here and not by an import line, so on code with no ceilings the first test fails on its assertion rather than the file failing to load.
const targets = fs.existsSync(TOOL) ? await import(pathToFileURL(TOOL).href) : null;
const { CAUGHT, CEILINGS, evaluate, judgeOld } = targets ?? {};
const atCeiling = () => Object.fromEntries(Object.entries(CEILINGS).map(([k, [c]]) => [k, c]));

test('the ceilings command is there', () => {
  assert.ok(targets, 'scripts/bench/speed/targets.mjs is there');
});

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

test('against old code: every ceiling meant to catch it must fail there, and one that passes is named', () => {
  const over = Object.fromEntries(Object.entries(CEILINGS).map(([k, [c]]) => [k, c + 1]));
  assert.deepEqual(judgeOld(over).missed, []); assert.equal(judgeOld(over).ok, true);
  for (const name of CAUGHT) {
    const v = judgeOld({ ...over, [name]: CEILINGS[name][0] });
    assert.equal(v.ok, false, name); assert.deepEqual(v.missed, [name]); assert.ok(v.passes.includes(name));
  }
  for (const name of CAUGHT) assert.equal(judgeOld({ ...over, [name]: undefined }).ok, false, `${name} with no number is not caught`);
  const guard = Object.keys(CEILINGS).filter((k) => !CAUGHT.includes(k));
  assert.equal(judgeOld({ ...over, ...Object.fromEntries(guard.map((k) => [k, 0])) }).ok, true, 'a guard the old code passes is no failure');
  for (const name of CAUGHT) assert.ok(name in CEILINGS, name);
  for (const name of ['a3_recall_p95_ms', 'a6_send_ms', 'a4_new_note_p50_ms', 'a8_stop_ms']) assert.ok(guard.includes(name), `${name} is a guard: the old code is under twice its ceiling, or passes it`);
});
