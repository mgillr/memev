// SR-0.03 task 3: the test path reaches the command as one argument, never as shell text, and a remote-signed contract's support
// files stay inside the vault.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, commit, gitIn, nodeTest, redGreen, signed, first } from './helpers/redgreen.mjs';
after(cleanup);

test('a test file named with $(touch pwned) runs as that one path in the red and the green run, and nothing is touched', async () => {
  const { v } = newVault({ git: false });
  try {
    const log = path.join(tmpdir('rg-args-'), 'paths');
    const name = 'test/a $(touch pwned).test.mjs';
    const body = nodeTest(`fs.appendFileSync(${JSON.stringify(log)}, path.basename(fileURLToPath(import.meta.url)) + '\\n'); assert.equal(f(), 2);`, "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nimport { f } from '../src/f.mjs';");
    const fx = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', [name]: body });
    const r = first(await v.contractVerify(OWNER, { id: signed(v, { workdir: fx.dir, base: fx.base, criteria: [redGreen(name, 'node --test {test}')] }) }));
    assert.equal(r.status, 'PASS', r.detail);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['a $(touch pwned).test.mjs', 'a $(touch pwned).test.mjs'], 'the red and the green run each got the path whole');
    for (const d of [fx.dir, path.join(fx.dir, 'test'), process.cwd()]) assert.equal(fs.existsSync(path.join(d, 'pwned')), false, `pwned was created in ${d}`);
  } finally { v.close(); }
});

test('a remote-signed, approved contract with a support file outside the vault is BLOCKED and nothing is written outside', async () => {
  const { v, root } = newVault({ git: false });
  try {
    // the workdir is a repository inside the vault
    const dir = path.join(root, 'work');
    fs.mkdirSync(dir, { recursive: true });
    gitIn(dir, 'init', '-q');
    commit(dir, { 'src/f.mjs': 'export const f = () => 1;\n' }, 'base');
    commit(dir, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") }, 'head');
    const away = fs.realpathSync(tmpdir('rg-away-'));
    fs.writeFileSync(path.join(root, '..', 'outside.txt'), 'outside\n');
    for (const support of ['../outside.txt', path.join(away, 'outside.txt')]) {
      const d = v.contractDraft(OWNER, { title: 'Remote support', workdir: dir, tasks: [{ id: 'T1', title: 'the change', scope: ['**'], criteria: [redGreen('test/f.test.mjs', 'node --test {test}', { support_files: [support] })] }] });
      v.contractSign(OWNER, { id: d.id, local: false });
      v.contractApprove(OWNER, { id: d.id });
      const r = first(await v.contractVerify(OWNER, { id: d.id }));
      assert.equal(r.status, 'BLOCKED', `${support}: ${r.detail}`);
      assert.match(r.detail, /outside the vault/);
    }
    assert.deepEqual(fs.readdirSync(away), [], 'a file was written outside the temporary worktree');
    assert.equal(fs.existsSync(path.join(dir, 'outside.txt')), false);
  } finally { v.close(); }
});
