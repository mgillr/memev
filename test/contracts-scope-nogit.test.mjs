// SR-0.03 task 2: when git cannot say what changed (the .git folder is gone, or git itself fails) scope and red-green are
// BLOCKED and never PASS.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { repoAt, put, signScope, SCOPE_CRITERION, OWNER } from './helpers/scope.mjs';
after(cleanup);

const TEST = "import { test } from 'node:test';\ntest('x', () => {});\n";
const RED_GREEN = { statement: 'red then green', verifier: { type: 'test_red_green', test_file: 'test/t.test.mjs', cmd: 'node --test {test}' } };

async function signedWithOutsideChange(v) {
  const { dir, base } = repoAt({ 'src/a/ok.js': 'ok\n', 'test/t.test.mjs': TEST });
  const id = signScope(v, { workdir: dir, tasks: { T1: ['src/a/**'] }, extra: [RED_GREEN] }); // the base is the workdir's HEAD at signing
  assert.equal(v.contractCheckSignature(id).contract.base.sha, base);
  put(dir, { 'src/b/outside.js': 'outside\n' });
  return { dir, id };
}
const verdicts = (r) => Object.fromEntries(r.tasks[0].criteria.map((c) => [c.statement, c]));

test('with .git renamed away, scope and red-green are BLOCKED ("not a git checkout") and neither is PASS', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, id } = await signedWithOutsideChange(v);
    fs.renameSync(path.join(dir, '.git'), path.join(tmpdir('nogit-away-'), 'git-away'));
    const by = verdicts(await v.contractVerify(OWNER, { id }));
    for (const name of [SCOPE_CRITERION.statement, RED_GREEN.statement]) {
      assert.equal(by[name].status, 'BLOCKED', `${name}: ${by[name].detail}`);
      assert.match(by[name].detail, /not a git checkout|git/i);
    }
  } finally { v.close(); }
});

test('with a git first on PATH that exits 128, scope and red-green are BLOCKED naming git, and neither is PASS', async () => {
  const { v } = newVault({ git: false });
  const saved = process.env.PATH;
  try {
    const { id } = await signedWithOutsideChange(v);
    const fake = tmpdir('nogit-fake-');
    fs.writeFileSync(path.join(fake, 'git'), '#!/bin/sh\necho "fatal: this git always fails" >&2\nexit 128\n', { mode: 0o755 });
    process.env.PATH = `${fake}${path.delimiter}${saved}`;
    let r; try { r = await v.contractVerify(OWNER, { id }); } finally { process.env.PATH = saved; }
    const by = verdicts(r);
    for (const name of [SCOPE_CRITERION.statement, RED_GREEN.statement]) {
      assert.equal(by[name].status, 'BLOCKED', `${name}: ${by[name].detail}`);
      assert.match(by[name].detail, /not a git checkout|git/i);
    }
  } finally { process.env.PATH = saved; v.close(); }
});

test('git failing after the base is found (a broken index) is BLOCKED on scope naming the failing git command, never PASS', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, id } = await signedWithOutsideChange(v);
    fs.writeFileSync(path.join(dir, '.git', 'index'), 'this is not an index');
    const r = verdicts(await v.contractVerify(OWNER, { id }))[SCOPE_CRITERION.statement];
    assert.equal(r.status, 'BLOCKED', r.detail);
    assert.match(r.detail, /git \w+ failed/);
  } finally { v.close(); }
});

test('a git that finds the base but fails when listing changes is BLOCKED on scope naming the failing git command, never PASS', async () => {
  const { v } = newVault({ git: false });
  const saved = process.env.PATH;
  try {
    const { id } = await signedWithOutsideChange(v);
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const fake = tmpdir('nogit-late-');
    fs.writeFileSync(path.join(fake, 'git'), `#!/bin/sh\nfor a in "$@"; do case "$a" in diff|ls-files|rev-list) echo "fatal: simulated failure" >&2; exit 128;; esac; done\nexec '${real}' "$@"\n`, { mode: 0o755 });
    process.env.PATH = `${fake}${path.delimiter}${saved}`;
    let r; try { r = await v.contractVerify(OWNER, { id }); } finally { process.env.PATH = saved; }
    const scope = verdicts(r)[SCOPE_CRITERION.statement];
    assert.equal(scope.status, 'BLOCKED', scope.detail);
    assert.match(scope.detail, /git (diff|ls-files|rev-list) failed/);
  } finally { process.env.PATH = saved; v.close(); }
});
