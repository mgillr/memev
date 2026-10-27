// memev init and connect set the comms bus up with no manual step: bus/ is in the vault and
// committed, every app found gets a seat, and the lead is always the person's choice.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { createServer } from '../src/server/http.mjs';
import { deviceKeyFile, join } from '../src/cli/remote.mjs';
import { writePrivate } from '../src/engine/util.mjs';
import crypto from 'node:crypto';
import { signLicense, loadLicense } from '../src/engine/license.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { askLead, leadChoices, runningApp, setupBus } from '../src/cli/bus-cli.mjs';
after(cleanup);

const gitOut = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const roster = (sb) => JSON.parse(sb.run(['bus', 'roster', '--json']).out);
const fakeClaude = (home) => { fs.mkdirSync(path.join(home, '.claude'), { recursive: true }); fs.writeFileSync(path.join(home, '.claude.json'), '{}\n'); };

test('init --help prints help and creates nothing', () => {
  const sb = sandbox();
  const r = sb.run(['init', '--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /memev init \[--root DIR\].*--lead SEAT/);
  assert.equal(fs.existsSync(sb.root), false, 'no vault was made');
  assert.equal(sb.run(['bus', '--help']).code, 0);
});

test('a fresh init in an empty home creates bus/ and commits it; no lead is set and that needs the user', () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(init.code, 0, init.err + init.out);
    assert.match(init.out, /✓ Agent comms bus: bus\/ set up and committed in the vault; no AI apps yet/);
    assert.match(init.out, /→ Lead AI: no lead AI chosen yet: pick the AI that leads and coordinates the others with memev bus operator <seat>/);
    const files = gitOut(sb.root, ['ls-files', 'bus']).split('\n');
    assert.ok(files.includes('bus/config.json') && files.includes('bus/operator.json'), files.join(','));
    const device = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'device.json'), 'utf8')).id;
    assert.ok(files.includes(`bus/log/${device}.jsonl`), 'one message file for this computer');
    assert.equal(gitOut(sb.root, ['status', '--porcelain', '--', 'bus']), '', 'nothing left uncommitted');
    assert.ok(Number(gitOut(sb.root, ['rev-list', '--count', 'HEAD'])) >= 2, 'more than the first commit');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sb.root, 'bus', 'operator.json'), 'utf8')).seat, null);
    const doc = sb.run(['doctor']);
    assert.equal(doc.code, 0, doc.out);
    assert.match(doc.out, /✓ comms bus folder in the vault/);
    assert.match(doc.out, /! lead AI chosen: needs you/);
    // doctor fails when bus/ goes missing, and --fix puts it back
    fs.rmSync(path.join(sb.root, 'bus'), { recursive: true, force: true });
    const bad = sb.run(['doctor']);
    assert.equal(bad.code, 1); assert.match(bad.out, /✗ comms bus folder in the vault: bus\/ is missing/);
    assert.equal(sb.run(['doctor', '--fix']).code, 0);
    assert.ok(fs.existsSync(path.join(sb.root, 'bus', 'config.json')));
  } finally { sb.stop(); }
});

test('connect with a fake Claude Code seats it at once; the roster and the check list it; no app makes itself lead', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only']).code, 0);
    fakeClaude(sb.home);
    const c = sb.run(['connect']);
    assert.equal(c.code, 0, c.out + c.err);
    assert.match(c.out, /Claude Code: connected/);
    assert.match(c.out, /on the comms bus: claude-code@host/);
    assert.match(c.out, /no lead AI chosen yet/);
    assert.ok(gitOut(sb.root, ['ls-files', 'bus/seats']).includes('bus/seats/claude-code~host.json'), 'the seat is committed');
    let r = roster(sb);
    assert.equal(r.operator, null, 'the only app is not promoted to lead');
    assert.match(r.lead_needed, /Ask the user which AI should lead/);
    assert.equal(r.seats.find((s) => s.seat === 'claude-code@host')?.state, 'never joined');
    assert.match(sb.run(['bus', 'roster']).out, /claude-code@host\s+never joined/);
    const check = JSON.parse(sb.run(['bus', 'check', '--timeout', '0', '--json']).out);
    assert.deepEqual(check.missing.map((m) => [m.seat, m.state]), [['claude-code@host', 'never joined']]);
    // a second app connected later alone is not promoted either
    fs.mkdirSync(path.join(sb.home, '.cursor'), { recursive: true });
    assert.match(sb.run(['connect', 'cursor']).out, /on the comms bus: cursor@host/);
    assert.equal(roster(sb).operator, null);
    // the doctor fails while a connected app has no seat
    fs.rmSync(path.join(sb.root, 'bus', 'seats', 'cursor~host.json'));
    const bad = sb.run(['doctor']);
    assert.equal(bad.code, 1); assert.match(bad.out, /✗ every connected app has a bus seat: no seat for cursor/);
    assert.equal(sb.run(['doctor', '--fix']).code, 0);
    assert.ok(fs.existsSync(path.join(sb.root, 'bus', 'seats', 'cursor~host.json')));
    // the person picks the lead with --lead (or MEMEV_LEAD) on connect, or memev bus operator
    assert.match(sb.run(['connect', 'claude-code'], { extraEnv: { MEMEV_LEAD: 'claude-code' } }).out, /claude-code@host leads the others/);
    r = roster(sb);
    assert.equal(r.operator, 'claude-code@host'); assert.equal(r.lead_needed, undefined);
    assert.equal(r.seats.find((s) => s.seat === 'claude-code@host').operator, true);
    assert.match(sb.run(['bus', 'roster']).out, /claude-code@host\s+never joined.*LEAD/);
    assert.match(sb.run(['doctor']).out, /✓ lead AI chosen: claude-code@host/);
  } finally { sb.stop(); }
});

test('non-interactive init: --lead and MEMEV_LEAD pick the lead; an unknown one is reported, not guessed', () => {
  for (const [args, extraEnv, lead] of [[['--lead', 'claude-code@host'], {}, 'claude-code@host'], [[], { MEMEV_LEAD: 'cursor' }, 'cursor@host'], [['--lead', 'nobody@host'], {}, null]]) {
    const sb = sandbox();
    try {
      fakeClaude(sb.home); fs.mkdirSync(path.join(sb.home, '.cursor'), { recursive: true });
      const init = sb.run(['init', '--port', String(sb.port), '--local-only', ...args], { extraEnv });
      assert.equal(init.code, 0, init.out + init.err);
      assert.equal(roster(sb).operator, lead);
      if (!lead) assert.match(init.out, /→ Lead AI: --lead nobody@host: no seat nobody@host/);
    } finally { sb.stop(); }
  }
});

test('on a terminal init asks which AI should lead, with the app running the setup first', async () => {
  assert.equal(runningApp({ CLAUDECODE: '1' }), 'claude-code');
  assert.equal(runningApp({ CURSOR_TRACE_ID: 'x' }), 'cursor');
  assert.equal(runningApp({}), null);
  const seats = ['claude-code@host', 'cursor@host'];
  assert.deepEqual(leadChoices(seats, { CURSOR_TRACE_ID: 'x' }).map((c) => c.label), ['cursor@host (running this setup)', 'claude-code@host', 'decide later']);
  const ask = async (answer, env = {}) => { const input = new PassThrough(); const output = new PassThrough(); let shown = ''; output.on('data', (d) => { shown += d; }); input.end(`${answer}\n`); const seat = await askLead({ seats, env, input, output }); return { seat, shown }; };
  const a = await ask('1', { CURSOR_TRACE_ID: 'x' });
  assert.equal(a.seat, 'cursor@host');
  assert.match(a.shown, /Which AI should lead and coordinate the others\?\n {2}1\) cursor@host \(running this setup\)\n {2}2\) claude-code@host\n {2}3\) decide later/);
  assert.equal((await ask('3')).seat, null, 'decide later');
  assert.equal((await ask('claude-code')).seat, 'claude-code@host');
  // the same question through init's own path, against a running vault
  const sb = sandbox();
  try {
    fakeClaude(sb.home);
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only']).code, 0);
    const input = new PassThrough(); input.end('1\n');
    const r = await setupBus({ root: sb.root, env: { CLAUDECODE: '1' }, clients: ['claude-code'], ask: true, input, output: new PassThrough() });
    assert.equal(r.ok, true, r.problems.join(';'));
    assert.equal(r.operator, 'claude-code@host');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sb.root, 'bus', 'operator.json'), 'utf8')).by, 'the user (asked at setup)');
  } finally { sb.stop(); }
});

test('over MCP: with no lead the tools and the session hook say to ask the user; only the user\'s answer sets it, once', async () => {
  const sb = sandbox();
  try {
    fakeClaude(sb.home); fs.mkdirSync(path.join(sb.home, '.cursor'), { recursive: true });
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only']).code, 0);
    const h = sb.hook('session-start', { session_id: 'lead-1', cwd: sb.home });
    assert.match(JSON.parse(h.out).hookSpecificOutput.additionalContext, /No lead AI is set for this vault. Ask the user/);
    const c = mcpClient(sb, 'cursor');
    try {
      const init = await c.request('initialize', { protocolVersion: '2025-06-18' });
      assert.match(init.result.instructions, /If no lead is set, ask the user which AI should lead/);
      const u = (await c.tool('bus_unread', {})).structuredContent;
      assert.match(u.lead_needed, /bus_set_operator/);
      const refused = async (args, re) => { const r = await c.tool('bus_set_operator', args); assert.equal(r.isError, true); assert.match(r.content[0].text, re); };
      await refused({ seat: 'cursor@host' }, /ask the user/);
      await refused({ seat: 'cursor@host', user_answer: 'you decide' }, /does not name cursor@host/);
      const ok = (await c.tool('bus_set_operator', { seat: 'claude-code@host', user_answer: 'Claude Code should lead' })).structuredContent;
      assert.equal(ok.operator, 'claude-code@host');
      await refused({ seat: 'cursor@host', user_answer: 'cursor' }, /already leads; only the person can change it/);
    } finally { await c.close(); }
    const op = JSON.parse(fs.readFileSync(path.join(sb.root, 'bus', 'operator.json'), 'utf8'));
    assert.equal(op.seat, 'claude-code@host'); assert.equal(op.by, 'cursor@host'); assert.equal(op.user_answer, 'Claude Code should lead');
    assert.match(sb.run(['bus', 'tail']).out, /claude-code@host now leads and speaks for the user \(the user chose it/);
  } finally { sb.stop(); }
});

test('memev join seats the joining computer\'s apps on the vault\'s bus', async () => {
  const { v } = newVault();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); const keys = { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);
  const conf = { MEMEV_CONFIG_DIR: tmpdir('join-conf-') };
  fs.writeFileSync(path.join(conf.MEMEV_CONFIG_DIR, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_join0001', tier: 'team', services: ['sync'], seats: 3, iat: day(-1), exp: day(300), grace_days: 14 }, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'test-vendor')));
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: keys, env: conf });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const home = tmpdir('join-home-'); fakeClaude(home);
    const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), PATH: process.env.PATH };
    const k = deviceKeygen(); fs.mkdirSync(path.dirname(deviceKeyFile(env)), { recursive: true }); writePrivate(deviceKeyFile(env), k.privateKeyPem);
    const enrolled = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: k.publicKey, policy: seatPolicy({ license: loadLicense({ env: conf, keys }), devices: v.devices.list() }) });
    const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' '));
    let code; try { code = await join([`http://127.0.0.1:${server.address().port}`], { token: enrolled.token }, { env }); } finally { console.log = log; }
    assert.equal(code, 0, lines.join('\n'));
    assert.match(lines.join('\n'), /on the comms bus: claude-code@laptop/);
    const seat = v.bus.roster().seats.find((s) => s.seat === 'claude-code@laptop');
    assert.equal(seat?.state, 'never joined'); assert.equal(seat.device, enrolled.device.id);
    assert.equal(v.bus.operator(), null, 'a joining computer never becomes the lead by itself');
  } finally { server.close(); v.close(); }
});
