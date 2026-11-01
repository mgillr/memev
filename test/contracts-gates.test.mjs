// SR-0.03 task 3: red-green and metric criteria pass the same gates as the command criterion beside them, with the same
// BLOCKED details, and a gated criterion runs nothing: no command, no git checkout, no worktree.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { baseAndHead, nodeTest, worktrees } from './helpers/redgreen.mjs';
after(cleanup);

function fixture() {
  const r = baseAndHead({ 'src/f.mjs': 'export const f = () => 1;\n' }, { 'src/f.mjs': 'export const f = () => 2;\n', 'test/f.test.mjs': nodeTest('assert.equal(f(), 2);', "import { f } from '../src/f.mjs';") });
  const hookMarker = path.join(tmpdir('rg-hook-'), 'post-checkout-ran');
  fs.writeFileSync(path.join(r.dir, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${hookMarker}'\n`, { mode: 0o755 });
  const marks = tmpdir('rg-marks-');
  const mark = (n) => path.join(marks, n);
  const criteria = [
    { statement: 'command', verifier: { type: 'command', cmd: `touch '${mark('command')}'` } },
    { statement: 'red-green', verifier: { type: 'test_red_green', test_file: 'test/f.test.mjs', cmd: `touch '${mark('redgreen')}'; node --test {test}` } },
    { statement: 'metric', verifier: { type: 'metric', cmd: `touch '${mark('metric')}'; echo '{"n":1}'`, key: 'n', op: '==', value: 1 } },
  ];
  return { ...r, hookMarker, mark, criteria };
}

const SETUPS = [
  ['remote-signed and unapproved', (v) => ({ sign: { local: false }, verify: { local: true } })],
  ['local-signed, verified by a remote caller with exec_local_only unset', (v) => { delete v.config.contracts?.exec_local_only; return { sign: { local: true }, verify: { local: false } }; }],
  ['contracts.exec off', (v) => { v.config.contracts = { ...v.config.contracts, exec: false }; return { sign: { local: true }, verify: { local: true } }; }],
];

for (const [name, setup] of SETUPS) {
  test(`${name}: red-green and metric get exactly the command criterion's BLOCKED detail, and nothing runs`, async () => {
    const { v } = newVault({ git: false });
    try {
      const f = fixture();
      const how = setup(v);
      const d = v.contractDraft(OWNER, { title: 'Gated', workdir: f.dir, base: f.base, tasks: [{ id: 'T1', title: 'gated', scope: ['**'], criteria: f.criteria }] });
      v.contractSign(OWNER, { id: d.id, ...how.sign });
      assert.deepEqual(worktrees(f.dir), [f.dir]);
      const r = await v.contractVerify(OWNER, { id: d.id }, how.verify);
      const by = Object.fromEntries(r.tasks[0].criteria.map((c) => [c.statement, c]));
      assert.equal(by.command.status, 'BLOCKED');
      for (const k of ['red-green', 'metric']) assert.deepEqual({ status: by[k].status, detail: by[k].detail }, { status: 'BLOCKED', detail: by.command.detail }, `${k} under ${name}`);
      for (const k of ['command', 'redgreen', 'metric']) assert.equal(fs.existsSync(f.mark(k)), false, `the ${k} command ran`);
      assert.equal(fs.existsSync(f.hookMarker), false, 'a checkout ran the repository\'s post-checkout hook');
      assert.deepEqual(worktrees(f.dir), [f.dir], 'a worktree was added');
    } finally { v.close(); }
  });
}
