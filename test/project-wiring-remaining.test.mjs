// SPDX-License-Identifier: Apache-2.0
// The rest of the project state machine on the wired task path (SO-1.01): pause stops dispatch (SO-REQ-012), a scope
// amendment makes evidence bound to the old version stale and replans the task, cancellation and reassignment go through
// the transition table and the log, and a stale update surfaces a conflict. Everything goes through the MCP tools the
// daemon serves, or the vault methods they call. The contract-verify feed is in test/task-verify-from-contract.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handle, toolList } from '../src/server/mcp.mjs';
import { TRANSITIONS } from '../src/engine/project-state.mjs';
const PKG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

const WRITER = { id: 'w', agent: 'writer', scopes: ['read', 'write'], paths: ['**'] };
const ctx = (over = {}) => ({ identity: OWNER, client: 'test', session: 's1', local: true, ...over });
const call = async (v, name, args, c = ctx()) => {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c);
  return { error: !!r.result.isError, text: r.result.content[0].text, data: r.result.structuredContent };
};
const events = (root, project) => fs.readFileSync(path.join(root, '.memev', 'projects', project, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const logged = (root, project, type) => events(root, project).filter((r) => r.entity?.kind === 'event' && r.entity.data?.type === type).map((r) => r.entity.data);
const state = async (v, project, task) => (await call(v, 'memev_project_status', { project })).data.tasks[task]?.state;
const evidenceOf = (v, project) => Object.values(v.projectStore(project).snapshot('evidence'));

const SPEC = (extra = {}) => ({ project: 'lc', tasks: [{ id: 'A', title: 'a', artifacts: ['src/a.js'], criteria: [{ id: 'c1', mandatory: true }], artifact_hash: 'h1' }, { id: 'B', title: 'b', artifacts: ['src/b.js'] }], ...extra });
const verified = async (v, project = 'lc', task = 'A') => {
  const lease = (await call(v, 'memev_task_claim', { project, task, ttl_s: 60 })).data.lease.id;
  await call(v, 'memev_task_report', { project, lease, output: 'x', artifacts: ['src/a.js'] });
  const r = await call(v, 'memev_task_verify', { project, task, evidence: [{ criterion: 'c1', scope_version: 1, artifact_hash: 'h1' }] });
  assert.equal(r.data.ok, true, r.text);
};

test('the lifecycle tools are listed, write tools, and none is read-only', () => {
  const by = new Map(toolList().map((t) => [t.name, t]));
  for (const n of ['memev_project_pause', 'memev_project_resume', 'memev_scope_amend', 'memev_task_cancel', 'memev_task_reassign', 'memev_task_update']) {
    assert.ok(by.has(n), n);
    assert.equal(by.get(n).annotations.readOnlyHint, false, n);
  }
});

test('SO-REQ-012: a paused project dispatches nothing, keeps its truth, and resume restores dispatch', async () => {
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', SPEC());
  const lease = (await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.lease.id;
  const p = await call(v, 'memev_project_pause', { project: 'lc', reason: 'freeze' });
  assert.equal(p.data.ok, true, p.text);
  const s = (await call(v, 'memev_project_status', { project: 'lc' })).data;
  assert.equal(s.status, 'PAUSED');
  assert.equal(s.paused, true);
  assert.deepEqual(s.eligible, [], 'nothing is eligible while paused');
  assert.equal(s.tasks.A.state, 'IN_PROGRESS', 'an in-flight task keeps its state');
  assert.equal(s.tasks.A.cancellation, 'requested', 'and is marked for cancellation by the pause');
  const refused = await call(v, 'memev_task_claim', { project: 'lc', task: 'B', ttl_s: 60 });
  assert.equal(refused.data.ok, false);
  assert.equal(refused.data.paused, true);
  assert.equal(v.coordinator('lc').dispatch('B', 'x', 'k1', {}, () => { throw new Error('sent while paused'); }).paused, true, 'dispatch is refused too');
  assert.equal((await call(v, 'memev_task_heartbeat', { project: 'lc', lease })).data.ok, true, 'a live lease still heartbeats');
  assert.equal((await call(v, 'memev_project_pause', { project: 'lc' })).data.ok, false, 'pausing twice is refused');
  const r = await call(v, 'memev_project_resume', { project: 'lc' });
  assert.equal(r.data.ok, true, r.text);
  const s2 = (await call(v, 'memev_project_status', { project: 'lc' })).data;
  assert.equal(s2.paused, false);
  assert.equal(s2.tasks.A.cancellation ?? null, null, 'the cancellation the pause itself made is withdrawn');
  assert.deepEqual(s2.eligible, ['B']);
  assert.equal((await call(v, 'memev_task_claim', { project: 'lc', task: 'B', ttl_s: 60 })).data.ok, true);
  assert.equal((await call(v, 'memev_project_resume', { project: 'lc' })).data.ok, false, 'resume of a running project is refused');
  assert.ok(logged(root, 'lc', 'project.paused').length === 1 && logged(root, 'lc', 'project.resumed').length === 1);
  // the pause survives a restart
  await call(v, 'memev_project_pause', { project: 'lc' });
  assert.equal(v.tasksStatus(OWNER, 'lc').paused, true);
  v.close();
});

test('a scope amendment bumps the version, makes the old evidence stale and replans the verified task through the table', async () => {
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', SPEC());
  await verified(v);
  assert.equal(await state(v, 'lc', 'A'), 'VERIFIED');
  assert.equal(evidenceOf(v, 'lc').filter((e) => !e.stale).length, 1);
  const unaffected = await call(v, 'memev_scope_amend', { project: 'lc', paths: ['src/other.js'], reason: 'unrelated' });
  assert.equal(unaffected.data.ok, true);
  assert.equal(await state(v, 'lc', 'A'), 'VERIFIED', 'a change to another path leaves the task alone');
  const am = await call(v, 'memev_scope_amend', { project: 'lc', paths: ['src/a.js'], reason: 'the cart changed' });
  assert.equal(am.data.ok, true, am.text);
  assert.deepEqual(am.data.affected.tasks, ['A']);
  assert.equal(await state(v, 'lc', 'A'), 'ACCEPTED', 'VERIFIED goes back to ACCEPTED');
  assert.ok(evidenceOf(v, 'lc').every((e) => e.stale), 'the evidence bound to the old version is stale');
  const t = v.projectStore('lc').snapshot('task').A;
  assert.equal(t.scope_version, 3, 'two amendments bumped the scope version twice');
  assert.match(t.replan_reason, /scope changed/);
  const move = logged(root, 'lc', 'task.transitioned').filter((m) => m.task_id === 'A').at(-1);
  assert.equal(move.from, 'VERIFIED'); assert.equal(move.to, 'ACCEPTED'); assert.ok(TRANSITIONS.VERIFIED.includes('ACCEPTED'));
  assert.equal(logged(root, 'lc', 'scope.amended').length, 2);
  // the old evidence does not verify the replanned task: bound to scope version 1, the task is at 3
  const lease = (await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.lease.id;
  await call(v, 'memev_task_report', { project: 'lc', lease, output: 'redone after the scope change', artifacts: [] });
  const old = await call(v, 'memev_task_verify', { project: 'lc', task: 'A', evidence: [{ criterion: 'c1', scope_version: 1, artifact_hash: 'h1' }] });
  assert.equal(old.data.code, 'NO_EVIDENCE');
  const fresh = await call(v, 'memev_task_verify', { project: 'lc', task: 'A', evidence: [{ criterion: 'c1', scope_version: 3, artifact_hash: 'h1' }] });
  assert.equal(fresh.data.ok, true, fresh.text);
  // adversarial: amendment needs the admin scope and paths
  assert.equal((await call(v, 'memev_scope_amend', { project: 'lc', paths: ['src/a.js'] }, ctx({ identity: WRITER }))).error, true);
  assert.equal((await call(v, 'memev_scope_amend', { project: 'lc', paths: [] })).error, true);
  v.close();
});

test('cancellation goes through the table: pending and unsupported keep the state, a confirmation cancels, a cancelled task is never revived', async () => {
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', SPEC());
  const lease = (await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.lease.id;
  const pending = await call(v, 'memev_task_cancel', { project: 'lc', task: 'A', reason: 'stop' });
  assert.equal(pending.data.ok, false); assert.equal(pending.data.code, 'CANCELLATION_PENDING');
  assert.equal(await state(v, 'lc', 'A'), 'IN_PROGRESS');
  const unsup = await call(v, 'memev_task_cancel', { project: 'lc', task: 'A', outcome: 'unsupported', reason: 'stop' });
  assert.equal(unsup.data.code, 'CANCELLATION_UNSUPPORTED');
  assert.equal(v.projectStore('lc').snapshot('task').A.cancellation, 'unsupported');
  // a stranger cannot confirm another session's task; the holder or an admin can
  const stranger = await call(v, 'memev_task_cancel', { project: 'lc', task: 'A', outcome: 'confirmed', reason: 'stop' }, ctx({ identity: WRITER }));
  assert.equal(stranger.data?.ok ?? false, false);
  assert.equal(await state(v, 'lc', 'A'), 'IN_PROGRESS');
  const done = await call(v, 'memev_task_cancel', { project: 'lc', task: 'A', outcome: 'confirmed', reason: 'user stopped the work' });
  assert.equal(done.data.ok, true, done.text);
  assert.equal(await state(v, 'lc', 'A'), 'CANCELLED');
  assert.equal(v.projectStore('lc').snapshot('lease')[lease].status, 'cancelled', 'its lease is closed');
  assert.equal(v.projectStore('lc').snapshot('task').A.locks.length, 0);
  const move = logged(root, 'lc', 'task.transitioned').filter((m) => m.task_id === 'A').at(-1);
  assert.equal(move.to, 'CANCELLED'); assert.equal(move.reason, 'user stopped the work');
  // never revived: a report under the dead lease is stored late and changes nothing; a second cancel is refused
  assert.equal((await call(v, 'memev_task_report', { project: 'lc', lease, output: 'zombie' })).data.ok, false);
  assert.equal(await state(v, 'lc', 'A'), 'CANCELLED');
  assert.equal((await call(v, 'memev_task_cancel', { project: 'lc', task: 'A', reason: 'again' })).data.ok, false);
  assert.equal((await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.ok, false);
  // a task nobody holds is cancelled directly
  assert.equal((await call(v, 'memev_task_cancel', { project: 'lc', task: 'B', reason: 'not needed' })).data.ok, true);
  assert.equal(await state(v, 'lc', 'B'), 'CANCELLED');
  const s = (await call(v, 'memev_project_status', { project: 'lc' })).data;
  assert.equal(s.status, 'COMPLETE', 'every task cancelled with a recorded reason');
  v.close();
});

test('reassignment needs a released or expired lease or an authorised override, bumps the generation and refuses the old holder', async () => {
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', SPEC());
  const l1 = (await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.lease.id;
  const live = await call(v, 'memev_task_reassign', { project: 'lc', task: 'A', to: 'other' });
  assert.equal(live.data.ok, false); assert.equal(live.data.code, 'LEASE_NOT_FREE');
  const noAdmin = await call(v, 'memev_task_reassign', { project: 'lc', task: 'A', to: 'other', override: true }, ctx({ identity: WRITER }));
  assert.equal(noAdmin.error, true, 'an override is an admin action');
  const gen0 = v.projectStore('lc').snapshot('task').A.generation;
  const ov = await call(v, 'memev_task_reassign', { project: 'lc', task: 'A', to: 'other', override: true, reason: 'owner unresponsive' });
  assert.equal(ov.data.ok, true, ov.text);
  const t = v.projectStore('lc').snapshot('task').A;
  assert.ok(t.generation > gen0, 'generation bumped');
  assert.equal(t.holder, 'other');
  assert.equal(t.status, 'READY');
  assert.equal(v.projectStore('lc').snapshot('lease')[l1].status, 'revoked');
  const rec = logged(root, 'lc', 'task.reassigned')[0];
  assert.equal(rec.to, 'other'); assert.deepEqual(rec.inspectedAttempts, []); assert.ok(rec.correlationId && rec.actor && rec.time);
  // the old holder's report is stale or late and changes nothing; only the new holder may claim
  const stale = await call(v, 'memev_task_report', { project: 'lc', lease: l1, output: 'old holder' });
  assert.equal(stale.data.ok, false);
  assert.equal(await state(v, 'lc', 'A'), 'READY');
  assert.equal((await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.ok, false, 'reserved for other');
  const l2 = await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 }, ctx({ identity: { ...OWNER, agent: 'other' } }));
  assert.equal(l2.data.ok, true, l2.text);
  // an expired lease frees reassignment without an override
  const lease3 = (await call(v, 'memev_task_claim', { project: 'lc', task: 'B', ttl_s: 0.05 })).data.lease.id;
  assert.ok(lease3);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
  v.coordinator('lc').sweep();
  assert.equal(await state(v, 'lc', 'B'), 'BLOCKED');
  assert.equal((await call(v, 'memev_task_reassign', { project: 'lc', task: 'B', to: 'third' })).data.ok, true);
  assert.equal(await state(v, 'lc', 'B'), 'READY');
  for (const m of logged(root, 'lc', 'task.transitioned')) assert.ok(TRANSITIONS[m.from].includes(m.to), `${m.from} -> ${m.to}`);
  v.close();
});

test('applyUpdate: a current update applies, competing updates from two sources surface a conflict, authoritative fields are not patchable', async () => {
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', SPEC());
  await call(v, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 });   // IN_PROGRESS, where the table allows CONFLICTED
  const base = v.projectStore('lc').snapshot('task').A;
  const gen = base.generation; const ver = base.version ?? 1;
  const u1 = await call(v, 'memev_task_update', { project: 'lc', task: 'A', patch: { title: 'a, renamed' }, base_version: ver, generation: gen, source: 'agent-1' });
  assert.equal(u1.data.ok, true, u1.text);
  assert.equal(v.projectStore('lc').snapshot('task').A.title, 'a, renamed');
  assert.equal(v.projectStore('lc').snapshot('task').A.version, ver + 1);
  const u2 = await call(v, 'memev_task_update', { project: 'lc', task: 'A', patch: { title: 'a, other name' }, base_version: ver, generation: gen, source: 'agent-2' });
  assert.equal(u2.data.ok, false); assert.equal(u2.data.code, 'CONFLICT');
  const t = v.projectStore('lc').snapshot('task').A;
  assert.equal(t.title, 'a, renamed', 'last write did not win');
  assert.equal(t.status, 'CONFLICTED');
  assert.equal(t.conflict.competing.length, 2);
  assert.ok(logged(root, 'lc', 'task.transitioned').some((m) => m.to === 'CONFLICTED'));
  const stale = await call(v, 'memev_task_update', { project: 'lc', task: 'A', patch: { title: 'x' }, base_version: ver, generation: gen + 7, source: 'agent-3' });
  assert.equal(stale.data.code, 'STALE_GENERATION');
  // where the table does not allow CONFLICTED (a READY task) the conflict record is attached and the state is kept
  const b = v.projectStore('lc').snapshot('task').B;
  await call(v, 'memev_task_update', { project: 'lc', task: 'B', patch: { note: 'one' }, base_version: b.version ?? 1, generation: b.generation, source: 'agent-1' });
  const bc = await call(v, 'memev_task_update', { project: 'lc', task: 'B', patch: { note: 'two' }, base_version: b.version ?? 1, generation: b.generation, source: 'agent-2' });
  assert.equal(bc.data.code, 'CONFLICT');
  assert.equal(v.projectStore('lc').snapshot('task').B.status, 'READY');
  assert.ok(v.projectStore('lc').snapshot('task').B.conflict, 'the conflict is recorded');
  assert.equal(v.projectStore('lc').snapshot('task').B.note, 'one');
  for (const key of ['status', 'state', 'lease_id', 'generation', 'scope_version', 'holder', 'locks', 'artifact_hash', 'version']) {
    const r = await call(v, 'memev_task_update', { project: 'lc', task: 'B', patch: { [key]: 'IN_PROGRESS' }, base_version: 1, generation: 0, source: 'agent-4' });
    assert.equal(r.data.ok, false, `${key} must not be patchable`);
    assert.equal(r.data.code, 'FORBIDDEN_FIELD');
  }
  assert.equal(v.projectStore('lc').snapshot('task').B.status, 'READY');
  v.close();
});

test('the task history is read through the event log: unique ids, frozen entries, in order', async () => {
  const { v } = newVault();
  await call(v, 'memev_task_plan', SPEC());
  await verified(v);
  const h = (await call(v, 'memev_project_status', { project: 'lc', history: true })).data.history;
  assert.ok(h.length >= 5);
  assert.equal(new Set(h.map((e) => e.id)).size, h.length);
  assert.deepEqual(h.filter((e) => e.task_id === 'A').map((e) => e.to), ['ACCEPTED', 'READY', 'IN_PROGRESS', 'VERIFYING', 'VERIFIED']);
  const entries = v.coordinator('lc').history();
  assert.throws(() => { 'use strict'; entries[0].to = 'X'; });
  v.close();
});

test('a pause and a scope version survive a restart, and the reopened project still refuses dispatch', async () => {
  const { Vault } = await import('../src/engine/vault.mjs');
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', SPEC());
  await call(v, 'memev_scope_amend', { project: 'lc', paths: ['src/zzz.js'] });
  await call(v, 'memev_project_pause', { project: 'lc' });
  v.close();
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  const s = (await call(v2, 'memev_project_status', { project: 'lc' })).data;
  assert.equal(s.paused, true); assert.equal(s.status, 'PAUSED'); assert.equal(s.scope_version, 2);
  assert.equal((await call(v2, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.paused, true);
  assert.equal((await call(v2, 'memev_project_resume', { project: 'lc' })).data.ok, true);
  assert.equal((await call(v2, 'memev_task_claim', { project: 'lc', task: 'A', ttl_s: 60 })).data.ok, true);
  v2.close();
});

test('a read-only token can read the status and nothing else on the task path', async () => {
  const { v } = newVault();
  const READER = { id: 'r', agent: 'reader', scopes: ['read'], paths: ['**'] };
  await call(v, 'memev_task_plan', SPEC());
  assert.equal((await call(v, 'memev_project_status', { project: 'lc' }, ctx({ identity: READER }))).error, false);
  for (const [name, args] of [['memev_task_claim', { project: 'lc', task: 'A' }], ['memev_project_pause', { project: 'lc' }], ['memev_task_cancel', { project: 'lc', task: 'A' }], ['memev_task_update', { project: 'lc', task: 'A', patch: { title: 'x' }, base_version: 1, generation: 0 }], ['memev_task_reassign', { project: 'lc', task: 'A', to: 'x' }], ['memev_scope_amend', { project: 'lc', paths: ['a'] }]]) {
    assert.equal((await call(v, name, args, ctx({ identity: READER }))).error, true, `${name} must refuse a read-only token`);
  }
  assert.equal(v.projectStore('lc').snapshot('task').A.status, 'READY');
  v.close();
});

test('every function the state machine exports is called from the coordinator, which is the only importer', async () => {
  const stateSrc = fs.readFileSync(path.join(PKG, 'src/engine/project-state.mjs'), 'utf8');
  const exported = [...stateSrc.matchAll(/^export (?:function|class) (\w+)/gm)].map((m) => m[1]);
  const coord = fs.readFileSync(path.join(PKG, 'src/engine/coordinator.mjs'), 'utf8');
  const imported = (/import \{([^}]*)\} from '\.\/project-state\.mjs'/.exec(coord)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  // makeRecord is the record builder transition() calls inside the module
  for (const name of exported.filter((n) => n !== 'makeRecord')) {
    assert.ok(imported.includes(name), `${name} is exported by project-state.mjs and not imported by the coordinator`);
    const calls = coord.split('\n').filter((l) => !/^\s{2}\w+\(.*\) \{$/.test(l) && !l.trim().startsWith('//')).filter((l) => new RegExp(`(?<![.\\w])(new )?${name}\\(`).test(l)).length;   // a method of the same name is a definition, not a call
    assert.ok(calls > 0, `${name} is imported by the coordinator and never called`);
  }
});
