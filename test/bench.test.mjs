// The benchmark harness (scripts/bench): a seeded vault, labelled prompts, an exact token counter, a --check that
// catches a lost hit or a breached token target, and a run with no network at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PKG, tmpdir, cleanup } from './helpers/tmp.mjs';
import { seedVault } from '../scripts/bench/seed.mjs';
import { count } from '../scripts/bench/o200k.mjs';

const RUN = path.join(PKG, 'scripts', 'bench', 'run.mjs');
const NO_NET = pathToFileURL(path.join(PKG, 'test', 'bench', 'no-net.mjs')).href;
const queries = JSON.parse(fs.readFileSync(path.join(PKG, 'bench', 'queries.json'), 'utf8'));
const bench = (args, env = {}) => spawnSync(process.execPath, [...args], { cwd: PKG, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 300000 });

let dir, metrics, netLog, run;
before(() => {
  dir = tmpdir('bench-');
  metrics = path.join(dir, 'small.json'); netLog = path.join(dir, 'net.log');
  // one real run at the small level with every network call refused; the other tests check its metrics
  run = bench(['--import', NO_NET, RUN, '--level', 'small', '--check', '--group', 'guard', '--json', metrics], { NO_NET_LOG: netLog });
});
after(() => cleanup());

const mutate = (name, fn) => { const m = JSON.parse(fs.readFileSync(metrics, 'utf8')); fn(m); const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(m)); return f; };
const r4 = (x) => Math.round(x * 1e4) / 1e4;

test('MEM-106 AC06: The seeded vault has the same notes on every run and at least 20 on-topic, 20 off-topic and 5 continuation prompts are labelled', () => {
  const digest = (root) => {
    const files = seedVault(root, 'small', queries);
    return files.map((p) => `${p} ${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, ...p.split('/')))).digest('hex')}`);
  };
  const a = digest(path.join(tmpdir('seed-a-'), 'v')), b = digest(path.join(tmpdir('seed-b-'), 'v'));
  assert.ok(a.length > 60, `${a.length} notes`);
  assert.deepEqual(a, b, 'the same notes, byte for byte');
  assert.ok(queries.on_topic.length >= 20 && queries.off_topic.length >= 20 && queries.continuation.length >= 5);
  // every on-topic prompt names the items recall must find, and each of them is in the seeded vault
  const root = path.join(tmpdir('seed-c-'), 'v'); seedVault(root, 'small', queries);
  for (const q of queries.on_topic) {
    assert.ok(q.expect.length >= 1, q.prompt);
    for (const item of q.expect) {
      const [p, heading] = item.split('#');
      assert.ok(fs.readFileSync(path.join(root, ...p.split('/')), 'utf8').includes(`\n### ${heading}\n`), `${item} is in the vault`);
    }
  }
});

test('MEM-106 AC07: The token counter agrees with the committed tiktoken o200k_base fixture within 2 percent on every fixture text', () => {
  const f = JSON.parse(fs.readFileSync(path.join(PKG, 'test', 'bench', 'o200k-fixture.json'), 'utf8'));
  assert.match(f.tokenizer, /tiktoken 0\.14\.0 o200k_base/);
  assert.ok(f.texts.length >= 15);
  for (const t of f.texts) {
    const n = count(t.text);
    assert.ok(Math.abs(n - t.o200k) <= 0.02 * t.o200k, `${t.name}: ${n} against ${t.o200k}`);
  }
});

test('MEM-106 AC08: --check fails with a clear message when recall@k is lowered by one hit, and passes on the unchanged code', () => {
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /PASS guard quality\.recall_at_6 = [\d.]+ >= baseline/);
  assert.match(run.stdout, /check: PASS/);
  for (const k of [6, 4]) {
    const f = mutate(`one-hit-less-at-${k}.json`, (m) => { const c = m.quality.counts; c[`found_at_${k}`] -= 1; m.quality[`recall_at_${k}`] = r4(c[`found_at_${k}`] / c.expected); });
    const r = bench([RUN, '--level', 'small', '--check', '--group', 'guard', '--metrics', f]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, new RegExp(`FAIL guard quality\\.recall_at_${k} = [\\d.]+ < baseline [\\d.]+ at 18abe10 \\(on-topic recall`));
    assert.match(r.stdout, /check: FAIL \(1 of/);
  }
});

test('MEM-106 AC09: --check fails when a token target is breached and names the metric and the contract that owns it', () => {
  // the live run is inside the cap, so the breach is a mutated metric
  const over = mutate('get-over.json', (m) => { m.max_result_tokens.get = 2600; });
  const r = bench([RUN, '--level', 'small', '--check', '--group', 'caps', '--only', 'get', '--metrics', over]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL caps\/get max_result_tokens\.get = 2600 > 2500 \(MEM-107: /);
  // and the same check passes once the result is inside the target
  const f = mutate('get-capped.json', (m) => { m.max_result_tokens.get = 2400; m.max_result_tokens.get_chars = 7900; });
  const ok = bench([RUN, '--level', 'small', '--check', '--group', 'caps', '--only', 'get', '--metrics', f]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /PASS caps\/get max_result_tokens\.get = 2400 <= 2500 \(MEM-107: /);
});

test('MEM-106 AC10: The harness makes no network call and no model call (fetch, http and https replaced by throwing stubs, the run still succeeds)', () => {
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const m = JSON.parse(fs.readFileSync(metrics, 'utf8'));
  assert.ok(m.quality.recall_at_6 > 0 && m.fixed.fixed_overhead_default > 0 && m.max_result_tokens.get > 0, 'the run measured everything');
  assert.equal(fs.existsSync(netLog) ? fs.readFileSync(netLog, 'utf8') : '', '', 'no network call was attempted');
  // the stubs do refuse: the same preload stops a plain fetch and an http request, and logs both
  const probe = path.join(dir, 'probe.log');
  const p = bench(['--import', NO_NET, '--input-type=module', '-e', "import http from 'node:http'; await fetch('http://192.0.2.1/').catch((e) => console.log(e.message)); try { http.get('http://192.0.2.1/'); } catch (e) { console.log(e.message); }"], { NO_NET_LOG: probe });
  assert.match(p.stdout, /network call refused: fetch\nnetwork call refused: http\.get/);
  assert.equal(fs.readFileSync(probe, 'utf8'), 'fetch\nhttp.get\n');
});
