// SR-0.03 task 2: a commit that carries one Contract-Task trailer is judged against that task's scope, in that task's criterion
// only; the same change in an untrailered commit is judged against the union of the task scopes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { repoAt, commitFiles, signScope, scopeResults, trailer, OWNER } from './helpers/scope.mjs';
after(cleanup);

const FILES = { 'a.js': 'a\n', 'b.js': 'b\n' };
const TASKS = { T1: ['a.js'], T2: ['b.js'] };
const run = async (v, dir, base) => { const id = signScope(v, { workdir: dir, base, tasks: TASKS }); return { id, r: scopeResults(await v.contractVerify(OWNER, { id })) }; };

test('a commit trailered T1 that changes b.js fails T1 naming b.js and the commit, and T2 passes', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    const id = signScope(v, { workdir: dir, base, tasks: TASKS });
    const sha = commitFiles(dir, { 'b.js': 'changed by task one\n' }, `I change b.js${trailer(id, 'T1')}`);
    const r = scopeResults(await v.contractVerify(OWNER, { id }));
    assert.equal(r.T1.status, 'FAIL', r.T1.detail);
    assert.ok(r.T1.detail.includes('b.js') && r.T1.detail.includes(sha), r.T1.detail);
    assert.equal(r.T2.status, 'PASS', r.T2.detail);
  } finally { v.close(); }
});

test('the same change in an untrailered commit is judged against the union, and both tasks pass', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    commitFiles(dir, { 'b.js': 'changed without a trailer\n' }, 'I change b.js');
    const { r } = await run(v, dir, base);
    assert.equal(r.T1.status, 'PASS', r.T1.detail);
    assert.equal(r.T2.status, 'PASS', r.T2.detail);
  } finally { v.close(); }
});

test('a trailered commit inside its own task scope passes both tasks', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    const id = signScope(v, { workdir: dir, base, tasks: TASKS });
    commitFiles(dir, { 'a.js': 'one\n' }, `I change a.js${trailer(id, 'T1')}`);
    commitFiles(dir, { 'b.js': 'two\n' }, `I change b.js${trailer(id, 'T2')}`);
    const r = scopeResults(await v.contractVerify(OWNER, { id }));
    assert.equal(r.T1.status, 'PASS', r.T1.detail);
    assert.equal(r.T2.status, 'PASS', r.T2.detail);
  } finally { v.close(); }
});
