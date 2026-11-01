// SR-0.03 task 1: every criterion command runs with MEMEV_CONTRACT_BASE set to the signed base, and a contract without a base
// never inherits one from the daemon's own environment.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { gitRepo, commit, task, signByHand, signedBody } from './helpers/contracts-base.mjs';
after(cleanup);

const note = (out) => `printf '%s\\n' "\${MEMEV_CONTRACT_BASE-unset}" >> '${out}'`;

test('command, metric and both red-green runs each see the signed base', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const out = path.join(tmpdir('base-env-'), 'seen');
    const { dir } = gitRepo({ 'src/a.js': 'export const a = 1;\n' });
    commit(dir, { 'test/a.test.mjs': '// a test\n' }, 'the test');
    const d = v.contractDraft(OWNER, { title: 'Base in the env', workdir: dir, tasks: task([
      { statement: 'the command sees the base', verifier: { type: 'command', cmd: note(out) } },
      { statement: 'the metric sees the base', verifier: { type: 'metric', cmd: `${note(out)}; echo '{"n":1}'`, key: 'n', op: '==', value: 1 } },
      { statement: 'red and green see the base', verifier: { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd: `${note(out)}; exit 0` } },
    ], ['**']) });
    v.contractSign(OWNER, { id: d.id });
    const base = signedBody(root, d.id).base.sha;
    assert.match(base, /^[0-9a-f]{40}$/);
    await v.contractVerify(OWNER, { id: d.id });
    const lines = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n') : [];
    assert.deepEqual(lines.slice(-4), [base, base, base, base], `command, metric, red and green each saw the base (file: ${JSON.stringify(lines)})`);
  } finally { v.close(); }
});

test('a legacy contract without a base sees MEMEV_CONTRACT_BASE unset, even when the daemon\'s environment has it', async () => {
  const { v, root } = newVault({ git: false });
  const saved = process.env.MEMEV_CONTRACT_BASE;
  try {
    const out = path.join(tmpdir('base-env-'), 'seen');
    const { dir } = gitRepo();
    process.env.MEMEV_CONTRACT_BASE = 'f'.repeat(40);
    const legacy = signByHand(root, { workdir: dir, tasks: task([{ statement: 'the command sees no base', verifier: { type: 'command', cmd: note(out) } }]) });
    await v.contractVerify(OWNER, { id: legacy.id });
    assert.equal(fs.readFileSync(out, 'utf8').trim().split('\n').pop(), 'unset');
  } finally {
    if (saved === undefined) delete process.env.MEMEV_CONTRACT_BASE; else process.env.MEMEV_CONTRACT_BASE = saved;
    v.close();
  }
});
