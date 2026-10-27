// The opt-in anonymous milestone report: off by default, asked once, and only names, days and a random id when on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { MILESTONES, buildReport, recordMilestones } from '../src/engine/milestones.mjs';
import { reportSettings, reportFile, reportPayload, sendReport, askReportOnce, setReport, reportEndpoint } from '../src/cli/onboarding.mjs';
after(cleanup);

const BIN = path.join(PKG, 'bin', 'memev.mjs');
const ID = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };

function collector() {
  const seen = []; let connections = 0;
  const server = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body: b }); res.end('{}'); }); });
  server.on('connection', () => { connections++; });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, connections: () => connections, url: `http://127.0.0.1:${server.address().port}/r`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) })));
}
const cli = (args, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, MEMEV_NO_SERVICE: '1', MEMEV_NO_TUNNEL: '1', MEMEV_NO_BACKGROUND: '1', ...env } });
  let out = '', err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});
const quiet = new Writable({ write(_c, _e, cb) { cb(); } });
const answers = (text) => Object.assign(Readable.from([text]), { isTTY: false });

test('MEM-074 AC01: a fresh install sends nothing and the setting is off', async () => {
  const srv = await collector();
  const sb = sandbox();
  try {
    const env = { ...sb.env, MEMEV_REPORT_URL: srv.url };
    // a fresh configuration: off, never asked, no id, no file
    assert.deepEqual(reportSettings(env), { enabled: false, asked: false, id: null, sent: {} });
    assert.equal(fs.existsSync(reportFile(env)), false);
    // install and set up with an address available to it: nothing is sent
    const init = await cli(['init', '--no-connect', '--local-only'], env);
    assert.equal(init.code, 0, init.out + init.err);
    assert.match(init.out, /Anonymous milestone report: off, as it is for everyone until they choose/);
    for (const args of [['onboarding'], ['onboarding', '--milestones'], ['report'], ['report', 'status'], ['report', 'show']]) assert.equal((await cli(args, env)).code, 0, args.join(' '));
    const status = JSON.parse((await cli(['report', 'status', '--json'], env)).out);
    assert.deepEqual(status, { enabled: false, asked: false, address_set: true });
    // sending while it is off is refused and sends nothing
    const send = await cli(['report', 'send'], env);
    assert.equal(send.code, 1); assert.match(send.out, /report is off, so nothing was sent/);
    await cli(['stop'], env);
    assert.equal(srv.seen.length, 0, 'no request');
    assert.equal(srv.connections(), 0, 'not even a connection');
    assert.equal(reportSettings(env).enabled, false);
    assert.equal(fs.existsSync(reportFile(env)), false, 'nothing was written either');
    // in process: off means the sender never reaches for the network
    let called = 0; const calls = () => { called++; throw new Error('network'); };
    assert.equal((await sendReport({ root: sb.root, env, fetchImpl: calls })).sent, false);
    assert.equal(reportPayload({ root: sb.root, env }), null);
    assert.equal(called, 0);
    // asked once: on a terminal, a no (or just Enter) keeps it off, and the question never returns
    const out = { write() {} };
    assert.equal(await askReportOnce({ env, ask: true, input: answers('n\n'), output: out }), false);
    assert.equal(reportSettings(env).enabled, false); assert.equal(reportSettings(env).asked, true);
    assert.equal(await askReportOnce({ env, ask: true, input: answers('y\n'), output: out }), null, 'not asked again');
    assert.equal(reportSettings(env).enabled, false);
    const env2 = { ...env, MEMEV_CONFIG_DIR: tmpdir('rep-conf-') };
    assert.equal(await askReportOnce({ env: env2, ask: true, input: answers('\n'), output: out }), false, 'Enter is no');
    // with no terminal it is not asked at all
    const env3 = { MEMEV_CONFIG_DIR: tmpdir('rep-conf-') };
    assert.equal(await askReportOnce({ env: env3, input: answers('y\n'), output: out }), null);
    assert.equal(reportSettings(env3).asked, false); assert.equal(fs.existsSync(reportFile(env3)), false);
  } finally { sb.stop(); await srv.close(); }
});

test('MEM-074 AC02: with the setting on, the payload holds only milestone names, dates and a random id (no paths, names or content)', async () => {
  const { v, root } = newVault();
  const secretText = 'Quarterly invoice 4471 for Zelda Fitzgerald goes through the Orchid Lane account';
  v.remember(ID, { text: secretText, kind: 'fact', client: 'app-alpha' });
  v.recall(ID, { query: 'invoice Zelda Orchid Lane', client: 'app-beta' });
  const host = v.devices.get(v.host.id);
  const ctx = (client) => ({ identity: { scopes: ['read', 'write'], paths: ['**'] }, client, device: host, local: true });
  for (const c of ['codex', 'cursor', 'claude-code']) { v.bus.register({ client: c, device: host }); v.bus.pulse(ctx(c)); }
  await v.bus.check(ctx('codex'), { timeout_s: 0 }); v.bus.unread(ctx('cursor')); v.bus.unread(ctx('claude-code'));
  v.bus.send(ctx('cursor'), { to: 'all', type: 'status', body: 'working on the Orchid Lane invoices' });
  const conf = tmpdir('rep-conf-'); const srv = await collector();
  const env = { MEMEV_CONFIG_DIR: conf, MEMEV_ROOT: root, HOME: tmpdir('rep-home-'), MEMEV_REPORT_URL: srv.url };
  try {
    assert.equal((await cli(['report', 'on'], env)).code, 0);
    const show = await cli(['report', 'show'], env);
    assert.equal(show.code, 0); assert.match(show.out, /exactly what is sent/);
    assert.equal(srv.seen.length, 0, 'show sends nothing');
    const sent = await cli(['report', 'send'], env);
    assert.equal(sent.code, 0, sent.out + sent.err); assert.match(sent.out, /sent \d+ milestone/);
    assert.equal(srv.seen.length, 1);
    const req = srv.seen[0];
    assert.equal(req.method, 'POST');
    for (const h of ['authorization', 'cookie']) assert.equal(req.headers[h], undefined, h);
    const body = JSON.parse(req.body);
    assert.deepEqual(Object.keys(body).sort(), ['id', 'milestones', 'v']);
    assert.equal(body.v, 1);
    assert.match(body.id, /^[0-9a-f]{32}$/, 'a random id');
    const names = body.milestones.map((m) => m.name);
    for (const m of body.milestones) { assert.deepEqual(Object.keys(m).sort(), ['date', 'name']); assert.ok(MILESTONES.includes(m.name), m.name); assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/); }
    for (const n of ['installed', 'second_app_joined', 'first_cross_app_recall', 'two_apps_one_memory', 'first_bus_message', 'comms_activation']) assert.ok(names.includes(n), `${n} is reported`);
    // nothing about this machine, the vault or its content is in the request, body or headers
    const everything = `${req.url}\n${JSON.stringify(req.headers)}\n${req.body}`;
    const secrets = [root, conf, env.HOME, os.hostname(), os.userInfo().username, secretText, 'Zelda', 'Orchid', '4471', 'app-alpha', 'app-beta', 'codex', 'cursor', 'claude', 'memory/', 'bus/', '.memev', 'hash'];
    for (const x of secrets) assert.equal(everything.includes(x), false, `leaks ${x}`);
    // the id is the one in the settings, only milestones not yet reported are sent again, and a new yes is a new id
    assert.equal(reportSettings(env).id, body.id);
    const again = await cli(['report', 'send'], env); assert.equal(again.code, 0); assert.match(again.out, /already reported/);
    assert.equal(srv.seen.length, 1);
    await cli(['report', 'off'], env); assert.equal(reportSettings(env).id, null);
    await cli(['report', 'on'], env); await cli(['report', 'send'], env);
    assert.equal(srv.seen.length, 2); assert.notEqual(JSON.parse(srv.seen[1].body).id, body.id);
  } finally { await srv.close(); v.close(); }
});

test('MEM-074: no address means nothing is sent, a refusing address is not recorded as sent, and the address must be https', async () => {
  const { v, root } = newVault(); v.close();
  const env = { MEMEV_CONFIG_DIR: tmpdir('rep-conf-') };
  setReport(env, true);
  recordMilestones({ root });
  assert.deepEqual(await sendReport({ root, env, fetchImpl: () => { throw new Error('network'); } }), { sent: false, reason: 'no report address is set, so nothing is sent' });
  assert.throws(() => reportEndpoint({ MEMEV_REPORT_URL: 'http://reports.example.invalid/x' }), /must be https/);
  assert.equal(reportEndpoint({}), null);
  const refuse = await sendReport({ root, env: { ...env, MEMEV_REPORT_URL: 'https://reports.example.invalid/x' }, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(refuse.sent, false); assert.deepEqual(reportSettings(env).sent, {});
  const ok = await sendReport({ root, env: { ...env, MEMEV_REPORT_URL: 'https://reports.example.invalid/x' }, fetchImpl: async () => ({ ok: true, status: 200 }) });
  assert.equal(ok.sent, true); assert.deepEqual(Object.keys(reportSettings(env).sent), ['installed']);
  assert.deepEqual(buildReport({ id: 'x', milestones: { installed: { at: '2026-11-01T10:00:00.000Z' }, bogus: { at: '2026-11-01' } } }), { v: 1, id: 'x', milestones: [{ name: 'installed', date: '2026-11-01' }] });
});
