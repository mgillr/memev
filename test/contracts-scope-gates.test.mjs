// SR-0.03 task 2: a scope criterion passes the same three gates as the command criterion beside it (remote-signed without
// approval, a remote caller with exec_local_only unset, contracts.exec off), with exactly its BLOCKED detail, and a gated
// criterion runs nothing: no fsmonitor, no filter, no generator, and no path of the repository in the result.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { commitFiles, put, gitIn, plant, ran, generatorText, SCOPE_CRITERION, OWNER } from './helpers/scope.mjs';
after(cleanup);

const SETUPS = [
  ['remote-signed and unapproved', () => ({ sign: { local: false }, verify: { local: true } })],
  ['local-signed, verified with local:false and exec_local_only unset', (v) => { delete v.config.contracts?.exec_local_only; return { sign: { local: true }, verify: { local: false } }; }],
  ['contracts.exec:false', (v) => { v.config.contracts = { ...v.config.contracts, exec: false }; return { sign: { local: true }, verify: { local: true } }; }],
];

for (const [name, setup] of SETUPS) {
  test(`${name}: scope is BLOCKED with the command criterion's detail, no marker appears and the result names no path of the repository`, async () => {
    const { v, root } = newVault({ git: false });
    try {
      // a git repository inside the vault root, so the vault confinement is met and only the gates decide
      const dir = path.join(root, 'work', 'project');
      fs.mkdirSync(dir, { recursive: true });
      gitIn(dir, 'init', '-q', '-b', 'main');
      const base = commitFiles(dir, { 'src/a/ok.js': 'ok\n', 'docs/MODULES.md': 'x\n' }, 'start');
      const markers = plant(dir);
      put(dir, { 'src/b/outside-7c1e.js': 'outside\n', 'scripts/docs/module-graph.mjs': generatorText('generated\n', markers.gen) });
      const how = setup(v);
      const d = v.contractDraft(OWNER, { title: 'Gated scope', workdir: dir, base, tasks: [{ id: 'T1', title: 'gated', scope: ['src/a/**'], criteria: [{ statement: 'command', verifier: { type: 'command', cmd: 'true' } }, SCOPE_CRITERION] }] });
      v.contractSign(OWNER, { id: d.id, ...how.sign });
      const r = await v.contractVerify(OWNER, { id: d.id }, how.verify);
      const by = Object.fromEntries(r.tasks[0].criteria.map((c) => [c.statement, c]));
      assert.equal(by.command.status, 'BLOCKED', by.command.detail);
      assert.deepEqual({ status: by[SCOPE_CRITERION.statement].status, detail: by[SCOPE_CRITERION.statement].detail }, { status: 'BLOCKED', detail: by.command.detail });
      assert.deepEqual(ran(markers), [], 'something in the repository ran');
      const text = JSON.stringify(r);
      for (const leak of ['outside-7c1e', 'module-graph', 'project']) assert.ok(!text.includes(leak), `the result names ${leak}`);
    } finally { v.close(); }
  });
}
