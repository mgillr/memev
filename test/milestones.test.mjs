// Activation milestones: worked out locally from the vault's own files and kept in onboarding.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { newVault, cleanup, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { deriveMilestones, recordMilestones, loadMilestones, MILESTONES } from '../src/engine/milestones.mjs';
after(cleanup);

const ID = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };
const H = 3600e3;
const at = (base, h) => new Date(Date.parse(base) + h * H).toISOString();
const T0 = '2026-11-01T09:00:00.000Z';
const rec = (seq, hours, fields) => ({ seq, ts: at(T0, hours), path: null, agent: 'x', data: null, ...fields });
const put = (seq, hours, client, p = 'memory/a.md') => rec(seq, hours, { type: 'put', path: p, client, data: { content: 'x' } });
const use = (seq, hours, client, p = 'memory/a.md') => rec(seq, hours, { type: 'usage', client, data: { items: [`${p}#Heading`] } });

test('MEM-073 AC01: a memory saved by one client id and recalled by another within 24 hours records two apps, one memory', () => {
  // through a real vault: one app saves, another recalls, the milestone lands in onboarding.json
  const { v, root } = newVault();
  v.remember(ID, { text: 'The deploy key rotates on the first of the month', kind: 'fact', client: 'app-a' });
  const same = v.recall(ID, { query: 'when does the deploy key rotate', client: 'app-a' });
  assert.ok(same.length, 'the memory is recalled');
  let m = recordMilestones({ root });
  assert.equal(m.two_apps_one_memory, undefined, 'the same app recalling its own memory is not two apps');
  assert.equal(m.first_cross_app_recall, undefined);
  const other = v.recall(ID, { query: 'when does the deploy key rotate', client: 'app-b' });
  assert.ok(other.length);
  m = recordMilestones({ root });
  assert.ok(m.two_apps_one_memory?.at, 'recorded');
  assert.ok(m.first_cross_app_recall?.at);
  assert.ok(m.second_app_joined?.at, 'a second app has used the vault');
  assert.ok(m.installed?.at);
  const stored = JSON.parse(fs.readFileSync(path.join(root, '.memev', 'onboarding.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.milestones).sort(), Object.keys(m).sort());
  assert.deepEqual(loadMilestones(root), m);
  // a recorded milestone keeps its first date
  const first = m.two_apps_one_memory.at;
  v.recall(ID, { query: 'when does the deploy key rotate', client: 'app-c' });
  assert.equal(recordMilestones({ root }).two_apps_one_memory.at, first);
  v.close();

  // the 24 hour rule, on records with known times
  const inside = deriveMilestones({ records: [put(1, 0, 'app-a'), use(2, 23.9, 'app-b')] });
  assert.equal(inside.two_apps_one_memory.at, at(T0, 23.9));
  const late = deriveMilestones({ records: [put(1, 0, 'app-a'), use(2, 24.5, 'app-b')] });
  assert.equal(late.two_apps_one_memory, undefined, 'recalled after 24 hours');
  assert.equal(late.first_cross_app_recall.at, at(T0, 24.5), 'still the first cross-app recall');
  // a later save by the recalling app, or by the terminal, is not another app's memory
  assert.equal(deriveMilestones({ records: [put(1, 0, 'app-a'), put(2, 1, 'app-b'), use(3, 2, 'app-b')] }).two_apps_one_memory, undefined);
  assert.equal(deriveMilestones({ records: [put(1, 0, 'cli'), use(2, 1, 'app-b')] }).two_apps_one_memory, undefined);
  assert.equal(deriveMilestones({ records: [put(1, 0, 'app-a'), use(2, 1, 'app-b', 'memory/other.md')] }).two_apps_one_memory, undefined, 'another memory');
});

test('MEM-073 AC02: a comms check with two seats answering records comms activation', async () => {
  const { v, root } = newVault();
  try {
    const host = v.devices.get(v.host.id);
    const ctx = (client) => ({ identity: { scopes: ['read', 'write'], paths: ['**'] }, client, device: host, local: true });
    for (const c of ['codex', 'cursor', 'claude-code']) { v.bus.register({ client: c, device: host }); v.bus.pulse(ctx(c)); }
    // a check that only one seat answers is not yet comms activation
    const one = await v.bus.check(ctx('codex'), { timeout_s: 0 });
    v.bus.unread(ctx('cursor'));
    let m = recordMilestones({ root });
    assert.equal(m.comms_activation, undefined, 'one answer is not enough');
    assert.ok(m.first_bus_message === undefined, 'a check and hello are not a message');
    // a check that two seats answer
    const two = await v.bus.check(ctx('codex'), { timeout_s: 0 });
    v.bus.unread(ctx('cursor')); v.bus.unread(ctx('claude-code'));
    m = recordMilestones({ root });
    assert.ok(m.comms_activation?.at, 'recorded');
    assert.notEqual(one.check, two.check);
    assert.ok(Date.parse(m.comms_activation.at) >= Date.parse(v.bus.all().find((x) => x.id === two.check).ts));
    // the first real message
    v.bus.send(ctx('cursor'), { to: 'all', type: 'status', body: 'hello team, working on the parser' });
    m = recordMilestones({ root });
    assert.ok(m.first_bus_message?.at);
  } finally { v.close(); }
  // on records with known times: the checker's own ack does not count, and two seats are needed
  const check = { id: 'd-1', ts: at(T0, 0), from: 'codex@host', type: 'status', check: true };
  const ack = (seat, h) => ({ id: `d-${h}`, ts: at(T0, h), from: seat, type: 'ack', ref: 'd-1' });
  assert.equal(deriveMilestones({ messages: [check, ack('a@host', 1)] }).comms_activation, undefined);
  assert.equal(deriveMilestones({ messages: [check, ack('a@host', 1), ack('a@host', 2)] }).comms_activation, undefined, 'one seat twice');
  assert.equal(deriveMilestones({ messages: [check, ack('codex@host', 1), ack('a@host', 2)] }).comms_activation, undefined, 'the checker itself');
  assert.equal(deriveMilestones({ messages: [check, ack('a@host', 1), ack('b@host', 3)] }).comms_activation.at, at(T0, 3), 'dated when the second seat answered');
});

test('MEM-073 AC03: no milestone code makes a network call', async () => {
  // the code: no module that can reach a network or start a program
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'milestones.mjs'), 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(imports.sort(), ['./oplog.mjs', './util.mjs', 'node:fs', 'node:path']);
  assert.equal(/\b(fetch|XMLHttpRequest|WebSocket|dgram|child_process|require)\b/.test(src), false);
  // the behaviour: with every way out of the process stubbed, computing and recording touch none of them
  const { v, root } = newVault();
  v.remember(ID, { text: 'A memory for the network test', kind: 'fact', client: 'app-a' });
  v.recall(ID, { query: 'memory for the network test', client: 'app-b' });
  v.close();
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memev', 'invites.json'), JSON.stringify({ version: 1, invites: { i1: { id: 'i1', hash: 'h', expires: 'x', address: 'a', used: false } } }));
  const calls = []; const keep = { fetch: globalThis.fetch, connect: net.Socket.prototype.connect, hreq: http.request, sreq: https.request };
  globalThis.fetch = () => { calls.push('fetch'); throw new Error('network'); };
  net.Socket.prototype.connect = function () { calls.push('connect'); throw new Error('network'); };
  http.request = () => { calls.push('http'); throw new Error('network'); };
  https.request = () => { calls.push('https'); throw new Error('network'); };
  try { const m = recordMilestones({ root }); assert.equal(m.invite_sent !== undefined, true); assert.ok(m.two_apps_one_memory); }
  finally { globalThis.fetch = keep.fetch; net.Socket.prototype.connect = keep.connect; http.request = keep.hreq; https.request = keep.sreq; }
  assert.deepEqual(calls, []);
});

test('MEM-073: the checklist keeps the milestones, memev onboarding --milestones lists them, a fresh vault has only installed', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--no-connect', '--local-only']).code, 0);
    const r = sb.run(['onboarding', '--milestones', '--json']);
    assert.equal(r.code, 0, r.err);
    const m = JSON.parse(r.out);
    assert.deepEqual(Object.keys(m), ['installed']);
    const f = path.join(sb.root, '.memev', 'onboarding.json');
    const mine = { ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    assert.ok(mine.milestones.installed.at);
    // the checklist rewrites the file, and the milestones stay
    sb.run(['onboarding']);
    assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).milestones.installed.at, mine.milestones.installed.at);
    assert.ok(Array.isArray(JSON.parse(fs.readFileSync(f, 'utf8')).items));
    const text = sb.run(['onboarding', '--milestones']).out;
    for (const n of MILESTONES) assert.match(text, new RegExp(n.replace(/_/g, ' ')));
  } finally { sb.stop(); }
});

test('MEM-073: an invite and a second joined app are milestones too', () => {
  const m = deriveMilestones({
    seats: [{ seat: 'a@host', client: 'claude-code', created: at(T0, 0), joined: at(T0, 0.5) }, { seat: 'b@host', client: 'cursor', created: at(T0, 0), joined: at(T0, 2) }, { seat: 'c@laptop', client: 'cursor', created: at(T0, 1), joined: at(T0, 3) }],
    invites: [{ id: 'i' }], seen: at(T0, 5),
  });
  assert.equal(m.second_app_joined.at, at(T0, 2), 'two seats of one app are one app');
  assert.equal(m.invite_sent.at, at(T0, 5));
  assert.equal(deriveMilestones({ seats: [{ seat: 'a@host', client: 'cursor', joined: at(T0, 1) }, { seat: 'b@laptop', client: 'cursor', joined: at(T0, 2) }] }).second_app_joined, undefined);
});
