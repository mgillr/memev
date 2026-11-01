// SR-0.03 task 2: union semantics over one two-task fixture (T1 scope ['a.js'], T2 scope ['b.js']): trailered commits against
// their own task, untrailered commits and uncommitted changes against the union, a commit naming two tasks always FAIL, and
// the vault itself as the workdir.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { repoAt, commitFiles, put, signScope, scopeResults, trailer, OWNER } from './helpers/scope.mjs';
after(cleanup);

const FILES = { 'a.js': 'a\n', 'b.js': 'b\n', 'z.js': 'z\n' };
const TASKS = { T1: ['a.js'], T2: ['b.js'] };
const verify = async (v, id) => scopeResults(await v.contractVerify(OWNER, { id }));
const fixture = (v) => { const f = repoAt(FILES); return { ...f, id: signScope(v, { workdir: f.dir, base: f.base, tasks: TASKS }) }; };

test('c1 changes a.js with trailer T1 and c2 changes b.js with trailer T2: both PASS; c3 changes b.js with trailer T1: T1 FAIL naming b.js and c3', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, id } = fixture(v);
    commitFiles(dir, { 'a.js': 'one\n' }, `I change a.js${trailer(id, 'T1')}`);
    commitFiles(dir, { 'b.js': 'two\n' }, `I change b.js${trailer(id, 'T2')}`);
    const ok = await verify(v, id);
    assert.equal(ok.T1.status, 'PASS', ok.T1.detail);
    assert.equal(ok.T2.status, 'PASS', ok.T2.detail);
    const c3 = commitFiles(dir, { 'b.js': 'three\n' }, `I change b.js again${trailer(id, 'T1')}`);
    const bad = await verify(v, id);
    assert.equal(bad.T1.status, 'FAIL', bad.T1.detail);
    assert.ok(bad.T1.detail.includes('b.js') && bad.T1.detail.includes(c3), bad.T1.detail);
  } finally { v.close(); }
});

test('an untrailered commit changing a.js is PASS; one changing z.js, outside every task, is FAIL naming z.js and the commit', async () => {
  const { v } = newVault({ git: false });
  try {
    const one = fixture(v);
    commitFiles(one.dir, { 'a.js': 'changed\n' }, 'I change a.js');
    const ok = await verify(v, one.id);
    assert.equal(ok.T1.status, 'PASS', ok.T1.detail); assert.equal(ok.T2.status, 'PASS', ok.T2.detail);
    const two = fixture(v);
    const sha = commitFiles(two.dir, { 'z.js': 'changed\n' }, 'I change z.js');
    const bad = await verify(v, two.id);
    for (const t of ['T1', 'T2']) { assert.equal(bad[t].status, 'FAIL', bad[t].detail); assert.ok(bad[t].detail.includes('z.js') && bad[t].detail.includes(sha), bad[t].detail); }
  } finally { v.close(); }
});

test('an uncommitted edit to a.js is PASS; an uncommitted z.js is FAIL naming z.js and "uncommitted"', async () => {
  const { v } = newVault({ git: false });
  try {
    const one = fixture(v);
    put(one.dir, { 'a.js': 'edited\n' });
    const ok = await verify(v, one.id);
    assert.equal(ok.T1.status, 'PASS', ok.T1.detail); assert.equal(ok.T2.status, 'PASS', ok.T2.detail);
    const two = fixture(v);
    put(two.dir, { 'z.js': 'edited\n' });
    const bad = await verify(v, two.id);
    for (const t of ['T1', 'T2']) { assert.equal(bad[t].status, 'FAIL', bad[t].detail); assert.ok(bad[t].detail.includes('z.js') && bad[t].detail.includes('uncommitted'), bad[t].detail); }
  } finally { v.close(); }
});

test('a commit carrying two Contract-Task trailers is FAIL naming the commit, whatever it changes', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, id } = fixture(v);
    const sha = commitFiles(dir, { 'a.js': 'in scope\n' }, `I change a.js${trailer(id, 'T1')}${trailer(id, 'T2')}`);
    const bad = await verify(v, id);
    for (const t of ['T1', 'T2']) { assert.equal(bad[t].status, 'FAIL', bad[t].detail); assert.ok(bad[t].detail.includes(sha) && /more than one task/.test(bad[t].detail), bad[t].detail); }
  } finally { v.close(); }
});

test('a commit naming a task of another contract, or a task this contract does not have, is FAIL naming the commit', async () => {
  const { v } = newVault({ git: false });
  try {
    for (const named of ['k-another-contract-aaaaaa T1', null]) {
      const { dir, id } = fixture(v);
      const sha = commitFiles(dir, { 'a.js': 'in scope\n' }, `I change a.js\n\nContract-Task: ${named || `${id} T9`}`);
      const bad = await verify(v, id);
      assert.equal(bad.T1.status, 'FAIL', bad.T1.detail);
      assert.ok(bad.T1.detail.includes(sha), bad.T1.detail);
    }
  } finally { v.close(); }
});

test('with the vault root as workdir, sign, verify and an in-scope memory/ write leave scope PASS', async () => {
  const { v, root } = newVault();
  try {
    const id = signScope(v, { workdir: root, tasks: { T1: ['memory/**'], T2: ['work/**'] } });
    v.write(OWNER, { path: 'memory/in-scope.md', body: 'a note inside the scope\n' });
    v.commits.flush();
    const first = await verify(v, id);
    v.commits.flush();
    const second = await verify(v, id);
    for (const r of [first, second]) for (const t of ['T1', 'T2']) { assert.equal(r[t].status, 'PASS', r[t].detail); assert.ok(!r[t].detail.includes('contracts/')); }
  } finally { v.close(); }
});
