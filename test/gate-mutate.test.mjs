// SPDX-License-Identifier: Apache-2.0
// QL-1.02 T1: the mutation gate over the changed lines (scripts/gate/mutate.mjs over src/engine/mutation-gate.mjs). A
// subtest named T1-cNN: is criterion NN of the contract's task T1. Each fixture is a small git repository in a temp folder;
// in the sources below, a line ending with //@ is a changed line, and the --test command is a plain node script.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, repo, write, git, scratch, cleanupScratch, runGate, hashTree, gitState, fileSha, readLog, alive, waitFor, inside }
  from './helpers/mutate-repo.mjs';

after(cleanupScratch);

const STATUSES = new Set(['ok', 'noise', 'no-mutants', 'error']);
// Runs the gate with --json and checks the counting rules that hold on every run, whatever the fixture.
async function gate(dir, args, opts) {
  const r = await runGate(dir, [...args, '--json'], opts);
  const j = r.json;
  assert.ok(j, `no JSON from the gate (exit ${r.code} ${r.signal ?? ''}): ${r.out}${r.err}`);
  assert.ok(STATUSES.has(j.status), `status ${j.status}`);
  assert.equal(j.mutants, j.killed + (j.survived ?? 0), 'mutants equals killed + survived');
  if (j.status === 'ok') assert.equal(typeof j.survived, 'number');
  else assert.equal(j.survived ?? null, null, 'survived is a number only when the status is ok');
  assert.equal(j.survivors.length, j.survived ?? 0);
  for (const f of j.files) assert.equal(f.mutants, f.killed + (f.survived ?? 0), `${f.file}: mutants equals killed + survived`);
  for (const k of ['mutants', 'killed']) assert.equal(j.files.reduce((n, f) => n + f[k], 0), j[k], `${k} per file adds up to the total`);
  assert.equal(j.ignored, j.ignores.length);
  const want = j.status === 'ok' ? (j.survived > 0 ? 1 : 0) : j.status === 'no-mutants' ? 3 : 2;
  assert.equal(r.code, want, `exit code for status ${j.status} (${j.reason})`);
  return { ...r, j };
}
const RUN = ['--test', 'node test/t.mjs'];
const on = (fx) => ['--base', fx.base];
const at = (j, file, line) => j.results.filter((x) => x.file === file && x.line === line);
const pairs = (list) => [...new Set(list.map((s) => `${s.file}:${s.line}`))].sort();
const parsesAsModule = (file) => spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }).status === 0;
function walkNames(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => [e.name, ...(e.isDirectory() ? walkNames(path.join(dir, e.name)) : [])]);
}

// One changed comparison, and a strong, a weak and a flaky test for it.
const CMP = 'export const gt = (a, b) => a > b; //@\n';
const WEAK_GT = "import { gt } from '../src/cmp.mjs';\ngt(1, 2);\n";
const STRONG_GT = String.raw`import assert from 'node:assert/strict';
import { gt } from '../src/cmp.mjs';
assert.equal(gt(2, 1), true);
assert.equal(gt(1, 1), false);
assert.equal(gt(1, 2), false);
`;
// Fails on every second run; each run logs the hash of the source it saw.
const FLAKY_GT = String.raw`import fs from 'node:fs';
import crypto from 'node:crypto';
import { gt } from '../src/cmp.mjs';
const log = process.env.GATE_LOG;
const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
fs.appendFileSync(log, JSON.stringify({ sha: crypto.createHash('sha256').update(fs.readFileSync('src/cmp.mjs')).digest('hex') }) + '\n');
gt(1, 2);
process.exit(n % 2);
`;
// Counts its runs in the file GATE_COUNT names and fails on the runs GATE_FAIL selects (a JS expression of n).
const COUNTED_GT = String.raw`import fs from 'node:fs';
import { gt } from '../src/cmp.mjs';
const f = process.env.GATE_COUNT;
const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1;
fs.writeFileSync(f, String(n));
gt(1, 2);
process.exit(new Function('n', 'return ' + process.env.GATE_FAIL)(n) ? 1 : 0);
`;
const cmpFixture = (testText, files = {}) => fixture({ src: { 'src/cmp.mjs': CMP }, files: { 'test/t.mjs': testText, ...files } });

async function checkC01Fixtures() {
  const strong = cmpFixture(STRONG_GT);
  const s = await gate(strong.dir, [...on(strong), ...RUN]);
  assert.equal(s.code, 0);
  assert.deepEqual([s.j.status, s.j.mutants, s.j.killed, s.j.survived], ['ok', 1, 1, 0]);
  assert.deepEqual(s.j.results.map((x) => [x.line, x.operator, x.outcome]), [[1, '> -> <=', 'killed']]);

  const weak = cmpFixture(WEAK_GT);
  const w = await gate(weak.dir, [...on(weak), ...RUN]);
  assert.equal(w.code, 1);
  assert.deepEqual([w.j.status, w.j.mutants, w.j.killed, w.j.survived], ['ok', 1, 0, 1]);
  assert.deepEqual(w.j.survivors, [{ file: 'src/cmp.mjs', line: 1, operator: '> -> <=' }]);

  const flaky = cmpFixture(FLAKY_GT);
  const log = path.join(scratch(), 'runs.jsonl');
  const f = await gate(flaky.dir, [...on(flaky), ...RUN], { env: { GATE_LOG: log } });
  assert.equal(f.code, 2);
  assert.equal(f.j.status, 'noise');
  assert.deepEqual(f.j.results, [], 'no mutant was tried');
  const runs = readLog(log);
  assert.equal(runs.length, 2, 'only the two unmutated runs ran');
  const original = fileSha(path.join(flaky.dir, 'src/cmp.mjs'));
  assert.ok(runs.every((e) => e.sha === original), 'every run saw the unmutated source');
}

test('T1-c01: a tested comparison is killed, an untested one survives with exit 1, a flaky test stops as NOISE before any mutant', async () => {
  await checkC01Fixtures();
});

// Passes every run and prints a pass count that grows by one each run.
const COUNTING_PASS = String.raw`import fs from 'node:fs';
import { gt } from '../src/cmp.mjs';
const f = process.env.GATE_COUNT;
const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1;
fs.writeFileSync(f, String(n));
gt(1, 2);
console.log('# pass ' + n);
`;
// On its first run, edits the caller's own copy of the source through an absolute path.
const TOUCH_CALLER = String.raw`import fs from 'node:fs';
import { gt } from '../src/cmp.mjs';
const f = process.env.GATE_COUNT;
const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1;
fs.writeFileSync(f, String(n));
if (n === 1) fs.appendFileSync(process.env.GATE_CALLER + '/src/cmp.mjs', '// touched\n');
gt(1, 2);
`;

test('T1-c03: a flaky test and a test failing on the unmutated tree exit 2 with no numeric survived', async () => {
  const flaky = cmpFixture(FLAKY_GT);
  const failing = cmpFixture("import { gt } from '../src/cmp.mjs';\ngt(1, 2);\nprocess.exit(1);\n");
  for (const [fx, env] of [[flaky, { GATE_LOG: path.join(scratch(), 'runs.jsonl') }], [failing, {}]]) {
    const r = await gate(fx.dir, [...on(fx), ...RUN], { env });
    assert.equal(r.code, 2);
    assert.equal(r.j.status, 'noise');
    assert.ok(!('survived' in r.j) || r.j.survived === null, 'survived is null or absent');
    assert.equal(r.j.survived === 0, false, 'a metric survived == 0 evaluated on this output fails');
  }
  // two passing unmutated controls whose pass counts differ are noise too (requirement 2)
  const counting = cmpFixture(COUNTING_PASS);
  const rc = await gate(counting.dir, [...on(counting), ...RUN], { env: { GATE_COUNT: path.join(scratch(), 'count') } });
  assert.deepEqual([rc.code, rc.j.status], [2, 'noise']);
  assert.match(rc.j.reason, /pass count/);
});

// Logs its pid and keeps the source it ran on, then calls every export and checks only that each returns.
const SEEN = String.raw`import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.GATE_SEEN;
fs.appendFileSync(path.join(dir, 'pids'), process.pid + '\n');
fs.writeFileSync(path.join(dir, 'src-' + process.pid + '-' + process.hrtime.bigint() + '.mjs'), fs.readFileSync('src/m.mjs'));
const m = await import('../src/m.mjs');
for (const f of Object.values(m)) f(3, 2);
`;
const C04 = `export const gt = (a, b) => a > b; //@
export const tag = (s) => s + '==='; //@
export function sum(n) {
  let t = 0;
  for (let i = 0; i < n; i = i + 1) { //@
    t += i;
  }
  return t;
}
`;

test('T1-c04: on gt, a string holding === and a sum loop with a weak test: exit 1, killed 0, judged mutants parse, the loop times out', async () => {
  const fx = fixture({ src: { 'src/m.mjs': C04 }, files: { 'test/t.mjs': SEEN } });
  const seen = scratch();
  const r = await gate(fx.dir, [...on(fx), ...RUN], { env: { GATE_SEEN: seen } });
  assert.equal(r.code, 1);
  assert.equal(r.j.killed, 0);
  assert.deepEqual(r.j.results.map((x) => [x.line, x.operator, x.outcome]),
    [[1, '> -> <=', 'survived'], [5, '< -> >=', 'survived'], [5, '+ -> -', 'timeout']]);
  assert.equal(r.j.timeout, 1);
  assert.deepEqual(r.j.unmutated, [{ file: 'src/m.mjs', line: 2 }], 'nothing inside the string literal is mutated');
  const sources = fs.readdirSync(seen).filter((f) => f.endsWith('.mjs'));
  const distinct = new Set(sources.map((f) => fileSha(path.join(seen, f))));
  assert.equal(distinct.size, 5, 'the unmutated source, its parenthesised rewrite and the three mutants each reached the test');
  for (const f of sources) assert.ok(parsesAsModule(path.join(seen, f)), `${f} passes node --check`);
  assert.ok(r.ms < 120000, `the run took ${r.ms} ms`);
  const pids = fs.readFileSync(path.join(seen, 'pids'), 'utf8').split('\n').filter(Boolean).map(Number);
  assert.ok(await waitFor(() => pids.every((p) => !alive(p)), 10000), 'no test process is left running');

  // A mutant that does not parse is invalid, never killed, and never reaches the test.
  const badSrc = 'export const gt = (a, b) => a > b; //@\nexport const odd = (a) => a -+1; //@\n';
  const bad = fixture({ src: { 'src/m.mjs': badSrc }, files: { 'test/t.mjs': SEEN } });
  const seen2 = scratch();
  const v = await gate(bad.dir, [...on(bad), ...RUN], { env: { GATE_SEEN: seen2 } });
  assert.equal(v.code, 1);
  assert.deepEqual([v.j.killed, v.j.invalid, v.j.mutants], [0, 1, 1]);
  assert.deepEqual(at(v.j, 'src/m.mjs', 2).map((x) => [x.operator, x.outcome]), [['- -> +', 'invalid']]);
  for (const f of fs.readdirSync(seen2).filter((n) => n.endsWith('.mjs'))) assert.ok(parsesAsModule(path.join(seen2, f)), `${f} passes node --check`);
});

test('T1-c05: a weak test that reads a git-ignored file and runs git rev-parse HEAD never exits 0 and kills nothing', async () => {
  const t = String.raw`import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gt } from '../src/cmp.mjs';
if (fs.readFileSync('secret.txt', 'utf8') !== 'kept out of git\n') process.exit(1);
execFileSync('git', ['rev-parse', 'HEAD'], { stdio: 'ignore' });
gt(1, 2);
`;
  const fx = cmpFixture(t, { '.gitignore': 'secret.txt\n' });
  write(fx.dir, { 'secret.txt': 'kept out of git\n' });
  assert.equal(git(fx.dir, 'status', '--porcelain', '--', 'secret.txt'), '', 'secret.txt is ignored');
  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.notEqual(r.code, 0);
  assert.equal(r.j.killed, 0);
  if (r.code === 1) assert.deepEqual(pairs(r.j.survivors), ['src/cmp.mjs:1']);
  else assert.deepEqual([r.code, r.j.status], [2, 'noise']);
});

// Logs where it ran and the hash of the source it saw. With GATE_BLOCK set, a run on a mutant (a source that differs from
// GATE_ORIGINAL in more than parentheses and spaces) writes <GATE_BLOCK>.started and waits for <GATE_BLOCK>.release.
const BLOCKING = String.raw`import fs from 'node:fs';
import crypto from 'node:crypto';
const text = fs.readFileSync('src/cmp.mjs', 'utf8');
const sha = crypto.createHash('sha256').update(text).digest('hex');
fs.appendFileSync(process.env.GATE_LOG, JSON.stringify({ pwd: process.env.PWD, cwd: process.cwd(), sha }) + '\n');
const bare = (s) => s.replace(/[()\s]/g, '');
const block = process.env.GATE_BLOCK;
if (block && bare(text) !== bare(fs.readFileSync(process.env.GATE_ORIGINAL, 'utf8'))) {
  fs.writeFileSync(block + '.started', String(process.pid));
  const until = Date.now() + 60000;
  while (!fs.existsSync(block + '.release') && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
const { gt } = await import('../src/cmp.mjs');
gt(1, 2);
`;
// Starts a gate whose mutant test blocks, SIGKILLs the gate while that test runs, then lets the orphaned test finish.
async function killDuringMutant(fx, args, env) {
  const marker = path.join(scratch(), 'block');
  let child;
  const run = runGate(fx.dir, [...args, '--json'], { env: { ...env, GATE_BLOCK: marker, TMPDIR: scratch() }, onSpawn: (c) => { child = c; } });
  assert.ok(await waitFor(() => fs.existsSync(`${marker}.started`), 60000), 'a mutant test started');
  child.kill('SIGKILL');
  const k = await run;
  assert.equal(k.signal, 'SIGKILL');
  const pid = Number(fs.readFileSync(`${marker}.started`, 'utf8'));
  fs.writeFileSync(`${marker}.release`, '');
  assert.ok(await waitFor(() => !alive(pid), 30000), 'the blocked test finished');
}

test('T1-c06: no run sees a mutated source at the workdir path, and a SIGKILLed run leaves the workdir exactly as it was', async () => {
  const fx = cmpFixture(BLOCKING);
  const out = scratch();
  const original = path.join(out, 'original.mjs');
  fs.copyFileSync(path.join(fx.dir, 'src/cmp.mjs'), original);
  const sha0 = fileSha(original);
  const before = hashTree(fx.dir);
  const status0 = gitState(fx.dir).status;
  const log = path.join(out, 'runs.jsonl');
  const r = await gate(fx.dir, [...on(fx), ...RUN], { env: { GATE_LOG: log, GATE_ORIGINAL: original } });
  assert.equal(r.code, 1);
  const runs = readLog(log);
  assert.ok(runs.some((e) => e.sha !== sha0), 'a mutant ran');
  for (const e of runs) {
    assert.ok(!inside(e.cwd, fx.dir) && !inside(e.pwd, fx.dir), `a test ran at the workdir path: ${e.cwd}`);
  }
  assert.deepEqual(hashTree(fx.dir), before);

  await killDuringMutant(fx, [...on(fx), ...RUN], { GATE_LOG: log, GATE_ORIGINAL: original });
  assert.deepEqual(hashTree(fx.dir), before, 'every file in the workdir hashes as before');
  assert.equal(gitState(fx.dir).status, status0, 'git status --porcelain is unchanged');
  assert.deepEqual(walkNames(fx.dir).filter((n) => n.startsWith('memev-mutate')), [], 'no gate temp directory in the workdir');
  // a run during which the caller's tree changes ends in error (requirement 3)
  const touch = cmpFixture(TOUCH_CALLER);
  const rt = await gate(touch.dir, [...on(touch), ...RUN], { env: { GATE_COUNT: path.join(scratch(), 'count'), GATE_CALLER: touch.dir } });
  assert.deepEqual([rt.code, rt.j.status], [2, 'error']);
  assert.match(rt.j.reason, /working tree changed/);
});

test('T1-c07: committed, uncommitted, untracked and renamed changes are judged at their new-side lines and nowhere else', async () => {
  const OLD = ['export const r1 = (a) => a > 1;', 'export const r2 = (a) => a < 2;', 'export const r3 = (a) => a === 3;',
    'export const r4 = (a) => a !== 4;', 'export const r5 = (a) => a >= 5;', 'export const r6 = (a) => a <= 6;', ''];
  const t = String.raw`import * as one from '../src/a/one.mjs';
import * as two from '../src/two.mjs';
import * as fresh from '../src/new.mjs';
import * as moved from '../src/b/renamed.mjs';
for (const m of [one, two, fresh, moved]) for (const f of Object.values(m)) f(3);
`;
  const fx = repo({
    'src/a/one.mjs': 'export const one = (a) => a >= 1;\nexport const keep = (a) => a === 0;\n',
    'src/two.mjs': 'export const pad = (a) => a !== 2;\nexport const two = (a) => a <= 2;\n',
    'src/old.mjs': OLD.join('\n'),
    'test/t.mjs': t,
  });
  write(fx.dir, { 'src/a/one.mjs': 'export const one = (a) => a > 1;\nexport const keep = (a) => a === 0;\n' });
  git(fx.dir, 'commit', '-q', '-am', 'change one');
  write(fx.dir, { 'src/two.mjs': 'export const pad = (a) => a !== 2;\n// one\n// two\n// three\nexport const two = (a) => a < 2;\n' });
  write(fx.dir, { 'src/new.mjs': 'export const fresh = (a) => a < 3;\n' });
  fs.mkdirSync(path.join(fx.dir, 'src', 'b'));
  git(fx.dir, 'mv', 'src/old.mjs', 'src/b/renamed.mjs');
  write(fx.dir, { 'src/b/renamed.mjs': OLD.map((l, i) => (i === 3 ? 'export const r4 = (a) => a !== 40;' : l)).join('\n') });

  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.equal(r.code, 1);
  const want = ['src/a/one.mjs:1', 'src/b/renamed.mjs:4', 'src/new.mjs:1', 'src/two.mjs:5'];
  assert.deepEqual(pairs(r.j.survivors), want);
  assert.deepEqual(pairs(r.j.results), want, 'no mutant sits on an unchanged line');
});

const C08 = `export const eq = (a) => a === 1; //@
export const ne = (a) => a !== 1; //@
export const lt = (a) => a < 1; //@
export const ge = (a) => a >= 1; //@
export const gt = (a) => a > 1; //@
export const le = (a) => a <= 1; //@
export const and = (a, b) => a && b; //@
export const or = (a, b) => a || b; //@
export const yes = () => true; //@
export const no = () => false; //@
export const inc = (a) => a + 1; //@
export const dec = (a) => a - 1; //@
export const not = (a) => !a; //@
export const pick = (a, b) => a ?? b; //@
export const loose = (a) => a == 1; //@
export const unlike = (a) => a != 1; //@
export const mul = (a) => a * 2; //@
export const div = (a) => a / 2; //@
export const mod = (a) => a % 3; //@
export const choose = (c) => c ? 1 : 2; //@
export function value(a) {
  return a; //@
}
export function call(log) {
  log.push(1); //@
}
export function cond(ok, log) {
  if (ok()) log.push(1); //@
}
export function plain(o, log) {
  if (o.on) log.push(1); //@
}
export function thrower(a) {
  if (a) throw new Error('no'); //@
}
export function early(a, log) {
  if (a) return; //@
  log.push(1);
}
export function add(a) {
  a += 2; //@
  return a;
}
export function sub(a) {
  a -= 2; //@
  return a;
}
export function up(a) {
  a++; //@
  return a;
}
export function down(a) {
  a--; //@
  return a;
}
export function orSet(o) {
  o.v ||= 2; //@
  return o;
}
export function andSet(o) {
  o.v &&= 2; //@
  return o;
}
export function init(a) {
  const v = a + 1; //@
  return v;
}
export async function store(save, x) {
  await save(x); //@
}
export function both(a, b, c) {
  return a > b && c; //@
}
`;
const WEAK_OPS = String.raw`import * as m from '../src/ops.mjs';
m.eq(1); m.ne(1); m.lt(1); m.ge(1); m.gt(1); m.le(1); m.and(1, 0); m.or(0, 1); m.yes(); m.no(); m.inc(1); m.dec(1); m.not(true);
m.pick(0, 1); m.loose(1); m.unlike(1); m.mul(2); m.div(2); m.mod(5); m.choose(true); m.value(1); m.call([]);
m.cond(() => true, []); m.plain({ on: true }, []); m.thrower(false); m.early(false, []); m.add(1); m.sub(1); m.up(1); m.down(1);
m.orSet({}); m.andSet({ v: 1 }); m.init(1); await m.store(async () => {}, 1); m.both(2, 1, true);
`;
const STRONG_OPS = String.raw`import assert from 'node:assert/strict';
import * as m from '../src/ops.mjs';
const is = (got, want) => assert.deepEqual(got, want);
is(m.eq(1), true); is(m.eq(2), false); is(m.ne(1), false); is(m.ne(2), true);
is(m.lt(0), true); is(m.lt(1), false); is(m.ge(1), true); is(m.ge(0), false);
is(m.gt(2), true); is(m.gt(1), false); is(m.le(1), true); is(m.le(2), false);
is(m.and(1, 0), 0); is(m.or(0, 1), 1); is(m.yes(), true); is(m.no(), false); is(m.inc(1), 2); is(m.dec(1), 0); is(m.not(true), false);
is(m.pick(0, 1), 0); is(m.loose(1), true); is(m.loose(2), false); is(m.unlike(1), false); is(m.unlike(2), true);
is(m.mul(3), 6); is(m.div(4), 2); is(m.mod(5), 2); is(m.choose(true), 1); is(m.choose(false), 2); is(m.value(5), 5);
const log = (fn) => { const l = []; fn(l); return l; };
is(log((l) => m.call(l)), [1]);
is(log((l) => m.cond(() => true, l)), [1]); is(log((l) => m.cond(() => false, l)), []);
is(log((l) => m.plain({ on: true }, l)), [1]); is(log((l) => m.plain({ on: false }, l)), []);
assert.throws(() => m.thrower(true)); m.thrower(false);
is(log((l) => m.early(true, l)), []); is(log((l) => m.early(false, l)), [1]);
is(m.add(1), 3); is(m.sub(1), -1); is(m.up(1), 2); is(m.down(1), 0);
is(m.orSet({}).v, 2); is(m.orSet({ v: 1 }).v, 1); is(m.andSet({ v: 1 }).v, 2); is(m.andSet({}).v, undefined);
is(m.init(1), 2);
const saved = []; await m.store(async (x) => { saved.push(x); }, 7); is(saved, [7]);
is(m.both(2, 1, true), true); is(m.both(1, 2, true), false); is(m.both(2, 1, false), false);
`;
// Every operator of requirement 1 and of the added set, in both directions where it has two.
const KINDS = ['=== -> !==', '!== -> ===', '< -> >=', '>= -> <', '> -> <=', '<= -> >', '&& -> ||', '|| -> &&', 'true -> false', 'false -> true',
  '+ -> -', '- -> +', 'return value -> undefined', 'call statement removed', 'call condition negated', '! removed', 'throw removed',
  'bare return removed', '?? -> ||', '+= -> -=', '-= -> +=', '++ -> --', '-- -> ++', 'awaited call removed', 'condition negated',
  'ternary branches swapped', '== -> !=', '!= -> ==', '||= -> &&=', '&&= -> ||=', '* -> /', '/ -> *', '% -> *', 'const initialiser -> undefined'];

test('T1-c08: every operator kind survives a weak test, a two-site line yields two survivors, and a strong test kills every mutant', async () => {
  const weak = fixture({ src: { 'src/ops.mjs': C08 }, files: { 'test/t.mjs': WEAK_OPS } });
  const w = await gate(weak.dir, [...on(weak), ...RUN]);
  assert.equal(w.code, 1);
  const got = new Set(w.j.survivors.map((s) => s.operator));
  assert.deepEqual(KINDS.filter((k) => !got.has(k)), [], 'every operator kind is among the survivors');
  const twoSite = C08.split('\n').findIndex((l) => l.includes('return a > b && c;')) + 1;
  const onTwoSite = w.j.survivors.filter((s) => s.line === twoSite).map((s) => s.operator);
  assert.ok(onTwoSite.includes('> -> <=') && onTwoSite.includes('&& -> ||'), `return a > b && c; yields a survivor at each site: ${onTwoSite}`);
  assert.deepEqual(w.j.unmutated, []);

  const strong = fixture({ src: { 'src/ops.mjs': C08 }, files: { 'test/t.mjs': STRONG_OPS } });
  const s = await gate(strong.dir, [...on(strong), ...RUN]);
  assert.equal(s.code, 0, `survivors: ${JSON.stringify(s.j.survivors)}`);
  assert.deepEqual([s.j.status, s.j.survived, s.j.invalid, s.j.timeout], ['ok', 0, 0, 0]);
  assert.equal(s.j.mutants, w.j.mutants, 'the same mutants are judged under both tests');
  assert.ok(s.j.killed >= KINDS.length);
});

test('T1-c09: two gates started together on one weak-fixture checkout agree, kill nothing and leave the checkout as it was', async () => {
  const fx = fixture({
    src: { 'src/m.mjs': 'export const gt = (a, b) => a > b; //@\nexport const lt = (a, b) => a < b && b !== 0; //@\n' },
    files: { 'test/t.mjs': "import * as m from '../src/m.mjs';\nm.gt(1, 2);\nm.lt(1, 2);\n" },
  });
  const before = hashTree(fx.dir);
  const [a, b] = await Promise.all([gate(fx.dir, [...on(fx), ...RUN]), gate(fx.dir, [...on(fx), ...RUN])]);
  for (const r of [a, b]) { assert.equal(r.code, 1); assert.equal(r.j.killed, 0); }
  assert.ok(a.j.survivors.length >= 3);
  assert.deepEqual(a.j.survivors, b.j.survivors);
  assert.deepEqual(hashTree(fx.dir), before);
});

test('T1-c10: only a mutate-ignore comment with a reason skips a line; ignored is a count plus {file,line,reason} entries', async () => {
  const src = `export const a = (x) => x > 1; // mutate-ignore //@
export const b = (x) => x < 2 || 'mutate-ignore: not a comment'; //@
export const c = (x) => x === 3; // mutate-ignore: equality is covered by the integration suite //@
`;
  const fx = fixture({ src: { 'src/ig.mjs': src }, files: { 'test/t.mjs': "import * as m from '../src/ig.mjs';\nm.a(0);\nm.b(0);\nm.c(0);\n" } });
  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.equal(r.code, 1);
  assert.deepEqual(pairs(r.j.survivors), ['src/ig.mjs:1', 'src/ig.mjs:2']);
  assert.deepEqual(at(r.j, 'src/ig.mjs', 3), [], 'the line with a reason is not mutated');
  assert.equal(r.j.ignored, 1);
  assert.deepEqual(r.j.ignores, [{ file: 'src/ig.mjs', line: 3, reason: 'equality is covered by the integration suite' }]);
});

test('T1-c11: a weak test that fails only on its 3rd run never gets the mutant counted as killed and never exits 0', async () => {
  const fx = cmpFixture(COUNTED_GT);
  const r = await gate(fx.dir, [...on(fx), ...RUN], { env: { GATE_COUNT: path.join(scratch(), 'count'), GATE_FAIL: 'n === 3' } });
  assert.notEqual(r.code, 0);
  assert.equal(r.j.killed, 0);
  assert.ok(!r.j.results.some((x) => x.outcome === 'killed'));
  if (r.code === 1) assert.deepEqual(pairs(r.j.survivors), ['src/cmp.mjs:1']);
  else assert.deepEqual([r.code, r.j.status], [2, 'noise']);
  // a flake on the first run of a mutant (the 4th invocation, after the two controls and the rewrite control) is noise, never a kill
  const fx4 = cmpFixture(COUNTED_GT);
  const r4 = await gate(fx4.dir, [...on(fx4), ...RUN], { env: { GATE_COUNT: path.join(scratch(), 'count'), GATE_FAIL: 'n === 4' } });
  assert.deepEqual([r4.code, r4.j.status, r4.j.killed], [2, 'noise', 0]);
});

test('T1-c12: a run that judges no mutant (timeout only, all ignored, nothing changed) is not ok and has no numeric survived', async () => {
  const loop = fixture({
    src: { 'src/count.mjs': 'export function count(n) {\n  let i = 0;\n  while (i < n) {\n    i = i + 1; //@\n  }\n  return i;\n}\n' },
    files: { 'test/t.mjs': "import { count } from '../src/count.mjs';\ncount(3);\n" },
  });
  const ignored = fixture({
    src: { 'src/cmp.mjs': 'export const gt = (a, b) => a > b; // mutate-ignore: compared in the end-to-end suite //@\n' +
      'export const lt = (a, b) => a < b; // mutate-ignore: compared in the end-to-end suite //@\n' },
    files: { 'test/t.mjs': WEAK_GT },
  });
  const quiet = repo({ 'src/cmp.mjs': 'export const gt = (a, b) => a > b;\n', 'test/t.mjs': WEAK_GT });
  write(quiet.dir, { 'test/t.mjs': `${WEAK_GT}gt(2, 1);\n`, 'README.md': 'notes\n' });
  const runs = [[loop, { timeout: 1 }], [ignored, { ignored: 2 }], [quiet, {}]];
  for (const [fx, extra] of runs) {
    const r = await gate(fx.dir, [...on(fx), ...RUN]);
    assert.notEqual(r.code, 0);
    assert.notEqual(r.j.status, 'ok');
    assert.equal(r.j.survived ?? null, null);
    assert.equal(r.j.mutants, 0);
    for (const [k, v] of Object.entries(extra)) assert.equal(r.j[k], v, k);
  }
  // mutants equals killed + survived on every run gate() makes, so on every fixture in this file; these add the c01 kinds.
  await checkC01Fixtures();
});

test('T1-c13: throw, bare return, ??, += and an awaited call each survive a weak test, and unmutated lists no line', async () => {
  const src = `export async function step(p, ok, a, b, n, x, blocked, save) {
  if (blocked(p)) throw new Error('no'); //@
  if (!ok) return; //@
  const v = a ?? b; //@
  n += 1; //@
  await save(x); //@
  return [v, n];
}
`;
  const t = "import { step } from '../src/step.mjs';\nawait step(1, true, 1, 2, 3, 4, () => false, async () => {});\n";
  const fx = fixture({ src: { 'src/step.mjs': src }, files: { 'test/t.mjs': t } });
  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.equal(r.code, 1);
  assert.deepEqual(pairs(r.j.survivors), ['src/step.mjs:2', 'src/step.mjs:3', 'src/step.mjs:4', 'src/step.mjs:5', 'src/step.mjs:6']);
  assert.deepEqual(r.j.unmutated, []);
});

// Logs HOME and the modes of the run's folder and of this test run's folder (the two levels above HOME's env folder).
const MODES = String.raw`import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.env.GATE_TMP;
const parts = path.relative(root, process.env.HOME).split(path.sep);
const runDir = path.join(root, parts[0]);
const box = path.join(runDir, parts[1]);
const mode = (d) => fs.statSync(d).mode & 0o777;
fs.appendFileSync(process.env.GATE_LOG, JSON.stringify({ home: process.env.HOME, runDir, runMode: mode(runDir), box, boxMode: mode(box) }) + '\n');
const { strong, weak } = await import('../src/m.mjs');
assert.equal(strong(2, 1), true);
assert.equal(strong(1, 1), false);
weak(1, 2);
`;

test('T1-c14: two interleaved runs under an empty TMPDIR agree, use their own 0700 temp folders and leave TMPDIR empty', async () => {
  const src = 'export const strong = (a, b) => a > b; //@\nexport const weak = (a, b) => a < b; //@\n';
  const fx = fixture({ src: { 'src/m.mjs': src }, files: { 'test/t.mjs': MODES } });
  const tmp = scratch();
  const logs = [path.join(scratch(), 'one.jsonl'), path.join(scratch(), 'two.jsonl')];
  const env = (log) => ({ TMPDIR: tmp, GATE_TMP: tmp, GATE_LOG: log });
  const [a, b] = await Promise.all([
    gate(fx.dir, [...on(fx), ...RUN], { env: env(logs[0]) }),
    gate(fx.dir, [...on(fx), '--test', 'sleep 1; node test/t.mjs'], { env: env(logs[1]) }),
  ]);
  const runDirs = [];
  for (const [r, log] of [[a, logs[0]], [b, logs[1]]]) {
    assert.equal(r.code, 1);
    assert.deepEqual(r.j.survivors, [{ file: 'src/m.mjs', line: 2, operator: '< -> >=' }]);
    assert.deepEqual(at(r.j, 'src/m.mjs', 1).map((x) => x.outcome), ['killed']);
    const entries = readLog(log);
    assert.ok(entries.length >= 5);
    for (const e of entries) {
      assert.ok(inside(e.home, tmp), `HOME ${e.home} is inside TMPDIR`);
      assert.deepEqual([e.runMode, e.boxMode], [0o700, 0o700], 'temp folders are created with mode 0700');
    }
    const dirs = [...new Set(entries.map((e) => e.runDir))];
    assert.equal(dirs.length, 1, 'one temp folder per run');
    runDirs.push(dirs[0]);
    assert.equal(new Set(entries.map((e) => e.box)).size, entries.length, 'each test run has its own folder');
  }
  assert.notEqual(runDirs[0], runDirs[1], 'the two runs never share a temp folder');
  assert.deepEqual(fs.readdirSync(tmp), [], 'TMPDIR is empty after both runs');
});

test('T1-c15: a weak test that passes 3 runs and fails after never yields an ok kill; the closing unmutated run makes it NOISE', async () => {
  const fx = cmpFixture(COUNTED_GT);
  const r = await gate(fx.dir, [...on(fx), ...RUN], { env: { GATE_COUNT: path.join(scratch(), 'count'), GATE_FAIL: 'n > 3' } });
  assert.notEqual(r.code, 0);
  assert.ok(!(r.j.status === 'ok' && r.j.killed > 0));
  assert.deepEqual([r.code, r.j.status, r.j.killed], [2, 'noise', 0]);
  const last = r.j.controls.at(-1);
  assert.deepEqual([last.kind, last.pass], ['final', false], 'the unmutated run after the last mutant failed');
});

test('T1-c16: a test that compares each changed file to its committed text, comments and spaces aside, makes the rewrite control NOISE', async () => {
  const t = String.raw`import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\s+/g, '');
for (const f of ['src/a.mjs', 'src/b.mjs']) {
  if (bare(fs.readFileSync(f, 'utf8')) !== bare(execFileSync('git', ['show', 'HEAD:' + f], { encoding: 'utf8' }))) process.exit(1);
}
const { a } = await import('../src/a.mjs');
const { b } = await import('../src/b.mjs');
a(0);
b(0);
`;
  const src = { 'src/a.mjs': 'export const a = (x) => x > 1; //@\n', 'src/b.mjs': 'export const b = (x) => x < 2; //@\n' };
  const fx = fixture({ src, files: { 'test/t.mjs': t }, commit: true });
  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.notEqual(r.code, 0);
  assert.deepEqual([r.code, r.j.status, r.j.killed], [2, 'noise', 0]);
  assert.deepEqual(r.j.results, [], 'no mutant was judged');
  assert.deepEqual(r.j.controls.map((c) => [c.kind, c.pass]), [['unmutated', true], ['unmutated', true], ['rewrite', false]]);
  assert.deepEqual(r.j.rewrite, { lines: 2, wrapped: 2 }, 'the rewrite touched the changed line in each file');
});

test('T1-c17: a plain condition, a ternary, a while condition and == each survive a weak test; the run is never ok with 0 survived', async () => {
  const src = `export function cmp(a, b) {
  return a > b; //@
}
export function flow(opts, ready, a, b, q, x, log) {
  if (opts.force) { //@
    log.push('force');
  }
  const v = ready ? a : b; //@
  while (q.length) { //@
    q.pop();
  }
  if (x == null) return 1; //@
  return v;
}
`;
  const t = String.raw`import assert from 'node:assert/strict';
import { cmp, flow } from '../src/flow.mjs';
assert.equal(cmp(2, 1), true);
assert.equal(cmp(1, 1), false);
assert.equal(cmp(1, 2), false);
flow({ force: true }, true, 1, 2, [1, 2], 5, []);
`;
  const fx = fixture({ src: { 'src/flow.mjs': src }, files: { 'test/t.mjs': t } });
  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.ok(!(r.code === 0 && r.j.survived === 0), 'never exit 0 with survived 0');
  const four = ['src/flow.mjs:12', 'src/flow.mjs:5', 'src/flow.mjs:8', 'src/flow.mjs:9'];
  const survived = pairs(r.j.survivors);
  const unmutated = pairs(r.j.unmutated);
  const allSurvive = four.every((p) => survived.includes(p));
  const allListed = four.every((p) => unmutated.includes(p)) && r.code !== 0 && r.j.status !== 'ok';
  assert.ok(allSurvive || allListed, `survivors ${survived}; unmutated ${unmutated}`);
});

test('T1-c18: sentinel MEMEV_*, XDG_CONFIG_HOME, GIT_DIR and GIT_INDEX_FILE in the gate never reach a test, and stay untouched', async () => {
  const t = String.raw`import fs from 'node:fs';
import { gt } from '../src/cmp.mjs';
import { execFileSync } from 'node:child_process';
const keys = ['HOME', 'MEMEV_ROOT', 'MEMEV_CONFIG_DIR', 'XDG_CONFIG_HOME', 'MEMEV_TEST_TMP', 'GIT_DIR', 'GIT_INDEX_FILE',
  'MEMEV_NO_TUNNEL', 'MEMEV_NO_BACKGROUND', 'SSH_AUTH_SOCK', 'GIT_SSH_COMMAND'];
const remotes = execFileSync('git', ['remote'], { encoding: 'utf8' }).trim();
fs.appendFileSync(process.env.GATE_LOG, JSON.stringify({ ...Object.fromEntries(keys.map((k) => [k, process.env[k] ?? null])), remotes }) + '\n');
gt(1, 2);
`;
  const fx = cmpFixture(t);
  const box = scratch();
  const sentinels = {};
  for (const k of ['MEMEV_ROOT', 'MEMEV_CONFIG_DIR', 'XDG_CONFIG_HOME', 'MEMEV_TEST_TMP', 'GIT_DIR']) {
    sentinels[k] = path.join(box, k.toLowerCase());
    write(sentinels[k], { 'keep.txt': `${k}\n` });
  }
  write(path.join(box, 'index'), { index: 'not an index\n' });
  sentinels.GIT_INDEX_FILE = path.join(box, 'index', 'index');
  const before = hashTree(box);
  const tmp = scratch();
  const log = path.join(scratch(), 'env.jsonl');
  // the caller has a remote and an ssh agent; no copy keeps the remote and no test sees the agent, so a test cannot push anywhere real
  spawnSync('git', ['remote', 'add', 'origin', path.join(box, 'upstream.git')], { cwd: fx.dir });
  const r = await gate(fx.dir, [...on(fx), ...RUN], { env: { ...sentinels, TMPDIR: tmp, GATE_LOG: log, SSH_AUTH_SOCK: path.join(box, 'agent.sock'), GIT_SSH_COMMAND: 'ssh -i /nowhere' } });
  assert.equal(r.code, 1);
  const entries = readLog(log);
  assert.ok(entries.length >= 5);
  for (const e of entries) {
    const runDir = path.join(tmp, path.relative(tmp, e.HOME).split(path.sep)[0]);
    assert.ok(inside(e.HOME, tmp) && runDir !== tmp, `HOME ${e.HOME} is inside the run's temp folder`);
    for (const k of Object.keys(sentinels)) assert.ok(e[k] === null || inside(e[k], runDir), `${k}=${e[k]} is unset or inside ${runDir}`);
    assert.deepEqual([e.MEMEV_NO_TUNNEL, e.MEMEV_NO_BACKGROUND], ['1', '1']);
    assert.deepEqual([e.SSH_AUTH_SOCK, e.GIT_SSH_COMMAND, e.remotes], [null, null, ''], 'no ssh agent, no ssh override and no remote reach a test');
  }
  assert.deepEqual(hashTree(box), before, 'every sentinel folder hashes as before');
});

test('T1-c19: changed lines in src .mjs, vendor, bin and src .js files are all judged; --scope narrows the run with per-file counts', async () => {
  const fx = fixture({
    src: {
      'vendor/x/y.mjs': 'export const y = (a) => a > 1; //@\n',
      'src/a.mjs': "import { y } from '../vendor/x/y.mjs';\nexport const useY = (v) => y(v);\nexport const a = (v) => v < 5; //@\n",
      'bin/z.mjs': 'export const z = (a) => a === 3; //@\n',
      'src/c.js': 'export const c = (a) => a !== 4; //@\n',
    },
    files: { 'test/t.mjs': String.raw`import { useY, a } from '../src/a.mjs';
import { z } from '../bin/z.mjs';
import { c } from '../src/c.js';
useY(0); a(0); z(0); c(0);
` },
  });
  const all = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.equal(all.code, 1);
  assert.deepEqual(pairs(all.j.survivors), ['bin/z.mjs:1', 'src/a.mjs:3', 'src/c.js:1', 'vendor/x/y.mjs:1']);
  assert.deepEqual(all.j.files.map((f) => [f.file, f.mutants, f.killed, f.survived]),
    [['bin/z.mjs', 1, 0, 1], ['src/a.mjs', 1, 0, 1], ['src/c.js', 1, 0, 1], ['vendor/x/y.mjs', 1, 0, 1]]);

  const src = await gate(fx.dir, [...on(fx), ...RUN, '--scope', 'src/**']);
  assert.deepEqual(pairs(src.j.survivors), ['src/a.mjs:3', 'src/c.js:1']);
  assert.deepEqual(src.j.files.map((f) => f.file), ['src/a.mjs', 'src/c.js']);
  const other = await gate(fx.dir, [...on(fx), ...RUN, '--scope', 'vendor/**', '--scope', 'bin/*.mjs']);
  assert.deepEqual(pairs(other.j.survivors), ['bin/z.mjs:1', 'vendor/x/y.mjs:1']);
});

test('T1-c20: git config, tag and commit in the test, after a normal run and after a SIGKILLed one, leave the repository as it was', async () => {
  const t = String.raw`import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const g = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (g('config', 'gate.touched') !== 'yes' || !g('tag', '-l', 'gate-*') || g('log', '-1', '--format=%s') !== 'x') process.exit(1);
const text = fs.readFileSync('src/cmp.mjs', 'utf8');
const bare = (s) => s.replace(/[()\s]/g, '');
const block = process.env.GATE_BLOCK;
if (block && bare(text) !== bare(fs.readFileSync(process.env.GATE_ORIGINAL, 'utf8'))) {
  fs.writeFileSync(block + '.started', String(process.pid));
  const until = Date.now() + 60000;
  while (!fs.existsSync(block + '.release') && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
const { gt } = await import('../src/cmp.mjs');
gt(1, 2);
`;
  const fx = cmpFixture(t);
  const original = path.join(scratch(), 'original.mjs');
  fs.copyFileSync(path.join(fx.dir, 'src/cmp.mjs'), original);
  const state = () => { const s = gitState(fx.dir); delete s.status; return s; };
  const before = state();
  const args = [...on(fx), '--test', 'git config gate.touched yes; git tag gate-$$; git commit -q --allow-empty -m x; node test/t.mjs'];
  const r = await gate(fx.dir, args, { env: { GATE_ORIGINAL: original } });
  assert.equal(r.code, 1, 'the git commands ran in each copy and the weak mutant survived');
  assert.deepEqual(state(), before, 'after a normal run');
  await killDuringMutant(fx, args, { GATE_ORIGINAL: original });
  assert.deepEqual(state(), before, 'after a SIGKILLed run');
});

test('T1-c21: a mutant that makes a passing test about 3 times slower survives, and the time limit is reported and large enough', async () => {
  const src = `const done = new Set();
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function warm(k) {
  if (done.has(k)) return; //@
  pause(600);
  done.add(k);
}
`;
  const t = "import { warm } from '../src/warm.mjs';\nwarm('a');\nwarm('a');\nwarm('a');\n";
  const fx = fixture({ src: { 'src/warm.mjs': src }, files: { 'test/t.mjs': t } });
  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.equal(r.code, 1);
  assert.equal(r.j.timeout, 0);
  const slow = r.j.results.find((x) => x.operator === 'bare return removed');
  assert.equal(slow.outcome, 'survived');
  assert.ok(r.j.survivors.some((s) => s.line === 4 && s.operator === 'bare return removed'));
  const controls = r.j.controls.filter((c) => c.kind === 'unmutated').map((c) => c.ms);
  assert.equal(controls.length, 2);
  assert.ok(r.j.timeoutMs >= 5 * Math.max(...controls) + 10000, `limit ${r.j.timeoutMs} ms for unmutated runs of ${controls} ms`);
  assert.ok(slow.ms >= 1.8 * Math.min(...controls), `the mutant took ${slow.ms} ms against ${controls} ms unmutated`);
});

test('T1-c22: a test that fails whenever src differs from HEAD stops the run as NOISE before any mutant is judged', async () => {
  const t = String.raw`import { execFileSync } from 'node:child_process';
import { gt } from '../src/cmp.mjs';
try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src'], { stdio: 'ignore' }); } catch { process.exit(1); }
gt(1, 2);
`;
  const fx = fixture({ src: { 'src/cmp.mjs': CMP }, files: { 'test/t.mjs': t }, commit: true });
  const r = await gate(fx.dir, [...on(fx), ...RUN]);
  assert.deepEqual([r.code, r.j.status, r.j.killed], [2, 'noise', 0]);
  assert.deepEqual(r.j.results, [], 'no mutant was judged');
});

test('T1-c23: an empty --base, an absent sha and --base=--output=PWNED each exit 2 with status error before any test runs', async () => {
  const fx = cmpFixture(WEAK_GT);
  const marker = path.join(scratch(), 'ran');
  const tmp = scratch();
  const missing = 'f0'.repeat(20);
  assert.throws(() => git(fx.dir, 'cat-file', '-e', missing));
  for (const args of [['--base', ''], ['--base', missing], ['--base', '--output=PWNED'], ['--base=--output=PWNED']]) {
    const r = await gate(fx.dir, [...args, '--test', `touch '${marker}'`], { env: { TMPDIR: tmp } });
    assert.deepEqual([r.code, r.j.status], [2, 'error'], `${args.join(' ')}: ${r.j.reason}`);
    assert.equal(fs.existsSync(marker), false, 'the test command never ran');
    for (const dir of [fx.dir, process.cwd(), tmp]) assert.ok(!walkNames(dir).includes('PWNED'), `no PWNED file in ${dir}`);
    assert.deepEqual(fs.readdirSync(tmp), []);
  }
});

test('T1-c24: every test command sees a HOME inside the run temp folder, never the caller HOME, and MEMEV_NO_SERVICE=1', async () => {
  const fx = cmpFixture(WEAK_GT);
  const home = scratch();
  const tmp = scratch();
  const log = path.join(scratch(), 'env.log');
  const cmd = String.raw`printf '%s|%s\n' "$HOME" "$MEMEV_NO_SERVICE" >> "$GATE_LOG"; node test/t.mjs`;
  const r = await gate(fx.dir, [...on(fx), '--test', cmd], { env: { HOME: home, MEMEV_NO_SERVICE: undefined, TMPDIR: tmp, GATE_LOG: log } });
  assert.equal(r.code, 1);
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('|'));
  assert.ok(lines.length >= 5);
  const runDirs = new Set();
  for (const [h, noService] of lines) {
    assert.notEqual(h, home);
    assert.ok(inside(h, tmp) && path.relative(tmp, h).split(path.sep).length > 1, `HOME ${h} is inside the run's temp folder`);
    runDirs.add(path.relative(tmp, h).split(path.sep)[0]);
    assert.equal(noService, '1');
  }
  assert.equal(runDirs.size, 1);
});
