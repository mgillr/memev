// SO-A-03: requested, accepted, observed and verified are four distinct event kinds in the execution history, and a task
// leaves IN_PROGRESS for VERIFYING only after an observed execution under its current lease. Each test name starts with the
// criterion it covers, which is how the contract's verifier finds it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Coordinator } from '../src/engine/coordinator.mjs';
import { ProjectStore } from '../src/engine/project-store.mjs';
import { transition, TASK_STATES as S } from '../src/engine/project-state.mjs';
import { EXECUTION_EVENT_KINDS, validateExecutionEvent, executionStage, observedUnderLease } from '../src/engine/evidence.mjs';
import { runWork, workStatus, renderWorkStatus } from '../src/cli/work.mjs';
import { handle } from '../src/server/mcp.mjs';
import { newVault, tmpdir, cleanup, OWNER, PKG } from './helpers/tmp.mjs';
after(cleanup);

const KINDS = ['dispatch.requested', 'dispatch.accepted', 'execution.observed', 'outcome.verified'];

function lifecycleCoordinator(over = {}) {
  const dir = tmpdir('exec-events-');
  const store = new ProjectStore(dir, { id: 'p', fsync: false }).open();
  let t = 1000;
  const co = new Coordinator(store, { lifecycle: true, now: () => (t += 10), ...over });
  return { dir, store, co };
}
const plan = (co, specs) => co.plan('p', specs.map((s) => ({ criteria: [{ id: 'c1', mandatory: true }], artifact_hash: 'h1', ...s })));
const state = (store, id) => store.snapshot('task')[id].status;

test('SO-A-03 AC01: the event schema names the four kinds and requires the resource, the time and the payload hash', () => {
  assert.deepEqual([...EXECUTION_EVENT_KINDS], KINDS);
  for (const type of KINDS) {
    assert.equal(validateExecutionEvent({ type, resource: 'src/a.js', time: 1, payload_hash: 'abc' }).ok, true, type);
    for (const missing of ['resource', 'time', 'payload_hash']) {
      const e = { type, resource: 'src/a.js', time: 1, payload_hash: 'abc' };
      delete e[missing];
      const r = validateExecutionEvent(e);
      assert.equal(r.ok, false, `${type} without ${missing}`);
      assert.match(r.reason, new RegExp(missing));
    }
  }
  assert.equal(validateExecutionEvent({ type: 'dispatch.done', resource: 'r', time: 1, payload_hash: 'h' }).ok, false, 'a fifth kind is not part of the schema');
  // the project store refuses a stored event of these kinds that lacks a field
  const { store } = lifecycleCoordinator();
  assert.throws(() => store.append({ type: 'task.event', entity: { kind: 'event', data: { type: 'execution.observed', resource: 'r', time: 1 } } }), /payload_hash/);
  assert.doesNotThrow(() => store.append({ type: 'task.event', entity: { kind: 'event', data: { type: 'execution.observed', resource: 'r', time: 1, payload_hash: 'h' } } }));
});

test('SO-A-03 AC01: a history with dispatch.accepted and no execution.observed leaves the task IN_PROGRESS', () => {
  const { dir, store, co } = lifecycleCoordinator();
  plan(co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  const lease = co.claim('A', 'agent-1', 60000).lease;
  const d = co.dispatch('A', 'agent-1', 'k1', { resource: 'src/a.js', what: 'build it' }, () => ({ ok: true }));
  assert.equal(d.ok, true);
  assert.equal(state(store, 'A'), S.IN_PROGRESS, 'a provider that accepted the dispatch has not completed anything');
  // the history is replayed from the log by a second store on the same files
  const again = new ProjectStore(dir, { id: 'p', fsync: false }).open();
  const events = Object.values(again.snapshot('event'));
  const st = executionStage(events, 'A');
  assert.equal(st.stage, 'accepted');
  assert.equal(st.requested.length, 1);
  assert.equal(st.accepted.length, 1);
  assert.equal(st.observed.length, 0);
  assert.equal(observedUnderLease(events, { taskId: 'A', leaseId: lease.id, generation: lease.generation }), null);
  // the state machine refuses the move without an observed execution, with a reason that says so
  const view = { id: 'A', state: S.IN_PROGRESS, scopeVersion: 1, criteria: [], dependsOn: [] };
  const ctx = { actor: 'agent-1', time: 1, reason: 'work reported', correlationId: 'c' };
  const refused = transition(view, S.VERIFYING, ctx);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'NOT_OBSERVED');
  assert.equal(refused.task.state, S.IN_PROGRESS);
  // an observed event of another lease does not count
  const other = { kind: 'execution.observed', taskId: 'A', leaseId: 'lease_other', generation: 9 };
  assert.equal(transition(view, S.VERIFYING, { ...ctx, leaseId: lease.id, observed: other }).code, 'NOT_OBSERVED');
  const mine = { kind: 'execution.observed', taskId: 'A', leaseId: lease.id, generation: lease.generation };
  assert.equal(transition(view, S.VERIFYING, { ...ctx, leaseId: lease.id, observed: mine }).ok, true);
});

test('SO-A-03 AC01: dispatch records requested then accepted, an observation is recorded under the lease, and a report then moves the task to VERIFYING', () => {
  const { store, co } = lifecycleCoordinator();
  plan(co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  const lease = co.claim('A', 'agent-1', 60000).lease;
  co.dispatch('A', 'agent-1', 'k1', { resource: 'src/a.js' }, () => ({ ok: true }));
  const obs = co.observe(lease, { resource: 'src/a.js', payload: { lines: 3 } });
  assert.equal(obs.ok, true);
  assert.equal(state(store, 'A'), S.IN_PROGRESS, 'an observation alone does not move the task');
  const rep = co.report(lease, { output: 'built', artifacts: ['src/a.js'] });
  assert.equal(rep.ok, true);
  assert.equal(state(store, 'A'), S.VERIFYING);
  const kinds = co.executionEvents('A').map((e) => e.type);
  assert.deepEqual(kinds, ['dispatch.requested', 'dispatch.accepted', 'execution.observed']);
  assert.equal(co.executionEvents('A').filter((e) => e.type === 'execution.observed').length, 1, 'the report did not repeat an observation that already exists under the lease');
  for (const e of co.executionEvents('A')) {
    assert.equal(typeof e.resource, 'string'); assert.ok(e.resource);
    assert.equal(typeof e.time, 'number');
    assert.match(e.payload_hash, /^[0-9a-f]{64}$/);
  }
});

test('SO-A-03 AC01: a report records the observation it rests on, a late report records none, and VERIFIED still needs bound evidence', () => {
  const { store, co } = lifecycleCoordinator();
  plan(co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  const first = co.claim('A', 'agent-1', 60000).lease;
  co.release(first, 'giving up');
  const late = co.report(first, { output: 'late work' });
  assert.equal(late.ok, false);
  assert.equal(co.executionEvents('A').length, 0, 'a late report is not an observed execution');
  assert.equal(co.observe(first, { resource: 'x', payload: 1 }).ok, false, 'an observation under a released lease is refused');
  const second = co.claim('A', 'agent-2', 60000).lease;
  assert.equal(co.report(second, { output: 'built', artifacts: ['src/a.js'], artifact_hash: 'h1' }).ok, true);
  const obs = co.executionEvents('A').filter((e) => e.type === 'execution.observed');
  assert.equal(obs.length, 1);
  assert.equal(obs[0].lease_id, second.id);
  assert.equal(obs[0].generation, store.snapshot('lease')[second.id].generation);
  assert.equal(state(store, 'A'), S.VERIFYING);
  // VERIFIED only through the evidence rule
  assert.equal(co.verify('A', { evidence: [] }).code, 'NO_EVIDENCE');
  assert.equal(state(store, 'A'), S.VERIFYING);
  assert.equal(co.verify('A', { evidence: [{ criterion: 'c1', scope_version: 1, artifact_hash: 'h1' }] }).ok, true);
  assert.equal(state(store, 'A'), S.VERIFIED);
  const last = co.executionEvents('A').at(-1);
  assert.equal(last.type, 'outcome.verified');
  assert.deepEqual(executionStage(co.executionEvents('A'), 'A').stage, 'verified');
});

test('SO-A-03 AC01: without the lifecycle the coordinator records no execution events', () => {
  const { store, co } = lifecycleCoordinator({ lifecycle: false });
  plan(co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  const lease = co.claim('A', 'agent-1', 60000).lease;
  co.dispatch('A', 'agent-1', 'k1', {}, () => ({ ok: true }));
  co.report(lease, { output: 'built', artifacts: [] });
  assert.equal(Object.values(store.snapshot('event')).filter((e) => KINDS.includes(e.type)).length, 0);
  assert.equal(state(store, 'A'), 'DONE');
});

const call = async (v, name, args) => {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { identity: OWNER, client: 'test', session: 's', local: true });
  return r.result.structuredContent;
};

function workFixture() {
  const { root, v } = newVault();
  return { root, v };
}
const capture = () => { const o = { out: '', err: '' }; return { o, io: { out: (s) => { o.out += `${s}\n`; }, err: (s) => { o.err += `${s}\n`; } } }; };

test('SO-A-03 AC02: memev work status renders requested, accepted, observed and verified apart, in the user vocabulary', async () => {
  const { v } = workFixture();
  await call(v, 'memev_task_plan', { project: 'shop', tasks: [{ id: 'A', title: 'build the cart', artifacts: ['src/cart.js'], criteria: [{ id: 'c1', mandatory: true }], artifact_hash: 'h1' }, { id: 'B', title: 'build checkout' }] });
  const claim = await call(v, 'memev_task_claim', { project: 'shop', task: 'A', ttl_s: 60 });
  const co = v.coordinator('shop');
  co.dispatch('A', 'agent-1', 'k1', { resource: 'src/cart.js' }, () => ({ ok: true }));
  await call(v, 'memev_task_report', { project: 'shop', lease: claim.lease.id, output: 'built', artifacts: ['src/cart.js'] });
  const { o, io } = capture();
  assert.equal(await runWork(['status', 'shop'], {}, { vault: v, ...io }), 0);
  for (const label of ['asked for', 'taken on', 'seen running', 'confirmed']) assert.match(o.out, new RegExp(label), `the text says ${label}`);
  assert.doesNotMatch(o.out, /dispatch\.requested|dispatch\.accepted|execution\.observed|outcome\.verified/, 'the text uses the user vocabulary, not the event names');
  const j = capture();
  assert.equal(await runWork(['status', 'shop'], { json: true }, { vault: v, ...j.io }), 0);
  const data = JSON.parse(j.o.out);
  assert.equal(data.project, 'shop');
  assert.deepEqual(Object.keys(data.tasks.A.events), ['requested', 'accepted', 'observed', 'verified']);
  assert.deepEqual(data.tasks.A.events, { requested: 1, accepted: 1, observed: 1, verified: 0 });
  assert.equal(data.tasks.A.stage, 'observed');
  v.close();
});

test('SO-A-03 AC02: a report of work in progress never counts an observed task as done', async () => {
  const { v } = workFixture();
  await call(v, 'memev_task_plan', { project: 'shop', tasks: [{ id: 'A', title: 'build the cart', artifacts: ['src/cart.js'], criteria: [{ id: 'c1', mandatory: true }], artifact_hash: 'h1' }] });
  const claim = await call(v, 'memev_task_claim', { project: 'shop', task: 'A', ttl_s: 60 });
  await call(v, 'memev_task_report', { project: 'shop', lease: claim.lease.id, output: 'done, trust me', artifacts: ['src/cart.js'] });
  const before = workStatus(v.coordinator('shop'), 'shop');
  assert.equal(before.tasks.A.stage, 'observed');
  assert.equal(before.tasks.A.state, 'VERIFYING');
  assert.equal(before.done, 0, 'an observed task is not done');
  assert.equal(before.total, 1);
  assert.match(renderWorkStatus(before), /done 0 of 1/);
  const ok = await call(v, 'memev_task_verify', { project: 'shop', task: 'A', evidence: [{ criterion: 'c1', scope_version: 1, artifact_hash: 'h1' }] });
  assert.equal(ok.ok, true);
  const after1 = workStatus(v.coordinator('shop'), 'shop');
  assert.equal(after1.tasks.A.stage, 'verified');
  assert.equal(after1.done, 1);
  assert.match(renderWorkStatus(after1), /done 1 of 1/);
  v.close();
});

test('SO-A-03 AC02: a project that does not exist exits 1 with one line, and the status reads a vault it opens itself', async () => {
  const { root, v } = workFixture();
  await call(v, 'memev_task_plan', { project: 'shop', tasks: [{ id: 'A', title: 'build the cart' }] });
  v.close();
  const none = capture();
  assert.equal(await runWork(['status', 'nothing-here'], {}, { root, ...none.io }), 1);
  assert.equal(none.o.err.trim().split('\n').length, 1);
  assert.equal(none.o.out, '');
  const some = capture();
  assert.equal(await runWork(['status', 'shop'], {}, { root, ...some.io }), 0);
  assert.match(some.o.out, /shop/);
  const bad = capture();
  assert.equal(await runWork(['bogus'], {}, { root, ...bad.io }), 1);
});

test('SO-A-03 AC02: the new files are inside the contract scope and add no import cycle through the store', () => {
  const src = (f) => fs.readFileSync(path.join(PKG, f), 'utf8');
  assert.doesNotMatch(src('src/engine/evidence.mjs'), /from '\.\/(project-store|project-state|coordinator|vault)\.mjs'/);
  assert.doesNotMatch(src('src/cli/work.mjs'), /engine\/(coordinator|project-store|project-state)\.mjs/);
});
