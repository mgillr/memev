// SPDX-License-Identifier: Apache-2.0
// SR-1.27 and SR-1.30: a task tied to a signed contract is verified only by a passing memev_contract_verify, which feeds
// its evidence bound to the task's scope version and a Memev-computed artifact hash. A caller cannot supply that evidence,
// a failing verify fails the task, and a task or artifact changed since the report stays unverified.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handle, toolList } from '../src/server/mcp.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

const ctx = (over = {}) => ({ identity: OWNER, client: 'test', session: 's1', local: true, ...over });
const call = async (v, name, args, c = ctx()) => {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c);
  return { error: !!r.result.isError, text: r.result.content[0].text, data: r.result.structuredContent };
};
const events = (root, project) => fs.readFileSync(path.join(root, '.memev', 'projects', project, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const logged = (root, project, type) => events(root, project).filter((r) => r.entity?.kind === 'event' && r.entity.data?.type === type).map((r) => r.entity.data);
const state = async (v, project, task) => (await call(v, 'memev_project_status', { project })).data.tasks[task]?.state;
const evidenceOf = (v, project) => Object.values(v.projectStore(project).snapshot('evidence'));

// ---- SR-1.27 / SR-1.30: a passing contract verify is what feeds a task's evidence
function contractSetup(v, root) {
  const work = path.join(root, '..', 'cwork'); fs.mkdirSync(path.join(work, 'src'), { recursive: true });
  fs.writeFileSync(path.join(work, 'src', 'a.js'), 'export const a = 1;\n');
  const d = v.contractDraft(OWNER, { title: 'Cart contract', project: 'shop', workdir: work, tasks: [{ id: 'T1', title: 'cart', scope: ['src/**'], criteria: [
    { statement: 'the cart exists', verifier: { type: 'file_exists', path: 'src/a.js' } },
    { statement: 'it exports a', verifier: { type: 'grep', file: 'src/a.js', pattern: 'export const a' } },
  ] }] });
  v.contractSign(OWNER, { id: d.id, session: 's1' });
  return { work, id: d.id };
}
const plannedLinked = async (v, id) => (await call(v, 'memev_task_plan', { project: 'shop', tasks: [{ id: 'cart', title: 'cart', artifacts: ['src/a.js'], contract: { id, task: 'T1' } }] }));
const runCart = async (v) => {
  const lease = (await call(v, 'memev_task_claim', { project: 'shop', task: 'cart', ttl_s: 60 })).data.lease.id;
  return (await call(v, 'memev_task_report', { project: 'shop', lease, output: 'built', artifacts: ['src/a.js'] }));
};

test('SR-1.27: a passing contract verify makes the linked task VERIFIED with evidence bound to scope version and artifact hash; nothing else can', async () => {
  const { root, v } = newVault();
  const { id } = contractSetup(v, root);
  const planned = await plannedLinked(v, id);
  assert.equal(planned.error, false, planned.text);
  const t0 = v.projectStore('shop').snapshot('task').cart;
  assert.deepEqual(t0.criteria.map((c) => c.id), v.contractCheckSignature(id).contract.tasks[0].criteria.map((c) => c.id), 'criteria come from the signed contract');
  await runCart(v);
  assert.equal(await state(v, 'shop', 'cart'), 'VERIFYING');
  const t1 = v.projectStore('shop').snapshot('task').cart;
  assert.match(t1.artifact_hash, /^[0-9a-f]{64}$/, 'the hash of the artifact is computed by Memev, not taken from the agent');
  // the operator tool refuses to verify a contract-linked task by hand
  const manual = await call(v, 'memev_task_verify', { project: 'shop', task: 'cart', evidence: t0.criteria.map((c) => ({ criterion: c.id, scope_version: 1, artifact_hash: t1.artifact_hash })) });
  assert.equal(manual.data.ok, false); assert.equal(manual.data.code, 'CONTRACT_LINKED');
  assert.equal(await state(v, 'shop', 'cart'), 'VERIFYING');
  const r = await call(v, 'memev_contract_verify', { id });
  assert.equal(r.data.ok, true, r.text);
  assert.equal(await state(v, 'shop', 'cart'), 'VERIFIED');
  const ev = evidenceOf(v, 'shop');
  assert.equal(ev.length, t0.criteria.length);
  for (const e of ev) { assert.equal(e.scope_version, 1); assert.equal(e.artifact_hash, t1.artifact_hash); assert.match(e.ref, new RegExp(id)); }
  const move = logged(root, 'shop', 'task.transitioned').at(-1);
  assert.equal(move.to, 'VERIFIED'); assert.equal(move.actor, 'contract-verify'); assert.equal(move.evidence.length, t0.criteria.length);
  assert.equal(r.data.tasks_verified?.[0]?.task, 'cart');
  v.close();
});

test('SR-1.27 adversarial: a failing verify never verifies the task, an artifact changed after the report or a scope amendment during it leaves it unverified', async () => {
  const { root, v } = newVault();
  const { work, id } = contractSetup(v, root);
  await plannedLinked(v, id);
  await runCart(v);
  // the artifact changes after the report: the verify passes its checks, but the evidence binds to a different hash
  fs.writeFileSync(path.join(work, 'src', 'a.js'), 'export const a = 2;\n');
  const r1 = await call(v, 'memev_contract_verify', { id });
  assert.equal(r1.data.ok, true);
  assert.equal(await state(v, 'shop', 'cart'), 'VERIFYING', 'evidence bound to a changed artifact does not verify');
  assert.equal(r1.data.tasks_verified[0].ok, false); assert.equal(r1.data.tasks_verified[0].code, 'NO_EVIDENCE');
  // a failing check: the task is not verified, and goes to FAILED through the table
  fs.rmSync(path.join(work, 'src', 'a.js'));
  const r2 = await call(v, 'memev_contract_verify', { id });
  assert.equal(r2.data.ok, false);
  assert.equal(await state(v, 'shop', 'cart'), 'FAILED');
  assert.ok(logged(root, 'shop', 'task.transitioned').some((m) => m.from === 'VERIFYING' && m.to === 'FAILED'));
  // a task that was never reported is not touched by a passing verify
  fs.writeFileSync(path.join(work, 'src', 'a.js'), 'export const a = 1;\n');
  await call(v, 'memev_scope_amend', { project: 'shop', paths: ['src/a.js'], reason: 'replan' });
  const r3 = await call(v, 'memev_contract_verify', { id });
  assert.equal(r3.data.ok, true);
  assert.notEqual(await state(v, 'shop', 'cart'), 'VERIFIED', 'a task that is not VERIFYING is never verified by a verify');
  // a link to a contract of another project, or to a task the contract does not have, is refused at plan time
  assert.equal((await call(v, 'memev_task_plan', { project: 'other', tasks: [{ id: 'x', title: 'x', contract: { id, task: 'T1' } }] })).error, true);
  assert.equal((await call(v, 'memev_task_plan', { project: 'shop', tasks: [{ id: 'y', title: 'y', contract: { id, task: 'T9' } }] })).error, true);
  v.close();
});

test('a scope amendment while a verify runs leaves the task unverified: the evidence is bound to the version the verify started at', async () => {
  const { root, v } = newVault();
  const { id } = contractSetup(v, root);
  await plannedLinked(v, id);
  await runCart(v);
  // the scope is amended while the verify is running
  const real = v.coordinator('shop').amendScope.bind(v.coordinator('shop'));
  const orig = v.contractCheckSignature.bind(v);
  let reads = 0;
  v.contractCheckSignature = (x) => { const s = orig(x); if (++reads === 2) { real('shop', { paths: ['src/a.js'] }, { actor: 'operator', reason: 'amended mid-verify' }); } return s; };
  const r = await call(v, 'memev_contract_verify', { id });
  assert.equal(r.data.ok, true);
  assert.notEqual(await state(v, 'shop', 'cart'), 'VERIFIED');
  v.close();
});

