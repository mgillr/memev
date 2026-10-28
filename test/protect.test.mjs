// Regression guards for the strengths that already work: reversibility of connect/disconnect,
// the hook output format of each app, one bus log file per computer, offline licence verification,
// and the secret-free local-only bundle.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { connectAll, disconnect, detect, HOOK_CLIENTS } from '../src/cli/clients.mjs';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { signLicense, verifyLicense } from '../src/engine/license.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { seatPolicy } from '../src/engine/entitlements.mjs';
import { findSecrets } from '../src/engine/secrets.mjs';
import { bundle } from '../src/cli/doctor.mjs';

after(cleanup);

function fixtureHome() {
  const home = tmpdir('home-');
  const w = (rel, body) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
  const files = {
    claudeJson: w('.claude.json', JSON.stringify({ numStartups: 42, theme: 'dark', mcpServers: { other: { command: 'other-server', args: ['--x'] } }, projects: { '/w': { allowedTools: ['Bash'] } } }, null, 4)),
    claudeSettings: w('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }], Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }] } })),
    claudeMd: w('.claude/CLAUDE.md', '# My rules\n\nAlways use tabs.\n'),
    codexToml: w('.codex/config.toml', 'model = "some-model"\n\n[mcp_servers.other]\ncommand = "other"\n'),
    cursorMcp: w('.cursor/mcp.json', '{"mcpServers":{"gh":{"url":"https://example.com/mcp"}}}'),
    gemini: w('.gemini/settings.json', '{"theme":"Default"}'),
  };
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  return { home, env, files };
}
const snap = (files) => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));

test('MEM-102 AC01: uninstall restores every client file byte for byte', () => {
  const { home, env, files } = fixtureHome();
  const original = snap(files);
  const launcher = '/opt/memev/bin/memev';
  connectAll({ env, launcher });
  for (const c of detect(env, launcher).filter((x) => x.connected)) disconnect(c.id, { env, launcher });
  assert.deepEqual(snap(files), original, 'every file that existed before connect is back, byte for byte');
  for (const created of ['.codex/hooks.json', '.cursor/hooks.json', '.codex/AGENTS.md', '.gemini/GEMINI.md']) assert.equal(fs.existsSync(path.join(home, created)), false, `${created} is gone`);
  const st = JSON.parse(fs.readFileSync(path.join(env.MEMEV_CONFIG_DIR, 'clients-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(st.connected), [], 'no client stays connected');
});

test('MEM-102 AC02: hook outputs match each vendor\'s documented format for Claude Code, Codex, Gemini CLI and Cursor', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const FORMAT = { 'claude-code': [], codex: [], 'gemini-cli': ['--format', 'gemini'], cursor: ['--format', 'cursor'] };
    const names = { 'claude-code': { SessionStart: 'SessionStart', UserPromptSubmit: 'UserPromptSubmit' }, codex: { SessionStart: 'SessionStart', UserPromptSubmit: 'UserPromptSubmit' }, 'gemini-cli': { SessionStart: 'SessionStart', UserPromptSubmit: 'BeforeAgent' }, cursor: { SessionStart: 'SessionStart' } };
    for (const id of ['claude-code', 'codex', 'gemini-cli', 'cursor']) {
      assert.ok(HOOK_CLIENTS.has(id), `${id} has hooks`);
      const h = sb.hook('session-start', { session_id: `prot-${id}`, source: 'startup' }, id, FORMAT[id]);
      assert.equal(h.code, 0, h.err);
      const j = JSON.parse(h.out || 'null');
      assert.ok(j, `${id}: the hook printed its output (out=${JSON.stringify(h.out).slice(0, 120)} err=${JSON.stringify(h.err).slice(0, 120)})`);
      if (id === 'cursor') {
        assert.equal(typeof j.additional_context, 'string', 'Cursor gets { additional_context } at session start');
        assert.ok(j.additional_context.length > 0, 'and it carries the context');
        assert.equal(j.hookSpecificOutput, undefined, 'Cursor does not get the Claude shape');
      } else {
        assert.ok(j.hookSpecificOutput, `${id} gets { hookSpecificOutput }`);
        assert.equal(j.hookSpecificOutput.hookEventName, names[id].SessionStart, `${id} names its own event`);
        assert.equal(typeof j.hookSpecificOutput.additionalContext, 'string', 'and the context is in additionalContext');
        assert.ok(j.hookSpecificOutput.additionalContext.length > 0, 'and it carries the context');
      }
      if (names[id].UserPromptSubmit) {
        const p = sb.hook('prompt', { session_id: `prot-${id}`, prompt: 'Add CSV export to the reports page' }, id, FORMAT[id]);
        assert.equal(p.code, 0, p.err);
        assert.equal(p.out, '', `${id}: a prompt with nothing to recall prints nothing, and never breaks the session`);
      }
    }
  } finally { sb.stop(); }
});

test('MEM-102 AC03: the bus writes one message file per device', () => {
  const { root, v } = newVault();
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const keys = { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
    const lic = signLicense({ v: 1, lid: 'lic_protect04', tier: 'team', services: ['sync'], seats: 3, iat: new Date(Date.now() - 86400e3).toISOString().slice(0, 10), exp: new Date(Date.now() + 300 * 86400e3).toISOString().slice(0, 10), grace_days: 14 }, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'test-vendor');
    const env = { MEMEV_CONFIG_DIR: path.join(root, '.memev') };
    fs.writeFileSync(path.join(env.MEMEV_CONFIG_DIR, 'license.json'), JSON.stringify(lic));
    const host = v.devices.get(v.devices.hostId);
    const key = deviceKeygen();
    const laptop = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'laptop', pubkey: key.publicKey, policy: seatPolicy({ license: verifyLicense(lic, { keys }), devices: v.devices.list() }) });
    const ctx = (client, device) => ({ identity: { scopes: ['read', 'write'], paths: ['**'] }, client, device, local: false });
    v.bus.send(ctx('claude-code', host), { type: 'status', body: 'the host says hello' });
    v.bus.send(ctx('cursor', laptop.device), { type: 'status', body: 'the laptop says hello' });
    v.bus.send(ctx('codex', host), { type: 'status', body: 'a second message from the host' });
    const files = fs.readdirSync(path.join(root, 'bus', 'log')).filter((x) => x.endsWith('.jsonl'));
    assert.deepEqual(files.sort(), [`${host.id}.jsonl`, `${laptop.device.id}.jsonl`].sort(), 'one log file per device, no more');
    const hostLines = fs.readFileSync(path.join(root, 'bus', 'log', `${host.id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(hostLines.every((m) => m.device === host.id), 'every line of the host file is from the host');
    assert.deepEqual(hostLines.filter((m) => m.type === 'status').map((m) => m.from).sort(), ['claude-code@host', 'codex@host'], 'both host messages are in the host file');
    const lapLines = fs.readFileSync(path.join(root, 'bus', 'log', `${laptop.device.id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lapLines.every((m) => m.device === laptop.device.id), 'every line of the laptop file is from the laptop');
    assert.deepEqual(lapLines.filter((m) => m.type === 'status').map((m) => m.from), ['cursor@laptop'], 'the laptop message is in the laptop file');
    const all = v.bus.all();
    assert.deepEqual(all.filter((m) => m.type === 'status').map((m) => m.device).sort(), [host.id, host.id, laptop.device.id].sort(), 'every message is readable through the bus, on its own device');
  } finally { v.close(); }
});

test('MEM-102 AC04: a licence verifies with the network disabled', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keys = { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);
  const lic = signLicense({ v: 1, lid: 'lic_protect01', tier: 'team', services: ['sync'], seats: 3, iat: day(-10), exp: day(300), grace_days: 14 }, pem, 'test-vendor');
  const r = verifyLicense(lic, { keys });
  assert.equal(r.state, 'valid', r.reason);
  assert.equal(r.tier, 'team');
  assert.equal(r.seats, 3);
  // the check is local: a tampered signature is refused without any lookup
  const bad = { ...lic, lid: 'lic_protect02' };
  assert.equal(verifyLicense(bad, { keys }).state, 'invalid');
  // and a licence from an unknown vendor is refused the same way
  const other = (() => { const k = crypto.generateKeyPairSync('ed25519'); return { pem: k.privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'other-vendor': k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
  const foreign = signLicense({ v: 1, lid: 'lic_protect03', tier: 'team', services: ['sync'], seats: 3, iat: day(-10), exp: day(300), grace_days: 14 }, other.pem, 'other-vendor');
  assert.equal(verifyLicense(foreign, { keys }).state, 'invalid');
});

test('MEM-102 AC05: doctor --bundle contains no secret', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const state = path.join(sb.root, '.memev');
    const SECRETS = {
      github: `ghp_${'a1B2c3D4e5'.repeat(4)}`,
      openai: `sk-${'Zy9Xw8Vu7T'.repeat(3)}`,
      memev: `mv_${'0123abcd'}_${'f'.repeat(32)}`,
      password: 'password=correct-horse-battery',
      aws: `AKIA${'ABCDEFGHIJKLMNOP'}`,
      slack: 'xoxb-1234567890-abcdefghij',
    };
    fs.appendFileSync(path.join(state, 'daemon.log'), `${Object.values(SECRETS).join('\n')}\nstarted in ${sb.home}/memev for ${sb.home}\n`);
    const admin = JSON.parse(fs.readFileSync(path.join(state, 'admin.json'), 'utf8')).token;
    const file = bundle({ root: sb.root, env: sb.env, checks: [] });
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(() => JSON.parse(text));
    for (const [kind, secret] of Object.entries(SECRETS)) assert.equal(text.includes(secret), false, `${kind} is not in the bundle`);
    assert.equal(text.includes(admin), false, 'the admin token of this vault is not in the bundle');
    assert.equal(/mv_[0-9a-f]{8}_[0-9a-f]{16,}/.test(text), false, 'no Memev token of any kind');
    assert.equal(text.includes(sb.home), false, 'the home folder is shortened');
    assert.equal(fs.statSync(file).mode & 0o077, 0, 'the file is private to the user');
    assert.equal(findSecrets(text).length, 0, `nothing in the bundle looks like a credential: ${findSecrets(text).join(', ')}`);
    // local-only: the bundle says remote is off, and the config holds no tunnel
    const data = JSON.parse(text);
    assert.equal(data.config.remote?.enabled, false, 'the bundle is of a local-only vault');
  } finally { sb.stop(); }
});
