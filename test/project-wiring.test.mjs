// SPDX-License-Identifier: Apache-2.0
// The project store, the state machine and the coordinator are one authority, reached from the default entry: the daemon
// (src/server/main.mjs, which `memev start` runs) serves /mcp, whose task tools go through the vault to one coordinator
// over one project store, and every state change passes the transition table of project-state.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildGraph } from '../scripts/docs/module-graph.mjs';
import { Vault } from '../src/engine/vault.mjs';
import { createServer } from '../src/server/http.mjs';
import { handle, toolList } from '../src/server/mcp.mjs';
import { TRANSITIONS, TASK_STATES } from '../src/engine/project-state.mjs';
import { newVault, cleanup, OWNER, PKG } from './helpers/tmp.mjs';
after(cleanup);

const ENTRIES = ['bin/memev.mjs', 'src/server/main.mjs'];
const reachable = () => {
  const g = buildGraph(PKG);
  const adj = new Map();
  for (const e of g.edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from).push(e.to); }
  const seen = new Set(); const stack = [...ENTRIES];
  while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); stack.push(...(adj.get(n) || [])); }
  return { seen, importers: (id) => g.edges.filter((e) => e.to === id).map((e) => e.from) };
};

test('SO-04-A, SO-07-A and SO-08-A are reached from the default entry, each by the module that owns the step', () => {
  const { seen, importers } = reachable();
  for (const m of ['src/engine/project-store.mjs', 'src/engine/project-state.mjs', 'src/engine/coordinator.mjs']) assert.ok(seen.has(m), `${m} is not reachable from ${ENTRIES.join(' or ')}`);
  assert.deepEqual(importers('src/engine/project-store.mjs'), ['src/engine/vault.mjs']);
  assert.deepEqual(importers('src/engine/coordinator.mjs'), ['src/engine/vault.mjs']);
  assert.deepEqual(importers('src/engine/project-state.mjs'), ['src/engine/coordinator.mjs']);
});

test('there is one store and one coordinator per project: nothing else in src builds either', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mjs') ? [path.join(d, e.name)] : []));
  const sites = (re) => ['src', 'bin'].flatMap((d) => walk(path.join(PKG, d))).filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(PKG, f).split(path.sep).join('/'));
  assert.deepEqual(sites(/new ProjectStore\(/), ['src/engine/vault.mjs']);
  assert.deepEqual(sites(/new Coordinator\(/), ['src/engine/vault.mjs']);
  const { v } = newVault();
  assert.equal(v.projectStore('shop'), v.projectStore('shop'), 'the same store object, not a second one');
  assert.equal(v.coordinator('shop'), v.coordinator('shop'));
  assert.equal(v.coordinator('shop').store, v.projectStore('shop'), 'the coordinator runs over that store');
  assert.notEqual(v.projectStore('shop'), v.projectStore('other'));
  v.close();
});

const ctx = (over = {}) => ({ identity: OWNER, client: 'test', session: 'sess-1', local: true, ...over });
const call = async (v, name, args, c = ctx()) => {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c);
  return { error: !!r.result.isError, text: r.result.content[0].text, data: r.result.structuredContent };
};
const eventsOf = (root, project) => fs.readFileSync(path.join(root, '.memev', 'projects', project, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const moves = (root, project) => eventsOf(root, project).filter((r) => r.entity?.kind === 'event' && r.entity.data?.type === 'task.transitioned').map((r) => r.entity.data);

test('the MCP task tools run a task through the transition table, and an agent report never verifies', async () => {
  const { root, v } = newVault();
  const names = new Set(toolList().map((t) => t.name));
  for (const n of ['memev_task_plan', 'memev_task_claim', 'memev_task_heartbeat', 'memev_task_report', 'memev_task_release', 'memev_task_verify', 'memev_project_status']) assert.ok(names.has(n), `${n} is a tool`);

  const plan = await call(v, 'memev_task_plan', { project: 'shop', tasks: [
    { id: 'A', title: 'build the cart', artifacts: ['src/cart.js'], criteria: [{ id: 'c1', mandatory: true }], artifact_hash: 'h1' },
    { id: 'B', title: 'build checkout', deps: ['A'] },
  ] });
  assert.equal(plan.error, false, plan.text);
  const status0 = (await call(v, 'memev_project_status', { project: 'shop' })).data;
  assert.equal(status0.tasks.A.state, 'READY');
  assert.equal(status0.tasks.B.state, 'ACCEPTED', 'a task with an unmet dependency is accepted, not ready');
  assert.deepEqual(status0.eligible, ['A']);

  const early = await call(v, 'memev_task_claim', { project: 'shop', task: 'B', ttl_s: 60 });
  assert.equal(early.data.ok, false, 'B cannot be claimed before A is verified');

  const claim = await call(v, 'memev_task_claim', { project: 'shop', task: 'A', ttl_s: 60 });
  assert.equal(claim.data.ok, true, claim.text);
  const lease = claim.data.lease.id;
  assert.equal((await call(v, 'memev_task_heartbeat', { project: 'shop', lease })).data.ok, true);
  const rep = await call(v, 'memev_task_report', { project: 'shop', lease, output: 'done, trust me', artifacts: ['src/cart.js'] });
  assert.equal(rep.data.ok, true, rep.text);
  const status1 = (await call(v, 'memev_project_status', { project: 'shop' })).data;
  assert.equal(status1.tasks.A.state, 'VERIFYING', 'a report moves the task to VERIFYING, never to a finished state');
  assert.equal(status1.status, 'VERIFYING');
  assert.deepEqual(status1.eligible, [], 'B stays closed while A is unverified');

  // verification needs bound evidence and is an operator action: not through the tunnel, and not without evidence
  const remote = await call(v, 'memev_task_verify', { project: 'shop', task: 'A', evidence: [] }, ctx({ local: false }));
  assert.equal(remote.error, true);
  assert.match(remote.text, /only from this machine/);
  const none = await call(v, 'memev_task_verify', { project: 'shop', task: 'A', evidence: [] });
  assert.equal(none.data.ok, false);
  assert.equal(none.data.code, 'NO_EVIDENCE');
  const wrongHash = await call(v, 'memev_task_verify', { project: 'shop', task: 'A', evidence: [{ criterion: 'c1', scope_version: 1, artifact_hash: 'other' }] });
  assert.equal(wrongHash.data.code, 'NO_EVIDENCE', 'evidence bound to another artifact does not verify');
  const ok = await call(v, 'memev_task_verify', { project: 'shop', task: 'A', evidence: [{ criterion: 'c1', scope_version: 1, artifact_hash: 'h1' }] });
  assert.equal(ok.data.ok, true, ok.text);
  const status2 = (await call(v, 'memev_project_status', { project: 'shop' })).data;
  assert.equal(status2.tasks.A.state, 'VERIFIED');
  assert.deepEqual(status2.eligible, ['B'], 'B opens once A is verified');
  assert.equal((await call(v, 'memev_task_claim', { project: 'shop', task: 'B', ttl_s: 60 })).data.ok, true);

  // every recorded move is one the table allows, with its full record
  const log = moves(root, 'shop');
  assert.ok(log.length >= 6, `moves recorded: ${log.length}`);
  for (const m of log) {
    assert.ok(m.from === 'PROPOSED' || Object.hasOwn(TRANSITIONS, m.from), m.from);
    assert.ok(Object.hasOwn(TASK_STATES, m.to), m.to);
    assert.ok(TRANSITIONS[m.from].includes(m.to), `${m.from} -> ${m.to} is not in the table`);
    for (const f of ['actor', 'time', 'reason', 'correlationId', 'scopeVersion']) assert.ok(m[f] !== undefined && m[f] !== null, `record has ${f}`);
  }
  assert.ok(log.some((m) => m.to === 'VERIFIED' && m.evidence.length === 1), 'the VERIFIED move names its evidence');
  assert.ok(!log.some((m) => m.to === 'DONE'));
  v.close();
});

test('a release returns a task to READY through the table, a lost lease blocks it, and a restart rebuilds all of it from the log', async () => {
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', { project: 'p', tasks: [{ id: 'T1', title: 'one' }, { id: 'T2', title: 'two' }] });
  const l1 = (await call(v, 'memev_task_claim', { project: 'p', task: 'T1', ttl_s: 60 })).data.lease.id;
  assert.equal((await call(v, 'memev_task_release', { project: 'p', lease: l1, reason: 'switching' })).data.ok, true);
  assert.equal((await call(v, 'memev_project_status', { project: 'p' })).data.tasks.T1.state, 'READY');
  const l2 = (await call(v, 'memev_task_claim', { project: 'p', task: 'T2', ttl_s: 0.05 })).data.lease.id;
  assert.ok(l2);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
  await call(v, 'memev_task_claim', { project: 'p', task: 'T1', ttl_s: 60 });   // a claim sweeps lapsed leases first
  assert.equal((await call(v, 'memev_project_status', { project: 'p' })).data.tasks.T2.state, 'BLOCKED');
  assert.equal((await call(v, 'memev_project_status', { project: 'p' })).data.status, 'NEEDS_ATTENTION');
  for (const m of moves(root, 'p')) assert.ok(TRANSITIONS[m.from].includes(m.to), `${m.from} -> ${m.to}`);
  const before = (await call(v, 'memev_project_status', { project: 'p' })).data;
  v.close();
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  const after = (await call(v2, 'memev_project_status', { project: 'p' })).data;
  assert.deepEqual(after.tasks, before.tasks);
  assert.equal(after.status, before.status);
  v2.close();
});

test('the daemon serves the task tools: a claim over HTTP is stored in the one project store and shows in the next session card', async () => {
  const { root, v } = newVault();
  const server = createServer(v, { tunnelKey: () => 'k'.repeat(32) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const token = v.tokens.issue({ agent: 'local' }).token;
    const rpc = async (name, args) => (await (await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
    assert.notEqual((await rpc('memev_task_plan', { project: 'web', tasks: [{ id: 'X', title: 'x' }] })).isError, true);
    const c = await rpc('memev_task_claim', { project: 'web', task: 'X', ttl_s: 60 });
    assert.equal(c.structuredContent.ok, true);
    assert.ok(fs.existsSync(path.join(root, '.memev', 'projects', 'web', 'events.jsonl')));
    assert.equal(v.projectStore('web').snapshot('task').X.status, 'IN_PROGRESS');
    const start = await rpc('memev_session_start', { project: 'web', task: 'continue' });
    assert.equal(start.structuredContent.project_tasks.status, 'ACTIVE');
    assert.equal(start.structuredContent.project_tasks.counts.IN_PROGRESS, 1);
    assert.match(start.content[0].text, /IN_PROGRESS/);
  } finally { server.close(); v.close(); }
});

// ---- SO-1.01 requirements 3 and 5: nothing mutates authoritative state except through the coordinator, and the
// adversarial cases (duplicate delivery, stale generation, expired lease, concurrent claim) hold on the wired path.
const srcFiles = () => { const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mjs') ? [path.join(d, e.name)] : [])); return ['src', 'bin'].flatMap((d) => walk(path.join(PKG, d))); };
const rel = (f) => path.relative(PKG, f).split(path.sep).join('/');

test('SO-1.01 req 3: only the coordinator writes the project store, and the tools reach it only through the vault', () => {
  const touching = srcFiles().filter((f) => /ProjectStore|projectStore\(|\bcoordinator\(|new Coordinator/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(touching, ['src/engine/coordinator.mjs', 'src/engine/project-store.mjs', 'src/engine/vault.mjs'], 'a module other than the vault, the coordinator and the store reaches the store');
  const mcp = fs.readFileSync(path.join(PKG, 'src/server/mcp.mjs'), 'utf8');
  assert.doesNotMatch(mcp, /projectStore|coordinator\(|project-store|project-state/, 'the MCP layer goes through the vault task methods');
  const vault = fs.readFileSync(path.join(PKG, 'src/engine/vault.mjs'), 'utf8');
  assert.doesNotMatch(vault, /projectStore\([^)]*\)\.(append|put|withWrite)\(/, 'the vault does not write the store itself');
});

test('SO-1.01 req 5: duplicate delivery, a stale generation and an expired lease are refused or stored as attempts, never applied', async () => {
  const { root, v } = newVault();
  const plan = { project: 'adv', tasks: [{ id: 'T', title: 'one', artifacts: ['a.js'] }] };
  await call(v, 'memev_task_plan', plan);
  const n0 = eventsOf(root, 'adv').length;
  await call(v, 'memev_task_plan', plan);
  assert.equal(eventsOf(root, 'adv').length, n0, 'a duplicate plan appends nothing');

  const first = (await call(v, 'memev_task_claim', { project: 'adv', task: 'T', ttl_s: 60 })).data.lease.id;
  assert.equal((await call(v, 'memev_task_claim', { project: 'adv', task: 'T', ttl_s: 60 })).data.ok, false, 'a second claim of a held task loses');
  await call(v, 'memev_task_release', { project: 'adv', lease: first });
  const second = (await call(v, 'memev_task_claim', { project: 'adv', task: 'T', ttl_s: 60 })).data.lease.id;
  const stale = await call(v, 'memev_task_report', { project: 'adv', lease: first, output: 'late work' });
  assert.equal(stale.data.ok, false);
  assert.ok(stale.data.stale || stale.data.late, 'a report under a released lease is stale or late');
  const st = (await call(v, 'memev_project_status', { project: 'adv' })).data;
  assert.equal(st.tasks.T.state, 'IN_PROGRESS', 'the stale report changed no state');
  assert.ok(Object.values(v.projectStore('adv').snapshot('attempt')).some((a) => a.lease_id === first && ['stale', 'late'].includes(a.status)), 'its output is kept as an attempt');

  const done = await call(v, 'memev_task_report', { project: 'adv', lease: second, output: 'ok', artifacts: ['a.js'] });
  assert.equal(done.data.ok, true);
  const dup = await call(v, 'memev_task_report', { project: 'adv', lease: second, output: 'ok again' });
  assert.equal(dup.data.ok, false, 'the same report delivered twice is not applied twice');
  assert.equal((await call(v, 'memev_project_status', { project: 'adv' })).data.tasks.T.state, 'VERIFYING');
  v.close();
});

test('SO-1.01 req 5: two processes claiming one task through the project store directory have exactly one winner', async () => {
  const { root, v } = newVault();
  await call(v, 'memev_task_plan', { project: 'race', tasks: [{ id: 'R', title: 'contended' }] });
  const { spawn } = await import('node:child_process');
  const script = `import { ProjectStore } from ${JSON.stringify(path.join(PKG, 'src/engine/project-store.mjs'))};
import { Coordinator } from ${JSON.stringify(path.join(PKG, 'src/engine/coordinator.mjs'))};
const c = new Coordinator(new ProjectStore(${JSON.stringify(root)}, { id: 'race', fsync: false }).open(), { lifecycle: true });
const r = c.claim('R', process.argv[1], 60000);
console.log(JSON.stringify({ ok: r.ok === true }));`;
  const run = (who) => new Promise((res) => { let out = ''; const p = spawn(process.execPath, ['--input-type=module', '-e', script, who], { stdio: ['ignore', 'pipe', 'inherit'] }); p.stdout.on('data', (d) => { out += d; }); p.on('close', () => res(JSON.parse(out.trim().split('\n').pop()))); });
  const results = await Promise.all([run('p1'), run('p2')]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  v.close();
});
