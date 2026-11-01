// SR-0.03 task 2: a remote caller, or a remote-signed contract, never learns anything about a repository outside the vault: a
// scope criterion is BLOCKED "outside the vault", a red-green and a metric criterion are BLOCKED, and neither the verify
// result nor the receipt names a file of that repository.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { repoAt, put, OWNER } from './helpers/scope.mjs';
after(cleanup);

const LEAK = 'leak-7f3a';
const TEST = "import { test } from 'node:test';\ntest('x', () => {});\n";

function criteria(abs) {
  return [
    { statement: 'scope', verifier: { type: 'scope' } },
    { statement: 'red-green', verifier: { type: 'test_red_green', test_file: 'test/t.test.mjs', cmd: 'node --test {test}' } },
    { statement: 'metric relative', verifier: { type: 'metric', cmd: 'echo \'{"n":1}\'', key: 'n', op: '==', value: 1, output_file: '../x.json' } },
    { statement: 'metric absolute', verifier: { type: 'metric', cmd: 'echo \'{"n":1}\'', key: 'n', op: '==', value: 1, output_file: abs } },
  ];
}

const CASES = [
  ['a remote-signed contract that is not approved', { local: false, approve: false }, { local: true }],
  ['a remote-signed contract that is approved', { local: false, approve: true }, { local: true }],
  ['a local-signed contract verified with local:false', { local: true, approve: false }, { local: false }],
];

for (const [name, how, call] of CASES) {
  test(`${name}: scope, red-green and metric are BLOCKED, and ${LEAK} appears in neither the result nor the receipt`, async () => {
    const { v, root } = newVault({ git: false });
    try {
      const { dir, base } = repoAt({ 'src/a/ok.js': 'ok\n', 'test/t.test.mjs': TEST });
      put(dir, { [`${LEAK}.txt`]: 'a file the caller must not learn of\n' });
      const outFile = path.join(tmpdir('remote-out-'), 'x.json');
      const d = v.contractDraft(OWNER, { title: 'Outside the vault', workdir: dir, base, tasks: [{ id: 'T1', title: 'the work', scope: ['src/a/**'], criteria: criteria(outFile) }] });
      v.contractSign(OWNER, { id: d.id, local: how.local });
      if (how.approve) v.contractApprove(OWNER, { id: d.id });
      const r = await v.contractVerify(OWNER, { id: d.id }, call);
      const by = Object.fromEntries(r.tasks[0].criteria.map((c) => [c.statement, c]));
      assert.equal(by.scope.status, 'BLOCKED', by.scope.detail);
      assert.ok(by.scope.detail.includes('outside the vault'), by.scope.detail);
      assert.equal(by['red-green'].status, 'BLOCKED', by['red-green'].detail);
      if (how.approve) assert.ok(by['red-green'].detail.includes('outside the vault'), by['red-green'].detail);
      for (const k of ['metric relative', 'metric absolute']) assert.equal(by[k].status, 'BLOCKED', `${k}: ${by[k].detail}`);
      assert.equal(fs.existsSync(outFile), false);
      assert.ok(!JSON.stringify(r).includes(LEAK), 'the result names the file');
      const receipt = fs.readFileSync(path.join(root, 'contracts', 'receipts', `${d.id}.md`), 'utf8');
      assert.ok(!receipt.includes(LEAK), 'the receipt names the file');
    } finally { v.close(); }
  });
}

test('for a remote caller the scope detail names only paths inside the caller\'s path scope and counts the rest', async () => {
  const { v, root } = newVault();
  try {
    v.config.contracts = { ...v.config.contracts, exec_local_only: false }; // the gate that keeps a remote caller out of command criteria is open
    const d = v.contractDraft(OWNER, { title: 'Path scope', workdir: root, tasks: [{ id: 'T1', title: 'the work', scope: ['memory/**'], criteria: [{ statement: 'scope', verifier: { type: 'scope' } }] }] });
    v.contractSign(OWNER, { id: d.id, local: true });
    v.write(OWNER, { path: 'work/visible-9d2c.md', body: 'a note the caller may read\n' });
    v.write(OWNER, { path: 'notes/hidden-4b8e.md', body: 'a note the caller may not read\n' });
    v.commits.flush();
    const caller = { id: 'remote', agent: 'remote', scopes: ['read', 'write'], paths: ['work/**', 'contracts/**'] }; // a verify writes its receipt
    const r = (await v.contractVerify(caller, { id: d.id }, { local: false })).tasks[0].criteria[0];
    assert.equal(r.status, 'FAIL', r.detail);
    assert.ok(r.detail.includes('work/visible-9d2c.md'), r.detail);
    assert.ok(!r.detail.includes('hidden-4b8e'), `the detail names a path outside the caller's scope: ${r.detail}`);
    assert.match(r.detail, /\b1 more\b/);
    const receipt = fs.readFileSync(path.join(root, 'contracts', 'receipts', `${d.id}.md`), 'utf8');
    assert.ok(!receipt.includes('hidden-4b8e'), 'the receipt names it');
    const local = (await v.contractVerify(OWNER, { id: d.id })).tasks[0].criteria[0];
    assert.ok(local.detail.includes('hidden-4b8e') && local.detail.includes('visible-9d2c'), `a local caller sees both: ${local.detail}`);
  } finally { v.close(); }
});
