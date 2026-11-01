// SR-0.03 task 2: verifying a repository never runs code the repository supplies. With contracts.exec on and a local-signed
// contract, a repository whose core.fsmonitor, clean filter, post-checkout hook and docs generator would each write a marker
// gets its verdicts, and no marker appears. A generated file counts as in scope only when the generator taken from the
// recorded base reproduces it; the workdir's copy of the generator never runs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { repoAt, commitFiles, put, plant, ran, generatorText, signScope, scopeResults, SCOPE_CRITERION, OWNER } from './helpers/scope.mjs';
after(cleanup);

const F_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { f } from '../src/f.mjs';\ntest('f is fixed', () => { assert.equal(f(), 2); });\n";
const BASE = { 'README.md': 'start here\n', 'src/f.mjs': 'export const f = () => 1;\n', 'docs/MODULES.md': 'stale\n', 'scripts/docs/module-graph.mjs': generatorText('generated\n') };
const GREP = { statement: 'the readme says where to start', verifier: { type: 'grep', file: 'README.md', pattern: 'start here' } };
const RED_GREEN = { statement: 'red then green', verifier: { type: 'test_red_green', test_file: 'test/f.test.mjs', cmd: 'node --test {test}' } };
const WORK = { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': F_TEST };
const MODULES = 'docs/MODULES.md';
const GENERATOR = 'scripts/docs/module-graph.mjs';

/** A fixture signed against its base, `change` applied (committed or not), then the hostile settings planted; returns the verdicts by statement and the markers. */
async function run(v, { base = BASE, change, committed }) {
  const { dir, base: sha } = repoAt(base);
  const id = signScope(v, { workdir: dir, base: sha, tasks: { T1: ['src/**', 'test/**', '.gitattributes'] }, extra: [GREP, RED_GREEN] });
  const markerDir = tmpdir('hardening-markers-');
  const files = change(path.join(markerDir, 'marker-gen'));
  if (committed) commitFiles(dir, files, 'I change the code and the generated file'); else put(dir, files);
  const markers = plant(dir, markerDir);
  const r = await v.contractVerify(OWNER, { id });
  return { by: Object.fromEntries(r.tasks[0].criteria.map((c) => [c.statement, c])), markers };
}
const scopeOf = (by) => by[SCOPE_CRITERION.statement];
// what a hostile worker changes: the code, the generated file as the base generator would write it, and a generator that would leave a marker
const hostile = (text) => (gen) => ({ ...WORK, [MODULES]: text, [GENERATOR]: generatorText(text, gen) });

for (const committed of [true, false]) {
  const how = committed ? 'committed' : 'uncommitted';
  test(`${how}: every verdict comes back, the file the base generator reproduces is in scope, the changed generator is not, and no marker appears`, async () => {
    const { v } = newVault({ git: false });
    try {
      const { by, markers } = await run(v, { committed, change: hostile('generated\n') });
      assert.equal(by[GREP.statement].status, 'PASS', by[GREP.statement].detail);
      assert.equal(by[RED_GREEN.statement].status, 'PASS', by[RED_GREEN.statement].detail);
      assert.equal(scopeOf(by).status, 'FAIL', scopeOf(by).detail);
      assert.ok(scopeOf(by).detail.includes(GENERATOR), scopeOf(by).detail);
      assert.ok(!scopeOf(by).detail.includes(MODULES), `the reproduced file was named: ${scopeOf(by).detail}`);
      assert.deepEqual(ran(markers), [], 'something in the repository ran');
    } finally { v.close(); }
  });

  test(`${how}: a generated file the base generator does not reproduce is FAIL naming it, and still no marker appears`, async () => {
    const { v } = newVault({ git: false });
    try {
      // the hostile generator would write exactly this text, but only the base generator decides
      const { by, markers } = await run(v, { committed, change: (gen) => ({ ...WORK, [MODULES]: 'hand edited\n', [GENERATOR]: generatorText('hand edited\n', gen) }) });
      assert.equal(scopeOf(by).status, 'FAIL', scopeOf(by).detail);
      assert.ok(scopeOf(by).detail.includes(MODULES) && scopeOf(by).detail.includes(GENERATOR), scopeOf(by).detail);
      assert.deepEqual(ran(markers), [], 'something in the repository ran');
    } finally { v.close(); }
  });

  test(`${how}: with the generator unchanged, a file it reproduces is PASS and counted`, async () => {
    const { v } = newVault({ git: false });
    try {
      const { by, markers } = await run(v, { committed, change: () => ({ ...WORK, [MODULES]: 'generated\n' }) });
      assert.equal(scopeOf(by).status, 'PASS', scopeOf(by).detail);
      assert.match(scopeOf(by).detail, /\b4 changed files\b/);
      assert.deepEqual(ran(markers), []);
    } finally { v.close(); }
  });
}

test('a base without a generator gives a generated file no exception', async () => {
  const { v } = newVault({ git: false });
  try {
    const { by } = await run(v, { committed: true, base: { 'README.md': 'start here\n', 'src/f.mjs': 'export const f = () => 1;\n', 'docs/MODULES.md': 'stale\n' }, change: () => ({ ...WORK, [MODULES]: 'generated\n' }) });
    assert.equal(scopeOf(by).status, 'FAIL', scopeOf(by).detail);
    assert.ok(scopeOf(by).detail.includes(MODULES), scopeOf(by).detail);
  } finally { v.close(); }
});

test('the contract\'s own changelog note is in scope', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt({ 'src/a.js': 'a\n' });
    const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/**'] } });
    commitFiles(dir, { [`changelog.d/${id}.md`]: 'I change a thing.\n', 'changelog.d/OTHER.md': 'not mine\n' }, 'I add notes');
    const r = scopeResults(await v.contractVerify(OWNER, { id })).T1;
    assert.equal(r.status, 'FAIL', r.detail);
    assert.ok(r.detail.includes('changelog.d/OTHER.md') && !r.detail.includes(`${id}.md`), r.detail);
  } finally { v.close(); }
});
