// SO-08-B: recovery and control. A session that stops heart-beating is recovered by inspection, a restart rebuilds the
// project from its store, memev work pauses, resumes and cancels with honest in-flight reporting, every transition is
// posted on the bus as ids and states, and a bus message processed twice changes the project once. Each test name starts
// with the criterion it covers, which is how the contract's verifier finds it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Coordinator } from '../src/engine/coordinator.mjs';
import { ProjectStore } from '../src/engine/project-store.mjs';
import { TASK_STATES as S } from '../src/engine/project-state.mjs';
import { runWork } from '../src/cli/work.mjs';
import { handle } from '../src/server/mcp.mjs';
import { findSecrets } from '../src/engine/secrets.mjs';
import { sandbox } from './helpers/cli.mjs';
import { newVault, tmpdir, cleanup, OWNER, PKG } from './helpers/tmp.mjs';
after(cleanup);

// ---- a coordinator on its own store, with a clock the test moves
function rig(over = {}) {
  const dir = tmpdir('recovery-');
  const clock = { t: 1_000_000 };
  const open = (opts = {}) => {
    const store = new ProjectStore(dir, { id: 'p', fsync: false }).open();
    return { store, co: new Coordinator(store, { lifecycle: true, now: () => clock.t, ...over, ...opts }) };
  };
  return { dir, clock, open, ...open() };
}
const plan = (co, specs) => co.plan('p', specs.map((s) => ({ criteria: [{ id: 'c1', mandatory: true }], artifact_hash: 'h1', ...s })));
const task = (store, id) => store.snapshot('task')[id];
const logged = (store, type) => Object.values(store.snapshot('event')).filter((e) => e.type === type);
const moves = (store, id) => logged(store, 'task.transitioned').filter((e) => e.task_id === id);

// ---- the tool surface the CLI talks to, driven in process
const WORKER = 'worker-a@host';
const ctx = () => ({ identity: OWNER, client: 'test', session: 's1', local: true });
const callTool = async (v, name, args) => {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx());
  if (r.result.isError) throw new Error(r.result.content[0].text);
  return r.result.structuredContent;
};
const portOf = (v) => (name, args) => callTool(v, name, args);
const work = async (pos, flags, deps) => {
  const o = { out: '', err: '' };
  const code = await runWork(pos, flags, { ...deps, out: (s) => { o.out += `${s}\n`; }, err: (s) => { o.err += `${s}\n`; } });
  return { code, ...o };
};
const seed = async (v, project = 'shop') => {
  await callTool(v, 'memev_task_plan', { project, tasks: [
    { id: 'A', title: 'build the page', artifacts: ['src/a.js'], criteria: [{ id: 'c1', mandatory: true }], artifact_hash: 'h1' },
    { id: 'B', title: 'write the copy', artifacts: ['src/b.js'] },
    { id: 'C', title: 'ship it', artifacts: ['src/c.js'] },
  ] });
};

// ---- AC01: recovery after a disconnect

test('SO-08-B AC01: recover inspects the checkpoint, the lease, the changed artifacts and the side effects, and records what it found', () => {
  const { store, co, clock } = rig();
  plan(co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  const lease = co.claim('A', WORKER, 100).lease;
  co.heartbeat(lease, { checkpoint: 'cp-1' });
  const live = co.recover('A');
  assert.equal(live.ok, false, 'a live lease is not recovered');
  assert.equal(live.code, 'LEASE_LIVE');
  assert.equal(logged(store, 'task.recovery.inspected').length, 0, 'a refused recovery writes no inspection');
  clock.t += 1000; // the session stopped heart-beating
  co.sweep();
  const r = co.recover('A', { actor: 'operator' });
  assert.equal(r.ok, true);
  const rec = logged(store, 'task.recovery.inspected');
  assert.equal(rec.length, 1, 'one inspection record');
  assert.equal(rec[0].task_id, 'A');
  assert.equal(rec[0].checkpoint, 'cp-1');
  assert.equal(rec[0].lease_id, lease.id);
  assert.equal(rec[0].lease_status, 'expired');
  assert.deepEqual(rec[0].artifacts, []);
  assert.deepEqual(rec[0].side_effects, []);
  assert.deepEqual(r.inspection, { checkpoint: 'cp-1', lease_id: lease.id, lease_status: 'expired', artifacts: [], side_effects: [] });
  assert.equal(r.plan.action, 'resume', 'a checkpoint and nothing outstanding resumes from the checkpoint');
  assert.equal(r.plan.checkpoint, 'cp-1');
});

test('SO-08-B AC01: the recovery plan is resume, reassign or ask the user, by what the inspection found', () => {
  const a = rig();
  plan(a.co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  a.co.claim('A', WORKER, 100); a.clock.t += 1000; a.co.sweep();
  assert.equal(a.co.recover('A').plan.action, 'reassign', 'no checkpoint and nothing done is handed to someone else');
  const b = rig();
  plan(b.co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  const l = b.co.claim('A', WORKER, 100).lease;
  b.co.heartbeat(l, { checkpoint: 'cp-2' });
  b.co.external('A', 'payment', 'ext-1', { n: 1 }, () => ({ status: 'timeout' }));
  b.clock.t += 1000; b.co.sweep();
  const r = b.co.recover('A');
  assert.equal(r.plan.action, 'ask_user', 'a side effect with no recorded success is not repeated or resumed blind');
  assert.equal(r.inspection.side_effects.length, 1);
  assert.equal(r.inspection.side_effects[0].key, 'ext-1');
  const c = rig();
  plan(c.co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  const l3 = c.co.claim('A', WORKER, 100).lease;
  c.co.report(l3, { ok: true, output: 'partial', artifacts: ['src/a.js'] });
  assert.equal(c.co.recover('A').code, 'NOT_RECOVERABLE', 'a task that was not interrupted has nothing to recover');
});

test('SO-08-B AC01: reassignment after a disconnect happens only after the inspection is recorded', () => {
  const { store, co, clock } = rig();
  plan(co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  co.claim('A', WORKER, 100); clock.t += 1000; co.sweep();
  const early = co.reassignAfterRecovery('A', { to: 'worker-b@host' });
  assert.equal(early.ok, false);
  assert.equal(early.code, 'NOT_INSPECTED');
  assert.equal(task(store, 'A').holder ?? null, null, 'nothing moved');
  co.recover('A');
  const ok = co.reassignAfterRecovery('A', { to: 'worker-b@host' });
  assert.equal(ok.ok, true);
  assert.equal(task(store, 'A').holder, 'worker-b@host');
  assert.equal(task(store, 'A').status, S.READY);
  // the inspection is of one generation: after the handover a new loss needs a new inspection
  const l2 = co.claim('A', 'worker-b@host', 100).lease; assert.ok(l2);
  clock.t += 1000; co.sweep();
  assert.equal(co.reassignAfterRecovery('A', { to: WORKER }).code, 'NOT_INSPECTED');
});

test('SO-08-B AC01: no second dispatch of a task happens while the original lease is live', () => {
  const { co, clock } = rig();
  plan(co, [{ id: 'A', title: 'build', artifacts: ['src/a.js'] }]);
  co.claim('A', WORKER, 100);
  let sent = 0; const send = () => { sent++; return { ok: true }; };
  assert.equal(co.dispatch('A', WORKER, 'k1', { what: 'x' }, send).ok, true);
  const second = co.dispatch('A', 'worker-b@host', 'k2', { what: 'x' }, send);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'LEASE_LIVE');
  assert.equal(second.sent, false);
  assert.equal(sent, 1, 'the provider was not asked twice');
  clock.t += 1000; co.sweep();
  assert.equal(co.dispatch('A', 'worker-b@host', 'k3', { what: 'x' }, send).ok, true, 'once the lease has lapsed the task may be sent again');
});

// ---- AC02: restart reconstruction

test('SO-08-B AC02: leases, in-flight tasks, approvals and the pause flag reconstruct from the store, and expired leases are marked on start', () => {
  const r = rig();
  plan(r.co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }, { id: 'B', title: 'b', artifacts: ['src/b.js'] }, { id: 'C', title: 'c', artifacts: ['src/c.js'] }]);
  const la = r.co.claim('A', WORKER, 60_000).lease;
  const lb = r.co.claim('B', 'worker-b@host', 100).lease;
  r.store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr_1', data: { task_id: 'C', status: 'pending', what: 'deploy' } } });
  assert.equal(r.co.pause('p').ok, true);
  r.clock.t += 1000; // the daemon was down while B's lease ran out
  const before = Object.keys(r.store.snapshot('attempt')).length;
  // restart: a fresh store and coordinator on the same files
  const again = r.open();
  const rec = again.co.reconstruct('p');
  assert.equal(rec.paused, true, 'the pause flag is read back');
  assert.deepEqual(rec.inflight, ['A'], 'A is still held under a live lease');
  assert.deepEqual(rec.leases.active.map((l) => l.id), [la.id]);
  assert.deepEqual(rec.leases.expired.map((l) => l.id), [lb.id], 'the lapsed lease is detected and marked');
  assert.deepEqual(rec.approvals.map((a) => a.id), ['appr_1']);
  assert.equal(task(again.store, 'B').status, S.BLOCKED);
  assert.equal(task(again.store, 'B').blocked_reason, 'owner_lost');
  assert.equal(again.store.snapshot('lease')[lb.id].status, 'expired');
  assert.equal(task(again.store, 'A').status, S.IN_PROGRESS);
  assert.equal(Object.keys(again.store.snapshot('attempt')).length, before, 'starting up dispatched nothing');
  assert.equal(logged(again.store, 'dispatch.requested').length, 0);
});

test('SO-08-B AC02: nothing is re-dispatched until an eligibility pass runs, and the pass skips a task with a live lease', () => {
  const r = rig();
  plan(r.co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }, { id: 'B', title: 'b', artifacts: ['src/b.js'] }, { id: 'C', title: 'c', artifacts: ['src/c.js'] }]);
  r.co.claim('A', WORKER, 60_000);
  const again = r.open();
  again.co.reconstruct('p');
  assert.equal(logged(again.store, 'dispatch.requested').length, 0, 'a start re-dispatches nothing');
  const sent = [];
  const pass = again.co.eligibilityPass('p', { send: (id) => { sent.push(id); return { ok: true }; } });
  assert.equal(pass.ok, true);
  assert.deepEqual(pass.dispatchable.sort(), ['B', 'C'], 'A holds a live lease and is not offered again');
  assert.deepEqual(sent.sort(), ['B', 'C']);
  // a task whose record still carries a live lease is skipped even if its state reads as ready
  const t = task(again.store, 'B');
  again.store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'B', data: { ...t, status: S.READY } } });
  const lease = again.co.claim('B', WORKER, 60_000).lease; assert.ok(lease);
  again.store.append({ type: 'task.upserted', entity: { kind: 'task', id: 'B', data: { ...task(again.store, 'B'), status: S.READY } } });
  assert.deepEqual(again.co.eligibilityPass('p').dispatchable, ['C'], 'live lease wins over a ready-looking state');
  // a paused project dispatches nothing from the pass
  again.co.pause('p');
  assert.deepEqual(again.co.eligibilityPass('p').dispatchable, []);
});

// ---- AC03: memev work pause, resume and cancel

test('SO-08-B AC03: memev work pause stops new dispatch at once and prints per in-flight task requested, confirmed or unsupported', async () => {
  const { v } = newVault();
  await seed(v);
  const lease = (await callTool(v, 'memev_task_claim', { project: 'shop', task: 'A', ttl_s: 60 })).lease.id;
  const call = portOf(v);
  const r = await work(['pause', 'shop'], { reason: 'lunch' }, { call });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\bA\b.*\brequested\b/, 'the in-flight task says what happened to its cancellation');
  assert.doesNotMatch(r.out, /\bB\b.*\brequested\b/, 'a task nobody holds is not in flight');
  const refused = await callTool(v, 'memev_task_claim', { project: 'shop', task: 'B', ttl_s: 60 });
  assert.equal(refused.paused, true, 'new dispatch stopped at once');
  const j = await work(['pause', 'shop'], { json: true }, { call });
  assert.equal(j.code, 1, 'pausing a paused project is refused');
  const json = await work(['pause', 'shop'], { json: true, reason: 'again' }, { call: async (n, a) => (n === 'memev_project_pause' ? { ok: false, code: 'X' } : callTool(v, n, a)) });
  assert.equal(json.code, 1); assert.ok(lease);
  // the coordinator reads the client's capability: without one the honest answer is unsupported, never confirmed
  const rg = rig();
  plan(rg.co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }]);
  rg.co.claim('A', WORKER, 60_000);
  const p = rg.co.pause('p', { capability: () => false });
  assert.equal(p.ok, true);
  assert.deepEqual(p.cancellations, { A: 'unsupported' });
  assert.equal(task(rg.store, 'A').cancellation, 'unsupported');
  assert.notEqual(task(rg.store, 'A').cancellation, 'confirmed');
});

test('SO-08-B AC03: memev work pause --json lists each in-flight task with its cancellation, and resume continues from the checkpoint', async () => {
  const { v } = newVault();
  await seed(v);
  await callTool(v, 'memev_task_claim', { project: 'shop', task: 'A', ttl_s: 60 });
  const call = portOf(v);
  const p = await work(['pause', 'shop'], { json: true }, { call });
  assert.equal(p.code, 0);
  const pj = JSON.parse(p.out);
  assert.equal(pj.project, 'shop'); assert.equal(pj.paused, true);
  assert.deepEqual(pj.tasks, [{ task: 'A', cancellation: 'requested' }]);
  const r = await work(['resume', 'shop'], { json: true }, { call });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).paused, false);
  const st = await callTool(v, 'memev_project_status', { project: 'shop' });
  assert.equal(st.tasks.A.state, S.IN_PROGRESS, 'the in-flight task kept its state across the pause');
  assert.equal(st.tasks.A.cancellation ?? null, null, 'the request the pause made is withdrawn');
  assert.equal((await callTool(v, 'memev_task_claim', { project: 'shop', task: 'B', ttl_s: 60 })).ok, true, 'dispatch is allowed again');
  const again = await work(['resume', 'shop'], {}, { call });
  assert.equal(again.code, 1, 'resuming a project that is not paused is refused');
  assert.equal(again.err.trim().split('\n').length, 1);
});

test('SO-08-B AC03: memev work cancel records the actor and the reason and refuses without a reason', async () => {
  const { v } = newVault();
  await seed(v);
  const call = portOf(v);
  const none = await work(['cancel', 'shop', 'C'], {}, { call });
  assert.equal(none.code, 2, 'a cancel with no reason is a usage error');
  assert.equal((await callTool(v, 'memev_project_status', { project: 'shop' })).tasks.C.state, S.READY, 'nothing was cancelled');
  const r = await work(['cancel', 'shop', 'C'], { reason: 'no longer needed', json: true }, { call });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).state, S.CANCELLED);
  const events = Object.values(v.projectStore('shop').snapshot('event')).filter((e) => e.type === 'task.transitioned' && e.task_id === 'C' && e.to === S.CANCELLED);
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, OWNER.agent);
  assert.match(events[0].reason, /no longer needed/);
  const gone = await work(['cancel', 'shop', 'ZZ'], { reason: 'x' }, { call });
  assert.equal(gone.code, 1, 'no such task');
  assert.equal(gone.err.trim().split('\n').length, 1);
});

test('SO-08-B AC03: pause, resume and cancel exit 2 on a usage error and 1 for a project that does not exist', async () => {
  const { v } = newVault();
  const call = portOf(v);
  for (const pos of [['pause'], ['resume'], ['cancel'], ['cancel', 'shop']]) {
    const r = await work(pos, { reason: 'x' }, { call });
    assert.equal(r.code, 2, pos.join(' '));
    assert.equal(r.err.trim().split('\n').length, 1, `${pos.join(' ')} says one line`);
  }
  for (const pos of [['pause', 'nope'], ['resume', 'nope'], ['cancel', 'nope', 'A']]) {
    const r = await work(pos, { reason: 'x' }, { call });
    assert.equal(r.code, 1, pos.join(' '));
    assert.match(r.err, /no project nope/);
    assert.equal(r.err.trim().split('\n').length, 1);
  }
  assert.equal(fs.existsSync(path.join(v.root, '.memev', 'projects', 'nope')), false, 'asking about a project does not create it');
  const j = await work(['pause'], { json: true }, { call });
  assert.equal(j.code, 2);
});

test('SO-08-B AC03: memev work is a command of the CLI: usage exits 2 and a project that does not exist exits 1 with one line', () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(init.code, 0, init.err + init.out);
    const bare = sb.run(['work']);
    assert.equal(bare.code, 2, bare.err + bare.out);
    const status = sb.run(['work', 'status', 'nope']);
    assert.equal(status.code, 1, status.err + status.out);
    assert.equal((status.err + status.out).trim().split('\n').length, 1);
    assert.match(status.err + status.out, /no project nope/);
    assert.equal(sb.run(['work', 'cancel', 'nope', 'A']).code, 2, 'a cancel needs its reason');
    assert.match(sb.run(['help']).out + sb.run(['--help']).out, /memev work status/);
  } finally { sb.stop(); }
});

// ---- AC04: transitions travel on the bus

const seats = (v) => {
  for (const c of [WORKER.split('@')[0], 'worker-b']) v.bus.resolve({ identity: OWNER, client: c, local: true }, { need: 'write' });
};
const transitionMsgs = (v) => v.bus.all().filter((m) => m.type === 'transition');

test('SO-08-B AC04: every transition posts one typed message to the assignee seat and one to the operator seat, with ids and states only', () => {
  const { v } = newVault();
  seats(v);
  assert.ok(v.bus.seat(WORKER), 'the assignee has a seat');
  const r = rig({ bus: v.bus });
  plan(r.co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }]);
  const planned = moves(r.store, 'A').length;
  assert.equal(transitionMsgs(v).filter((m) => m.to === 'operator').length, planned, 'each planning move reached the operator');
  assert.equal(transitionMsgs(v).filter((m) => m.to === WORKER).length, 0, 'nobody is assigned yet');
  const lease = r.co.claim('A', WORKER, 60_000).lease;
  const all = moves(r.store, 'A');
  const msgs = transitionMsgs(v);
  assert.equal(msgs.filter((m) => m.to === 'operator').length, all.length, 'one operator message per transition');
  const mine = msgs.filter((m) => m.to === WORKER);
  assert.equal(mine.length, all.length - planned, 'one assignee message per transition under the assignee');
  const last = JSON.parse(mine.at(-1).body);
  assert.deepEqual(Object.keys(last).sort(), ['correlation', 'from', 'project', 'task', 'to']);
  assert.equal(last.task, 'A'); assert.equal(last.project, 'p'); assert.equal(last.to, S.IN_PROGRESS); assert.equal(last.from, S.READY);
  assert.equal(findSecrets(mine.at(-1).body).length, 0);
  r.co.report(lease, { ok: true, output: 'secret output that must never travel', artifacts: ['src/a.js'] });
  for (const m of transitionMsgs(v)) assert.doesNotMatch(m.body, /secret output/, 'only ids and states travel');
  assert.equal(transitionMsgs(v).filter((m) => m.to === 'operator').length, moves(r.store, 'A').length);
});

test('SO-08-B AC04: a message that would carry a credential is refused by the bus and a bus failure never blocks a transition', () => {
  const { v } = newVault();
  const key = ['sk', 'proj', 'a'.repeat(30)].join('-');
  assert.throws(() => v.bus.postTransition({ project: 'p', task: key, from: 'READY', to: 'IN_PROGRESS', correlation: 'c1' }), /credential/);
  const broken = { postTransition() { throw new Error('bus down'); } };
  const r = rig({ bus: broken });
  plan(r.co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }]);
  assert.equal(r.co.claim('A', WORKER, 60_000).ok, true, 'the claim went through');
  assert.equal(task(r.store, 'A').status, S.IN_PROGRESS);
});

test('SO-08-B AC04: the bus is transport, not the store: deleting the bus files loses no project state', () => {
  const { v } = newVault();
  seats(v);
  const r = rig({ bus: v.bus });
  plan(r.co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }, { id: 'B', title: 'b', artifacts: ['src/b.js'] }]);
  r.co.claim('A', WORKER, 60_000);
  assert.ok(transitionMsgs(v).length > 0);
  const before = JSON.stringify(r.co.status('p', { history: true }));
  fs.rmSync(path.join(v.root, 'bus', 'log'), { recursive: true, force: true });
  assert.equal(transitionMsgs(v).length, 0, 'the messages are gone');
  const again = r.open();
  assert.equal(JSON.stringify(again.co.status('p', { history: true })), before, 'the project reads the same');
  assert.deepEqual(again.co.reconstruct('p').inflight, ['A']);
});

// ---- AC05: duplicate delivery

test('SO-08-B AC05: the same bus message processed twice produces one transition and one event', () => {
  const { store, co } = rig();
  plan(co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }, { id: 'B', title: 'b', artifacts: ['src/b.js'] }]);
  const msg = { id: 'dev1-7', kind: 'cancel', project: 'p', task_id: 'A', actor: 'operator', reason: 'not needed' };
  const t0 = logged(store, 'task.transitioned').length;
  const first = co.applyBusMessage(msg);
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, undefined);
  const second = co.applyBusMessage(msg);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true, 'the second delivery is recognised');
  assert.equal(task(store, 'A').status, S.CANCELLED);
  assert.equal(logged(store, 'task.transitioned').length - t0, 1, 'one transition');
  assert.equal(logged(store, 'bus.processed').filter((e) => e.message_id === 'dev1-7').length, 1, 'one event');
  // a pause delivered twice pauses once
  const pause = { id: 'dev1-8', kind: 'pause', project: 'p', actor: 'operator', reason: 'break' };
  assert.equal(co.applyBusMessage(pause).ok, true);
  assert.equal(co.applyBusMessage(pause).duplicate, true);
  assert.equal(logged(store, 'project.paused').length, 1);
  // a second process reading the same files sees the first one's work and does not repeat it
  const other = new Coordinator(new ProjectStore(path.dirname(store.snapshotPath('task')), { id: 'p', fsync: false }).open(), { lifecycle: true });
  assert.equal(other.applyBusMessage(msg).duplicate, true);
});

test('SO-08-B AC05: a bus message with no id, an unknown kind or no project is refused and changes nothing', () => {
  const { store, co } = rig();
  plan(co, [{ id: 'A', title: 'a', artifacts: ['src/a.js'] }]);
  const n = Object.keys(store.snapshot('event')).length;
  assert.equal(co.applyBusMessage({ kind: 'cancel', project: 'p', task_id: 'A', reason: 'x' }).ok, false);
  assert.equal(co.applyBusMessage({ id: 'm1', kind: 'launch', project: 'p' }).code, 'UNKNOWN_KIND');
  assert.equal(co.applyBusMessage({ id: 'm2', kind: 'cancel', task_id: 'A', reason: 'x' }).ok, false);
  assert.equal(Object.keys(store.snapshot('event')).length, n);
});

// ---- AC06: memev work status

test('SO-08-B AC06: memev work status prints the status, active tasks with owner and lease expiry, blocked items, approvals and stale evidence, each with a next action', async () => {
  const { v } = newVault();
  await seed(v);
  await callTool(v, 'memev_task_claim', { project: 'shop', task: 'A', ttl_s: 3600 });
  const store = v.projectStore('shop');
  const lease = Object.values(store.snapshot('lease')).find((l) => l.task_id === 'A');
  await callTool(v, 'memev_task_claim', { project: 'shop', task: 'B', ttl_s: 0.02 });
  await new Promise((r) => setTimeout(r, 80));
  v.coordinator('shop').sweep();
  store.append({ type: 'approval.upserted', entity: { kind: 'approval', id: 'appr_9', data: { task_id: 'C', status: 'pending', what: 'deploy' } } });
  store.append({ type: 'evidence.upserted', entity: { kind: 'evidence', id: 'ev_9', data: { task_id: 'A', criterion: 'c1', stale: true } } });
  const r = await work(['status', 'shop'], {}, { call: portOf(v) });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /shop/);
  assert.match(r.out, /ACTIVE|NEEDS_ATTENTION/, 'the project status');
  assert.match(r.out, /A\b.*build the page/s);
  assert.ok(r.out.includes(OWNER.agent) || /held by/.test(r.out), 'the owner is named');
  assert.ok(r.out.includes(new Date(lease.expires).toISOString()), 'the lease expiry is shown');
  assert.match(r.out, /B\b.*owner_lost/s, 'a blocked item with its reason');
  assert.match(r.out, /appr_9/);
  assert.match(r.out, /ev_9/);
  assert.equal((r.out.match(/next:/g) || []).length, 4, 'one next action each for the active task, the blocked item, the approval and the stale evidence');
  const j = await work(['status', 'shop'], { json: true }, { call: portOf(v) });
  assert.equal(j.code, 0);
  const d = JSON.parse(j.out);
  assert.equal(d.project, 'shop');
  assert.ok(d.status);
  assert.equal(d.active.length, 1);
  assert.equal(d.active[0].task, 'A'); assert.equal(d.active[0].owner, OWNER.agent); assert.equal(d.active[0].lease_expires, lease.expires);
  assert.equal(d.blocked.length, 1);
  assert.equal(d.blocked[0].task, 'B'); assert.equal(d.blocked[0].reason, 'owner_lost');
  assert.equal(d.approvals.length, 1); assert.equal(d.approvals[0].id, 'appr_9');
  assert.equal(d.stale_evidence.length, 1); assert.equal(d.stale_evidence[0].id, 'ev_9');
  for (const k of ['active', 'blocked', 'approvals', 'stale_evidence']) for (const x of d[k]) assert.ok(typeof x.next === 'string' && x.next.length > 0, `${k} carries a next action`);
});

test('SO-08-B AC06: memev work status for a project that does not exist exits 1 with one line', async () => {
  const { v } = newVault();
  for (const flags of [{}, { json: true }]) {
    const r = await work(['status', 'nope'], flags, { call: portOf(v) });
    assert.equal(r.code, 1);
    assert.equal(r.err.trim().split('\n').length, 1);
    assert.equal(r.out, '');
    assert.match(r.err, /no project nope/);
  }
  assert.equal((await work(['status'], {}, { call: portOf(v) })).code, 2, 'no project named is a usage error');
});

// ---- AC07: the docs

test('SO-08-B AC07: docs/BUS.md documents the project message kinds the coordinator posts', () => {
  const md = fs.readFileSync(path.join(PKG, 'docs', 'BUS.md'), 'utf8');
  assert.match(md, /(?=[\s\S]*project)(?=[\s\S]*transition)/);
  assert.match(md, /^## Project messages/m);
  assert.match(md, /`transition`/);
  assert.match(md, /ids and states only/);
  const projects = fs.readFileSync(path.join(PKG, 'docs', 'PROJECTS.md'), 'utf8');
  for (const w of ['recover', 'eligibility pass', 'memev work pause', 'memev work cancel']) assert.ok(projects.includes(w), `PROJECTS.md says ${w}`);
});
