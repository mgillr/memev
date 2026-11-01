// SR-0.03 task 2: a base the repository does not have (never there, or removed by reset, reflog expiry and gc) makes scope and
// red-green BLOCKED with "base <sha> not found" and runs nothing; and `memev contract new` refuses a base that is not 40 hex
// characters before it writes a draft.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { repoAt, commitFiles, put, gitIn, signScope, scopeResults, OWNER } from './helpers/scope.mjs';
after(cleanup);

const RED_GREEN = 'red then green';
const redGreenCriterion = (marker) => ({ statement: RED_GREEN, verifier: { type: 'test_red_green', test_file: 'test/f.test.mjs', cmd: `echo ran >> '${marker}'; node --test {test}` } });
const byName = (r, name) => r.tasks[0].criteria.find((c) => c.statement === name);
const FILES = { 'src/a/ok.js': '1\n', 'test/f.test.mjs': "import { test } from 'node:test';\ntest('x', () => {});\n" };

async function checkBlocked(v, dir, base, marker, id) {
  const r = await v.contractVerify(OWNER, { id });
  const scope = scopeResults(r).T1; const rg = byName(r, RED_GREEN);
  for (const [name, c] of [['scope', scope], ['test_red_green', rg]]) {
    assert.equal(c.status, 'BLOCKED', `${name}: ${c.detail}`);
    assert.ok(c.detail.includes(`base ${base} not found`), `${name} detail: ${c.detail}`);
  }
  assert.equal(fs.existsSync(marker), false, 'the red command ran');
}

test('a base that is a 40-hex sha the repository does not have is BLOCKED on scope and red-green, and the red command never runs', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir } = repoAt(FILES);
    put(dir, { 'src/b/out.js': 'outside\n' }); // an out-of-scope change, which must not be judged against a base nobody can find
    const missing = '0123456789abcdef0123456789abcdef01234567';
    const marker = path.join(tmpdir('unknown-marker-'), 'red-ran');
    const id = signScope(v, { workdir: dir, base: missing, tasks: { T1: ['src/a/**'] }, extra: [redGreenCriterion(marker)] });
    await checkBlocked(v, dir, missing, marker, id);
  } finally { v.close(); }
});

test('a base whose commit was removed (reset --hard, reflog expire --all, gc --prune=now) is BLOCKED the same way', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base: first } = repoAt(FILES);
    const doomed = commitFiles(dir, { 'src/a/ok.js': '2\n' }, 'a commit that will be removed');
    const marker = path.join(tmpdir('removed-marker-'), 'red-ran');
    const id = signScope(v, { workdir: dir, base: doomed, tasks: { T1: ['src/a/**'] }, extra: [redGreenCriterion(marker)] });
    gitIn(dir, 'reset', '--hard', '-q', first);
    gitIn(dir, 'reflog', 'expire', '--expire=now', '--all');
    gitIn(dir, 'gc', '-q', '--prune=now');
    assert.throws(() => gitIn(dir, 'cat-file', '-e', `${doomed}^{commit}`), 'the commit is still in the repository');
    put(dir, { 'src/b/out.js': 'outside\n' });
    await checkBlocked(v, dir, doomed, marker, id);
  } finally { v.close(); }
});

test('memev contract new refuses a base of abc and a base of 41 hex characters, and writes no draft; 40 hex is taken', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const { dir, base } = repoAt(FILES);
    const spec = path.join(tmpdir('unknown-spec-'), 'spec.json');
    fs.writeFileSync(spec, JSON.stringify({ title: 'Base format', tasks: [{ id: 'T1', title: 'the work', scope: ['src/a/**'], criteria: [{ statement: 'changes stay in scope', verifier: { type: 'scope' } }] }] }));
    const drafts = () => { try { return fs.readdirSync(path.join(sb.root, 'contracts', 'drafts')); } catch { return []; } };
    for (const bad of ['abc', `${base}a`]) {
      const r = sb.run(['contract', 'new', spec, '--workdir', dir, '--base', bad]);
      assert.notEqual(r.code, 0, `a base of ${bad.length} characters was accepted: ${r.out}`);
      assert.match(r.err + r.out, /40 hex/);
      assert.deepEqual(drafts(), [], `a draft was written for the base ${bad}`);
    }
    const ok = sb.run(['contract', 'new', spec, '--workdir', dir, '--base', base]);
    assert.equal(ok.code, 0, ok.err + ok.out);
    assert.equal(drafts().length, 1);
  } finally { sb.stop(); }
});
